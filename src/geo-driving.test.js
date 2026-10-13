import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ORIGIN, toLocal, toLatLng, projectSegment, pointInRing,
  circleIntersectsRing, segmentDistance, createRoadNetwork, createGeoState, stepGeoDriving,
} from './geo-driving.js';

const data = JSON.parse(readFileSync(new URL('./dehradun-data.json', import.meta.url), 'utf8'));
const realNetwork = createRoadNetwork(data);
const road = (points = [[0, -500], [0, 500]], width = 8, name = 'Test Road') => ({ id: 'way/test', points, width, name });
const network = (roads = [road()], buildings = [], places = [], extra = {}) => createRoadNetwork({ roads, buildings, places, ...extra });
const state = (x = 0, z = 0, heading = 0, speed = 0) => ({ x, z, heading, speed, steering: 0, distance: 0 });
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const run = (s, input, seconds, n, dt = 1 / 100) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepGeoDriving(s, input, dt, n);
  return s;
};
const rectangle = (minX, minZ, maxX, maxZ) => ({ ring: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]] });

test('local metre coordinates round-trip geographic bounds, POIs and custom origins', () => {
  for (const origin of [DEFAULT_ORIGIN, { lat: 51.5074, lng: -0.1278 }]) {
    for (const [lat, lng] of [[origin.lat, origin.lng], [origin.lat + .01, origin.lng - .015], [origin.lat - .02, origin.lng + .008]]) {
      const local = toLocal(lat, lng, origin), result = toLatLng(local.x, local.z, origin);
      close(result.lat, lat, 1e-12); close(result.lng, lng, 1e-12);
    }
    assert.ok(toLocal(origin.lat + .001, origin.lng, origin).z < 0, 'north is -Z');
    assert.ok(toLocal(origin.lat, origin.lng + .001, origin).x > 0, 'east is +X');
  }
  for (const place of data.places) {
    const p = toLocal(place.lat, place.lng, data.origin);
    close(p.x, place.x, .001); close(p.z, place.z, .001);
  }
  const nw = toLatLng(realNetwork.bounds.minX, realNetwork.bounds.minZ, data.origin);
  const se = toLatLng(realNetwork.bounds.maxX, realNetwork.bounds.maxZ, data.origin);
  close(nw.lat, data.bounds.north); close(nw.lng, data.bounds.west);
  close(se.lat, data.bounds.south); close(se.lng, data.bounds.east);
});

test('real OSM provenance counts, mapped Ghanta Ghar coordinate and named roads remain present', () => {
  for (const key of ['roads', 'buildings', 'places']) {
    assert.equal(data[key].length, data.provenance.counts[key], `${key} provenance count`);
    assert.equal(new Set(data[key].map(item => item.id)).size, data[key].length, `${key} OSM IDs are unique`);
  }
  assert.ok(data.roads.length > 500 && data.buildings.length > 4000);
  assert.match(data.provenance.source, /OpenStreetMap/);
  assert.match(data.provenance.license, /ODbL/);
  assert.match(data.provenance.attribution, /OpenStreetMap/);
  const tower = realNetwork.tower;
  assert.ok(tower, 'mapped Clock Tower is retained');
  assert.match(tower.name, /ghanta|clock/i);
  assert.match(tower.id, /^(node|way)\/\d+$/);
  assert.equal(tower.source, 'OpenStreetMap');
  assert.match(tower.locationSource, /OSM/);
  assert.ok(Math.abs(tower.lat - 30.3244) < .001 && Math.abs(tower.lng - 78.04186) < .001);
  assert.equal(tower.radius, 4.3);
  for (const name of [/rajpur/i, /gandhi/i, /chakrata/i]) assert.ok(data.roads.some(r => name.test(r.name)));
});

test('map roads are asymmetric surveyed geometry rather than a generated axis grid', () => {
  const segments = realNetwork.segments;
  assert.ok(segments.some(s => Math.abs(s.ax - s.bx) > 2 && Math.abs(s.az - s.bz) > 2));
  assert.ok(new Set(segments.map(s => s.heading.toFixed(2))).size > 100);
  assert.ok(new Set(data.roads.map(r => r.width)).size > 3);
  let mismatches = 0;
  for (let i = 0; i < segments.length; i += 37) {
    const s = segments[i], x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2;
    if (realNetwork.isDrivable(x, z) !== realNetwork.isDrivable(-x, -z)) mismatches++;
  }
  assert.ok(mismatches > 30, `${mismatches} asymmetric sampled road positions`);
});

test('circle radius boundaries and narrow lanes remain usable without a 2.4m disk', () => {
  const n = network([road(undefined, 3)]);
  assert.ok(n.isDrivable(.4, 0));
  assert.ok(!n.isDrivable(.40001, 0));
  assert.ok(n.isVehicleDrivable(.38, 0, 0));
  assert.ok(!n.isVehicleDrivable(.38001, 0, 0));
  assert.ok(!n.isDrivable(0, 0, 2.4));
  assert.ok(!n.isVehicleDrivable(0, 0, Math.PI / 2), 'crosswise sedan cannot fit a 3m lane');
  for (const radius of [-1, NaN, Infinity]) assert.ok(!n.isDrivable(0, 0, radius));
  assert.ok(!n.isVehicleDrivable(0, 0, NaN));
  const s = n.spawnNear(.3, 10);
  assert.equal(s.distance, 0);
  run(s, { forward: true }, 3, n);
  assert.ok(s.distance > 20 && n.isVehicleDrivable(s.x, s.z, s.heading));
});

test('open, closed and duplicate-vertex footprint rings include the closing edge', () => {
  const ring = rectangle(0, -3, 4, 3).ring;
  for (const variant of [ring, [...ring, ring[0]], [ring[0], ring[0], ...ring.slice(1), ring[0], ring[0]]]) {
    assert.ok(pointInRing(2, 0, variant));
    assert.ok(!pointInRing(-1, 0, variant));
    assert.ok(circleIntersectsRing(-1, 0, 1.1, variant));
    assert.ok(!circleIntersectsRing(-1.1, 0, 1.1, variant));
    const n = network([road(undefined, 20)], [{ ring: variant }]);
    assert.ok(!n.isDrivable(-1, 0), 'left closing edge blocks circle');
    assert.ok(!n.canMove(-1.05, -5, -1.05, 5), 'sweep also sees left closing edge');
  }
  close(segmentDistance({ ax: 0, az: 0, bx: 0, bz: 4 }, { ax: -1, az: 2, bx: 1, bz: 2 }), 0);
  close(projectSegment(2, 3, { ax: 0, az: 0, bx: 0, bz: 0 }).distance, Math.sqrt(13));
});

test('full capsule blocks nose and centreline collisions which a centre disk misses', () => {
  const n = network([road(undefined, 12)], [rectangle(-4, -3.5, 4, -2)]);
  assert.ok(n.isDrivable(0, 0), 'old centre disk is clear');
  assert.ok(!n.isVehicleDrivable(0, 0, 0), 'front bumper is not clear');
  assert.ok(n.isVehicleDrivable(0, 0, Math.PI / 2));
  const spawned = n.spawnNear(0, 0);
  assert.ok(n.isVehicleDrivable(spawned.x, spawned.z, spawned.heading));
  assert.equal(spawned.distance, 0);
  const side = network([road(undefined, 20)], [rectangle(1, -.04, 1.02, .04)]);
  assert.ok(side.isDrivable(0, -1.1, 1.12) && side.isDrivable(0, 1.1, 1.12));
  assert.ok(!side.isVehicleDrivable(0, 0, 0), 'capsule interior between endpoint circles is covered');
});

test('Clock Tower name/kind variants guard the entire rendered 4.3m base', () => {
  for (const place of [{ name: 'Ghanta Ghar' }, { name: 'Clock Tower' }, { kind: 'clock_tower' }, { name: 'घंटा घर' }]) {
    const n = network([road(undefined, 30)], [], [{ ...place, x: 0, z: 0 }]);
    assert.equal(n.tower.radius, 4.3);
    assert.ok(n.isDrivable(5.4, 0));
    assert.ok(!n.isDrivable(5.399, 0));
    assert.ok(n.isVehicleDrivable(5.42, 0, 0));
    assert.ok(!n.isVehicleDrivable(5.419, 0, 0));
    assert.ok(!n.isVehicleDrivable(5.5, 0, Math.PI / 2));
    assert.ok(!n.canMove(-8, 0, 8, 0));
  }
});

test('sweeps cannot jump thin walls, missing road slivers, or disconnected roads', () => {
  const n = network([road(undefined, 20)], [rectangle(-10, -.0001, 10, .0001)]);
  assert.ok(n.isVehicleDrivable(0, -10, 0) && n.isVehicleDrivable(0, 10, 0));
  assert.ok(!n.canMove(0, -10, 0, 10));
  assert.ok(!n.canVehicleMove(0, -10, 0, 10, 0));
  const s = state(0, 3, 0, 16.7);
  run(s, { forward: true }, 2, n);
  assert.ok(s.z >= 2.2201 - 1e-8 && s.speed < .1);
  const gap = network([road([[0, -20], [0, -1.1001]], 2.2), road([[0, 1.1001], [0, 20]], 2.2)]);
  assert.ok(gap.isDrivable(0, -2, 0) && gap.isDrivable(0, 2, 0));
  assert.ok(!gap.canMove(0, -2, 0, 2, 0), '0.2mm road gap cannot be skipped by sampling');
  const disconnected = network([road([[-5, -10], [-5, 10]], 3), road([[5, -10], [5, 10]], 3)]);
  assert.ok(!disconnected.canVehicleMove(-5, 0, 5, 0, 0));
});

test('yaw sweeps cannot rotate through a building, and blocked translation cannot accumulate yaw', () => {
  const n = network([road(undefined, 30)], [rectangle(-1.5, -1.5, -1.45, -1.45)]);
  assert.ok(n.isVehicleDrivable(0, 0, 0));
  assert.ok(n.isVehicleDrivable(0, 0, Math.PI / 2));
  assert.ok(!n.canVehicleMove(0, 0, 0, 0, 0, Math.PI / 2), 'intermediate rotation intersects corner');
  const wall = network([road(undefined, 20)], [rectangle(-10, -4, 10, -2.22)]);
  const s = state(0, 0, 0, 12);
  run(s, { forward: true, left: true }, 2, wall);
  assert.ok(wall.isVehicleDrivable(s.x, s.z, s.heading));
  close(s.heading, 0, 1e-6);
  close(s.x, 0, 1e-6); close(s.z, 0, 1e-6);
  assert.ok(s.speed < .1);
});

test('geographic bounds constrain every part of the vehicle', () => {
  const cornerNW = toLatLng(-10, -10), cornerSE = toLatLng(10, 10);
  const n = network([road(undefined, 30)], [], [], { bounds: { north: cornerNW.lat, west: cornerNW.lng, south: cornerSE.lat, east: cornerSE.lng } });
  assert.ok(n.isVehicleDrivable(0, -7.779, 0));
  assert.ok(!n.isVehicleDrivable(0, -7.781, 0));
  const s = state(0, 0, 0, 16.7);
  run(s, { forward: true }, 2, n);
  assert.ok(n.isVehicleDrivable(s.x, s.z, s.heading));
  assert.ok(s.z >= -7.78 - 1e-7 && s.speed < .1);
});

test('forward/reverse caps, direction-change braking and explicit brake work in either direction', () => {
  const n = network(), s = state();
  run(s, { forward: true }, 4, n);
  close(s.speed, 16.7); assert.ok(s.z < 0);
  run(s, { reverse: true }, .5, n);
  assert.ok(s.speed > 0 && s.speed < 16.7, 'reverse first brakes forward travel');
  run(s, { reverse: true }, 4, n);
  close(s.speed, -5);
  const z = s.z;
  run(s, { reverse: true }, .2, n); assert.ok(s.z > z);
  run(s, { forward: true }, .2, n); assert.ok(s.speed < 0 && s.speed > -5);
  run(s, { brake: true }, 1, n); close(s.speed, 0);
  run(s, { forward: true }, 1, n); run(s, { brake: true }, 1, n); close(s.speed, 0);
  run(s, { reverse: true }, 1, n); run(s, {}, 8, n); close(s.speed, 0);
});

test('invalid states never teleport and stalled steering cannot rotate a parked vehicle', () => {
  const n = network(), s = state(80, 80, .3, 10), before = { ...s };
  stepGeoDriving(s, { forward: true, left: true }, .1, n);
  assert.deepEqual(s, { ...before, speed: 0 });
  const parked = state(); run(parked, { left: true }, 1, n);
  assert.equal(parked.heading, 0); assert.equal(parked.distance, 0);
  for (const dt of [NaN, Infinity, -1, 0]) {
    const previous = { ...parked }; stepGeoDriving(parked, { forward: true }, dt, n); assert.deepEqual(parked, previous);
  }
  assert.throws(() => stepGeoDriving({ ...state(), heading: NaN }, {}, .1, n), TypeError);
  const a = state(), b = state();
  stepGeoDriving(a, { forward: true }, 100, n); stepGeoDriving(b, { forward: true }, .1, n);
  assert.deepEqual(a, b);
});

test('initial view is on a nearby real Rajpur approach facing the actual mapped tower', () => {
  const s = createGeoState(realNetwork), tower = realNetwork.tower;
  assert.ok(realNetwork.isVehicleDrivable(s.x, s.z, s.heading));
  assert.equal(s.speed, 0); assert.equal(s.distance, 0);
  const rajpurDistance = Math.min(...realNetwork.segments.filter(segment => /rajpur/i.test(segment.name)).map(segment => projectSegment(s.x, s.z, segment).distance));
  close(rajpurDistance, 0);
  const dx = tower.x - s.x, dz = tower.z - s.z, distance = Math.hypot(dx, dz);
  assert.ok(distance > 6 && distance < 80, `tower is ${distance} metres away`);
  assert.ok((-Math.sin(s.heading) * dx - Math.cos(s.heading) * dz) / distance > .99, 'tower is directly ahead');
  const shifted = network([road([[95, 100], [95, 200]], 12, 'Rajpur Road')], [], [{ name: 'Clock Tower', x: 100, z: 100 }]);
  const other = createGeoState(shifted);
  assert.ok(shifted.isVehicleDrivable(other.x, other.z, other.heading));
  assert.ok(Math.hypot(other.x - 100, other.z - 100) < 30, 'spawn follows supplied tower, not DEFAULT_ORIGIN');
});

test('20,000 seeded real-map driving steps preserve full footprint and bounded continuous movement', () => {
  let seed = 983;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let s = createGeoState(realNetwork), input = {}, totalDistance = 0;
  const visitedRoads = new Set();
  for (let i = 0; i < 20000; i++) {
    if (i && i % 1000 === 0) {
      // Each new scenario starts with the full-footprint spawn API; never seed
      // an invalid arbitrary heading, which would make safety checks vacuous.
      const segment = realNetwork.segments[Math.floor(random() * realNetwork.segments.length)];
      s = realNetwork.spawnNear((segment.ax + segment.bx) / 2, (segment.az + segment.bz) / 2);
      assert.ok(realNetwork.isVehicleDrivable(s.x, s.z, s.heading));
      visitedRoads.add(realNetwork.nearest(s.x, s.z).segment.roadId);
    }
    if (i % 70 === 0) input = { forward: random() > .2, reverse: random() > .7, left: random() > .5, right: random() > .5, brake: random() > .97 };
    const previous = { ...s };
    stepGeoDriving(s, input, 1 / 30, realNetwork);
    assert.ok(realNetwork.isVehicleDrivable(s.x, s.z, s.heading), `unsafe full vehicle at step ${i}`);
    assert.ok(s.speed >= -5 && s.speed <= 16.7);
    const distance = Math.hypot(s.x - previous.x, s.z - previous.z);
    assert.ok(distance <= 16.7 / 30 + 1e-8, `teleport at ${i}`);
    assert.ok(s.distance >= previous.distance);
    totalDistance += distance;
  }
  assert.ok(visitedRoads.size >= 10);
  assert.ok(totalDistance > 100, 'exercise moving cars, not only parked collisions');
});
