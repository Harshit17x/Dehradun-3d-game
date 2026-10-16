import test from 'node:test';
import assert from 'node:assert/strict';
import { createMappedSurface } from './mapped-surface.js';

const network = { bounds: { minX: -20, maxX: 30, minZ: -20, maxZ: 30 } };

test('builds typed-array road strips with round joining coverage', () => {
  const surface = createMappedSurface({ roads: [{ id: 'l', width: 8, points: [[0, 0], [10, 0], [10, 10]] }] }, network, { ground: false, boundary: false });
  assert.equal(surface.group.children.length, 2, 'road and merged centerline meshes');
  const roads = surface.group.children.find(mesh => mesh.name === 'Mapped OSM roads');
  const markings = surface.group.children.find(mesh => mesh.name === 'Mapped road centerlines');
  assert.ok(roads.geometry.getAttribute('position').array instanceof Float32Array);
  assert.equal(roads.geometry.index.count, 120, 'two strip quads plus three round caps');
  assert.equal(markings.geometry.index.count, 24, 'one dash per long segment step');
  const positions = roads.geometry.getAttribute('position').array;
  let hasOuterJoin = false;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] === 14 && positions[i + 2] === 0) hasOuterJoin = true;
  }
  assert.ok(hasOuterJoin, 'the shared corner has a round cap reaching the capsule edge');
  surface.dispose();
  surface.dispose();
  assert.equal(surface.group.children.length, 0);
});

test('supports chunk surfaces without global geometry and global empty bounds', () => {
  const chunk = createMappedSurface({ roads: [] }, network, { ground: false, boundary: false });
  assert.equal(chunk.group.children.length, 0);
  chunk.dispose();

  const global = createMappedSurface({ roads: [] }, network);
  assert.equal(global.group.children.length, 2, 'ground and boundary are available without roads');
  assert.equal(global.group.children[0].geometry.getAttribute('position').array.constructor, Float32Array);
  global.dispose();
});

test('updates road palette for day and night', () => {
  const surface = createMappedSurface({ roads: [{ width: 8, points: [[0, 0], [10, 0]] }] }, network, { ground: false, boundary: false });
  const road = surface.group.children.find(mesh => mesh.name === 'Mapped OSM roads');
  const day = road.material.color.getHexString();
  surface.setTimeOfDay('night');
  assert.equal(road.material.color.getHexString(), '252d30');
  assert.notEqual(day, road.material.color.getHexString());
  surface.dispose();
  // setTimeOfDay remains safe for lifecycle callers after disposal.
  assert.doesNotThrow(() => surface.setTimeOfDay('day'));
});

test('renders OSM bridge roads as raised flyover structures with provenance', () => {
  const surface = createMappedSurface({ roads: [{ id: 'bridge/1', width: 8, bridge: 'yes', points: [[0, 0], [30, 0]] }] }, network, { ground: false, boundary: false });
  const flyover = surface.group.children.find(child => child.name === 'Mapped OSM flyover structures');
  assert.ok(flyover, 'bridge-tagged roads create a flyover group');
  assert.match(flyover.userData.provenance, /OSM bridge\/layer/);
  assert.ok(flyover.children.some(child => child.name === 'OSM flyover decks'));
  assert.ok(flyover.children.some(child => child.name === 'OSM flyover rails'));
  assert.ok(flyover.children.some(child => child.name === 'OSM flyover supports'));
  surface.dispose();
});
