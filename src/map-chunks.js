// Pure map partitioning: coordinates remain in the original local metre frame.
// Chunk data shares read-only feature metadata with its source; only clipped
// road/barrier records and their point arrays are new objects.
const FEATURES = ['roads', 'buildings', 'places', 'signals', 'crossings', 'streetLamps', 'barriers'];
const POINT_FEATURES = ['places', 'signals', 'crossings', 'streetLamps'];
const asArray = value => Array.isArray(value) ? value : [];
const finitePoint = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const keyOf = (cx, cz) => `${cx},${cz}`;

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a finite positive number`);
}

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite nonnegative number`);
}

function centroid(input) {
  if (input.length < 3 || !input.every(finitePoint)) return null;
  const count = samePoint(input[0], input.at(-1)) ? input.length - 1 : input.length;
  if (count < 3) return null;
  // Translate before calculating area to avoid cancellation far from origin.
  const [ox, oz] = input[0];
  let area = 0, x = 0, z = 0;
  for (let i = 0; i < count; i++) {
    const a = input[i], b = input[(i + 1) % count];
    const ax = a[0] - ox, az = a[1] - oz, bx = b[0] - ox, bz = b[1] - oz;
    const cross = ax * bz - bx * az;
    area += cross; x += (ax + bx) * cross; z += (az + bz) * cross;
  }
  if (area !== 0) return [ox + x / (3 * area), oz + z / (3 * area)];
  return [input.slice(0, count).reduce((sum, p) => sum + p[0], 0) / count,
    input.slice(0, count).reduce((sum, p) => sum + p[1], 0) / count];
}

// Visit every crossed cell once per segment. Shared endpoints are calculated
// once, with the intersected coordinate snapped exactly to the grid boundary.
function splitSegment(a, b, size, visit) {
  if (samePoint(a, b)) return;
  const events = [{ t: 0, point: a }, { t: 1, point: b }];
  for (let axis = 0; axis < 2; axis++) {
    if (a[axis] === b[axis]) continue;
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    for (let cell = Math.floor(lo / size) + 1; cell * size < hi; cell++) {
      const boundary = cell * size;
      events.push({ t: (boundary - a[axis]) / (b[axis] - a[axis]), axis, boundary });
    }
  }
  events.sort((a, b) => a.t - b.t);
  const cuts = [];
  for (const event of events) {
    let cut = cuts.at(-1);
    if (!cut || cut.t !== event.t) {
      cut = { t: event.t, point: event.point ? [...event.point] : [
        a[0] + (b[0] - a[0]) * event.t, a[1] + (b[1] - a[1]) * event.t,
      ] };
      cuts.push(cut);
    }
    if (event.axis !== undefined) cut.point[event.axis] = event.boundary;
  }
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1].point, end = cuts[i].point;
    if (samePoint(start, end)) continue;
    visit(Math.floor((start[0] + (end[0] - start[0]) / 2) / size),
      Math.floor((start[1] + (end[1] - start[1]) / 2) / size), start, end);
  }
}

/** Index a normalized OSM map once, without constructing render geometry. */
export function createMapChunkIndex(data = {}, { chunkSize = 200 } = {}) {
  positive(chunkSize, 'chunkSize');
  data = data && typeof data === 'object' ? data : {};
  const chunks = new Map();
  function cell(cx, cz) {
    const key = keyOf(cx, cz);
    let chunk = chunks.get(key);
    if (!chunk) {
      const local = { origin: data.origin, bounds: data.bounds };
      for (const feature of FEATURES) local[feature] = [];
      chunk = { key, cx, cz, data: local };
      chunks.set(key, chunk);
    }
    return chunk;
  }
  const at = (x, z) => cell(Math.floor(x / chunkSize), Math.floor(z / chunkSize));
  function indexLine(record, feature) {
    const points = asArray(record?.points);
    if (feature === 'barriers' && points.length === 1 && finitePoint(points[0])) {
      at(...points[0]).data.barriers.push(record);
      return;
    }
    let previousKey = null, previousPart = null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      // Invalid/missing nodes break a line; never filter them into a bridge.
      if (!finitePoint(a) || !finitePoint(b)) { previousKey = null; previousPart = null; continue; }
      splitSegment(a, b, chunkSize, (cx, cz, start, end) => {
        const chunk = cell(cx, cz);
        if (previousKey === chunk.key && samePoint(previousPart.points.at(-1), start)) {
          previousPart.points.push(end);
        } else {
          previousPart = { ...record, points: [start, end] };
          chunk.data[feature].push(previousPart);
          previousKey = chunk.key;
        }
      });
    }
  }
  for (const road of asArray(data.roads)) indexLine(road, 'roads');
  for (const building of asArray(data.buildings)) {
    const center = centroid(asArray(building?.ring));
    if (center && finitePoint(center)) at(...center).data.buildings.push(building);
  }
  for (const feature of POINT_FEATURES) for (const record of asArray(data[feature])) {
    if (record && Number.isFinite(record.x) && Number.isFinite(record.z)) at(record.x, record.z).data[feature].push(record);
  }
  for (const barrier of asArray(data.barriers)) indexLine(barrier, 'barriers');
  return { chunks, chunkSize };
}

function distanceToCellSquared(chunk, size, x, z) {
  const left = chunk.cx * size, top = chunk.cz * size;
  const dx = Math.max(left - x, 0, x - left - size);
  const dz = Math.max(top - z, 0, z - top - size);
  return dx * dx + dz * dz;
}

/**
 * Radius is measured to the chunk rectangle (centre distance breaks ties).
 * Only local grid cells are queried, never the entire city's feature arrays.
 * The hard cap is one synchronous build per update, even if the requested
 * maxBuildsPerUpdate is larger; budgetMs is a soft scheduling budget, not an
 * interruption deadline. Call each active handle's update(time) separately
 * when animated renderers need the application's simulation clock.
 */
export function createChunkStreamer({ index, buildChunk, loadRadius = 600, unloadRadius = 850,
  maxBuildsPerUpdate = 1, budgetMs = 4, now = () => performance.now() } = {}) {
  if (!(index?.chunks instanceof Map)) throw new TypeError('index.chunks must be a Map');
  positive(index.chunkSize, 'chunkSize');
  if (typeof buildChunk !== 'function' || typeof now !== 'function') throw new TypeError('buildChunk and now must be functions');
  nonnegative(loadRadius, 'loadRadius'); nonnegative(unloadRadius, 'unloadRadius');
  nonnegative(maxBuildsPerUpdate, 'maxBuildsPerUpdate'); nonnegative(budgetMs, 'budgetMs');
  if (unloadRadius < loadRadius) throw new RangeError('unloadRadius must be at least loadRadius');
  const active = new Map(), size = index.chunkSize;
  let disposed = false, mode = 'day', buildingsVisible = true;
  let pending = 0, builds = 0, labelVersion = 0;
  const getStats = () => ({ pending, active: active.size, total: index.chunks.size, builds, labelVersion });

  function update(x, z) {
    if (disposed) return getStats();
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Streaming position must be finite');
    const started = now();
    for (const [key, handle] of active) {
      const chunk = index.chunks.get(key);
      if (!chunk || distanceToCellSquared(chunk, size, x, z) > unloadRadius * unloadRadius) {
        active.delete(key); labelVersion++;
        handle.dispose();
      }
    }
    // Rebuild a small local queue on movement (or a repeated update), so old
    // distant requests cannot compete with the new position's nearest cells.
    const queue = [];
    for (let cx = Math.floor((x - loadRadius) / size); cx <= Math.floor((x + loadRadius) / size); cx++) {
      for (let cz = Math.floor((z - loadRadius) / size); cz <= Math.floor((z + loadRadius) / size); cz++) {
        const key = keyOf(cx, cz), chunk = index.chunks.get(key);
        if (!chunk || active.has(key)) continue;
        const distance = distanceToCellSquared(chunk, size, x, z);
        if (distance <= loadRadius * loadRadius) queue.push({ chunk, distance,
          centerDistance: ((cx + .5) * size - x) ** 2 + ((cz + .5) * size - z) ** 2 });
      }
    }
    queue.sort((a, b) => a.distance - b.distance || a.centerDistance - b.centerDistance
      || a.chunk.cx - b.chunk.cx || a.chunk.cz - b.chunk.cz);
    pending = queue.length;
    if (!disposed && pending && maxBuildsPerUpdate >= 1 && budgetMs > 0 && now() - started < budgetMs) {
      const chunk = queue[0].chunk;
      const handle = buildChunk(chunk);
      if (!handle || typeof handle.dispose !== 'function') throw new TypeError('buildChunk must return a disposable chunk handle');
      builds++;
      // A callback can dispose the controller; its newly created result must
      // also be released rather than resurrecting the active set.
      if (disposed) { handle.dispose(); return getStats(); }
      try {
        handle.setTimeOfDay?.(mode);
        handle.setBuildingsVisible?.(buildingsVisible);
      } catch (error) { handle.dispose(); throw error; }
      if (disposed) { handle.dispose(); return getStats(); }
      active.set(chunk.key, handle); pending--; labelVersion++;
    }
    return getStats();
  }

  function setTimeOfDay(value) {
    if (disposed) return;
    mode = value;
    for (const handle of active.values()) handle.setTimeOfDay?.(mode);
  }

  function setBuildingsVisible(value) {
    if (disposed) return;
    buildingsVisible = Boolean(value);
    for (const handle of active.values()) handle.setBuildingsVisible?.(buildingsVisible);
  }

  function dispose() {
    if (disposed) return;
    disposed = true; pending = 0;
    const handles = [...active.values()];
    labelVersion += active.size; active.clear();
    // Release every handle even if one renderer's cleanup fails.
    const errors = [];
    for (const handle of handles) { try { handle.dispose(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Failed to dispose map chunks');
  }

  return { update, setTimeOfDay, setBuildingsVisible, getStats, dispose, active };
}
