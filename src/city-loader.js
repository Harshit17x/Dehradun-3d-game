import { CITY_BOUNDS, isInsideBounds } from './osm-normalize.js';

const abortError = () => Object.assign(new Error('City map request superseded'), { name: 'AbortError' });
const finite = (n) => Number.isFinite(Number(n));
const validPoint = (p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);

function validDataset(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.roads) || value.roads.length === 0 || !Array.isArray(value.buildings) || !Array.isArray(value.places)) return false;
  for (const road of value.roads) if (!Array.isArray(road.points) || road.points.length < 2 || road.points.some(p => !validPoint(p))) return false;
  for (const building of value.buildings) if (!Array.isArray(building.ring) || building.ring.length < 4 || building.ring.some(p => !validPoint(p))) return false;
  for (const list of ['signals', 'crossings', 'streetLamps', 'barriers']) if (value[list] !== undefined && !Array.isArray(value[list])) return false;
  for (const barrier of value.barriers || []) if (!Array.isArray(barrier.points) || !barrier.points.length || barrier.points.some(p => !validPoint(p))) return false;
  return value.provenance?.scope === 'Dehradun city region';
}

export { CITY_BOUNDS };
export const insideCity = (lat, lng) => isInsideBounds(lat, lng, CITY_BOUNDS);

/** Load the overlapping OSM cell containing a city coordinate. */
export function createCityLoader({ fetcher = globalThis.fetch, onStatus = () => {} } = {}) {
  let sequence = 0;
  let active;
  let disposed = false;
  const status = (event, id) => { if (!disposed && id === sequence) onStatus(event); };

  async function load(lat, lng, { signal } = {}) {
    if (disposed) throw new Error('City loader disposed');
    if (!insideCity(lat, lng)) throw new RangeError('lat/lng must be inside the Dehradun city region');
    const id = ++sequence;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    let removeExternal;
    if (signal) {
      if (signal.aborted) controller.abort();
      else { removeExternal = () => controller.abort(); signal.addEventListener('abort', removeExternal, { once: true }); }
    }
    status({ status: 'loading', lat: Number(lat), lng: Number(lng) }, id);
    try {
      const url = `/api/city-map?lat=${encodeURIComponent(Number(lat))}&lng=${encodeURIComponent(Number(lng))}`;
      const response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response?.ok) {
        let detail = `HTTP ${response?.status || 'unknown'}`;
        try { const body = await response.json(); detail = body.error || detail; } catch { /* response body is optional */ }
        throw new Error(detail);
      }
      const body = await response.json();
      const dataset = body?.dataset?.roads ? body.dataset : body;
      if (body?.status && body.status !== 'ok') throw new Error(body.error || 'City map request failed');
      if (!validDataset(dataset)) throw new Error('Invalid city map response');
      if (controller.signal.aborted || id !== sequence || disposed) throw abortError();
      status({ status: 'loaded', lat: Number(lat), lng: Number(lng), dataset }, id);
      return dataset;
    } catch (error) {
      if (controller.signal.aborted || id !== sequence || disposed || error?.name === 'AbortError') {
        if (id === sequence && !disposed) onStatus({ status: 'aborted', error });
        throw error?.name === 'AbortError' ? error : abortError();
      }
      status({ status: 'error', error, lat: Number(lat), lng: Number(lng) }, id);
      throw error;
    } finally {
      removeExternal?.();
      if (active === controller) active = null;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true; sequence++;
    active?.abort(); active = null;
    onStatus({ status: 'disposed' });
  }
  return { load, dispose };
}
