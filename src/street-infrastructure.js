import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// This module deliberately has no fallback fixtures.  An OSM control node is an
// intersection/control point, not a survey of a signal pole.  Pole placement is
// therefore an explicitly-labelled rendering inference from the nearest mapped
// road edge; the source coordinate remains available in userData.provenance.
const MAX_COORD = 20000;
const finitePoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= MAX_COORD && Math.abs(p[1]) <= MAX_COORD;
const asArray = (value) => Array.isArray(value) ? value : [];
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function sourceRecord(record, type) {
  return record && typeof record === 'object'
    && Number.isFinite(record.x) && Number.isFinite(record.z)
    && Math.abs(record.x) <= MAX_COORD && Math.abs(record.z) <= MAX_COORD
    && (record.source === 'OpenStreetMap' || record.locationSource === 'OSM control node')
    ? { ...record, type } : null;
}

function tagsOf(record) {
  return record?.tags && typeof record.tags === 'object' ? record.tags : {};
}

function direction(record, segment = null) {
  const tags = tagsOf(record);
  const raw = record?.heading ?? record?.angle ?? record?.bearing ?? record?.orientation ?? tags.heading ?? tags.direction ?? tags.bearing ?? tags.orientation;
  if (Number.isFinite(Number(raw))) return Number(raw) * (Math.abs(Number(raw)) > Math.PI * 2 ? Math.PI / 180 : 1);
  const compass = { n: 0, north: 0, e: Math.PI / 2, east: Math.PI / 2, s: Math.PI, south: Math.PI, w: -Math.PI / 2, west: -Math.PI / 2 };
  if (typeof raw === 'string' && compass[raw.trim().toLowerCase()] != null) return compass[raw.trim().toLowerCase()];
  if (segment) return Math.atan2(segment.ax - segment.bx, segment.az - segment.bz);
  return 0;
}

function nearestRoad(record, roads) {
  let best = null;
  for (const road of roads) {
    const points = asArray(road?.points);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (!finitePoint(a) || !finitePoint(b)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
      if (len2 < 1e-8) continue;
      const t = Math.max(0, Math.min(1, ((record.x - a[0]) * dx + (record.z - a[1]) * dz) / len2));
      const x = a[0] + dx * t, z = a[1] + dz * t;
      const distance = Math.hypot(record.x - x, record.z - z);
      if (!best || distance < best.distance) best = {
        x, z, distance, dx, dz, width: Math.max(0, number(road.width, 8)), roadId: road.id,
      };
    }
  }
  return best;
}

function explicitClosedGate(record) {
  const tags = tagsOf(record);
  const kind = String(record.kind || tags.barrier || '').toLowerCase();
  const gate = /gate|entrance|access/.test(kind);
  if (!gate) return false;
  const access = String(record.access ?? tags.access ?? '').toLowerCase();
  const state = String(record.state ?? record.status ?? tags.gate ?? tags.open ?? '').toLowerCase();
  return state === 'closed' || state === 'locked' || access === 'no';
}

function isGate(record) {
  const tags = tagsOf(record);
  return /gate|entrance|access/.test(String(record.kind || tags.barrier || '').toLowerCase());
}

/** Normalize mapped barrier geometry for physics. Unknown gates are not walls. */
export function getBarrierObstacles(data = {}) {
  const result = [];
  for (const raw of asArray(data?.barriers)) {
    if (!raw || typeof raw !== 'object' || raw.source !== 'OpenStreetMap' || (isGate(raw) && !explicitClosedGate(raw))) continue;
    const points = asArray(raw.points).filter(finitePoint).map(([x, z]) => [x, z]);
    const width = Math.max(0.05, number(raw.width, 0.35));
    if (points.length === 1) {
      result.push({ type: 'circle', barrier: true, x: points[0][0], z: points[0][1], radius: width / 2,
        id: raw.id, kind: raw.kind, source: raw.source });
      continue;
    }
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const nx = -dz / length * width / 2, nz = dx / length * width / 2;
      result.push({ type: 'polygon', barrier: true, ring: [[ax + nx, az + nz], [bx + nx, bz + nz],
        [bx - nx, bz - nz], [ax - nx, az - nz]], width, id: raw.id, kind: raw.kind, source: raw.source });
    }
  }
  return result;
}

export function createStreetInfrastructure(data = {}) {
  const group = new THREE.Group();
  group.name = 'Mapped street infrastructure (OSM records only)';
  group.userData.provenance = 'Only data.signals, data.crossings, data.barriers and data.streetLamps; no default fixtures';
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const batches = new Map();
  group.userData.provenanceSignals = [];
  group.userData.provenanceRecords = [];
  const addMaterial = (color, options = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .8, ...options }); materials.add(m); return m; };
  const mats = {
    dark: addMaterial('#202326', { metalness: .35 }), yellow: addMaterial('#e5ad22'), red: addMaterial('#2b0000', { emissive: '#ff1b00' }),
    amber: addMaterial('#271500', { emissive: '#ff9900' }), green: addMaterial('#002a0a', { emissive: '#00ff40' }),
    lamp: addMaterial('#182319', { metalness: .3 }), glow: addMaterial('#fff0bd', { emissive: '#fff0bd', emissiveIntensity: 1.8 }),
    barrier: addMaterial('#e8a51c'), barrierDark: addMaterial('#343535'), crossing: addMaterial('#eee8d8'),
  };
  const phaseB = { red: addMaterial('#2b0000', { emissive: '#ff1b00' }), amber: addMaterial('#271500', { emissive: '#ff9900' }), green: addMaterial('#002a0a', { emissive: '#00ff40' }) };
  const add = (geometry, material, parent = group) => { geometry.clearGroups(); let b = batches.get(material); if (!b) batches.set(material, b = []); b.push(geometry); };
  const provenance = (record, extra = {}) => ({ source: record.source, id: record.id, lat: record.lat, lng: record.lng, ...extra });
  const roadList = asArray(data?.roads);
  const signals = [];
  for (const raw of asArray(data?.signals)) {
    const record = sourceRecord(raw, 'signal'); if (!record) continue;
    const road = nearestRoad(record, roadList);
    const inferred = road && road.distance <= 50;
    const heading = direction(record, inferred ? { ax: road.x + road.dx, az: road.z + road.dz, bx: road.x, bz: road.z } : null);
    const nx = inferred ? -road.dz / Math.hypot(road.dx, road.dz) : -Math.cos(heading);
    const nz = inferred ? road.dx / Math.hypot(road.dx, road.dz) : Math.sin(heading);
    const offset = inferred ? road.width / 2 + .35 : 0;
    const x = inferred ? road.x + nx * offset : record.x, z = inferred ? road.z + nz * offset : record.z;
    const phase = String(record.phase || tagsOf(record).phase || 'A').toUpperCase(), signalMats = phase === 'B' ? phaseB : mats;
    group.userData.provenanceRecords.push(provenance(record));
    group.userData.provenanceSignals.push(provenance(record, { x, z, heading, locationSource: record.locationSource || 'OSM control node',
      placement: inferred ? 'inferred nearest road left-edge offset; node is not an exact pole survey' : 'node position; no nearby road for offset' }));
    const base = new THREE.CylinderGeometry(.24, .28, .12, 8); base.translate(x, .06, z); add(base, mats.dark);
    const mast = new THREE.CylinderGeometry(.09, .11, 4.4, 8); mast.translate(x, 2.2, z); add(mast, mats.dark);
    const arm = new THREE.BoxGeometry(.09, .09, 2.3); arm.rotateY(heading); arm.translate(x - Math.cos(heading) * 1.05, 4.25, z + Math.sin(heading) * 1.05); add(arm, mats.dark);
    const head = new THREE.BoxGeometry(.34, 1.1, .3); head.rotateY(heading); head.translate(x - Math.cos(heading) * 2.15, 3.7, z + Math.sin(heading) * 2.15); add(head, mats.dark);
    for (const [y, mat] of [[4.02, signalMats.red], [3.7, signalMats.amber], [3.38, signalMats.green]]) { const lens = new THREE.CircleGeometry(.1, 12); lens.rotateY(Math.PI + heading); lens.translate(x - Math.cos(heading) * 2.31, y, z + Math.sin(heading) * 2.31); add(lens, mat); }
    signals.push({ raw: record, phase, materials: signalMats });
  }
  for (const raw of asArray(data?.crossings)) {
    const record = sourceRecord(raw, 'crossing'); if (!record) continue;
    group.userData.provenanceRecords.push(provenance(record));
    const heading = direction(record), width = Math.max(2, number(record.width, 4)), length = Math.max(2, number(record.length, 8));
    const stripeCount = Math.max(2, Math.min(12, Math.round(length / 1.2)));
    for (let i = 0; i < stripeCount; i++) { const stripe = new THREE.BoxGeometry(width, .025, .38); stripe.rotateY(heading); const along = -length / 2 + (i + .5) * length / stripeCount; stripe.translate(record.x + Math.sin(heading) * along, .015, record.z + Math.cos(heading) * along); add(stripe, mats.crossing); }
  }
  for (const raw of asArray(data?.barriers)) {
    const record = raw && typeof raw === 'object' ? raw : null; if (!record || record.source !== 'OpenStreetMap') continue;
    const points = asArray(record.points).filter(finitePoint); if (!points.length) continue;
    if (record.source === 'OpenStreetMap') group.userData.provenanceRecords.push(provenance(record));
    const kind = String(record.kind || tagsOf(record).barrier || '').toLowerCase();
    const closedGate = explicitClosedGate(record), gate = isGate(record);
    if (gate && !closedGate) { for (const [x, z] of [points[0], points.at(-1)]) { const post = new THREE.CylinderGeometry(.1, .14, Math.max(1, number(record.height, 1.1)), 8); post.translate(x, Math.max(1, number(record.height, 1.1)) / 2, z); add(post, mats.barrier); } continue; }
    const height = Math.max(.35, number(record.height, /bollard/.test(kind) ? 1 : 1.05));
    if (points.length === 1) { const [x, z] = points[0], radius = Math.max(.08, number(record.width, .3) / 2); const post = new THREE.CylinderGeometry(radius, radius, height, 8); post.translate(x, height / 2, z); add(post, mats.barrier); continue; }
    for (let i = 1; i < points.length; i++) { const [ax, az] = points[i - 1], [bx, bz] = points[i], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < .05) continue; const mesh = /bollard/.test(kind) ? new THREE.CylinderGeometry(Math.max(.08, number(record.width, .3) / 2), Math.max(.08, number(record.width, .3) / 2), height, 8) : new THREE.BoxGeometry(Math.max(.05, number(record.width, .35)), height, len); mesh.rotateY(Math.atan2(dx, dz)); mesh.translate((ax + bx) / 2, height / 2, (az + bz) / 2); add(mesh, /guardrail|fence/.test(kind) ? mats.barrierDark : mats.barrier); }
  }
  for (const raw of asArray(data?.streetLamps)) {
    const record = sourceRecord(raw, 'streetLamp'); if (!record) continue;
    group.userData.provenanceRecords.push(provenance(record));
    const h = Math.max(2, number(record.height, 4.2)), heading = direction(record); const pole = new THREE.CylinderGeometry(.09, .13, h, 8); pole.translate(record.x, h / 2, record.z); add(pole, mats.lamp);
    const arm = new THREE.BoxGeometry(.08, .08, 1.1); arm.rotateY(heading); arm.translate(record.x, h - .15, record.z); add(arm, mats.lamp);
    const bulb = new THREE.SphereGeometry(.14, 8, 6); bulb.translate(record.x - Math.cos(heading) * .5, h - .28, record.z + Math.sin(heading) * .5); add(bulb, mats.glow);
  }
  for (const [mat, parts] of batches) { const merged = mergeGeometries(parts, false); for (const part of parts) part.dispose(); if (!merged) continue; geometries.add(merged); merged.computeBoundingSphere(); const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.provenance = { source: 'OpenStreetMap', records: group.userData.provenanceRecords }; group.add(mesh); }
  batches.clear();
  function update(time) {
    const t = Number.isFinite(time) ? ((time % 14) + 14) % 14 : 0;
    const a = t < 6 ? 'green' : t < 7.5 ? 'amber' : 'red', b = t < 13 ? 'red' : t < 14 ? 'amber' : 'green';
    for (const signal of signals) { const active = signal.phase === 'B' ? b : a; signal.materials.red.emissiveIntensity = active === 'red' ? 2.4 : .05; signal.materials.amber.emissiveIntensity = active === 'amber' ? 2.2 : .05; signal.materials.green.emissiveIntensity = active === 'green' ? 2.4 : .05; }
  }
  update(0);
  let disposed = false;
  return { group, update, getBarrierObstacles: () => getBarrierObstacles(data), dispose() { if (disposed) return; disposed = true; group.removeFromParent(); group.clear(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose(); geometries.clear(); materials.clear(); textures.clear(); } };
}
