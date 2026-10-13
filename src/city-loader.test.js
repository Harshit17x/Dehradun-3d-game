import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityLoader, insideCity } from './city-loader.js';

const dataset = { roads: [{ points: [[0, 0], [1, 1]] }], buildings: [], places: [], signals: [], crossings: [], barriers: [], streetLamps: [], provenance: { scope: 'Dehradun city region' } };
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 502, async json() { return body; } });

test('validates city coordinates and returns a normalized dataset', async () => {
  assert.equal(insideCity(30.32448, 78.04187), true);
  assert.equal(insideCity(31, 78), false);
  const loader = createCityLoader({ fetcher: async () => response({ status: 'ok', dataset }) });
  assert.equal((await loader.load(30.32448, 78.04187)).provenance.scope, 'Dehradun city region');
  loader.dispose();
});

test('latest load aborts an older request and does not publish stale data', async () => {
  const statuses = [];
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const loader = createCityLoader({ onStatus: event => statuses.push(event.status), fetcher: (url) => url.includes('30.32448') ? first.then(() => response({ status: 'ok', dataset })) : Promise.resolve(response({ status: 'ok', dataset })) });
  const old = loader.load(30.32448, 78.04187).catch(error => error.name);
  const current = loader.load(30.33, 78.05);
  assert.equal((await current).provenance.scope, 'Dehradun city region');
  release();
  assert.equal(await old, 'AbortError');
  assert.equal(statuses.filter(status => status === 'loaded').length, 1);
  loader.dispose();
});
