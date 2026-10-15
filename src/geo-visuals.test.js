import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisualTheme, normalizeVisualMode } from './geo-visuals.js';

test('visual mode normalization and themes are deterministic', () => {
  assert.equal(normalizeVisualMode('NIGHT'), 'night');
  assert.equal(normalizeVisualMode('unknown'), 'day');
  assert.notEqual(getVisualTheme('day').background, getVisualTheme('night').background);
  assert.ok(getVisualTheme('night').fogFar < getVisualTheme('day').fogFar);
});
