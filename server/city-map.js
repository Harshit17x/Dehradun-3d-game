import { CITY_BOUNDS, CITY_ORIGIN, isInsideBounds, normalizeOSM } from '../src/osm-normalize.js';

const CELL_LAT = 0.022;
const CELL_LNG = 0.026;
const CENTER_STEP = 0.006;
const MAX_BYTES = 25 * 1024 * 1024;
const ENDPOINTS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const round = (n) => Math.round(n * 1000) / 1000;
function cellFor(lat, lng) {
  const centerLat = CITY_ORIGIN.lat + Math.round((lat - CITY_ORIGIN.lat) / CENTER_STEP) * CENTER_STEP;
  const centerLng = CITY_ORIGIN.lng + Math.round((lng - CITY_ORIGIN.lng) / CENTER_STEP) * CENTER_STEP;
  return {
    centerLat, centerLng,
    bounds: { south: Math.max(CITY_BOUNDS.south, centerLat - CELL_LAT / 2), north: Math.min(CITY_BOUNDS.north, centerLat + CELL_LAT / 2), west: Math.max(CITY_BOUNDS.west, centerLng - CELL_LNG / 2), east: Math.min(CITY_BOUNDS.east, centerLng + CELL_LNG / 2) },
  };
}

function overpassQuery(bounds) {
  const b = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:90];(way[highway](${b});way[building](${b});relation[building](${b});nwr[name][shop](${b});nwr[name][amenity](${b});nwr[name][tourism](${b});nwr[name][historic](${b});nwr[man_made=clock_tower](${b});nwr["tower:type"=clock](${b});node[highway=traffic_signals](${b});node[highway=crossing](${b});node[highway=street_lamp](${b});nwr[barrier](${b}););out body geom;`;
}

async function responseJson(response, maxBytes = MAX_BYTES) {
  if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('OSM response exceeds 25 MB');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('OSM response exceeds 25 MB');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('OSM response exceeds 25 MB'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const isLocalOrigin = (value) => {
  if (!value) return true;
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname); } catch { return false; }
};

/** Create a local-only Connect middleware for bounded, fixed OSM map cells. */
export function createCityMapMiddleware({ fetcher = globalThis.fetch, endpoints = ENDPOINTS, maxBytes = MAX_BYTES, minRequestIntervalMs = 3000, timeoutMs = 110000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let lastFetchAt = 0;
  let queue = Promise.resolve();

  const trim = () => { while (cache.size > 6) cache.delete(cache.keys().next().value); };
  const waitForRate = async () => {
    const wait = Math.max(0, minRequestIntervalMs - (Date.now() - lastFetchAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastFetchAt = Date.now();
  };
  const fetchCell = (cell) => {
    const key = `${round(cell.centerLat)},${round(cell.centerLng)}`;
    if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return Promise.resolve(value); }
    if (pending.has(key)) return pending.get(key);
    const task = queue = queue.catch(() => {}).then(async () => {
      const query = overpassQuery(cell.bounds);
      let lastError;
      for (const endpoint of endpoints.slice(0, 2)) {
        try {
          await waitForRate();
          const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DehradunDriveMap/1.0 (public OSM geographic dataset)' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(timeoutMs) });
          const raw = await responseJson(response, maxBytes);
          if (raw.remark || !Array.isArray(raw.elements)) throw new Error(raw.remark || 'Invalid OSM response');
          const dataset = normalizeOSM(raw, { origin: CITY_ORIGIN, bounds: cell.bounds, source: 'OpenStreetMap via Overpass API', url: endpoint, scope: 'Dehradun city region' });
          if (!dataset.roads.length) throw new Error('OSM response contains no drivable roads');
          cache.set(key, dataset); trim();
          return dataset;
        } catch (error) { lastError = error; }
      }
      throw Object.assign(new Error(`OSM map unavailable: ${lastError?.message || 'all endpoints failed'}`), { cause: lastError });
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };

  return function cityMapMiddleware(req, res, next) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (!['/', '/api/city-map'].includes(requestUrl.pathname)) return next?.();
    if (req.method && req.method !== 'GET') return json(res, 405, { status: 'error', error: 'GET required' });
    if (!isLocalOrigin(req.headers?.origin || req.headers?.Origin)) return json(res, 403, { status: 'error', error: 'Local browser origin required' });
    const lat = Number(requestUrl.searchParams.get('lat')), lng = Number(requestUrl.searchParams.get('lng'));
    if (!isInsideBounds(lat, lng)) return json(res, 400, { status: 'error', error: 'lat/lng must be inside the Dehradun city region', bounds: CITY_BOUNDS });
    const cell = cellFor(lat, lng), key = `${round(cell.centerLat)},${round(cell.centerLng)}`;
    fetchCell(cell).then(dataset => json(res, 200, { status: 'ok', key, dataset })).catch(error => {
      const message = error?.message || 'Map request failed';
      json(res, /timeout|timed out/i.test(message) ? 504 : 502, { status: 'error', key, error: message, scope: 'Dehradun city region' });
    });
  };
}

export { CITY_BOUNDS, CITY_ORIGIN };
