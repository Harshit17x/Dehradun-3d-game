import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDrivingState, stepDriving, isDrivable } from './drive-physics.js';
import { createVehicle } from './drive-vehicle.js';
import { createWorld, ROAD_CENTERS, ROAD_WIDTH, MAP_LIMIT } from './drive-world.js';

function run(state, input, seconds, dt = 1 / 120) {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepDriving(state, input, dt);
  return state;
}

test('spawn, road constants and footprint match rendered grid', () => {
  const s = createDrivingState();
  assert.ok(isDrivable(s.x, s.z));
  for (const c of ROAD_CENTERS) {
    assert.ok(isDrivable(c + ROAD_WIDTH / 2 - 2.4, 40));
    assert.ok(!isDrivable(c + ROAD_WIDTH / 2 - 2.39, 40));
    assert.ok(isDrivable(40, c));
  }
  assert.ok(isDrivable(0, MAP_LIMIT - 2.4));
  assert.ok(!isDrivable(0, MAP_LIMIT - 2.39));
  assert.ok(!isDrivable(40, 40));
  assert.ok(!isDrivable(NaN, 0));
});

test('forward and reverse caps, braking, coasting and signed movement', () => {
  const s = createDrivingState();
  run(s, { forward: true }, 4);
  assert.equal(s.speed, 25);
  assert.ok(s.z < 40);
  run(s, { reverse: true }, 0.5);
  assert.ok(s.speed > 0 && s.speed < 25, 'S must first brake');
  run(s, { reverse: true }, 4);
  assert.equal(s.speed, -8);
  const z = s.z;
  run(s, { reverse: true }, 0.2);
  assert.ok(s.z > z);
  run(s, {}, 8);
  assert.equal(s.speed, 0);
  run(s, { forward: true }, 1);
  run(s, { brake: true }, 1);
  assert.equal(s.speed, 0);
});

test('steering smooths, decays, and reverses yaw when backing', () => {
  const s = createDrivingState();
  s.x = 0; s.z = 0; s.speed = 4;
  stepDriving(s, { left: true }, 1 / 120);
  assert.ok(s.steering > 0 && s.steering < 0.1);
  assert.ok(s.heading > 0);
  const steering = s.steering;
  run(s, {}, 1);
  assert.ok(Math.abs(s.steering) < steering / 100);
  s.speed = -4; s.heading = 0; s.steering = 0;
  stepDriving(s, { left: true }, 1 / 120);
  assert.ok(s.heading < 0);
});

test('rounded corners are navigable only when the entire footprint clears', () => {
  assert.ok(isDrivable(7, 7));
  assert.ok(!isDrivable(8, 8));
  const s = createDrivingState();
  s.x = 0; s.z = 0; s.heading = -Math.PI * 0.75; s.speed = 25;
  run(s, { forward: true }, 3);
  assert.ok(isDrivable(s.x, s.z));
});

test('outer bounds stop the car and reset returns to valid road', () => {
  const s = createDrivingState();
  s.z = -200; s.speed = 25;
  run(s, { forward: true }, 5);
  assert.ok(s.z >= -202.6);
  assert.ok(isDrivable(s.x, s.z));
  assert.ok(s.speed < 0.1);
  Object.assign(s, createDrivingState());
  assert.equal(s.speed, 0);
  assert.equal(s.distance, 0);
});

test('long frame bounded, invalid delta harmless and framerate independent', () => {
  const a = createDrivingState(), b = createDrivingState();
  stepDriving(a, { forward: true }, 100);
  stepDriving(b, { forward: true }, 0.1);
  assert.deepEqual(a, b);
  const c = { ...a };
  stepDriving(a, { forward: true }, NaN);
  assert.deepEqual(a, c);
  const x = createDrivingState(), y = createDrivingState();
  run(x, { forward: true }, 3, 1 / 30);
  run(y, { forward: true }, 3, 1 / 120);
  assert.ok(Math.abs(x.z - y.z) < 1e-8);
});

test('seeded random driving cannot leave road across 20,000 steps', () => {
  let seed = 983;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const s = createDrivingState();
  let input = {};
  for (let i = 0; i < 20000; i++) {
    if (i % 70 === 0) input = { forward: random() > 0.2, reverse: random() > 0.7, left: random() > 0.5, right: random() > 0.5 };
    if (i % 500 === 0) { s.x = ROAD_CENTERS[Math.floor(random() * 5)]; s.z = random() * 400 - 200; s.heading = random() * Math.PI * 2; s.speed = 25; }
    stepDriving(s, input, 1 / 30);
    assert.ok(isDrivable(s.x, s.z), `Off road at ${i}: ${s.x}, ${s.z}`);
    assert.ok(s.speed >= -8 && s.speed <= 25);
  }
});

test('one compact vehicle, four spinning/steering wheels, bounded draw calls and disposal', () => {
  const vehicle = createVehicle();
  const pivots = [];
  const geometries = new Set(), materials = new Set();
  let meshes = 0;
  vehicle.group.traverse(object => {
    if (object.name.endsWith('-steering')) pivots.push(object);
    if (object.isMesh) { meshes++; geometries.add(object.geometry); materials.add(object.material); }
  });
  assert.equal(pivots.length, 4);
  assert.ok(meshes < 45, `${meshes} draws for vehicle`);
  const bounds = new THREE.Box3().setFromObject(vehicle.group);
  assert.ok(bounds.min.y >= -0.001);
  assert.ok(bounds.max.z - bounds.min.z < 4.5);
  vehicle.update(10, 0.2, 1 / 60, true);
  for (const pivot of pivots) {
    assert.equal(pivot.rotation.y, pivot.name.startsWith('front') ? 0.2 : 0);
    assert.ok(pivot.children.find(child => child.name === 'rotating-tire-and-rim').rotation.x < 0);
  }
  let disposed = 0;
  for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => disposed++);
  vehicle.dispose(); vehicle.dispose();
  assert.equal(disposed, geometries.size + materials.size);
  assert.equal(vehicle.group.children.length, 0);
});

test('world has a flat grid, bounded static batches and complete resource disposal', () => {
  // Stub only the Canvas2D painting API for a resource/geometry test. Actual
  // WebGL rendering is checked separately in the browser preview.
  const originalDocument = globalThis.document;
  const context = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  try {
    const scene = new THREE.Scene();
    const world = createWorld(scene);
    const resources = new Set();
    let meshes = 0;
    scene.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      resources.add(object.geometry); resources.add(object.material);
      if (object.material.map) resources.add(object.material.map);
      if (object.isInstancedMesh) resources.add(object);
    });
    assert.ok(meshes <= 20);
    const road = scene.getObjectByName('Flat road network');
    assert.ok(road);
    const position = road.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) assert.equal(position.getY(i), 0);
    road.geometry.computeBoundingBox();
    assert.equal(road.geometry.boundingBox.min.x, -MAP_LIMIT);
    assert.equal(road.geometry.boundingBox.max.z, MAP_LIMIT);
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    const crowns = scene.getObjectByName('tree crowns');
    for (let i = 0; i < crowns.count; i++) {
      crowns.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
      for (const c of ROAD_CENTERS) {
        assert.ok(Math.abs(point.x - c) >= ROAD_WIDTH / 2 + 2);
        assert.ok(Math.abs(point.z - c) >= ROAD_WIDTH / 2 + 2);
      }
    }
    let disposed = 0;
    for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
    world.dispose(); world.dispose();
    assert.equal(disposed, resources.size);
    assert.equal(scene.children.length, 0);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
