import * as THREE from 'three';
import { getVisualTheme, normalizeVisualMode } from './geo-visuals.js';

const CAP_SIDES = 12;
const CAP_RING = Array.from({ length: CAP_SIDES }, (_, i) => {
  const angle = i * Math.PI * 2 / CAP_SIDES;
  return [Math.cos(angle), Math.sin(angle)];
});
const ROAD_Y = 0;
const MARKING_Y = 0.012;

function roadWidth(road, points) {
  const width = Number.isFinite(road.width) ? THREE.MathUtils.clamp(road.width, 3, 32) : 8;
  if (road.id === 'way/1556686563' || (points.length >= 20 && /roundabout/i.test(road.kind || ''))) return Math.max(width, 13);
  if (/chakrata/i.test(road.name || '')) return Math.max(width, 10);
  return width;
}

function flatGeometry(vertexCount, indexCount) {
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vertex = 0, index = 0;
  const point = (x, y, z) => {
    const offset = vertex++ * 3;
    positions[offset] = x; positions[offset + 1] = y; positions[offset + 2] = z;
    normals[offset + 1] = 1;
  };
  const triangle = (a, b, c) => {
    indices[index++] = a; indices[index++] = b; indices[index++] = c;
  };
  return {
    quad(ax, az, bx, bz, halfWidth, y) {
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 1e-6) return;
      const nx = -(bz - az) / length * halfWidth, nz = (bx - ax) / length * halfWidth;
      const start = vertex;
      point(ax + nx, y, az + nz); point(bx + nx, y, bz + nz);
      point(bx - nx, y, bz - nz); point(ax - nx, y, az - nz);
      triangle(start, start + 1, start + 2); triangle(start, start + 2, start + 3);
    },
    disc(x, z, radius, y) {
      const start = vertex;
      point(x, y, z);
      for (const [cx, cz] of CAP_RING) point(x + cx * radius, y, z + cz * radius);
      for (let i = 0; i < CAP_SIDES; i++) {
        const next = (i + 1) % CAP_SIDES;
        triangle(start, start + next + 1, start + i + 1);
      }
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

export function createMappedSurface(data, network, { ground = true, boundary = true } = {}) {
  const group = new THREE.Group();
  group.name = 'OSM geographic road surface';
  const geometries = new Set(), materials = new Set(), palette = {};
  const material = (role, options) => {
    const result = new THREE.MeshStandardMaterial(options);
    materials.add(result); palette[role] = result; return result;
  };
  const addMesh = (name, geometry, surfaceMaterial, parent = group) => {
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, surfaceMaterial);
    mesh.name = name; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };

  if (ground || boundary) {
    const bounds = network.bounds;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    if (ground) {
      const builder = flatGeometry(4, 6);
      builder.quad(bounds.minX - 20, centerZ, bounds.maxX + 20, centerZ, (bounds.maxZ - bounds.minZ + 40) / 2, -0.12);
      addMesh('Mapped OSM bounds', builder.finish(), material('ground', { roughness: 1 }));
    }
    if (boundary) {
      const boundaryGroup = new THREE.Group();
      boundaryGroup.name = 'OSM mapped-area boundary';
      boundaryGroup.userData.provenance = 'Derived from supplied OSM road-network bounds; visual edge only';
      const minX = bounds.minX - 1.5, maxX = bounds.maxX + 1.5, minZ = bounds.minZ - 1.5, maxZ = bounds.maxZ + 1.5;
      const builder = flatGeometry(16, 24);
      builder.quad(minX, minZ, maxX, minZ, .11, .03); builder.quad(minX, maxZ, maxX, maxZ, .11, .03);
      builder.quad(minX, minZ, minX, maxZ, .11, .03); builder.quad(maxX, minZ, maxX, maxZ, .11, .03);
      addMesh('Mapped boundary edges', builder.finish(), material('boundary', { roughness: .7 }), boundaryGroup);
      group.add(boundaryGroup);
    }
  }

  const segments = [], discs = new Map(); let dashCount = 0;
  for (const road of Array.isArray(data?.roads) ? data.roads : []) {
    if (!road) continue;
    const points = Array.isArray(road.points) ? road.points : [], width = roadWidth(road, points);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const [ax, az] = a, [bx, bz] = b;
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const length = Math.hypot(bx - ax, bz - az); if (length < .01) continue;
      const dashes = width >= 6.5 ? Math.floor(length / 5) : 0;
      segments.push({ ax, az, bx, bz, width, length, dashes }); dashCount += dashes;
      for (const [x, z] of [a, b]) {
        const key = `${x},${z}`, existing = discs.get(key);
        if (!existing || existing.radius < width / 2) discs.set(key, { x, z, radius: width / 2 });
      }
    }
  }
  if (segments.length) {
    const roads = flatGeometry(segments.length * 4 + discs.size * (CAP_SIDES + 1), segments.length * 6 + discs.size * CAP_SIDES * 3);
    const markings = dashCount ? flatGeometry(dashCount * 4, dashCount * 6) : null;
    for (const { ax, az, bx, bz, width, length, dashes } of segments) {
      roads.quad(ax, az, bx, bz, width / 2, ROAD_Y);
      const fx = (bx - ax) / length, fz = (bz - az) / length;
      const start = (length - dashes * 5 + 2.4) / 2;
      for (let k = 0; k < dashes; k++) { const a = start + k * 5, b = a + 2.6; markings.quad(ax + fx * a, az + fz * a, ax + fx * b, az + fz * b, .09, MARKING_Y); }
    }
    for (const { x, z, radius } of discs.values()) roads.disc(x, z, radius, ROAD_Y);
    addMesh('Mapped OSM roads', roads.finish(), material('road', { roughness: .96, metalness: .01 }));
    if (markings) addMesh('Mapped road centerlines', markings.finish(), material('marking', { roughness: .85, metalness: .05 }));
  }

  let disposed = false;
  function setTimeOfDay(mode) {
    if (disposed) return;
    const visualMode = normalizeVisualMode(mode), theme = getVisualTheme(visualMode);
    for (const [role, value] of Object.entries(palette)) if (theme[role]) value.color.set(theme[role]);
    if (palette.boundary) { palette.boundary.emissive.set(theme.boundaryEmissive); palette.boundary.emissiveIntensity = visualMode === 'night' ? 1.2 : .3; }
    group.userData.visualMode = visualMode;
  }
  setTimeOfDay('day');
  return {
    group, setTimeOfDay,
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); group.clear(); for (const geometry of geometries) geometry.dispose(); for (const value of materials) value.dispose(); geometries.clear(); materials.clear(); },
  };
}
