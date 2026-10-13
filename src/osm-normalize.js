// Pure conversion of the public OSM JSON shapes used by Overpass and map.json.
// No feature in this module is invented: a feature is emitted only when OSM
// supplied a usable coordinate (and a way is never stitched across missing
// node references).

export const CITY_BOUNDS = Object.freeze({ south: 30.24, north: 30.43, west: 77.94, east: 78.17 });
export const CITY_ORIGIN = Object.freeze({ lat: 30.32448, lng: 78.04187 });

const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)(?:_link)?$/;
const ROAD_WIDTHS = { motorway: 14, trunk: 13, primary: 11, secondary: 9, tertiary: 8, residential: 6, unclassified: 6, service: 4, living_street: 4 };

const finitePoint = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon ?? p.lng));
const point = (p) => ({ lat: Number(p.lat), lng: Number(p.lon ?? p.lng) });
const same = (a, b) => a && b && a.lat === b.lat && a.lng === b.lng;

function validBounds(bounds) {
  if (!bounds || ![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite)) throw new Error('Invalid map bounds');
  if (!(bounds.south < bounds.north && bounds.west < bounds.east)) throw new Error('Invalid map bounds ordering');
  return { south: bounds.south, north: bounds.north, west: bounds.west, east: bounds.east };
}

function local(lat, lng, origin) {
  const metresPerDegree = 6378137 * Math.PI / 180;
  return [+(metresPerDegree * (lng - origin.lng) * Math.cos(origin.lat * Math.PI / 180)).toFixed(3), +(-metresPerDegree * (lat - origin.lat)).toFixed(3)];
}

function metres(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|')?$/i);
  return match ? Number(match[1]) * (/ft|'/i.test(match[2] || '') ? 0.3048 : 1) : NaN;
}

function clipSegment(a, b, bounds) {
  // Liang-Barsky in lat/lng space. This keeps roads/barriers within the
  // requested city cell without joining unrelated segments.
  let t0 = 0, t1 = 1;
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  for (const [p, q] of [[-dx, a.lng - bounds.west], [dx, bounds.east - a.lng], [-dy, a.lat - bounds.south], [dy, bounds.north - a.lat]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ lat: a.lat + (b.lat - a.lat) * t0, lng: a.lng + dx * t0 }, { lat: a.lat + (b.lat - a.lat) * t1, lng: a.lng + dx * t1 }];
}

function clipLine(line, bounds) {
  const out = [];
  for (let i = 1; i < line.length; i++) {
    const segment = clipSegment(line[i - 1], line[i], bounds);
    if (!segment) continue;
    for (const p of segment) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  }
  return out;
}

function clipPolygon(input, bounds) {
  let polygon = input.slice();
  const edges = [
    [p => p.lng >= bounds.west, (a, b) => ({ lat: a.lat + (b.lat - a.lat) * ((bounds.west - a.lng) / (b.lng - a.lng)), lng: bounds.west })],
    [p => p.lng <= bounds.east, (a, b) => ({ lat: a.lat + (b.lat - a.lat) * ((bounds.east - a.lng) / (b.lng - a.lng)), lng: bounds.east })],
    [p => p.lat >= bounds.south, (a, b) => ({ lat: bounds.south, lng: a.lng + (b.lng - a.lng) * ((bounds.south - a.lat) / (b.lat - a.lat)) })],
    [p => p.lat <= bounds.north, (a, b) => ({ lat: bounds.north, lng: a.lng + (b.lng - a.lng) * ((bounds.north - a.lat) / (b.lat - a.lat)) })],
  ];
  for (const [inside, intersection] of edges) {
    const next = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], ai = inside(a), bi = inside(b);
      if (ai && bi) next.push(b);
      else if (ai && !bi) next.push(intersection(a, b));
      else if (!ai && bi) next.push(intersection(a, b), b);
    }
    polygon = next;
  }
  return polygon;
}

function centroid(ring) {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i].lng * ring[i + 1].lat - ring[i + 1].lng * ring[i].lat;
    area += cross; x += (ring[i].lng + ring[i + 1].lng) * cross; y += (ring[i].lat + ring[i + 1].lat) * cross;
  }
  if (Math.abs(area) < 1e-12) return { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length };
  return { lat: y / (3 * area), lng: x / (3 * area) };
}

function polygonContains(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

function interiorCentroid(ring) {
  const candidate = centroid(ring);
  if (polygonContains(candidate, ring)) return candidate;
  // Concave ways can have an area centroid outside their polygon. Move it
  // toward a real OSM vertex until it is inside; the final fallback is still
  // an actual way coordinate, never a made-up map point.
  let current = candidate;
  for (let i = 0; i < 12; i++) {
    current = { lat: (current.lat + ring[0].lat) / 2, lng: (current.lng + ring[0].lng) / 2 };
    if (polygonContains(current, ring)) return current;
  }
  return ring[0];
}

function wayGeometry(element, nodes) {
  if (Array.isArray(element.geometry)) return element.geometry.filter(finitePoint).map(point);
  if (!Array.isArray(element.nodes)) return [];
  const resolved = element.nodes.map(id => nodes.get(id));
  return resolved.every(Boolean) ? resolved.map(point) : [];
}

function tagsOf(element) { return { ...(element.tags || {}) }; }

/** Normalize a validated OSM JSON response into the game's map contract. */
export function normalizeOSM(raw, { origin = CITY_ORIGIN, bounds = CITY_BOUNDS, source = 'OpenStreetMap via Overpass API', url = null, fetchedAt = new Date().toISOString(), scope = 'Dehradun city region' } = {}) {
  if (!raw || !Array.isArray(raw.elements)) throw new Error('Invalid OSM response: missing elements');
  const clipBounds = validBounds(bounds);
  const localOrigin = { lat: Number(origin.lat), lng: Number(origin.lng) };
  if (!Number.isFinite(localOrigin.lat) || !Number.isFinite(localOrigin.lng)) throw new Error('Invalid map origin');
  const elements = raw.elements;
  const nodes = new Map(elements.filter(e => e?.type === 'node' && Number.isFinite(Number(e.id)) && finitePoint(e)).map(e => [e.id, e]));
  const roads = [], buildings = [], places = [], signals = [], crossings = [], barriers = [], streetLamps = [];
  let excludedBuildingRelations = 0, excludedOpenBuildings = 0, incompleteWays = 0;
  const inside = (p) => p.lat >= clipBounds.south && p.lat <= clipBounds.north && p.lng >= clipBounds.west && p.lng <= clipBounds.east;

  for (const element of elements) {
    if (!element || !element.type || element.id === undefined) continue;
    const tags = tagsOf(element), id = `${element.type}/${element.id}`;
    const geometry = wayGeometry(element, nodes);
    const osmPoint = element.type === 'node' && finitePoint(element) ? point(element) : null;

    if (element.type === 'way' && DRIVABLE.test(tags.highway || '') && !['no', 'private'].includes(tags.motor_vehicle || tags.vehicle || tags.access)) {
      if (!geometry.length && element.nodes) incompleteWays++;
      const clipped = clipLine(geometry, clipBounds);
      if (clipped.length >= 2) {
        const taggedWidth = metres(tags.width), laneCount = Number(tags.lanes), baseKind = tags.highway.replace('_link', '');
        const estimated = Number.isFinite(laneCount) && laneCount > 0 && laneCount <= 6 ? laneCount * 3 : ROAD_WIDTHS[baseKind] || 6;
        const width = Number.isFinite(taggedWidth) && taggedWidth >= 2 && taggedWidth <= 40 ? taggedWidth : estimated;
        roads.push({ id, name: tags.name || tags['name:en'] || '', kind: tags.highway, width, widthSource: Number.isFinite(taggedWidth) && taggedWidth >= 2 && taggedWidth <= 40 ? 'OSM' : 'estimated', oneway: tags.oneway || null, surface: tags.surface || null, lanes: tags.lanes || null, bridge: tags.bridge || null, layer: tags.layer || null, points: clipped.map(p => local(p.lat, p.lng, localOrigin)) });
      }
    }

    if (tags.building && tags.building !== 'no') {
      if (element.type === 'relation') excludedBuildingRelations++;
      else if (element.type === 'way') {
        const closed = geometry.length >= 4 && same(geometry[0], geometry[geometry.length - 1]);
        if (!closed) excludedOpenBuildings++;
        else {
          const clipped = clipPolygon(geometry.slice(0, -1), clipBounds);
          if (clipped.length >= 3) {
            clipped.push(clipped[0]);
            const height = metres(tags.height), levels = Number(tags['building:levels']);
            const tagged = Number.isFinite(height) && height > 0 ? height : levels > 0 && levels < 100 ? levels * 3 : NaN;
            buildings.push({ id, ring: clipped.map(p => local(p.lat, p.lng, localOrigin)), height: Number.isFinite(tagged) ? tagged : 6, heightSource: Number.isFinite(tagged) ? 'OSM' : 'estimated', name: tags.name || '', kind: tags.building });
          }
        }
      }
    }

    const signal = tags.highway === 'traffic_signals' || (tags.highway === 'crossing' && (tags['crossing:signals'] || tags.crossing === 'traffic_signals'));
    if (osmPoint && inside(osmPoint)) {
      const [x, z] = local(osmPoint.lat, osmPoint.lng, localOrigin);
      const infrastructure = { id, x, z, lat: osmPoint.lat, lng: osmPoint.lng, tags, source: 'OpenStreetMap', locationSource: 'OSM control node' };
      if (signal) signals.push(infrastructure);
      if (tags.highway === 'crossing') crossings.push(infrastructure);
      if (tags.highway === 'street_lamp') streetLamps.push(infrastructure);
    }

    if (tags.barrier && (element.type === 'node' || element.type === 'way')) {
      const clipped = element.type === 'node' ? (osmPoint && inside(osmPoint) ? [osmPoint] : []) : clipLine(geometry, clipBounds);
      if ((element.type === 'node' && clipped.length) || clipped.length >= 2) {
        barriers.push({ id, kind: tags.barrier, points: clipped.map(p => local(p.lat, p.lng, localOrigin)), width: Number.isFinite(metres(tags.width)) ? metres(tags.width) : null, height: Number.isFinite(metres(tags.height)) ? metres(tags.height) : null, tags, source: 'OpenStreetMap' });
      }
    }

    const clock = tags.man_made === 'clock_tower' || tags['tower:type'] === 'clock';
    if ((tags.name && (tags.shop || tags.amenity || tags.tourism || tags.historic)) || clock) {
      const location = osmPoint || (geometry.length >= 3 ? interiorCentroid(geometry) : null);
      if (location && inside(location)) {
        const [x, z] = local(location.lat, location.lng, localOrigin);
        places.push({ id, name: tags.name || 'Clock tower', lat: location.lat, lng: location.lng, x, z, kind: clock ? 'clock_tower' : tags.shop || tags.amenity || tags.historic || tags.tourism, source: 'OpenStreetMap', locationSource: osmPoint ? 'OSM node' : 'OSM way centroid' });
      }
    }
  }

  const counts = { roads: roads.length, buildings: buildings.length, places: places.length, signals: signals.length, crossings: crossings.length, barriers: barriers.length, streetLamps: streetLamps.length, rawElements: elements.length, excludedBuildingRelations, excludedOpenBuildings, incompleteWays };
  return { origin: localOrigin, bounds: clipBounds, cityBounds: CITY_BOUNDS, roads, buildings, places, signals, crossings, barriers, streetLamps, infrastructure: { signals, crossings, barriers, streetLamps }, provenance: { source, url, fetchedAt, osmTimestamp: raw.osm3s?.timestamp_osm_base || null, license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright', scope, counts, notes: ['Dehradun city region means the bounded city area (south 30.24, north 30.43, west 77.94, east 78.17), not the Dehradun district.', 'Closed building ways only; incomplete ways and building relations are omitted rather than joined or fabricated.', 'Road widths and missing building heights are conservative rendering estimates; locations and infrastructure coordinates are from OSM.'] } };
}

export const isInsideBounds = (lat, lng, bounds = CITY_BOUNDS) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= bounds.south && Number(lat) <= bounds.north && Number(lng) >= bounds.west && Number(lng) <= bounds.east;
