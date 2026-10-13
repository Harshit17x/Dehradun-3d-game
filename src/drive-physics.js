// Metres, seconds and radians. This module deliberately has no rendering dependencies.
const CENTERS = [-160, -80, 0, 80, 160];
const EXTENT = 205;
const HALF_ROAD = 9;
const CAR_RADIUS = 2.4;
const gaps = [];
let edge = -EXTENT;
for (const center of CENTERS) {
  gaps.push([edge, center - HALF_ROAD]);
  edge = center + HALF_ROAD;
}
gaps.push([edge, EXTENT]);
const blocks = gaps.flatMap(([minX, maxX]) =>
  gaps.map(([minZ, maxZ]) => ({ minX, maxX, minZ, maxZ })),
);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, amount) =>
  value + clamp(target - value, -amount, amount);

export function createDrivingState() {
  return { x: -4.5, z: 40, heading: 0, speed: 0, steering: 0, distance: 0 };
}

export function isDrivable(x, z, radius = CAR_RADIUS) {
  if (![x, z, radius].every(Number.isFinite) || radius < 0) return false;
  if (Math.abs(x) + radius > EXTENT || Math.abs(z) + radius > EXTENT) return false;
  if (radius === 0) return CENTERS.some((center) => Math.abs(x - center) <= HALF_ROAD || Math.abs(z - center) <= HALF_ROAD);
  // The complement of the road union is the Cartesian product of the gaps.
  // Testing distance to those rectangles preserves the rounded intersection
  // corners, unlike shrinking each road independently (which leaves seams).
  for (const block of blocks) {
    const dx = x - clamp(x, block.minX, block.maxX);
    const dz = z - clamp(z, block.minZ, block.maxZ);
    if (dx * dx + dz * dz < radius * radius - 1e-10) return false;
  }
  return true;
}

// Sweep the whole footprint against the rounded Minkowski boundary of each
// sidewalk block. Continuous collision detection prevents diagonal corner cuts.
function sweep(x, z, dx, dz) {
  let hit = null;
  const consider = (t, nx, nz) => {
    if (t < -1e-9 || t > 1 || dx * nx + dz * nz >= -1e-10) return;
    if (!hit || t < hit.t) hit = { t: Math.max(0, t), nx, nz };
  };
  const bound = EXTENT - CAR_RADIUS;
  if (dx > 0) consider((bound - x) / dx, -1, 0);
  if (dx < 0) consider((-bound - x) / dx, 1, 0);
  if (dz > 0) consider((bound - z) / dz, 0, -1);
  if (dz < 0) consider((-bound - z) / dz, 0, 1);
  const a = dx * dx + dz * dz;
  if (a < 1e-18) return hit;
  for (const b of blocks) {
    if (Math.max(x, x + dx) < b.minX - CAR_RADIUS ||
        Math.min(x, x + dx) > b.maxX + CAR_RADIUS ||
        Math.max(z, z + dz) < b.minZ - CAR_RADIUS ||
        Math.min(z, z + dz) > b.maxZ + CAR_RADIUS) continue;
    for (const [face, normal] of [[b.minX - CAR_RADIUS, -1], [b.maxX + CAR_RADIUS, 1]]) {
      if (dx === 0) continue;
      const t = (face - x) / dx;
      const atZ = z + dz * t;
      if (atZ >= b.minZ && atZ <= b.maxZ) consider(t, normal, 0);
    }
    for (const [face, normal] of [[b.minZ - CAR_RADIUS, -1], [b.maxZ + CAR_RADIUS, 1]]) {
      if (dz === 0) continue;
      const t = (face - z) / dz;
      const atX = x + dx * t;
      if (atX >= b.minX && atX <= b.maxX) consider(t, 0, normal);
    }
    for (const [cx, sx] of [[b.minX, -1], [b.maxX, 1]]) {
      for (const [cz, sz] of [[b.minZ, -1], [b.maxZ, 1]]) {
        const ox = x - cx;
        const oz = z - cz;
        const dot = ox * dx + oz * dz;
        const discriminant = dot * dot - a * (ox * ox + oz * oz - CAR_RADIUS * CAR_RADIUS);
        if (discriminant < 0) continue;
        const t = (-dot - Math.sqrt(discriminant)) / a;
        const nx = (ox + dx * t) / CAR_RADIUS;
        const nz = (oz + dz * t) / CAR_RADIUS;
        if (nx * sx >= -1e-9 && nz * sz >= -1e-9) consider(t, nx, nz);
      }
    }
  }
  return hit;
}

function move(state, dx, dz) {
  let travelled = 0;
  for (let iteration = 0; iteration < 3; iteration++) {
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) break;
    const hit = sweep(state.x, state.z, dx, dz);
    const fraction = hit ? Math.max(0, hit.t - 1e-6 / length) : 1;
    state.x += dx * fraction;
    state.z += dz * fraction;
    travelled += length * fraction;
    if (!hit) break;
    dx *= 1 - fraction;
    dz *= 1 - fraction;
    const into = Math.min(0, dx * hit.nx + dz * hit.nz);
    const remaining = Math.hypot(dx, dz);
    dx -= into * hit.nx;
    dz -= into * hit.nz;
    // Keep tangent motion, dissipating the velocity component into the wall.
    if (remaining > 1e-9) state.speed *= Math.hypot(dx, dz) / remaining;
  }
  state.distance += travelled;
}

/** Mutates and returns state; dt is seconds, capped at 0.1 after tab pauses. */
export function stepDriving(state, input = {}, dt = 0) {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  if (![state.x, state.z, state.heading, state.speed, state.steering, state.distance].every(Number.isFinite)) {
    throw new TypeError('Driving state must contain finite numeric fields');
  }
  if (!isDrivable(state.x, state.z)) return state;
  const count = Math.ceil(Math.min(dt, 0.1) * 120);
  const h = Math.min(dt, 0.1) / count;
  for (let i = 0; i < count; i++) {
    const throttle = Number(Boolean(input.forward)) - Number(Boolean(input.reverse));
    if (input.brake) {
      state.speed = approach(state.speed, 0, 19 * h);
    } else if (throttle && state.speed * throttle < -0.05) {
      state.speed = approach(state.speed, 0, 13 * h);
    } else if (throttle) {
      state.speed += throttle * (throttle > 0 ? 7.5 : 4.5) * h;
    } else {
      state.speed = approach(state.speed, 0, (1.4 + Math.abs(state.speed) * 0.075) * h);
    }
    state.speed = clamp(state.speed, -8, 25);
    const turn = Number(Boolean(input.left)) - Number(Boolean(input.right));
    const maxSteering = 0.52 / (1 + Math.abs(state.speed) / 22);
    const target = turn * maxSteering;
    state.steering += (target - state.steering) * (1 - Math.exp(-7.5 * h));
    const yaw = state.speed / 2.65 * Math.tan(state.steering) * h;
    const midpoint = state.heading + yaw * 0.5;
    move(state, -Math.sin(midpoint) * state.speed * h, -Math.cos(midpoint) * state.speed * h);
    state.heading = Math.atan2(Math.sin(state.heading + yaw), Math.cos(state.heading + yaw));
  }
  return state;
}
