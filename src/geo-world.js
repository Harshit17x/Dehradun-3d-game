import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStreetInfrastructure } from './street-infrastructure.js';
import { getVisualTheme, normalizeVisualMode } from './geo-visuals.js';

// Buildings and the clock tower are deliberately generic illustrative geometry.
// Their footprints and POI locations come from the supplied map; facade detail
// does not claim to be a photographic or surveyed representation.
const MAX_COORD = 20000, MAX_VERTICES = 128;
const PALETTE = ['#bc9e88', '#cec1a4', '#abb4a1', '#c2b49f', '#b99482', '#bebbb0'];
const pointOK = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= MAX_COORD && Math.abs(p[1]) <= MAX_COORD;
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .01;
function validRing(input) {
  if (!Array.isArray(input) || input.length < 3 || input.length > MAX_VERTICES + 1 || !input.every(pointOK)) return null;
  const ring = input.filter((p, i) => !i || !same(p, input[i - 1])).map(([x, z]) => [x, z]);
  if (ring.length > 1 && same(ring[0], ring.at(-1))) ring.pop();
  if (ring.length < 3 || ring.length > MAX_VERTICES) return null;
  if (Math.max(...ring.map(p => p[0])) - Math.min(...ring.map(p => p[0])) > 1000 || Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1])) > 1000) return null;
  let area = 0; for (let i = 0; i < ring.length; i++) area += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
  return Math.abs(area) >= 4 ? ring : null;
}
function closestPoint(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], t = THREE.MathUtils.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1); return [a[0] + dx * t, a[1] + dz * t]; }
function coversTower(ring, tower) { let inside = false, p = [tower.x, tower.z]; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { if (Math.hypot(...closestPoint(p, ring[i], ring[j]).map((v, k) => v - p[k])) <= 4.5) return true; const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function hash(text) { let value = 2166136261; for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }

/**
 * Optional compatibility hook for handcrafted scenery. It is intentionally
 * disabled by default and labels every result as illustrative/uncertain. No
 * mapped feature is silently created by createGeoWorld.
 */
export function createIllustratedStreetFurniture(options = {}) {
  const group = new THREE.Group(); group.name = 'Optional illustrative street scenery (uncertain)';
  group.userData.provenance = 'Illustrative only; coordinates and identities are not verified OSM features.';
  if (!options.enabled) return { group, dispose() { group.clear(); } };
  // The old hand-authored showcase is kept behind this opt-in switch only.
  // These are deliberately called out as illustrative; they must never enter
  // the mapped default or the physics obstacle set.
  const materials = [new THREE.MeshStandardMaterial({ color: '#d6a11b', roughness: .75 }), new THREE.MeshStandardMaterial({ color: '#202326', roughness: .8 })];
  const meshes = [];
  const add = (geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.userData.uncertainty = 'illustrative, legacy handcrafted scenery'; group.add(mesh); meshes.push(mesh); };
  add(new THREE.BoxGeometry(2.8, .2, 2.8), materials[1], -8.5, .1, 12);
  add(new THREE.BoxGeometry(.28, 1.05, 4), materials[0], -14.5, .55, 18);
  add(new THREE.CylinderGeometry(.1, .13, 4.2, 8), materials[1], -5, 2.1, -2);
  return { group, dispose() { for (const mesh of meshes) mesh.geometry.dispose(); for (const mat of materials) mat.dispose(); group.clear(); } };
}

export function createGeoWorld(data = {}, options = {}) {
  data = data && typeof data === 'object' ? data : {};
  const group = new THREE.Group(); group.name = 'Mapped Dehradun — approximate architecture';
  const buildingsGroup = new THREE.Group(); buildingsGroup.name = 'Mapped buildings and storefronts'; group.add(buildingsGroup);
  const geometries = new Set(), materials = new Set(), textures = new Set(), batches = new Map(), labels = [];
  let disposed = false;
  const material = (color, opts = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .92, ...opts }); materials.add(m); return m; };
  const addBatch = (geometry, mat, parent = buildingsGroup) => { geometry.clearGroups(); const list = batches.get(mat) || batches.set(mat, { parent, parts: [] }).get(mat); list.parts.push(geometry); };
  const places = (Array.isArray(data.places) ? data.places : []).filter(p => p && pointOK([p.x, p.z]));
  const towerPlace = places.find(p => /ghanta[\s_-]*ghar|clock[\s_-]*tower|घंटा\s*घर/i.test(`${p.name || ''} ${p.kind || ''} ${p.type || ''}`));
  const landmark = towerPlace ? { x: towerPlace.x, z: towerPlace.z, name: String(towerPlace.name || 'Clock Tower') } : null;
  const wallMaterials = PALETTE.map(c => material(c)), roofMaterial = material('#b3ada0');
  for (const building of (Array.isArray(data.buildings) ? data.buildings : []).slice(0, 5000)) {
    const ring = validRing(building?.ring); if (!ring || landmark && coversTower(ring, landmark)) continue;
    const height = building.height == null ? 7 : Number(building.height); if (!Number.isFinite(height) || height <= 0) continue;
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const extrusion = new THREE.ExtrudeGeometry(shape, { depth: THREE.MathUtils.clamp(height, 2.5, 120), bevelEnabled: false, steps: 1 }); extrusion.rotateX(-Math.PI / 2);
    addBatch(extrusion, wallMaterials[hash(building.id ?? JSON.stringify(ring)) % wallMaterials.length]);
  }
  if (landmark) {
    const cream = material('#f0ead8'), trim = material('#9e4835');
    const cylinder = (r, h, y, mat) => { const g = new THREE.CylinderGeometry(r, r, h, 8); g.translate(landmark.x, y + h / 2, landmark.z); addBatch(g, mat, group); };
    cylinder(4.3, .65, 0, trim); cylinder(3.7, 1.15, .65, cream); cylinder(3.2, .45, 1.8, trim); cylinder(2.8, 14.55, 2.25, trim); cylinder(2.9, .4, 16.8, cream); cylinder(2.65, 3.8, 17.2, trim); cylinder(3.05, .45, 21, cream); cylinder(2.65, 1.1, 21.45, trim); cylinder(1.8, 1.1, 22.9, cream);
    labels.push({ ...landmark, height: 25.5, kind: 'landmark' });
  }
  const roads = Array.isArray(data.roads) ? data.roads : [], segments = [];
  for (const road of roads.slice(0, 3000)) for (let i = 1; i < (road.points || []).length; i++) if (pointOK(road.points[i - 1]) && pointOK(road.points[i])) segments.push([road.points[i - 1], road.points[i]]);
  const shops = [], seen = new Set();
  for (const place of places) {
    if (!place.name || !/shop|store|retail|cafe|restaurant|bakery|pharmacy|supermarket|market|bank/i.test(String(place.kind || ''))) continue;
    let nearest = null, distance = 35; for (const [a, b] of segments) { const p = closestPoint([place.x, place.z], a, b), d = Math.hypot(place.x - p[0], place.z - p[1]); if (d < distance) { distance = d; nearest = p; } }
    const key = `${place.name}:${place.x.toFixed(1)}:${place.z.toFixed(1)}`; if (nearest && !seen.has(key)) { seen.add(key); shops.push({ place, nearest }); }
  }
  const awning = material('#8b6254');
  for (const { place, nearest } of shops.slice(0, 18)) { const angle = Math.atan2(nearest[0] - place.x, nearest[1] - place.z); for (let i = 0; i < 6; i++) { const g = new THREE.BoxGeometry(.45, .1, 1.1); g.rotateY(angle); g.translate(place.x + (i - 2.5) * .45, 2.9, place.z); addBatch(g, awning); } labels.push({ x: place.x, z: place.z, height: 4.1, name: String(place.name).trim(), kind: place.kind }); }
  const infrastructure = createStreetInfrastructure(data); group.add(infrastructure.group);
  let illustrative = null;
  if (options.illustrativeStreetFurniture) { illustrative = createIllustratedStreetFurniture({ enabled: true }); group.add(illustrative.group); }
  for (const [mat, { parent, parts }] of batches) { const merged = mergeGeometries(parts, false); for (const part of parts) part.dispose(); if (!merged) continue; geometries.add(merged); merged.computeBoundingSphere(); const mesh = new THREE.Mesh(merged, mat); mesh.receiveShadow = true; parent.add(mesh); }
  batches.clear(); if (!buildingsGroup.children.length) group.remove(buildingsGroup);
  group.userData.architecture = 'Mapped footprints with generic approximate architecture. Street infrastructure is data-driven OSM only.';
  function setTimeOfDay(mode) {
    const visualMode = normalizeVisualMode(mode);
    const theme = getVisualTheme(visualMode);
    infrastructure.setNightMode(visualMode === 'night');
    group.userData.visualMode = visualMode;
    group.userData.visualTheme = theme.label;
  }
  setTimeOfDay('day');
  return { group, labels, landmark, infrastructure, setBuildingsVisible(visible) { buildingsGroup.visible = Boolean(visible); }, setTimeOfDay, update(time) { infrastructure.update(time); }, dispose() { if (disposed) return; disposed = true; infrastructure.dispose(); illustrative?.dispose(); group.removeFromParent(); group.clear(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose(); geometries.clear(); materials.clear(); textures.clear(); labels.length = 0; } };
}
