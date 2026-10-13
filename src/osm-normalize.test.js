import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOSM } from './osm-normalize.js';

const bounds = { south: 30.3, north: 30.35, west: 78, east: 78.08 };

test('normalizes map.json node references without reconnecting incomplete ways', () => {
  const data = normalizeOSM({ elements: [
    { type: 'node', id: 1, lat: 30.32, lon: 78.04 },
    { type: 'node', id: 2, lat: 30.321, lon: 78.041 },
    { type: 'way', id: 3, nodes: [1, 2, 99], tags: { highway: 'residential' } },
    { type: 'way', id: 4, nodes: [1, 2], tags: { highway: 'residential' } },
  ] }, { bounds });
  assert.equal(data.roads.length, 1);
  assert.equal(data.provenance.counts.incompleteWays, 1);
});

test('keeps OSM control nodes and real barriers with access tags', () => {
  const data = normalizeOSM({ elements: [
    { type: 'node', id: 1, lat: 30.32, lon: 78.04, tags: { highway: 'traffic_signals' } },
    { type: 'node', id: 2, lat: 30.321, lon: 78.041, tags: { highway: 'crossing' } },
    { type: 'node', id: 3, lat: 30.322, lon: 78.042, tags: { barrier: 'gate', access: 'private' } },
  ] }, { bounds });
  assert.equal(data.signals[0].locationSource, 'OSM control node');
  assert.equal(data.crossings.length, 1);
  assert.equal(data.barriers[0].tags.access, 'private');
  assert.deepEqual(data.barriers[0].points.length, 1);
});

test('retains closed building ways and places way labels at an interior centroid', () => {
  const data = normalizeOSM({ elements: [{ type: 'way', id: 8, geometry: [
    { lat: 30.31, lon: 78.01 }, { lat: 30.31, lon: 78.03 }, { lat: 30.33, lon: 78.03 }, { lat: 30.33, lon: 78.01 }, { lat: 30.31, lon: 78.01 },
  ], tags: { building: 'yes', amenity: 'school', name: 'OSM School' } }] }, { bounds });
  assert.equal(data.buildings.length, 1);
  assert.equal(data.places[0].locationSource, 'OSM way centroid');
  assert.ok(data.places[0].lat > 30.31 && data.places[0].lat < 30.33);
});
