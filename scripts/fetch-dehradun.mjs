// Public OSM only. Refreshes the small committed urban extract atomically:
// `node scripts/fetch-dehradun.mjs`. The city loader handles arbitrary city
// cells at runtime; this file is deliberately not a district-sized default.
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY_ORIGIN, normalizeOSM } from '../src/osm-normalize.js';

const districtMode = process.argv.includes('--district') || process.argv.includes('--district-buildings');
const districtBuildings = process.argv.includes('--district-buildings');
const origin = CITY_ORIGIN;
const bounds = districtMode
  ? { south: 29.9621668, west: 77.57133, north: 31.0375282, east: 78.3104149 }
  : { south: 30.320, west: 78.037, north: 30.329, east: 78.047 };
const output = new URL(districtMode ? '../src/dehradun-district-data.json' : '../src/dehradun-data.json', import.meta.url);
const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
const query = districtMode
  ? `[out:json][timeout:180];area(3600374983)->.district;(way[highway](area.district);nwr[name][shop](area.district);nwr[name][amenity](area.district);nwr[name][tourism](area.district);nwr[name][historic](area.district);nwr[man_made=clock_tower](area.district);nwr["tower:type"=clock](area.district);node[highway=traffic_signals](area.district);node[highway=crossing](area.district);node[highway=street_lamp](area.district);nwr[barrier](area.district);${districtBuildings ? 'way[building](area.district);' : ''});out body geom;`
  : `[out:json][timeout:90];(way[highway](${bbox});way[building](${bbox});relation[building](${bbox});nwr[name][shop](${bbox});nwr[name][amenity](${bbox});nwr[name][tourism](${bbox});nwr[name][historic](${bbox});nwr[man_made=clock_tower](${bbox});nwr["tower:type"=clock](${bbox});node[highway=traffic_signals](${bbox});node[highway=crossing](${bbox});node[highway=street_lamp](${bbox});nwr[barrier](${bbox}););out body geom;`;
const endpoints = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let raw, url, source = 'OpenStreetMap via Overpass API', lastError;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DehradunDriveMap/1.0 (public OSM geographic dataset)' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(110000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candidate = await response.json();
    if (candidate.remark || !Array.isArray(candidate.elements)) throw new Error(candidate.remark || 'Missing elements');
    raw = candidate; url = endpoint; break;
  } catch (error) { lastError = error; console.warn(`${endpoint}: ${error.message}`); }
}

if (!raw) {
  // The public map API is intentionally available only for a <=0.01° square.
  // It is not a fallback for district or city-sized requests.
  const height = bounds.north - bounds.south, width = bounds.east - bounds.west;
  if (Math.max(height, width) > 0.01) throw new Error(`Overpass unavailable (${lastError?.message || 'unknown error'}); map fallback is limited to <=0.01° square and existing data was unchanged.`);
  url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'DehradunDriveMap/1.0 (public geographic map)' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Public OSM map fallback failed: HTTP ${response.status}; existing data unchanged.`);
  raw = await response.json();
  if (!Array.isArray(raw.elements)) throw new Error('Invalid OSM response; existing data unchanged.');
  source = 'OpenStreetMap public map API';
}

const data = normalizeOSM(raw, { origin, bounds, source, url, fetchedAt: new Date().toISOString(), scope: districtMode ? 'Dehradun district extract (explicit opt-in)' : 'Dehradun city region urban extract' });
if (!data.roads.length || (!districtMode && !data.buildings.length) || (districtMode && districtBuildings && !data.buildings.length)) throw new Error('Incomplete normalized map response; existing data was unchanged.');

const serialized = `${JSON.stringify(data)}\n`;
const target = fileURLToPath(output), temp = join(dirname(target), `.${target.split('/').pop()}.${process.pid}.tmp`);
await writeFile(temp, serialized, 'utf8');
await rename(temp, target);
console.log(JSON.stringify({ status: 'Public OSM map saved', output: target, url, ...data.provenance.counts }));
