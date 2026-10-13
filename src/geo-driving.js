// Geographic simulation: metres, radians, seconds. Heading zero is north (-z),
// positive heading turns left. Rendering-independent; all geometry is supplied.
export const DEFAULT_ORIGIN = { lat: 30.32448, lng: 78.04187 };
const R = 6378137, DEG = Math.PI / 180, CELL = 24;
const CAR_RADIUS = 1.1;
const VEHICLE_RADIUS = 1.12;
const VEHICLE_HALF_LENGTH = 1.1;
const TOWER_RADIUS = 4.3;
const TOWER_RE = /ghanta[\s_-]*ghar|clock[\s_-]*tower|घंटा\s*घर/i;
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
function normalizeRing(ring) {
  if (!Array.isArray(ring)) return [];
  const result = [];
  for (const point of ring) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    if (!result.length || Math.hypot(point[0] - result.at(-1)[0], point[1] - result.at(-1)[1]) > 1e-9) {
      result.push([point[0], point[1]]);
    }
  }
  if (result.length > 1 && Math.hypot(result[0][0] - result.at(-1)[0], result[0][1] - result.at(-1)[1]) <= 1e-9) result.pop();
  return result;
}

export function pointInRing(x, z, ring) {
  ring = normalizeRing(ring);
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
function ringDistance(x, z, ring) {
  ring = normalizeRing(ring);
  let best = { distance: Infinity, x, z };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const hit = projectSegment(x, z, { ax: a[0], az: a[1], bx: b[0], bz: b[1] });
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
    const ring = normalizeRing(building.ring);
    if (ring.length < 3) continue;
    const obstacle = { ...building, ring };
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    obstacles.add(obstacle, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  }
  // Actual mapped tower nodes need a collision guard when no footprint is mapped.
  // Match the rendered model's 4.3m base, not an invented survey footprint.
  const towers = (data.places || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.z) && TOWER_RE.test(`${p.name || ''} ${p.kind || ''} ${p.type || ''}`));
  const tower = towers[0] ? { ...towers[0], radius: TOWER_RADIUS } : null;
  for (const p of towers) obstacles.add({ ...p, radius: TOWER_RADIUS }, p.x - TOWER_RADIUS, p.z - TOWER_RADIUS, p.x + TOWER_RADIUS, p.z + TOWER_RADIUS);
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
    for (const s of roads.near(x, z, radius + 0.5)) {
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
  function obstacleIntersectsPath(ax, az, bx, bz, radius, obstacle) {
    const path = { ax, az, bx, bz };
    if (!obstacle.ring) return projectSegment(obstacle.x, obstacle.z, path).distance < radius + obstacle.radius - 1e-9;
    if (pointInRing(ax, az, obstacle.ring) || pointInRing(bx, bz, obstacle.ring)) return true;
    for (let i = 0; i < obstacle.ring.length; i++) {
      const a = obstacle.ring[i], b = obstacle.ring[(i + 1) % obstacle.ring.length];
      if (segmentDistance(path, { ax: a[0], az: a[1], bx: b[0], bz: b[1] }) < radius - 1e-9) return true;
    }
    return false;
  }
  function roadCovers(points, radius, candidates, depth = 0) {
    if (candidates.some(s => points.every(p => projectSegment(p.x, p.z, s).distance <= s.width / 2 - radius + 1e-9))) return true;
    if (depth >= 12) return false;
    if (points.length === 2) {
      const [a, b] = points, m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (!candidates.some(s => projectSegment(m.x, m.z, s).distance <= s.width / 2 - radius + 1e-9)) return false;
      return roadCovers([a, m], radius, candidates, depth + 1) && roadCovers([m, b], radius, candidates, depth + 1);
    }
    // Convex triangles prove swept interior coverage, including at junctions.
    const [a, b, c] = points;
    const ab = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const bc = { x: (b.x + c.x) / 2, z: (b.z + c.z) / 2 };
    const ca = { x: (c.x + a.x) / 2, z: (c.z + a.z) / 2 };
    if (![ab, bc, ca].every(p => candidates.some(s => projectSegment(p.x, p.z, s).distance <= s.width / 2 - radius + 1e-9))) return false;
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].every(triangle => roadCovers(triangle, radius, candidates, depth + 1));
  }
  function circlePathClear(ax, az, bx, bz, radius) {
    if (!isDrivable(ax, az, radius) || !isDrivable(bx, bz, radius)) return false;
    const length = Math.hypot(bx - ax, bz - az);
    if (!roadCovers([{ x: ax, z: az }, { x: bx, z: bz }], radius, roads.near((ax + bx) / 2, (az + bz) / 2, length / 2 + radius))) return false;
    const candidates = obstacles.near((ax + bx) / 2, (az + bz) / 2, length / 2 + radius + 1);
    return !candidates.some(obstacle => obstacleIntersectsPath(ax, az, bx, bz, radius, obstacle));
  }
  function canMove(ax, az, bx, bz, radius = CAR_RADIUS) {
    return circlePathClear(ax, az, bx, bz, radius);
  }
  function vehicleCenters(x, z, heading) {
    const sx = Math.sin(heading) * VEHICLE_HALF_LENGTH, sz = Math.cos(heading) * VEHICLE_HALF_LENGTH;
    return [{ x: x - sx, z: z - sz }, { x: x + sx, z: z + sz }];
  }
  function vehicleAt(x, z, heading) {
    if (![x, z, heading].every(Number.isFinite)) return false;
    const [a, b] = vehicleCenters(x, z, heading);
    // The centreline is part of the capsule, so it must remain on one
    // continuous drivable corridor too; this rejects disconnected road jumps.
    return circlePathClear(a.x, a.z, b.x, b.z, VEHICLE_RADIUS);
  }
  const isVehicleDrivable = vehicleAt;
  function canVehicleMove(ax, az, bx, bz, heading, endHeading = heading) {
    if (![ax, az, bx, bz, heading, endHeading].every(Number.isFinite)) return false;
    if (!vehicleAt(ax, az, heading) || !vehicleAt(bx, bz, endHeading)) return false;
    const turn = Math.atan2(Math.sin(endHeading - heading), Math.cos(endHeading - heading));
    const length = Math.hypot(bx - ax, bz - az) + VEHICLE_HALF_LENGTH * Math.abs(turn);
    const steps = Math.max(1, Math.ceil(length / 0.12));
    const obstaclesOnPath = obstacles.near((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + VEHICLE_HALF_LENGTH + VEHICLE_RADIUS + 1);
    let previous = { x: ax, z: az, heading };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const current = { x: ax + (bx - ax) * t, z: az + (bz - az) * t, heading: heading + turn * t };
      if (!vehicleAt(current.x, current.z, current.heading)) return false;
      const before = vehicleCenters(previous.x, previous.z, previous.heading);
      const after = vehicleCenters(current.x, current.z, current.heading);
      // Every intermediate centreline lies in the convex hull of these four
      // endpoints, expanded by the circular-arc sagitta. This covers both yaw
      // and translation (including the sides between the endpoint circles).
      const radius = VEHICLE_RADIUS + VEHICLE_HALF_LENGTH * (1 - Math.cos(turn / steps / 2));
      const points = [...before, ...after];
      const candidates = roads.near(current.x, current.z, VEHICLE_HALF_LENGTH + radius + length / steps);
      // All four triangles cover the convex hull even when rotation crosses
      // the endpoint trajectories. Testing all six edges covers its boundary.
      for (const indices of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) {
        if (!roadCovers(indices.map(k => points[k]), radius, candidates)) return false;
      }
      for (const p of points) {
        if (p.x - radius < nw.x || p.x + radius > se.x || p.z - radius < nw.z || p.z + radius > se.z) return false;
      }
      for (let a = 0; a < points.length; a++) {
        for (let b = a + 1; b < points.length; b++) {
          if (obstaclesOnPath.some(obstacle => obstacleIntersectsPath(points[a].x, points[a].z, points[b].x, points[b].z, radius, obstacle))) return false;
        }
      }
      previous = current;
    }
    return true;
  }
  function spawnNear(x, z, options = {}) {
    const namePattern = options.roadName instanceof RegExp ? options.roadName : options.roadName ? new RegExp(String(options.roadName), 'i') : null;
    const pool = namePattern ? segments.filter(s => namePattern.test(s.name || '')) : segments;
    const ranked = pool.map(s => ({ s, p: projectSegment(x, z, s) })).sort((a, b) => a.p.distance - b.p.distance);
    for (const { s, p } of ranked) {
      // First try exact projection, then offsets away from mapped building edges.
      for (const t of [p.t, 0.5, 0.25, 0.75, 0, 1]) {
        const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az), nx = -(s.bz - s.az) / len, nz = (s.bx - s.ax) / len;
        for (const offset of [0, -0.5, 0.5, -1, 1]) {
          const sx = px + nx * offset, sz = pz + nz * offset;
          const heading = Number.isFinite(options.heading) ? options.heading : s.heading;
          if (isVehicleDrivable(sx, sz, heading)) return { x: sx, z: sz, heading, speed: 0, steering: 0, distance: 0 };
        }
      }
    }
    throw new Error('No collision-free spawn in the supplied road network');
  }
  return { segments, nearest, isDrivable, isVehicleDrivable, spawnNear, collisionAt, canMove, canVehicleMove, tower, bounds: { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z }, origin };
}

export function createGeoState(network) {
  if (network.tower) {
    // Start on the closest viable Rajpur-Mussoorie approach, facing the
    // mapped Ghanta Ghar node rather than an arbitrary way ordering.
    const tower = network.tower;
    let best = null;
    for (const segment of network.segments.filter(s => /rajpur/i.test(s.name || ''))) {
      const projected = projectSegment(tower.x, tower.z, segment);
      const length = Math.hypot(segment.bx - segment.ax, segment.bz - segment.az);
      for (let i = 0; i <= 24; i++) {
        const t = clamp(projected.t + (i - 12) * 1.5 / Math.max(length, 1), 0, 1);
        const x = segment.ax + (segment.bx - segment.ax) * t, z = segment.az + (segment.bz - segment.az) * t;
        const towardX = tower.x - x, towardZ = tower.z - z;
        const heading = Math.atan2(-towardX, -towardZ);
        if (!network.isVehicleDrivable(x, z, heading)) continue;
        const distance = Math.hypot(towardX, towardZ);
        if (!best || distance < best.distance) best = { x, z, heading, speed: 0, steering: 0, distance };
      }
    }
    if (best) return { ...best, heading: Math.atan2(Math.sin(best.heading), Math.cos(best.heading)), distance: 0 };
  }
  const target = network.tower || toLocal(DEFAULT_ORIGIN.lat + 0.0007, DEFAULT_ORIGIN.lng, network.origin);
  return network.spawnNear(target.x, target.z);
}

function move(state, dx, dz, targetHeading, network) {
  const originalLength = Math.hypot(dx, dz);
  const startX = state.x, startZ = state.z, startHeading = state.heading;
  const yaw = Math.atan2(Math.sin(targetHeading - startHeading), Math.cos(targetHeading - startHeading));

  if (originalLength < 1e-7) {
    if (Math.abs(yaw) > 1e-7 && network.canVehicleMove(startX, startZ, startX, startZ, startHeading, targetHeading)) {
      state.heading = targetHeading;
    }
    return;
  }

  if (network.canVehicleMove(startX, startZ, startX + dx, startZ + dz, startHeading, targetHeading)) {
    state.x += dx; state.z += dz; state.heading = targetHeading;
    state.distance += originalLength;
    return;
  }
  let lo = 0, hi = 1;
  for (let k = 0; k < 8; k++) {
    const t = (lo + hi) / 2;
    const h = startHeading + yaw * t;
    if (network.canVehicleMove(startX, startZ, startX + dx * t, startZ + dz * t, startHeading, h)) lo = t;
    else hi = t;
  }
  let travelled = originalLength * lo;
  state.x += dx * lo; state.z += dz * lo;
  state.heading = Math.atan2(Math.sin(startHeading + yaw * lo), Math.cos(startHeading + yaw * lo));
  state.distance += travelled;

  // Tangential road sliding when glancing or partially blocked
  if (lo < 0.99) {
    const unspent = 1 - lo;
    const remDx = dx * unspent, remDz = dz * unspent;
    const seg = network.nearest(state.x, state.z)?.segment;
    if (seg) {
      const segLen = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
      if (segLen > 0.01) {
        let tx = (seg.bx - seg.ax) / segLen, tz = (seg.bz - seg.az) / segLen;
        if (remDx * tx + remDz * tz < 0) { tx = -tx; tz = -tz; }
        const dot = remDx * tx + remDz * tz;
        if (dot > 1e-6) {
          const slideDx = tx * dot, slideDz = tz * dot;
          let sLo = 0, sHi = 1;
          for (let k = 0; k < 6; k++) {
            const st = (sLo + sHi) / 2;
            if (network.canVehicleMove(state.x, state.z, state.x + slideDx * st, state.z + slideDz * st, state.heading, state.heading)) sLo = st;
            else sHi = st;
          }
          if (sLo > 1e-4) {
            state.x += slideDx * sLo;
            state.z += slideDz * sLo;
            const slideDist = Math.hypot(slideDx, slideDz) * sLo;
            travelled += slideDist;
            state.distance += slideDist;
          }
        }
      }
    }
  }

  // If translation was blocked but in-place yaw is clear of obstacles:
  if (lo < 0.15 && Math.abs(yaw) > 1e-7) {
    if (network.canVehicleMove(state.x, state.z, state.x, state.z, state.heading, targetHeading)) {
      state.heading = targetHeading;
    }
  }

  if (originalLength > 1e-7) state.speed *= clamp(travelled / originalLength, 0, 1);
}

/** Smooth bicycle dynamics; bounded dt and conservative swept-capsule movement. */
export function stepGeoDriving(state, input = {}, dt = 0, network) {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  if (![state.x, state.z, state.heading, state.speed, state.steering, state.distance].every(Number.isFinite)) throw new TypeError('Driving state requires finite numeric fields');
  if (!network.isVehicleDrivable(state.x, state.z, state.heading)) { state.speed = 0; return state; }
  const count = Math.ceil(Math.min(dt, 0.1) * 100), h = Math.min(dt, 0.1) / count;
  for (let i = 0; i < count; i++) {
    const throttle = Number(Boolean(input.forward)) - Number(Boolean(input.reverse));
    const isBoost = Boolean(input.boost);
    const maxSpeed = isBoost ? 22.0 : 16.7;
    const accelMultiplier = isBoost ? 1.35 : 1.0;
    if (input.brake) state.speed = approach(state.speed, 0, 16 * h);
    else if (throttle && throttle * state.speed < -0.05) state.speed = approach(state.speed, 0, 12 * h);
    else if (throttle) state.speed += throttle * (throttle > 0 ? 5.2 : 3.5) * accelMultiplier * h;
    else state.speed = approach(state.speed, 0, (0.85 + Math.abs(state.speed) * 0.09) * h);
    state.speed = clamp(state.speed, -5, maxSpeed);
    const turn = Number(Boolean(input.left)) - Number(Boolean(input.right));
    const target = turn * 0.52 / (1 + Math.abs(state.speed) / 22);
    state.steering += (target - state.steering) * (1 - Math.exp(-8 * h));

    // When maneuvering from stop or blocked, use effective maneuver speed so wheels can steer out
    const steerSpeed = (throttle !== 0 && Math.abs(state.speed) < 1.0)
      ? (throttle * 1.0)
      : state.speed;
    const yaw = steerSpeed / 2.65 * Math.tan(state.steering) * h;
    const midpoint = state.heading + yaw / 2;
    const targetHeading = Math.atan2(Math.sin(state.heading + yaw), Math.cos(state.heading + yaw));
    move(state, -Math.sin(midpoint) * state.speed * h, -Math.cos(midpoint) * state.speed * h, targetHeading, network);
  }
  return state;
}
