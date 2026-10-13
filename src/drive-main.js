import * as THREE from 'three';
import { createWorld, ROAD_CENTERS, ROAD_WIDTH, MAP_LIMIT } from './drive-world.js';
import { createVehicle } from './drive-vehicle.js';
import { createDrivingState, stepDriving } from './drive-physics.js';

const canvas = document.querySelector('#scene');
const status = document.querySelector('#status');
const pauseButton = document.querySelector('#pause');
const ui = Object.fromEntries(['speed', 'speed-fill', 'gear', 'distance', 'fps', 'heading', 'road-name'].map(id => [id, document.getElementById(id)]));
const events = new AbortController();
const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: events.signal });
let renderer, world, vehicle, sun, frame = 0, stopped = false;

function showStatus(title, text) {
  status.replaceChildren();
  const h2 = document.createElement('h2');
  const p = document.createElement('p');
  h2.textContent = title;
  p.textContent = text;
  status.append(h2, p);
  status.hidden = false;
}

function start() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cbdad7');
  scene.fog = new THREE.Fog('#cbdad7', 100, 610);
  const camera = new THREE.PerspectiveCamera(53, innerWidth / innerHeight, 0.15, 1000);
  scene.add(new THREE.HemisphereLight('#e4f1ff', '#8b8964', 2.4));
  sun = new THREE.DirectionalLight('#fff0d4', 3.0);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, near: 10, far: 240 });
  sun.shadow.normalBias = 0.045;
  sun.shadow.bias = -0.00012;
  sun.castShadow = true;
  scene.add(sun, sun.target);
  world = createWorld(scene);
  vehicle = createVehicle();
  scene.add(vehicle.group);
  const state = createDrivingState();
  let paused = false;
  const keyboard = new Set();
  const touch = new Map();
  const input = { forward: false, reverse: false, left: false, right: false, brake: false };
  const bindings = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'reverse', ArrowDown: 'reverse', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
  const clearInput = () => {
    keyboard.clear();
    touch.clear();
    document.querySelectorAll('#touch button').forEach(button => button.classList.remove('pressed'));
  };
  function setPaused(value) {
    paused = value;
    clearInput();
    pauseButton.textContent = paused ? '▶ Resume' : 'Ⅱ Pause';
    pauseButton.setAttribute('aria-label', paused ? 'Resume driving' : 'Pause driving');
    pauseButton.setAttribute('aria-pressed', String(paused));
    if (paused) showStatus('Take in the view.', 'Paused. Press P or Resume when you’re ready to drive.');
    else status.hidden = true;
  }
  const cameraTarget = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const carPosition = new THREE.Vector3();
  function syncCar() { vehicle.group.position.set(state.x, 0.02, state.z); vehicle.group.rotation.y = state.heading; }
  function updateCamera(dt, snap = false) {
    const speed = Math.abs(state.speed);
    // The camera trails the car's orientation, not its signed velocity, so
    // braking through zero and reversing never flips the view.
    const behind = 10.5 + speed * 0.09;
    cameraTarget.set(state.x + Math.sin(state.heading) * behind, 6.4 + speed * 0.025, state.z + Math.cos(state.heading) * behind);
    // Keep the camera over the road union. A raw chase position at a turn can
    // pass through a building on the inside corner; project it to the nearest street.
    let best = Infinity, nearest = 0, axis = 'x';
    for (const center of ROAD_CENTERS) {
      if (Math.abs(cameraTarget.x - center) < best) { best = Math.abs(cameraTarget.x - center); nearest = center; axis = 'x'; }
      if (Math.abs(cameraTarget.z - center) < best) { best = Math.abs(cameraTarget.z - center); nearest = center; axis = 'z'; }
    }
    if (best > 7.7) cameraTarget[axis] = nearest + Math.sign(cameraTarget[axis] - nearest) * 7.7;
    cameraTarget.x = THREE.MathUtils.clamp(cameraTarget.x, -MAP_LIMIT, MAP_LIMIT);
    cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z, -MAP_LIMIT, MAP_LIMIT);
    desiredLook.set(state.x - Math.sin(state.heading) * 4.2, 1.25, state.z - Math.cos(state.heading) * 4.2);
    if (snap) { camera.position.copy(cameraTarget); lookAt.copy(desiredLook); }
    else { camera.position.lerp(cameraTarget, 1 - Math.exp(-5.5 * dt)); lookAt.lerp(desiredLook, 1 - Math.exp(-9 * dt)); }
    camera.lookAt(lookAt);
  }
  function reset() {
    Object.assign(state, createDrivingState());
    Object.assign(previous, { x: state.x, z: state.z, heading: state.heading });
    accumulator = 0;
    clearInput();
    vehicle.update(0, 0, 0.1, false);
    syncCar();
    updateCamera(0, true);
    updateHUD();
  }
  on(window, 'keydown', event => {
    if (event.target instanceof HTMLButtonElement && ['Space', 'Enter'].includes(event.code)) return;
    if (bindings[event.code]) { event.preventDefault(); if (!paused) keyboard.add(event.code); }
    if (!event.repeat && event.code === 'KeyP') setPaused(!paused);
    if (!event.repeat && event.code === 'KeyR') reset();
  });
  on(window, 'keyup', event => { keyboard.delete(event.code); });
  on(window, 'blur', () => setPaused(true));
  on(document, 'visibilitychange', () => { if (document.hidden) setPaused(true); });
  on(pauseButton, 'click', () => { setPaused(!paused); canvas.focus({ preventScroll: true }); });
  on(document.querySelector('#reset'), 'click', () => { reset(); canvas.focus({ preventScroll: true }); });
  for (const button of document.querySelectorAll('[data-control]')) {
    on(button, 'pointerdown', event => {
      event.preventDefault();
      if (paused) return;
      button.setPointerCapture(event.pointerId);
      touch.set(event.pointerId, button.dataset.control);
      button.classList.add('pressed');
    });
    const release = event => { touch.delete(event.pointerId); button.classList.remove('pressed'); };
    on(button, 'pointerup', release);
    on(button, 'pointercancel', release);
    on(button, 'lostpointercapture', release);
  }
  on(window, 'resize', () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  on(canvas, 'webglcontextlost', event => {
    event.preventDefault();
    setPaused(true);
    showStatus('Graphics paused.', 'The graphics context was lost. Waiting for your browser to restore it…');
  });
  on(canvas, 'webglcontextrestored', () => { setPaused(true); });

  // Render the static map once. Only the tiny car marker is drawn each HUD tick.
  const map = document.querySelector('#minimap');
  const ctx = map.getContext('2d');
  const baseMap = document.createElement('canvas');
  baseMap.width = map.width; baseMap.height = map.height;
  const bg = baseMap.getContext('2d');
  const scale = (map.height - 28) / (MAP_LIMIT * 2);
  const mx = x => map.width / 2 + x * scale;
  const mz = z => map.height / 2 + z * scale;
  bg.fillStyle = '#d9e0c9'; bg.fillRect(0, 0, map.width, map.height);
  bg.fillStyle = '#efeee2';
  for (const center of ROAD_CENTERS) {
    bg.fillRect(mx(center - ROAD_WIDTH / 2), mz(-MAP_LIMIT), ROAD_WIDTH * scale, MAP_LIMIT * 2 * scale);
    bg.fillRect(mx(-MAP_LIMIT), mz(center - ROAD_WIDTH / 2), MAP_LIMIT * 2 * scale, ROAD_WIDTH * scale);
  }
  bg.strokeStyle = '#b5c29c'; bg.lineWidth = 2;
  bg.beginPath(); bg.moveTo(mx(0), mz(-MAP_LIMIT)); bg.lineTo(mx(0), mz(MAP_LIMIT)); bg.stroke();
  const verticalNames = ['Kaulagarh Road', 'Chakrata Link', 'Rajpur Road', 'Dalanwala Avenue', 'Canal Road'];
  const horizontalNames = ['Mussoorie Approach', 'Dilaram Link', 'Clock Tower Road', 'Gandhi Road', 'Haridwar Link'];
  function updateHUD() {
    ui.speed.textContent = Math.round(Math.abs(state.speed) * 3.6);
    ui['speed-fill'].style.width = `${Math.abs(state.speed) / 25 * 100}%`;
    ui.gear.textContent = state.speed > 0.15 ? 'D' : state.speed < -0.15 ? 'R' : 'N';
    ui.distance.textContent = `${(state.distance / 1000).toFixed(2)} km`;
    const degrees = ((-state.heading * 180 / Math.PI) % 360 + 360) % 360;
    ui.heading.textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
    let best = Infinity, name = 'Rajpur Road';
    ROAD_CENTERS.forEach((center, i) => {
      const dx = Math.abs(state.x - center), dz = Math.abs(state.z - center);
      if (dx < best) { best = dx; name = verticalNames[i]; }
      if (dz < best) { best = dz; name = horizontalNames[i]; }
    });
    ui['road-name'].textContent = name;
    ctx.drawImage(baseMap, 0, 0);
    ctx.save(); ctx.translate(mx(state.x), mz(state.z)); ctx.rotate(-state.heading);
    ctx.fillStyle = '#b85d39'; ctx.strokeStyle = '#fff8e8'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 5); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  let last = performance.now(), accumulator = 0, hudTime = 0, fpsTime = 0, fpsCount = 0;
  const previous = { x: state.x, z: state.z, heading: state.heading };
  function animate(now) {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;
    if (!paused && !document.hidden) {
      for (const key in input) input[key] = false;
      for (const code of keyboard) input[bindings[code]] = true;
      for (const value of touch.values()) input[value] = true;
      accumulator += dt;
      while (accumulator >= 1 / 120) {
        previous.x = state.x; previous.z = state.z; previous.heading = state.heading;
        stepDriving(state, input, 1 / 120);
        accumulator -= 1 / 120;
      }
      const alpha = accumulator * 120;
      carPosition.set(THREE.MathUtils.lerp(previous.x, state.x, alpha), 0.02, THREE.MathUtils.lerp(previous.z, state.z, alpha));
      vehicle.group.position.copy(carPosition);
      const delta = Math.atan2(Math.sin(state.heading - previous.heading), Math.cos(state.heading - previous.heading));
      vehicle.group.rotation.y = previous.heading + delta * alpha;
      vehicle.update(state.speed, state.steering, dt, input.brake || (input.reverse && state.speed > 0.1) || (input.forward && state.speed < -0.1));
      updateCamera(dt);
    } else {
      accumulator = 0;
      previous.x = state.x; previous.z = state.z; previous.heading = state.heading;
    }
    // A local, texel-snapped shadow volume follows the car instead of allocating
    // a huge shadow map for the whole city. Snapping prevents crawling shadows.
    const texel = 130 / 2048;
    const sx = Math.round(state.x / texel) * texel, sz = Math.round(state.z / texel) * texel;
    sun.position.set(sx - 55, 95, sz - 35);
    sun.target.position.set(sx, 0, sz);
    renderer.render(scene, camera);
    hudTime += dt; fpsTime += dt; fpsCount++;
    if (hudTime > 0.1) { updateHUD(); hudTime = 0; }
    if (fpsTime >= 0.75) { ui.fps.textContent = `${Math.round(fpsCount / fpsTime)} fps`; fpsCount = 0; fpsTime = 0; }
  }
  reset();
  status.hidden = true;
  frame = requestAnimationFrame(animate);
}

function dispose() {
  if (stopped) return;
  stopped = true;
  cancelAnimationFrame(frame);
  events.abort();
  vehicle?.dispose();
  world?.dispose();
  sun?.shadow.dispose();
  renderer?.dispose();
}

try { start(); }
catch (error) {
  dispose();
  console.error('Unable to initialise driving scene:', error);
  showStatus('The valley needs WebGL 2.', 'Please enable hardware acceleration and open this scene in a current browser. If graphics are already enabled, reload to try again.');
}
on(window, 'pagehide', event => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
