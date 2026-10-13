// Geographic simulation: metres, radians, seconds. Heading zero is north (-z),
// positive heading turns left. Rendering-independent; all geometry is supplied.
export const DEFAULT_ORIGIN = { lat: 30.32448, lng: 78.04187 };
const R = 6378137, DEG = Math.PI / 180, CELL = 24, CAR_RADIUS = 1.1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (v, target, amount) => v + clamp(target - v, -amount, amount);
export function toLocal(lat, lng, origin = DEFAULT_ORIGIN) {
  return { x: R * (lng - origin.lng) * DEG * Math.cos(origin.lat * DEG), z: -R * (lat - origin.lat) * DEG };
}
export function toLatLng(x, z, origin = DEFAULT_ORIGIN) {
  return { lat: origin.lat - z / (R * DEG), lng: origin.lng + x / (R * DEG * Math.cos(origin.lat * DEG)) };
}
export function projectSegment(x, z, segment) {
  const { ax, az, bx, bz } = segment;
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const px = ax + dx * t, pz = az + dz * t;
  return { x: px, z: pz, distance: Math.hypot(x - px, z - pz), t };
}
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
function ringDistance(x, z, ring) {
  let best = { distance: Infinity, x, z };
  for (let i = 0; i < ring.length - 1; i++) {
    const hit = projectSegment(x, z, { ax: ring[i][0], az: ring[i][1], bx: ring[i + 1][0], bz: ring[i + 1][1] });
    if (hit.distance < best.distance) best = hit;
  }
  const inside = pointInRing(x, z, ring);
  const sign = inside ? -1 : 1;
  return { clearance: best.distance * sign, nx: sign * (x - best.x) / (best.distance || 1), nz: sign * (z - best.z) / (best.distance || 1) };
}
export function circleIntersectsRing(x, z, radius, ring) {
  return ringDistance(x, z, ring).clearance < radius;
}
export function segmentDistance(a, b) {
  const cross = (ax, az, bx, bz) => ax * bz - az * bx;
  const dx = a.bx - a.ax, dz = a.bz - a.az, ex = b.bx - b.ax, ez = b.bz - b.az;
  const divisor = cross(dx, dz, ex, ez);
  if (Math.abs(divisor) > 1e-12) {
    const t = cross(b.ax - a.ax, b.az - a.az, ex, ez) / divisor;
    const u = cross(b.ax - a.ax, b.az - a.az, dx, dz) / divisor;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(projectSegment(a.ax, a.az, b).distance, projectSegment(a.bx, a.bz, b).distance, projectSegment(b.ax, b.az, a).distance, projectSegment(b.bx, b.bz, a).distance);
}
class Grid {
  cells = new Map();
  add(item, minX, minZ, maxX, maxZ) {
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const key = `${x},${z}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(item);
      }
    }
  }
  near(x, z, radius = 0) {
    if (!radius) return this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) || [];
    const result = new Set();
    for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
      for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++) {
        for (const item of this.cells.get(`${cx},${cz}`) || []) result.add(item);
      }
    }
    return [...result];
  }
}

export function createRoadNetwork(data) {
  const roads = new Grid(), obstacles = new Grid(), segments = [];
  const origin = data.origin || DEFAULT_ORIGIN;
  const nw = data.bounds ? toLocal(data.bounds.north, data.bounds.west, origin) : { x: -Infinity, z: -Infinity };
  const se = data.bounds ? toLocal(data.bounds.south, data.bounds.east, origin) : { x: Infinity, z: Infinity };
  for (const road of data.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1], [bx, bz] = road.points[i];
      if (Math.hypot(bx - ax, bz - az) < 0.001) continue;
      // Splitting long survey segments keeps each grid cell's candidate list small.
      const count = Math.ceil(Math.hypot(bx - ax, bz - az) / CELL);
      for (let k = 0; k < count; k++) {
        const a = k / count, b = (k + 1) / count;
        const s = { ax: ax + (bx - ax) * a, az: az + (bz - az) * a, bx: ax + (bx - ax) * b, bz: az + (bz - az) * b, width: road.width, name: road.name, roadId: road.id, heading: Math.atan2(ax - bx, az - bz) };
        const pad = s.width / 2;
        if (Math.max(s.ax, s.bx) + pad < nw.x || Math.min(s.ax, s.bx) - pad > se.x || Math.max(s.az, s.bz) + pad < nw.z || Math.min(s.az, s.bz) - pad > se.z) continue;
        segments.push(s);
        roads.add(s, Math.min(s.ax, s.bx) - pad, Math.min(s.az, s.bz) - pad, Math.max(s.ax, s.bx) + pad, Math.max(s.az, s.bz) + pad);
      }
    }
  }
  for (const building of data.buildings || []) {
    const xs = building.ring.map(p => p[0]), zs = building.ring.map(p => p[1]);
    obstacles.add(building, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  }
  // Actual mapped tower nodes need a collision guard when no footprint is mapped.
  // This conservative 3m radius is simulation clearance, not claimed OSM geometry.
  const towers = (data.places || []).filter(p => p.kind === 'clock_tower');
  for (const p of towers) obstacles.add({ ...p, radius: 3 }, p.x - 3, p.z - 3, p.x + 3, p.z + 3);
  if (!segments.length) throw new Error('No drivable OSM roads within map bounds');
  function nearest(x, z) {
    if (![x, z].every(Number.isFinite)) return null;
    let best = null;
    for (let range = CELL; range <= CELL * 16; range *= 2) {
      for (const segment of roads.near(x, z, range)) {
        const p = projectSegment(x, z, segment);
        if (!best || p.distance < best.distance) best = { ...p, heading: segment.heading, width: segment.width, name: segment.name, segment };
      }
      if (best && best.distance <= range) return best;
    }
    // Only spawn/explicit off-map queries use this fallback; never the frame loop.
    for (const segment of segments) {
      const p = projectSegment(x, z, segment);
      if (!best || p.distance < best.distance) best = { ...p, heading: segment.heading, width: segment.width, name: segment.name, segment };
    }
    return best;
  }
  function collisionAt(x, z, radius = CAR_RADIUS) {
    if (![x, z, radius].every(Number.isFinite) || radius < 0) return { drivable: false, clearance: -Infinity, nx: 0, nz: 0, reason: 'invalid' };
    let result = { clearance: -Infinity, nx: 0, nz: 0, reason: 'road' };
    for (const s of roads.near(x, z)) {
      const p = projectSegment(x, z, s), clearance = s.width / 2 - p.distance - radius;
      if (clearance > result.clearance) result = { clearance, nx: (p.x - x) / (p.distance || 1), nz: (p.z - z) / (p.distance || 1), reason: 'road', segment: s };
    }
    // Erosion of individual road capsules is conservative: the entire circular
    // car footprint stays inside at least one actual road corridor at all times.
    const limits = [[x - nw.x - radius, 1, 0], [se.x - x - radius, -1, 0], [z - nw.z - radius, 0, 1], [se.z - z - radius, 0, -1]];
    for (const [clearance, nx, nz] of limits) if (clearance < result.clearance) result = { clearance, nx, nz, reason: 'bounds' };
    for (const obstacle of obstacles.near(x, z, radius + 0.3)) {
      let hit;
      if (obstacle.ring) hit = ringDistance(x, z, obstacle.ring);
      else {
        const dx = x - obstacle.x, dz = z - obstacle.z, d = Math.hypot(dx, dz);
        hit = { clearance: d - obstacle.radius, nx: dx / (d || 1), nz: dz / (d || 1) };
      }
      hit.clearance -= radius;
      if (hit.clearance < result.clearance) result = { ...hit, reason: obstacle.ring ? 'building' : 'clock_tower', obstacle };
    }
    return { ...result, drivable: result.clearance >= -1e-9 };
  }
  const isDrivable = (x, z, radius = CAR_RADIUS) => collisionAt(x, z, radius).drivable;
  function canMove(ax, az, bx, bz, radius = CAR_RADIUS) {
    if (!isDrivable(ax, az, radius) || !isDrivable(bx, bz, radius)) return false;
    const candidates = roads.near(ax, az, Math.hypot(bx - ax, bz - az));
    // A capsule is convex: containment of both endpoints proves containment of
    // the complete swept footprint. Subdivision joins overlapping capsules only.
    const covered = (x1, z1, x2, z2, depth = 0) => {
      if (candidates.some(s => Math.max(projectSegment(x1, z1, s).distance, projectSegment(x2, z2, s).distance) <= s.width / 2 - radius + 1e-9)) return true;
      if (depth >= 10) return false;
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      if (!candidates.some(s => projectSegment(mx, mz, s).distance <= s.width / 2 - radius)) return false;
      return covered(x1, z1, mx, mz, depth + 1) && covered(mx, mz, x2, z2, depth + 1);
    };
    if (!covered(ax, az, bx, bz)) return false;
    const path = { ax, az, bx, bz };
    for (const obstacle of obstacles.near(ax, az, radius + Math.hypot(bx - ax, bz - az))) {
      if (!obstacle.ring) {
        if (projectSegment(obstacle.x, obstacle.z, path).distance < radius + obstacle.radius - 1e-9) return false;
      } else {
        for (let i = 1; i < obstacle.ring.length; i++) {
          const [ex, ez] = obstacle.ring[i - 1], [fx, fz] = obstacle.ring[i];
          if (segmentDistance(path, { ax: ex, az: ez, bx: fx, bz: fz }) < radius - 1e-9) return false;
        }
      }
    }
    return true;
  }
  function spawnNear(x, z) {
    const ranked = segments.map(s => ({ s, p: projectSegment(x, z, s) })).sort((a, b) => a.p.distance - b.p.distance);
    for (const { s, p } of ranked) {
      // First try exact projection, then offsets away from mapped building edges.
      for (const t of [p.t, 0.5, 0.25, 0.75, 0, 1]) {
        const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az), nx = -(s.bz - s.az) / len, nz = (s.bx - s.ax) / len;
        for (const offset of [0, -0.5, 0.5, -1, 1]) {
          const sx = px + nx * offset, sz = pz + nz * offset;
          if (isDrivable(sx, sz)) return { x: sx, z: sz, heading: s.heading, speed: 0, steering: 0, distance: 0 };
        }
      }
    }
    throw new Error('No collision-free spawn in the supplied road network');
  }
  return { segments, nearest, isDrivable, spawnNear, collisionAt, canMove, bounds: { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z }, origin };
}

export function createGeoState(network) {
  const target = toLocal(DEFAULT_ORIGIN.lat + 0.0007, DEFAULT_ORIGIN.lng, network.origin);
  const state = network.spawnNear(target.x, target.z);
  // Orient along the mapped north approach, towards north rather than OSM way order.
  if (Math.cos(state.heading) < 0) state.heading = Math.atan2(Math.sin(state.heading + Math.PI), Math.cos(state.heading + Math.PI));
  return state;
}

function move(state, dx, dz, network) {
  const originalLength = Math.hypot(dx, dz);
  let travelled = 0;
  for (let slide = 0; slide < 2; slide++) {
    const x = state.x, z = state.z;
    if (Math.hypot(dx, dz) < 1e-7) break;
    if (network.canMove(x, z, x + dx, z + dz)) {
      state.x += dx; state.z += dz; travelled += Math.hypot(dx, dz); break;
    }
    let lo = 0, hi = 1;
    for (let k = 0; k < 9; k++) {
      const t = (lo + hi) / 2;
      if (network.canMove(x, z, x + dx * t, z + dz * t)) lo = t;
      else hi = t;
    }
    const hit = network.collisionAt(x + dx * hi, z + dz * hi);
    state.x += dx * lo; state.z += dz * lo;
    travelled += Math.hypot(dx, dz) * lo;
    dx *= 1 - lo; dz *= 1 - lo;
    const inward = Math.min(0, dx * hit.nx + dz * hit.nz);
    dx -= inward * hit.nx; dz -= inward * hit.nz;
  }
  state.distance += travelled;
  if (originalLength > 1e-7) state.speed *= clamp(travelled / originalLength, 0, 1);
}

/** Smooth bicycle dynamics; bounded dt and <=0.2m exact swept-circle movement. */
export function stepGeoDriving(state, input = {}, dt = 0, network) {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  if (![state.x, state.z, state.heading, state.speed, state.steering, state.distance].every(Number.isFinite)) throw new TypeError('Driving state requires finite numeric fields');
  if (!network.isDrivable(state.x, state.z)) { state.speed = 0; return state; }
  const count = Math.ceil(Math.min(dt, 0.1) * 100), h = Math.min(dt, 0.1) / count;
  for (let i = 0; i < count; i++) {
    const throttle = Number(Boolean(input.forward)) - Number(Boolean(input.reverse));
    if (input.brake) state.speed = approach(state.speed, 0, 16 * h);
    else if (throttle && throttle * state.speed < -0.05) state.speed = approach(state.speed, 0, 12 * h);
    else if (throttle) state.speed += throttle * (throttle > 0 ? 5.2 : 3.5) * h;
    else state.speed = approach(state.speed, 0, (0.85 + Math.abs(state.speed) * 0.09) * h);
    state.speed = clamp(state.speed, -5, 16.7);
    const turn = Number(Boolean(input.left)) - Number(Boolean(input.right));
    const target = turn * 0.52 / (1 + Math.abs(state.speed) / 22);
    state.steering += (target - state.steering) * (1 - Math.exp(-8 * h));
    const yaw = state.speed / 2.65 * Math.tan(state.steering) * h;
    const midpoint = state.heading + yaw / 2;
    move(state, -Math.sin(midpoint) * state.speed * h, -Math.cos(midpoint) * state.speed * h, network);
    state.heading = Math.atan2(Math.sin(state.heading + yaw), Math.cos(state.heading + yaw));
  }
  return state;
}
