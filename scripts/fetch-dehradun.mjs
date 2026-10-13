// Public OSM only. Run `node scripts/fetch-dehradun.mjs` to refresh the committed map.
import { writeFile } from 'node:fs/promises';
const origin = { lat: 30.32448, lng: 78.04187 };
const bounds = { south: 30.316, west: 78.033, north: 30.337, east: 78.051 };
const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
const query = `[out:json][timeout:90];(way[highway](${bbox});way[building](${bbox});relation[building](${bbox});nwr[name][shop](${bbox});nwr[name][amenity](${bbox});nwr[name][tourism](${bbox});nwr[name][historic](${bbox});nwr[man_made=clock_tower](${bbox});nwr["tower:type"=clock](${bbox}););out geom;`;
const endpoints = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'];
let raw, url, source = 'OpenStreetMap via Overpass API';
for (const endpoint of process.argv.includes('--osm-api') ? [] : endpoints) {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DehradunDriveMap/1.0 (public OSM geographic dataset)' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(110000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candidate = await response.json();
    if (candidate.remark || !Array.isArray(candidate.elements)) throw new Error(candidate.remark || 'Missing elements');
    raw = candidate; url = endpoint; break;
  } catch (error) { console.warn(`${endpoint}: ${error.message}`); }
}
if (!raw) {
  // Same real OSM database, public read-only map API; useful when Overpass is overloaded.
  url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'DehradunDriveMap/1.0 (public geographic map)' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Public OSM map fallback failed: HTTP ${response.status}; existing data unchanged.`);
  raw = await response.json();
  if (!Array.isArray(raw.elements)) throw new Error('Invalid OSM response; existing data unchanged.');
  const nodes = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  for (const element of raw.elements) {
    if (element.type === 'way') {
      const points = element.nodes.map(id => nodes.get(id));
      // Never connect across missing geometry.
      if (points.every(Boolean)) element.geometry = points.map(p => ({ lat: p.lat, lon: p.lon }));
    }
  }
  source = 'OpenStreetMap public map API';
}
const local = (lat, lng) => [+(6378137 * (lng - origin.lng) * Math.PI / 180 * Math.cos(origin.lat * Math.PI / 180)).toFixed(3), +(-6378137 * (lat - origin.lat) * Math.PI / 180).toFixed(3)];
const inside = (lat, lng) => lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const allowed = /^(trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)(?:_link)?$/;
const widths = { trunk: 13, primary: 11, secondary: 9, tertiary: 8, residential: 6, unclassified: 6, service: 4, living_street: 4 };
const metres = (value) => {
  if (!value) return NaN;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|')?$/i);
  return match ? Number(match[1]) * (/ft|'/.test(match[2] || '') ? 0.3048 : 1) : NaN;
};
const roads = [], buildings = [], places = [];
let excludedBuildingRelations = 0, excludedOpenBuildings = 0;
for (const element of raw.elements) {
  const tags = element.tags || {}, id = `${element.type}/${element.id}`;
  const geometry = element.geometry?.filter(valid) || [];
  if (element.type === 'way' && allowed.test(tags.highway || '') && !['no', 'private'].includes(tags.motor_vehicle || tags.vehicle || tags.access)) {
    if (geometry.length >= 2) {
      const taggedWidth = metres(tags.width), lanes = Number(tags.lanes);
      const estimated = Number.isFinite(lanes) && lanes > 0 && lanes <= 6 ? lanes * 3 : widths[tags.highway.replace('_link', '')];
      roads.push({ id, name: tags.name || tags['name:en'] || '', kind: tags.highway, width: Number.isFinite(taggedWidth) && taggedWidth >= 2 && taggedWidth <= 40 ? taggedWidth : estimated, widthSource: Number.isFinite(taggedWidth) && taggedWidth >= 2 && taggedWidth <= 40 ? 'OSM' : 'estimated', points: geometry.map(p => local(p.lat, p.lon)) });
    }
  }
  if (tags.building && tags.building !== 'no') {
    if (element.type === 'relation') excludedBuildingRelations++;
    else if (element.type === 'way') {
      const closed = geometry.length >= 4 && geometry[0].lat === geometry.at(-1).lat && geometry[0].lon === geometry.at(-1).lon;
      if (closed) {
        const height = metres(tags.height), levels = Number(tags['building:levels']);
        const tagged = Number.isFinite(height) && height > 0 ? height : levels > 0 && levels < 100 ? levels * 3 : NaN;
        buildings.push({ id, ring: geometry.map(p => local(p.lat, p.lon)), height: Number.isFinite(tagged) ? tagged : 6 + (element.id % 7), heightSource: Number.isFinite(tagged) ? 'OSM' : 'estimated', name: tags.name || '', kind: tags.building });
      } else excludedOpenBuildings++;
    }
  }
  const clock = tags.man_made === 'clock_tower' || tags['tower:type'] === 'clock';
  if ((tags.name && (tags.shop || tags.amenity || tags.tourism || tags.historic)) || clock) {
    // Ways use an actual coordinate from their geometry, never an invented location.
    const point = valid(element) ? element : geometry[Math.floor(geometry.length / 2)];
    if (point && inside(point.lat, point.lon)) {
      const [x, z] = local(point.lat, point.lon);
      places.push({ id, name: tags.name || 'Clock tower', lat: point.lat, lng: point.lon, x, z, kind: clock ? 'clock_tower' : tags.shop || tags.amenity || tags.historic || tags.tourism, source: 'OpenStreetMap', locationSource: element.type === 'node' ? 'OSM node' : 'OSM way vertex' });
    }
  }
}
if (!roads.length || !buildings.length) throw new Error('Incomplete map response; existing data has not been changed.');
const data = { origin, bounds, roads, buildings, places, provenance: { source, url, fetchedAt: new Date().toISOString(), osmTimestamp: raw.osm3s?.timestamp_osm_base || null, license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright', counts: { roads: roads.length, buildings: buildings.length, places: places.length, rawElements: raw.elements.length, excludedBuildingRelations, excludedOpenBuildings }, notes: ['Road widths are tagged or conservative class/lanes estimates; road ways may extend beyond the query bounds. Driving is clipped to the bounds.', 'Building relation multipolygons are excluded rather than incorrectly joined. Closed building ways only.', 'Missing building heights are deterministic 6–12 metre estimates. Tagged building levels use 3 metres per level.', 'Named point features use OSM coordinates; way labels use an actual way vertex. Relations without standalone geometry are omitted.'] } };
const serialized = `{"origin":${JSON.stringify(origin)},"bounds":${JSON.stringify(bounds)},\n"roads":[\n${roads.map(r => JSON.stringify(r)).join(',\n')}\n],"buildings":[\n${buildings.map(b => JSON.stringify(b)).join(',\n')}\n],"places":[\n${places.map(p => JSON.stringify(p)).join(',\n')}\n],"provenance":${JSON.stringify(data.provenance, null, 2)}\n}\n`;
await writeFile(new URL('../src/dehradun-data.json', import.meta.url), serialized);
console.log(JSON.stringify({ status: 'Public OSM map saved', url, ...data.provenance.counts }));
