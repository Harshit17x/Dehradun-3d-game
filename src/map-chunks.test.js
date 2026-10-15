import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapChunkIndex, createChunkStreamer } from './map-chunks.js';

const features = ['roads', 'buildings', 'places', 'signals', 'crossings', 'streetLamps', 'barriers'];
const all = (index, feature) => [...index.chunks.values()].flatMap(chunk => chunk.data[feature]);
const length = records => records.reduce((sum, record) => sum + record.points.slice(1).reduce((s, b, i) =>
  s + Math.hypot(b[0] - record.points[i][0], b[1] - record.points[i][1]), 0), 0);

test('roads split exactly at positive and negative seams, preserving width and metadata', () => {
  const road = { id: 'way/1', width: 13, surface: 'asphalt', points: [[-50, 20], [250, 20]] };
  const data = { origin: { lat: 30, lng: 78 }, bounds: { south: 29 }, roads: [road] };
  const original = structuredClone(data);
  const index = createMapChunkIndex(data, { chunkSize: 100 });
  assert.deepEqual([...index.chunks.keys()], ['-1,0', '0,0', '1,0', '2,0']);
  assert.deepEqual(all(index, 'roads').map(r => r.points), [
    [[-50, 20], [0, 20]], [[0, 20], [100, 20]], [[100, 20], [200, 20]], [[200, 20], [250, 20]],
  ]);
  assert.equal(length(all(index, 'roads')), 300);
  for (const chunk of index.chunks.values()) {
    assert.equal(chunk.data.origin, data.origin); assert.equal(chunk.data.bounds, data.bounds);
    for (const feature of features) assert.ok(Array.isArray(chunk.data[feature]));
    assert.equal(chunk.data.roads[0].width, 13);
    assert.equal(chunk.data.roads[0].surface, 'asphalt');
  }
  assert.deepEqual(data, original);
});

test('diagonal corners, reversed segments, and grid-aligned roads have no duplicate lengths', () => {
  for (const points of [ [[-50, -50], [250, 250]], [[250, 250], [-50, -50]] ]) {
    const index = createMapChunkIndex({ roads: [{ points }] }, { chunkSize: 100 });
    assert.equal(index.chunks.size, 4);
    assert.ok(Math.abs(length(all(index, 'roads')) - Math.hypot(300, 300)) < 1e-10);
    assert.equal(all(index, 'roads').length, 4);
  }
  const index = createMapChunkIndex({ roads: [{ points: [[100, -100], [100, 200]] }] }, { chunkSize: 100 });
  assert.deepEqual([...index.chunks.keys()], ['1,-1', '1,0', '1,1']);
  assert.equal(length(all(index, 'roads')), 300);
});

test('reentry and missing nodes never bridge disconnected line parts', () => {
  const index = createMapChunkIndex({ roads: [
    { id: 'loop', points: [[20, 20], [120, 20], [120, 80], [20, 80]] },
    { id: 'broken', points: [[10, 10], [20, 10], null, [80, 10], [90, 10]] },
  ] }, { chunkSize: 100 });
  const roads = index.chunks.get('0,0').data.roads;
  assert.deepEqual(roads.filter(r => r.id === 'loop').map(r => r.points), [
    [[20, 20], [100, 20]], [[100, 80], [20, 80]],
  ]);
  assert.deepEqual(roads.filter(r => r.id === 'broken').map(r => r.points), [
    [[10, 10], [20, 10]], [[80, 10], [90, 10]],
  ]);
  assert.equal(length(all(index, 'roads')), 280);
});

test('whole buildings belong to one area-centroid chunk, points to one cell, barriers split once', () => {
  const building = { id: 'large', ring: [[-20, -20], [220, -20], [220, 220], [-20, 220], [-20, -20]] };
  const data = { buildings: [building], barriers: [
    { id: 'wall', width: .5, points: [[-20, 30], [220, 30]] },
    { id: 'bollard', points: [[100, 100]] },
  ] };
  for (const feature of features.slice(2, -1)) data[feature] = [{ id: feature, x: 100, z: -1 }];
  const index = createMapChunkIndex(data, { chunkSize: 100 });
  assert.equal(all(index, 'buildings').length, 1);
  assert.equal(index.chunks.get('1,1').data.buildings[0], building);
  for (const feature of features.slice(2, -1)) {
    assert.equal(all(index, feature).length, 1);
    assert.equal(index.chunks.get('1,-1').data[feature][0], data[feature][0]);
  }
  assert.equal(length(all(index, 'barriers')), 240);
  assert.equal(all(index, 'barriers').filter(r => r.id === 'bollard').length, 1);
  assert.ok(all(index, 'barriers').filter(r => r.id === 'wall').every(r => r.width === .5));
});

function setup(options = {}) {
  const index = createMapChunkIndex({ places: Array.from({ length: 10 }, (_, i) => ({ x: i * 100 + 50, z: 50 })) }, { chunkSize: 100 });
  const made = [];
  const streamer = createChunkStreamer({ index, loadRadius: 130, unloadRadius: 220, now: () => 0,
    buildChunk(chunk) {
      const handle = { key: chunk.key, modes: [], visibility: [], disposals: 0,
        setTimeOfDay(mode) { this.modes.push(mode); }, setBuildingsVisible(visible) { this.visibility.push(visible); },
        dispose() { this.disposals++; } };
      made.push(handle); return handle;
    }, ...options });
  return { index, made, streamer };
}

test('only nearby chunks queue and updates build a single nearest chunk', () => {
  const { streamer, made } = setup({ maxBuildsPerUpdate: 20 });
  assert.deepEqual(streamer.update(250, 50), { active: 1, pending: 2, total: 10, builds: 1, labelVersion: 1 });
  streamer.update(250, 50); streamer.update(250, 50);
  assert.deepEqual(made.map(h => h.key), ['2,0', '1,0', '3,0']);
  assert.equal(streamer.getStats().pending, 0);
  const stats = streamer.getStats();
  streamer.update(250, 50);
  assert.deepEqual(streamer.getStats(), stats);
});

test('movement reprioritizes the queue and hysteresis retains then disposes distant chunks', () => {
  const { streamer, made } = setup();
  streamer.update(250, 50);
  streamer.update(450, 50);
  assert.deepEqual(made.map(h => h.key), ['2,0', '4,0']);
  assert.equal(made[0].disposals, 0); // 150m from cell, beyond load but inside unload.
  streamer.update(550, 50);
  assert.equal(made[0].disposals, 1);
  assert.equal(streamer.active.has('2,0'), false);
  assert.equal(made.at(-1).key, '5,0');
  streamer.update(950, 50);
  assert.equal(made.at(-1).key, '9,0');
  assert.equal(streamer.getStats().pending, 1);
  streamer.update(950, 50);
  assert.equal(made.at(-1).key, '8,0');
  assert.equal(streamer.getStats().pending, 0);
});

test('time/visibility reach existing and future handles; dispose is terminal and idempotent', () => {
  const { streamer, made } = setup();
  streamer.setTimeOfDay('night'); streamer.setBuildingsVisible(false);
  streamer.update(250, 50);
  assert.deepEqual(made[0].modes, ['night']); assert.deepEqual(made[0].visibility, [false]);
  const version = streamer.getStats().labelVersion;
  streamer.setTimeOfDay('sunset'); streamer.setBuildingsVisible(true);
  assert.equal(streamer.getStats().labelVersion, version);
  streamer.update(250, 50);
  assert.deepEqual(made[0].modes, ['night', 'sunset']);
  assert.deepEqual(made[1].modes, ['sunset']); assert.deepEqual(made[1].visibility, [true]);
  streamer.dispose();
  const stats = streamer.getStats();
  streamer.dispose(); streamer.update(950, 50); streamer.setTimeOfDay('day'); streamer.setBuildingsVisible(false);
  assert.deepEqual(streamer.getStats(), stats);
  assert.equal(stats.active, 0); assert.equal(stats.pending, 0);
  assert.equal(made.length, 2); assert.ok(made.every(h => h.disposals === 1));
});

test('soft budget prevents starting late work but cannot interrupt one expensive constructor', () => {
  let clock = 0;
  const index = createMapChunkIndex({ places: [{ x: 10, z: 10 }, { x: 110, z: 10 }] }, { chunkSize: 100 });
  const streamer = createChunkStreamer({ index, now: () => clock, budgetMs: 4,
    buildChunk() { clock += 20; return { dispose() {} }; } });
  assert.equal(streamer.update(10, 10).builds, 1);
  assert.equal(clock, 20);
  assert.equal(streamer.getStats().pending, 1);
  const delayed = setup({ now: () => { clock += 5; return clock; } }).streamer;
  assert.equal(delayed.update(250, 50).builds, 0);
  assert.equal(delayed.getStats().pending, 3);
  assert.equal(setup({ maxBuildsPerUpdate: 0 }).streamer.update(250, 50).builds, 0);
});

test('a build callback disposing the streamer cannot resurrect an active handle', () => {
  const index = createMapChunkIndex({ places: [{ x: 10, z: 10 }] });
  let disposals = 0;
  const streamer = createChunkStreamer({ index, now: () => 0, buildChunk() {
    streamer.dispose(); return { dispose() { disposals++; } };
  } });
  streamer.update(10, 10);
  assert.equal(disposals, 1); assert.equal(streamer.active.size, 0);
  assert.equal(streamer.getStats().pending, 0);
});

test('empty/malformed inputs and invalid options have deterministic behavior', () => {
  assert.equal(createMapChunkIndex(null).chunks.size, 0);
  const index = createMapChunkIndex({ roads: [null, { points: [[0, 0], [NaN, 1]] }],
    buildings: [null, { ring: [[1, 1]] }], places: [null, { x: Infinity, z: 0 }] });
  assert.equal(index.chunks.size, 0);
  assert.throws(() => createMapChunkIndex({}, { chunkSize: 0 }), /chunkSize/);
  assert.throws(() => setup({ unloadRadius: 1 }), /unloadRadius/);
  const { streamer } = setup({ index });
  assert.equal(streamer.update(0, 0).total, 0);
  assert.throws(() => streamer.update(NaN, 0), /finite/);
});
