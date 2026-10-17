import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { findRoutePath, createRibbonGeometry, RouteTracker, findPlace } from './route-tracker.js';

test('findPlace locates places via exact match, partial match, and aliases', () => {
  const places = [
    { name: 'Ghanta Ghar', x: -0.63, z: 17.52 },
    { name: 'Pacific Mall', x: 1200, z: -800 },
    { name: 'Kumar Sweetshop', x: 250, z: -100 },
    { name: 'Survey Chowk Fountain', x: 450, z: 200 },
  ];

  // Exact match
  assert.equal(findPlace('Ghanta Ghar', places)?.name, 'Ghanta Ghar');

  // Case-insensitive & trimmed
  assert.equal(findPlace('  pacific mall ', places)?.name, 'Pacific Mall');

  // Alias lookup: "Clock Tower" -> "Ghanta Ghar"
  assert.equal(findPlace('clock tower', places)?.name, 'Ghanta Ghar');
  assert.equal(findPlace('survey chowk', places)?.name, 'Survey Chowk Fountain');

  // Partial substring
  assert.equal(findPlace('kumar', places)?.name, 'Kumar Sweetshop');

  // Not found
  assert.equal(findPlace('nonexistent place xyz', places), null);
  assert.equal(findPlace('', places), null);
  assert.equal(findPlace(null, places), null);
});

test('findRoutePath returns connected waypoints between coordinates', () => {
  const dummyNetwork = {
    segments: [
      { ax: 0, az: 0, bx: 100, bz: 0 },
      { ax: 100, az: 0, bx: 100, bz: 100 },
      { ax: 100, az: 100, bx: 200, bz: 100 },
    ],
  };

  const path = findRoutePath({ x: 0, z: 0 }, { x: 200, z: 100 }, dummyNetwork);
  assert.ok(Array.isArray(path));
  assert.ok(path.length >= 2, 'Route contains at least start and dest');
  assert.equal(path[0].x, 0);
  assert.equal(path[0].z, 0);
  assert.equal(path.at(-1).x, 200);
  assert.equal(path.at(-1).z, 100);
});

test('findRoutePath falls back to direct line when network is empty or unreachable', () => {
  const start = { x: 10, z: 20 };
  const dest = { x: 50, z: 80 };
  const path = findRoutePath(start, dest, { segments: [] });
  assert.deepEqual(path, [start, dest]);
});

test('createRibbonGeometry builds valid vertex positions and UVs', () => {
  const waypoints = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 100, z: 50 },
  ];

  const geom = createRibbonGeometry(waypoints, 1.2);
  assert.ok(geom instanceof THREE.BufferGeometry);

  const posAttr = geom.getAttribute('position');
  assert.ok(posAttr, 'Position attribute exists');
  assert.equal(posAttr.count, 6, 'Two vertices per waypoint');

  const uvAttr = geom.getAttribute('uv');
  assert.ok(uvAttr, 'UV attribute exists');
  assert.equal(uvAttr.count, 6);

  const index = geom.getIndex();
  assert.ok(index, 'Index buffer exists');
  assert.equal(index.count, 12, '4 triangles (12 indices) for 2 segments');

  geom.dispose();
});

test('RouteTracker manages destination, updates metrics and handles arrival', () => {
  const scene = new THREE.Scene();
  const tracker = new RouteTracker(scene);

  assert.equal(tracker.active, false);

  const waypoints = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 100, z: 0 },
  ];

  tracker.setRoute(waypoints, 'Clock Tower', { x: 100, z: 0 });
  assert.equal(tracker.active, true);
  assert.equal(tracker.destinationName, 'Clock Tower');
  assert.ok(tracker.ribbonMesh, 'Ribbon mesh was added');
  assert.ok(tracker.beaconMesh, 'Beacon mesh was added');
  assert.ok(tracker.pinMesh, 'Pin mesh was added');

  // Update when far
  const farState = tracker.update({ x: 0, z: 0 }, 0.016);
  assert.equal(farState.active, true);
  assert.equal(farState.distanceMeters, 100);
  assert.equal(farState.arrived, false);

  // Update when close
  const nearState = tracker.update({ x: 95, z: 0 }, 0.016);
  assert.equal(nearState.arrived, true);

  // Clear route
  tracker.clear();
  assert.equal(tracker.active, false);
  assert.equal(tracker.ribbonMesh, null);

  tracker.dispose();
});
