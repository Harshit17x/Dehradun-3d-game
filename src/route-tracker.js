import * as THREE from 'three';

// 3D GPS Route Tracker & Road Network Navigation
// Generates an animated glowing 3D navigation ribbon and waypoint beacon
// along surveyed OpenStreetMap road corridors.

const ROUTE_ELEVATION = 0.28; // Metres above asphalt to prevent z-fighting
const RIBBON_WIDTH = 1.3;    // Width of the navigation line in metres
const ARRIVAL_THRESHOLD = 14; // Metres to destination to trigger arrival

export const KNOWN_ALIASES = {
  'clock tower': 'Ghanta Ghar',
  'ghantaghar': 'Ghanta Ghar',
  'clocktower': 'Ghanta Ghar',
  'survey chowk': 'Survey Chowk Fountain',
  'survey chowk fountain': 'Survey Chowk Fountain',
  'mussoorie stand': 'Mussoorie bus stand',
  'mussoorie bus': 'Mussoorie bus stand',
  'pacific mall': 'Pacific Mall',
  'pacific hotel': 'Pacific Hotel',
  'kumar sweets': 'Kumar Sweetshop',
  'kumar sweet shop': 'Kumar Sweetshop',
};

export function findPlace(query, places = []) {
  if (!query || typeof query !== 'string' || !Array.isArray(places) || !places.length) return null;
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return null;

  const aliasTarget = KNOWN_ALIASES[q];
  if (aliasTarget) {
    const matched = places.find(p => p.name?.toLowerCase() === aliasTarget.toLowerCase());
    if (matched) return matched;
  }

  const exact = places.find(p => p.name?.toLowerCase() === q);
  if (exact) return exact;

  const startsWith = places.find(p => p.name?.toLowerCase().startsWith(q));
  if (startsWith) return startsWith;

  const includes = places.find(p => p.name?.toLowerCase().includes(q));
  if (includes) return includes;

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const wordMatch = places.find(p => {
      const name = p.name?.toLowerCase() || '';
      return words.every(w => name.includes(w));
    });
    if (wordMatch) return wordMatch;
  }

  return null;
}

export function findRoutePath(start, dest, network, options = {}) {
  if (!start || !dest || !Number.isFinite(start.x) || !Number.isFinite(start.z) || !Number.isFinite(dest.x) || !Number.isFinite(dest.z)) {
    return [start, dest];
  }

  const padding = Math.max(250, options.padding || 350);
  const minX = Math.min(start.x, dest.x) - padding;
  const maxX = Math.max(start.x, dest.x) + padding;
  const minZ = Math.min(start.z, dest.z) - padding;
  const maxZ = Math.max(start.z, dest.z) + padding;

  const segments = (network?.segments || []).filter(s =>
    Math.max(s.ax, s.bx) >= minX && Math.min(s.ax, s.bx) <= maxX &&
    Math.max(s.az, s.bz) >= minZ && Math.min(s.az, s.bz) <= maxZ
  );

  if (!segments.length) {
    return [start, dest];
  }

  const nodes = new Map();
  const keyOf = (x, z) => `${Math.round(x * 1.5) / 1.5},${Math.round(z * 1.5) / 1.5}`;

  function addEdge(aKey, bKey, dist, ax, az, bx, bz) {
    if (!nodes.has(aKey)) nodes.set(aKey, { x: ax, z: az, edges: [] });
    if (!nodes.has(bKey)) nodes.set(bKey, { x: bx, z: bz, edges: [] });
    nodes.get(aKey).edges.push({ to: bKey, dist });
    nodes.get(bKey).edges.push({ to: aKey, dist });
  }

  for (const s of segments) {
    const kA = keyOf(s.ax, s.az);
    const kB = keyOf(s.bx, s.bz);
    if (kA === kB) continue;
    const dist = Math.hypot(s.bx - s.ax, s.bz - s.az);
    addEdge(kA, kB, dist, s.ax, s.az, s.bx, s.bz);
  }

  // Find nearest graph nodes to start and destination
  let startKey = null, bestStartDist = Infinity;
  let destKey = null, bestDestDist = Infinity;

  for (const [key, node] of nodes) {
    const dS = Math.hypot(node.x - start.x, node.z - start.z);
    if (dS < bestStartDist) { bestStartDist = dS; startKey = key; }
    const dD = Math.hypot(node.x - dest.x, node.z - dest.z);
    if (dD < bestDestDist) { bestDestDist = dD; destKey = key; }
  }

  if (!startKey || !destKey || startKey === destKey) {
    return [start, dest];
  }

  // A* pathfinding
  const open = new Set([startKey]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const targetNode = nodes.get(destKey);
  const hDist = (node) => Math.hypot(node.x - targetNode.x, node.z - targetNode.z);
  const fScore = new Map([[startKey, hDist(nodes.get(startKey))]]);

  let iterations = 0;
  const maxIterations = options.maxIterations || 2500;

  while (open.size > 0 && ++iterations < maxIterations) {
    let current = null, bestF = Infinity;
    for (const key of open) {
      const f = fScore.get(key) ?? Infinity;
      if (f < bestF) { bestF = f; current = key; }
    }

    if (current === destKey) {
      const path = [dest];
      let curr = destKey;
      while (cameFrom.has(curr)) {
        const n = nodes.get(curr);
        path.unshift({ x: n.x, z: n.z });
        curr = cameFrom.get(curr);
      }
      path.unshift(start);
      return simplifyPath(path);
    }

    open.delete(current);
    const currNode = nodes.get(current);
    const currentG = gScore.get(current) ?? Infinity;

    for (const edge of currNode.edges) {
      const neighbor = edge.to;
      const tentativeG = currentG + edge.dist;
      if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        const neighborNode = nodes.get(neighbor);
        fScore.set(neighbor, tentativeG + hDist(neighborNode));
        open.add(neighbor);
      }
    }
  }

  // Fallback: direct line if no graph path found
  return [start, dest];
}

function simplifyPath(points, epsilon = 0.5) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result.at(-1), curr = points[i], next = points[i + 1];
    const dx1 = curr.x - prev.x, dz1 = curr.z - prev.z;
    const dx2 = next.x - curr.x, dz2 = next.z - curr.z;
    const len1 = Math.hypot(dx1, dz1), len2 = Math.hypot(dx2, dz2);
    if (len1 < 0.2) continue;
    if (len2 < 0.2) continue;
    // Check collinearity
    const dot = (dx1 * dx2 + dz1 * dz2) / (len1 * len2);
    if (dot > 0.998) continue;
    result.push(curr);
  }
  result.push(points.at(-1));
  return result;
}

export function createRibbonGeometry(waypoints, width = RIBBON_WIDTH) {
  if (!waypoints || waypoints.length < 2) return new THREE.BufferGeometry();

  const vertices = [];
  const uvs = [];
  const indices = [];

  const halfWidth = width / 2;
  let totalLength = 0;
  const distances = [0];

  for (let i = 1; i < waypoints.length; i++) {
    totalLength += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].z - waypoints[i - 1].z);
    distances.push(totalLength);
  }

  for (let i = 0; i < waypoints.length; i++) {
    const curr = waypoints[i];
    let dirX = 0, dirZ = -1;

    if (i < waypoints.length - 1) {
      const next = waypoints[i + 1];
      const dX = next.x - curr.x, dZ = next.z - curr.z;
      const len = Math.hypot(dX, dZ) || 1;
      dirX += dX / len; dirZ += dZ / len;
    }
    if (i > 0) {
      const prev = waypoints[i - 1];
      const dX = curr.x - prev.x, dZ = curr.z - prev.z;
      const len = Math.hypot(dX, dZ) || 1;
      dirX += dX / len; dirZ += dZ / len;
    }

    const dirLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dirLen; dirZ /= dirLen;

    // Perpendicular vector
    const perpX = -dirZ * halfWidth, perpZ = dirX * halfWidth;

    // Left vertex
    vertices.push(curr.x + perpX, ROUTE_ELEVATION, curr.z + perpZ);
    // Right vertex
    vertices.push(curr.x - perpX, ROUTE_ELEVATION, curr.z - perpZ);

    const v = distances[i] / (width * 3);
    uvs.push(0, v);
    uvs.push(1, v);

    if (i < waypoints.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class RouteTracker {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'GPS Route Tracker Navigation';
    this.scene.add(this.group);

    this.active = false;
    this.destination = null;
    this.destinationName = '';
    this.waypoints = [];
    this.arrived = false;
    this.elapsedTime = 0;

    this.ribbonMesh = null;
    this.beaconMesh = null;
    this.pinMesh = null;

    // Vibrant Glowing Materials
    this.ribbonMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.beaconMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bbf9,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.pinMaterial = new THREE.MeshBasicMaterial({
      color: 0xff006e,
      wireframe: false,
    });
  }

  setRoute(waypoints, destinationName = 'Destination', destinationPoint = null) {
    this.clear();
    if (!waypoints || waypoints.length < 2) return;

    this.active = true;
    this.arrived = false;
    this.waypoints = waypoints;
    this.destinationName = destinationName;
    this.destination = destinationPoint || waypoints.at(-1);

    // 1. Build Ribbon Mesh
    const geometry = createRibbonGeometry(waypoints);
    this.ribbonMesh = new THREE.Mesh(geometry, this.ribbonMaterial);
    this.group.add(this.ribbonMesh);

    // 2. Build Destination Beacon Column
    const dest = this.destination;
    const beaconGeom = new THREE.CylinderGeometry(1.4, 2.2, 18, 16, 1, true);
    this.beaconMesh = new THREE.Mesh(beaconGeom, this.beaconMaterial);
    this.beaconMesh.position.set(dest.x, 9, dest.z);
    this.group.add(this.beaconMesh);

    // 3. Floating Marker Pin
    const pinGeom = new THREE.OctahedronGeometry(1.6, 0);
    this.pinMesh = new THREE.Mesh(pinGeom, this.pinMaterial);
    this.pinMesh.position.set(dest.x, 14, dest.z);
    this.group.add(this.pinMesh);
  }

  update(carPos, dt = 0.016) {
    if (!this.active || !this.destination) return null;
    this.elapsedTime += dt;

    // Pulse animation
    const pulse = 0.75 + Math.sin(this.elapsedTime * 4) * 0.18;
    this.ribbonMaterial.opacity = pulse;

    if (this.pinMesh) {
      this.pinMesh.rotation.y += dt * 1.5;
      this.pinMesh.position.y = 13.5 + Math.sin(this.elapsedTime * 3) * 1.2;
    }

    if (this.beaconMesh) {
      this.beaconMesh.rotation.y -= dt * 0.4;
    }

    // Calculate distance to destination
    const straightDist = Math.hypot(this.destination.x - carPos.x, this.destination.z - carPos.z);

    if (straightDist <= ARRIVAL_THRESHOLD && !this.arrived) {
      this.arrived = true;
    }

    return {
      active: true,
      name: this.destinationName,
      distanceMeters: Math.round(straightDist),
      distanceKm: (straightDist / 1000).toFixed(2),
      etaMinutes: Math.max(1, Math.round(straightDist / (11.1 * 60))), // ~40 km/h average
      arrived: this.arrived,
    };
  }

  clear() {
    this.active = false;
    this.arrived = false;
    this.destination = null;
    this.destinationName = '';
    this.waypoints = [];

    if (this.ribbonMesh) {
      this.group.remove(this.ribbonMesh);
      this.ribbonMesh.geometry.dispose();
      this.ribbonMesh = null;
    }
    if (this.beaconMesh) {
      this.group.remove(this.beaconMesh);
      this.beaconMesh.geometry.dispose();
      this.beaconMesh = null;
    }
    if (this.pinMesh) {
      this.group.remove(this.pinMesh);
      this.pinMesh.geometry.dispose();
      this.pinMesh = null;
    }
  }

  dispose() {
    this.clear();
    this.ribbonMaterial.dispose();
    this.beaconMaterial.dispose();
    this.pinMaterial.dispose();
    this.scene.remove(this.group);
  }
}
