import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreetInfrastructure, getBarrierObstacles } from './street-infrastructure.js';
import { createRoadNetwork, stepGeoDriving } from './geo-driving.js';

const road = { id: 'way/test', points: [[0, -40], [0, 40]], width: 20, name: 'Mapped Road' };
const osm = (extra) => ({ source: 'OpenStreetMap', locationSource: 'OSM control node', ...extra });

test('empty infrastructure has no fallback fixtures and disposes safely', () => {
  const result = createStreetInfrastructure({});
  assert.equal(result.group.children.length, 0);
  result.update(2); result.dispose(); result.dispose();
  assert.equal(result.group.children.length, 0);
});

test('signals render only supplied nodes and retain explicit inferred placement provenance', () => {
  const signal = osm({ id: 'node/1', x: 4, z: 0, lat: 30, lng: 78, tags: {} });
  const result = createStreetInfrastructure({ roads: [road], signals: [signal] });
  assert.equal(result.group.userData.provenanceSignals.length, 1);
  assert.equal(result.group.userData.provenanceSignals[0].id, 'node/1');
  assert.match(result.group.userData.provenanceSignals[0].placement, /inferred nearest road/);
  assert.ok(result.group.children.length > 0);
  result.dispose();
});

test('mapped street lamps gain bounded night illumination and return to dark in daytime', () => {
  const result = createStreetInfrastructure({ streetLamps: [osm({ id: 'node/lamp', x: 2, z: 3, height: 5 })] });
  const light = result.group.children.find((child) => child.isLight);
  assert.ok(light, 'an OSM lamp has a point-light mesh companion');
  assert.equal(light.intensity, 0);
  result.setNightMode(true);
  assert.ok(light.intensity > 0 && light.intensity <= 5.5);
  result.setNightMode(false);
  assert.equal(light.intensity, 0);
  result.dispose();
});

test('barrier polygons match mapped width and unknown gates remain non-colliding', () => {
  const wall = osm({ id: 'way/wall', kind: 'wall', width: 1.2, height: 1.5, points: [[-6, 0], [6, 0]] });
  const gate = osm({ id: 'way/gate', kind: 'gate', points: [[-3, 5], [3, 5]] });
  const obstacles = getBarrierObstacles({ barriers: [wall, gate] });
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].width, 1.2);
  const network = createRoadNetwork({ roads: [road], buildings: [], places: [], barriers: [wall, gate] });
  assert.equal(network.collisionAt(0, 0).reason, 'barrier');
  assert.ok(network.collisionAt(0, 5).drivable, 'unknown gate does not seal the entrance');
});

test('closed mapped barrier blocks the full vehicle sweep without teleport recovery', () => {
  const wall = osm({ id: 'way/wall', kind: 'guardrail', width: 1, height: 1, points: [[-8, 0], [8, 0]] });
  const network = createRoadNetwork({ roads: [road], buildings: [], places: [], barriers: [wall] });
  assert.ok(!network.canVehicleMove(0, 8, 0, -8, 0));
  const state = { x: 0, z: 8, heading: 0, speed: 4, steering: 0, distance: 0 };
  for (let i = 0; i < 100; i++) stepGeoDriving(state, { forward: true }, .02, network);
  assert.ok(state.z > 1.5, `vehicle stopped before the wall at z=${state.z}`);
  assert.ok(network.isVehicleDrivable(state.x, state.z, state.heading));
  const stopped = { x: state.x, z: state.z };
  stepGeoDriving(state, { forward: true }, 1, network);
  assert.ok(Math.hypot(state.x - stopped.x, state.z - stopped.z) < .01, 'blocked vehicle is not teleported');
  for (let i = 0; i < 10; i++) stepGeoDriving(state, { reverse: true }, .1, network);
  assert.ok(state.z > stopped.z + .1, 'reverse input can recover from a head-on collision');
  assert.ok(network.isVehicleDrivable(state.x, state.z, state.heading));
});

test('signal cycle is deterministic from absolute simulation time', () => {
  const data = { signals: [osm({ id: 'node/2', x: 0, z: 0, tags: {} })] };
  const a = createStreetInfrastructure(data), b = createStreetInfrastructure(data);
  a.update(6.25); b.update(6.25);
  const findMaterial = (root, color) => root.children.find((child) => child.isMesh && child.material?.color?.getHex() === color);
  assert.equal(findMaterial(a.group, 0x2b0000)?.material.emissiveIntensity, findMaterial(b.group, 0x2b0000)?.material.emissiveIntensity);
  a.update(2); b.update(2);
  assert.equal(findMaterial(a.group, 0x002a0a)?.material.emissiveIntensity, 2.4, 'phase A exposes green during its green interval');
  a.dispose(); b.dispose();
});
