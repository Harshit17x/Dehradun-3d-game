import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_MODES } from './google-drive-overlay.js';

test('Google camera modes are finite, distinct, and ordered for the drive control', () => {
  assert.deepEqual(Object.keys(CAMERA_MODES), ['chase', 'wide', 'preview']);
  const poses = Object.values(CAMERA_MODES);
  for (const pose of poses) {
    assert.match(pose.label, /^(Chase|Wide|Preview)$/);
    assert.ok(Number.isFinite(pose.offset));
    assert.ok(Number.isFinite(pose.zoom));
    assert.ok(Number.isFinite(pose.tilt));
    assert.ok(pose.zoom > 0 && pose.tilt >= 0 && pose.tilt <= 90);
  }
  assert.notEqual(CAMERA_MODES.chase.offset, CAMERA_MODES.wide.offset);
  assert.notEqual(CAMERA_MODES.wide.zoom, CAMERA_MODES.preview.zoom);
  assert.ok(CAMERA_MODES.preview.offset < 0, 'preview keeps the car in front of the camera center');
});
