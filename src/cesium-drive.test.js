import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./cesium-drive.js', import.meta.url), 'utf8');

test('Cesium drive exposes the requested runtime configuration contract', () => {
  assert.match(source, /import \* as Cesium from ['"]cesium['"]/);
  assert.match(source, /export async function createCesiumDrive/);
  assert.match(source, /configUrl = ['"]\/api\/cesium-config['"]/);
  assert.match(source, /fetch\(configUrl/);
  assert.match(source, /Cesium\.Ion\.defaultAccessToken\s*=\s*config\.token/);
  assert.match(source, /requestRenderMode:\s*true/);
  assert.match(source, /globe:\s*false/);
  assert.match(source, /createGooglePhotorealistic3DTileset/);
  assert.match(source, /Cesium3DTileset\.fromUrl/);
  assert.match(source, /tile\.googleapis\.com\/v1\/3dtiles\/root\.json/);
  assert.match(source, /createWorldTerrainAsync/);
  assert.match(source, /createOsmBuildingsAsync/);
});

test('local coordinate and heading helpers preserve the driving convention', async () => {
  let module;
  try {
    module = await import('./cesium-drive.js');
  } catch (error) {
    // Cesium is intentionally a later-installed application dependency. The
    // source contract test above still runs in the lightweight repository setup.
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /cesium/.test(String(error.message))) return;
    throw error;
  }
  assert.deepEqual(module.localToEnu(12, -8, 2.5), { x: 12, y: 2.5, z: 8 });
  assert.equal(module.cesiumHeading(Math.PI / 2), -Math.PI / 2);
});
