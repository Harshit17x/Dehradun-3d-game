import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Coordinates stay in local metres: X east, Y up, Z south. The overlay host
// owns the ENU rotation. Only footprints/POIs in the supplied dataset are used.
const MAX_COORD = 20000;
const MAX_VERTICES = 128;
const MAX_BUILDINGS = 5000;
const MAX_SHOPS = 18;
const PALETTE = ['#bc9e88', '#cec1a4', '#abb4a1', '#c2b49f', '#b99482', '#bebbb0'];
const pointOK = (p) => Array.isArray(p) && p.length >= 2
  && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= MAX_COORD && Math.abs(p[1]) <= MAX_COORD;
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function onSegment(p, a, b) {
  return Math.abs(cross(a, b, p)) < 1e-7
    && p[0] >= Math.min(a[0], b[0]) - 1e-7 && p[0] <= Math.max(a[0], b[0]) + 1e-7
    && p[1] >= Math.min(a[1], b[1]) - 1e-7 && p[1] <= Math.max(a[1], b[1]) + 1e-7;
}

function intersects(a, b, c, d) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

function validRing(input) {
  // Reject over-complex rings rather than inventing a simplified footprint.
  if (!Array.isArray(input) || input.length < 3 || input.length > MAX_VERTICES + 1 || !input.every(pointOK)) return null;
  const ring = input.filter((p, i) => !i || !same(p, input[i - 1])).map((p) => [p[0], p[1]]);
  if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3 || ring.length > MAX_VERTICES) return null;
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  if (Math.max(...xs) - Math.min(...xs) > 1000 || Math.max(...zs) - Math.min(...zs) > 1000) return null;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return null;
    }
  }
  return Math.abs(area) >= 4 ? ring : null;
}

function closestPoint(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = THREE.MathUtils.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return [a[0] + t * dx, a[1] + t * dz];
}

function coversTower(ring, tower) {
  const p = [tower.x, tower.z];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const near = closestPoint(p, a, b);
    // Include the model's base, even when the anchor is just outside a ring.
    if (Math.hypot(near[0] - p[0], near[1] - p[1]) <= 4.5) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

// One facade tile is 3.2 m wide and 3.4 m high; diagonal walls use edge length,
// not an X/Z projection. Thus windows have the same scale on every orientation.
const facadeUV = {
  generateTopUV(_geometry, vertices, a, b, c) {
    return [a, b, c].map((i) => new THREE.Vector2(vertices[i * 3] / 3.2, vertices[i * 3 + 1] / 3.2));
  },
  generateSideWallUV(_geometry, vertices, a, b, c, d) {
    const dx = vertices[b * 3] - vertices[a * 3];
    const dy = vertices[b * 3 + 1] - vertices[a * 3 + 1];
    const length = Math.hypot(dx, dy) || 1;
    return [a, b, c, d].map((i) => new THREE.Vector2(
      ((vertices[i * 3] - vertices[a * 3]) * dx + (vertices[i * 3 + 1] - vertices[a * 3 + 1]) * dy) / length / 3.2,
      vertices[i * 3 + 2] / 3.4,
    ));
  },
};

/**
 * Data-driven overlay; architecture, facade windows, awnings and landmark
 * detailing are generic approximations, not surveyed building appearances.
 * Labels contain unescaped plain text: hosts should insert names via textContent.
 */
export function createGeoWorld(data = {}) {
  data = data && typeof data === 'object' ? data : {};
  const group = new THREE.Group();
  group.name = 'Mapped Dehradun — approximate architecture';
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = 'Mapped buildings and storefronts';
  group.add(buildingsGroup);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const batches = new Map();
  const labels = [];
  let disposed = false;

  function material(color, options = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...options });
    materials.add(mat);
    return mat;
  }

  function texture(width, height, paint) {
    // Headless consumers still get valid geometry; browsers get shared textures.
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas')
      : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : null;
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    let ctx;
    try { ctx = canvas.getContext('2d'); } catch { return null; }
    if (!ctx) return null;
    paint(ctx, width, height);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    textures.add(map);
    return map;
  }

  function addBatch(geometry, mat, parent = buildingsGroup) {
    // Normalize attributes/indexes so all primitives of a material can merge.
    if (geometry.index) {
      const original = geometry;
      geometry = geometry.toNonIndexed();
      original.dispose();
    }
    geometry.clearGroups();
    let batch = batches.get(mat);
    if (!batch) batches.set(mat, batch = { parent, parts: [] });
    batch.parts.push(geometry);
  }

  const places = (Array.isArray(data.places) ? data.places : [])
    .filter((p) => p && pointOK([p.x, p.z]));
  const towerPlace = places.find((p) => /ghanta[\s_-]*ghar|clock[\s_-]*tower|घंटा\s*घर/i.test(`${p.name || ''} ${p.kind || ''} ${p.type || ''}`));
  const landmark = towerPlace ? { x: towerPlace.x, z: towerPlace.z, name: typeof towerPlace.name === 'string' && towerPlace.name.trim() ? towerPlace.name.trim() : 'Clock Tower' } : null;
  let wallMaterials, roofMaterial;
  function buildingMaterials() {
    if (wallMaterials) return;
    const map = texture(128, 128, (ctx) => {
      ctx.fillStyle = '#f1eee6'; ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#dfd9cf'; ctx.fillRect(0, 121, 128, 7);
      ctx.fillStyle = '#b8b4a9'; ctx.fillRect(34, 29, 62, 66);
      ctx.fillStyle = '#727f7c'; ctx.fillRect(39, 34, 52, 54);
      ctx.fillStyle = '#9ca7a1'; ctx.fillRect(42, 37, 19, 47);
      ctx.fillStyle = '#d3cfc2'; ctx.fillRect(63, 34, 3, 54); ctx.fillRect(33, 92, 64, 5);
    });
    if (map) map.wrapS = map.wrapT = THREE.RepeatWrapping;
    wallMaterials = PALETTE.map((color) => material(color, { map }));
    roofMaterial = material('#b3ada0');
  }

  for (const building of (Array.isArray(data.buildings) ? data.buildings : []).slice(0, MAX_BUILDINGS)) {
    if (!building) continue;
    const ring = validRing(building.ring);
    if (!ring || (landmark && coversTower(ring, landmark))) continue;
    // Missing height is a visibly approximate two-storey estimate; nonfinite or
    // negative explicit heights are invalid. Tall values are bounded for safety.
    const sourceHeight = building.height == null ? 7 : building.height;
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) continue;
    const height = THREE.MathUtils.clamp(sourceHeight, 2.5, 120);
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const extrusion = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1, UVGenerator: facadeUV });
    buildingMaterials();
    const mat = wallMaterials[hash(building.id ?? JSON.stringify(ring)) % PALETTE.length];
    // Split roof and sides for proper materials, omitting hidden bottom faces.
    for (const part of extrusion.groups) {
      const indices = [];
      const normals = extrusion.getAttribute('normal');
      for (let i = part.start; i < part.start + part.count; i += 3) {
        if (part.materialIndex === 0 && normals.getZ(i) < 0) continue;
        indices.push(i, i + 1, i + 2);
      }
      if (!indices.length) continue;
      const geometry = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const attribute = extrusion.getAttribute(name);
        const array = new Float32Array(indices.length * attribute.itemSize);
        indices.forEach((index, i) => {
          for (let k = 0; k < attribute.itemSize; k++) array[i * attribute.itemSize + k] = attribute.array[index * attribute.itemSize + k];
        });
        geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
      }
      geometry.rotateX(-Math.PI / 2);
      addBatch(geometry, part.materialIndex === 0 ? roofMaterial : mat);
    }
    extrusion.dispose();
  }

  if (landmark) {
    const cream = material('#eee4cb');
    const trim = material('#946754');
    const clockMap = texture(256, 256, (ctx) => {
      ctx.fillStyle = '#f5eedb'; ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#4b453e'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(128, 128, 117, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        ctx.beginPath(); ctx.moveTo(128 + Math.sin(angle) * 98, 128 - Math.cos(angle) * 98);
        ctx.lineTo(128 + Math.sin(angle) * 109, 128 - Math.cos(angle) * 109); ctx.stroke();
      }
      // Static illustrative face, not a claim about the landmark's working time.
      ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(82, 101); ctx.lineTo(128, 128); ctx.lineTo(173, 54); ctx.stroke();
    });
    const face = material('#ffffff', { map: clockMap });
    const cylinder = (bottom, top, height, y, mat) => {
      const g = new THREE.CylinderGeometry(top, bottom, height, 6, 1);
      g.translate(landmark.x, y + height / 2, landmark.z);
      addBatch(g, mat, group);
    };
    cylinder(4.3, 4.3, 0.65, 0, trim);
    cylinder(3.7, 3.7, 1.15, 0.65, cream);
    cylinder(3.2, 3.2, 0.45, 1.8, trim);
    cylinder(2.8, 2.65, 14.55, 2.25, cream);
    cylinder(2.9, 2.9, 0.4, 16.8, trim);
    cylinder(2.65, 2.65, 3.8, 17.2, cream);
    cylinder(3.05, 3.05, 0.45, 21, trim);
    cylinder(2.65, 2.3, 1.1, 21.45, cream);
    cylinder(2.5, 2.5, 0.35, 22.55, trim);
    cylinder(1.95, 1.65, 1.0, 22.9, cream);
    cylinder(1.8, 0.5, 1.1, 23.9, trim);
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 6 + i * Math.PI / 3;
      for (const [radius, offset, mat] of [[1.02, 0.04, trim], [0.87, 0.055, face]]) {
        const g = new THREE.CircleGeometry(radius, 24);
        g.rotateY(angle);
        const distance = 2.65 * Math.cos(Math.PI / 6) + offset;
        g.translate(landmark.x + Math.sin(angle) * distance, 19.05, landmark.z + Math.cos(angle) * distance);
        addBatch(g, mat, group);
      }
    }
    labels.push({ ...landmark, height: 25.5, kind: 'landmark' });
  }

  // Only named, mapped shop POIs close to an actual road qualify. Road geometry
  // is used solely for orientation/ranking; no mesh obscures the Google basemap.
  const roadSegments = [];
  for (const road of (Array.isArray(data.roads) ? data.roads : []).slice(0, 3000)) {
    const points = Array.isArray(road?.points) ? road.points : [];
    for (let i = 1; i < Math.min(points.length, 2048) && roadSegments.length < 30000; i++) {
      if (pointOK(points[i - 1]) && pointOK(points[i])) roadSegments.push([points[i - 1], points[i]]);
    }
  }
  const shops = [];
  const seen = new Set();
  for (const place of places.slice(0, 10000)) {
    if (typeof place.name !== 'string' || !place.name.trim()
      || !/shop|store|retail|cafe|restaurant|bakery|pharmacy|supermarket|market|bank/i.test(String(place.kind || ''))) continue;
    if (landmark && Math.hypot(place.x - landmark.x, place.z - landmark.z) < 6) continue;
    const key = `${place.name.trim().toLowerCase()}:${place.x.toFixed(1)}:${place.z.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let nearest = null, distance = 35;
    for (const [a, b] of roadSegments) {
      const p = closestPoint([place.x, place.z], a, b);
      const d = Math.hypot(place.x - p[0], place.z - p[1]);
      if (d < distance) { distance = d; nearest = p; }
    }
    if (nearest) shops.push({ place, nearest, distance });
  }
  shops.sort((a, b) => a.distance - b.distance || String(a.place.id ?? a.place.name).localeCompare(String(b.place.id ?? b.place.name)));
  let awningColor, awningLight;
  for (const { place, nearest } of shops.slice(0, MAX_SHOPS)) {
    awningColor ??= material('#8b6254');
    awningLight ??= material('#d9cfb6');
    const angle = Math.atan2(nearest[0] - place.x, nearest[1] - place.z);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BoxGeometry(0.45, 0.1, 1.1);
      g.translate((i - 2.5) * 0.45, 0, 0);
      g.rotateY(angle);
      g.translate(place.x, 2.9, place.z);
      addBatch(g, i % 2 ? awningLight : awningColor);
    }
    labels.push({ x: place.x, z: place.z, height: 4.1, name: place.name.trim(), kind: place.kind });
  }

  // At most 12 meshes/draw calls: 6 facades, roof, 3 landmark, 2 awnings.
  for (const [mat, { parent, parts }] of batches) {
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    geometries.add(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = parent === buildingsGroup ? 'Batched mapped architecture' : 'Approximate mapped clock tower';
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  batches.clear();
  // A missing dataset produces a truly empty root rather than a synthetic town.
  if (!buildingsGroup.children.length) group.remove(buildingsGroup);
  group.userData.architecture = 'Approximate facades and landmark model on dataset coordinates; not a survey.';

  return {
    group,
    labels,
    landmark,
    setBuildingsVisible(visible) {
      buildingsGroup.visible = Boolean(visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      buildingsGroup.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const map of textures) map.dispose();
      geometries.clear(); materials.clear(); textures.clear();
      labels.length = 0;
    },
  };
}
