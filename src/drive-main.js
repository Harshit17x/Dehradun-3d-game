import * as THREE from 'three';
import { createGeoWorld } from './geo-world.js';
import { createRoadNetwork, createGeoState, stepGeoDriving, toLocal } from './geo-driving.js';
import { createVehicle } from './drive-vehicle.js';
import { CAMERA_MODES, createGoogleDriveOverlay } from './google-drive-overlay.js';
import { createCityLoader } from './city-loader.js';
import { createMapChunkIndex, createChunkStreamer } from './map-chunks.js';
import { createMappedSurface as createChunkSurface } from './mapped-surface.js';
import { sound } from './audio.js';
import { getVisualTheme, normalizeVisualMode } from './geo-visuals.js';
import mappedData from './dehradun-data.json' with { type: 'json' };

const status = document.querySelector('#status');
const mapCanvas = document.querySelector('#map-canvas');
const mapStatus = document.querySelector('#map-status');
const pauseButton = document.querySelector('#pause');
const timeToggle = document.querySelector('#time-toggle');
const timeIcon = document.querySelector('#time-icon');
const timeText = document.querySelector('#time-text');
const geoStatus = document.querySelector('#geo-status');
const streamStatus = document.querySelector('#stream-status');
const ui = Object.fromEntries(['speed', 'speed-fill', 'gear', 'distance', 'fps', 'heading', 'road-name'].map(id => [id, document.getElementById(id)]));
const events = new AbortController();
const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: events.signal });
let vehicle, mappedWorld, frame = 0, stopped = false;
let googleOverlay, googleOverlayPromise, googleOverlayGeneration = 0, cityLoader;
let currentData = mappedData;

function showStatus(title, text) {
  status.replaceChildren();
  const h2 = document.createElement('h2');
  const p = document.createElement('p');
  h2.textContent = title;
  p.textContent = text;
  status.append(h2, p);
  status.hidden = false;
}

function setGeoStatus(text, tone = 'offline') {
  geoStatus.textContent = text;
  geoStatus.dataset.tone = tone;
}

const localCoverage = () => currentData.provenance?.scope || 'Dehradun city region extract';

function updateMapProvenance() {
  const counts = currentData.provenance?.counts;
  const roads = counts?.roads || 0;
  const buildings = counts?.buildings || 0;
  mapStatus.textContent = `Google Maps vector 3D basemap · OpenStreetMap overlay · ${localCoverage()} · ${roads} mapped roads, ${buildings} building footprints; façades are approximate.`;
}

function updateStreamingStatus(stats) {
  if (!streamStatus || !stats) return;
  const queued = stats.pending ? ` · ${stats.pending} queued` : ' · ready';
  streamStatus.textContent = `Streaming mapped overlay · ${stats.active} chunks active${queued}`;
  streamStatus.dataset.tone = stats.pending ? 'loading' : 'ready';
}

function showGoogleFailure(error) {
  const message = error?.message || 'Google Maps could not be loaded';
  setGeoStatus(`Google 3D unavailable · ${message}. Check the Maps API key and map ID.`, 'diagnostic');
  mapStatus.textContent = `Google 3D unavailable · ${message}`;
  showStatus('Google Maps 3D unavailable.', 'Check the Google Maps API configuration, then reload the drive.');
}

function start() {
  let network = createRoadNetwork(currentData);
  let chunkIndex = createMapChunkIndex(currentData, { chunkSize: 320 });
  const worldGroup = new THREE.Group();
  worldGroup.name = 'Mapped Google overlay chunks';
  vehicle = createVehicle();

  let visualMode = 'day';
  let chunkStreamer;
  let streamStats;
  let streamElapsed = 0;
  let streamX = 0, streamZ = 0;
  const streamInterval = .12;
  const streamMoveThresholdSquared = (chunkIndex.chunkSize * .25) ** 2;

  const createStreamingWorld = (index) => createChunkStreamer({
    index,
    loadRadius: 720,
    unloadRadius: 980,
    maxBuildsPerUpdate: 1,
    budgetMs: 5,
    buildChunk(chunk) {
      const world = createGeoWorld(chunk.data);
      const surface = createChunkSurface(chunk.data, network, { ground: false, boundary: false });
      const group = new THREE.Group();
      group.name = `Map chunk ${chunk.key}`;
      group.add(surface.group, world.group);
      worldGroup.add(group);
      return {
        group,
        labels: world.labels,
        setTimeOfDay(mode) { world.setTimeOfDay(mode); surface.setTimeOfDay(mode); },
        setBuildingsVisible(visible) { world.setBuildingsVisible(visible); },
        update(time) { world.update(time); },
        dispose() { world.dispose(); surface.dispose(); group.removeFromParent(); group.clear(); },
      };
    },
  });

  chunkStreamer = createStreamingWorld(chunkIndex);
  mappedWorld = {
    group: worldGroup,
    setTimeOfDay(mode) { chunkStreamer?.setTimeOfDay(mode); },
    update(time) { for (const handle of chunkStreamer?.active.values() || []) handle.update?.(time); },
    dispose() { chunkStreamer?.dispose?.(); chunkStreamer = null; worldGroup.clear(); },
  };

  const state = createGeoState(network);
  const updateStreaming = (force = false) => {
    if (!chunkStreamer) return streamStats;
    const dx = state.x - streamX, dz = state.z - streamZ;
    const moved = dx * dx + dz * dz >= streamMoveThresholdSquared;
    if (!force && !moved && !(streamStats?.pending > 0 && streamElapsed >= streamInterval)) return streamStats;
    streamElapsed = 0;
    streamX = state.x; streamZ = state.z;
    streamStats = chunkStreamer.update(state.x, state.z);
    updateStreamingStatus(streamStats);
    return streamStats;
  };

  function setTimeOfDay(mode) {
    visualMode = normalizeVisualMode(mode);
    const theme = getVisualTheme(visualMode);
    mappedWorld?.setTimeOfDay?.(visualMode);
    if (timeToggle) {
      timeToggle.textContent = visualMode === 'night' ? '☀ Day' : '☾ Night';
      timeToggle.setAttribute('aria-pressed', String(visualMode === 'night'));
      timeToggle.setAttribute('aria-label', visualMode === 'night' ? 'Switch to daylight' : 'Switch to night mode');
    }
    if (timeIcon) timeIcon.textContent = visualMode === 'night' ? '☾' : '☀';
    if (timeText) timeText.textContent = visualMode === 'night' ? 'Valley night' : 'Valley daylight';
    worldGroup.userData.visualTheme = theme.label;
  }

  setTimeOfDay(visualMode);
  streamStats = chunkStreamer.update(state.x, state.z);
  streamX = state.x; streamZ = state.z;
  updateStreamingStatus(streamStats);
  updateMapProvenance();

  let paused = false;
  let autoPaused = false;
  let frameFailure = null;
  const keyboard = new Set();
  const touch = new Map();
  const input = { forward: false, reverse: false, left: false, right: false, brake: false, boost: false };
  const bindings = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'reverse', ArrowDown: 'reverse',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'brake',
    ShiftLeft: 'boost', ShiftRight: 'boost',
  };
  const clearInput = () => {
    keyboard.clear();
    for (const key of Object.keys(input)) input[key] = false;
    const pointerIds = [...touch.keys()];
    touch.clear();
    for (const button of document.querySelectorAll('#touch button')) {
      button.classList.remove('pressed');
      for (const pointerId of pointerIds) {
        try { if (button.hasPointerCapture?.(pointerId)) button.releasePointerCapture(pointerId); }
        catch { /* the pointer may already have been cancelled by the browser */ }
      }
    }
  };
  function setPaused(value, { automatic = false } = {}) {
    const next = Boolean(value), wasPaused = paused;
    paused = next;
    if (paused) {
      if (automatic && !wasPaused) autoPaused = true;
      if (!automatic) autoPaused = false;
      clearInput();
      try { sound.updateVehicleSound('rover', 0, false); } catch { /* audio can be unavailable during teardown */ }
    } else {
      autoPaused = false;
      frameFailure = null;
    }
    pauseButton.textContent = paused ? '▶ Resume' : 'Ⅱ Pause';
    pauseButton.setAttribute('aria-label', paused ? 'Resume driving' : 'Pause driving');
    pauseButton.setAttribute('aria-pressed', String(paused));
    if (paused) showStatus('Take in the view.', 'Paused. Press P or Resume when you’re ready to drive.');
    else status.hidden = true;
  }

  function syncCar() {
    vehicle.group.position.set(state.x, 0.02, state.z);
    vehicle.group.rotation.y = state.heading;
  }

  function updateHUD() {
    ui.speed.textContent = Math.round(Math.abs(state.speed) * 3.6);
    ui['speed-fill'].style.width = `${Math.min(100, Math.abs(state.speed) / 16.7 * 100)}%`;
    ui.gear.textContent = state.speed > 0.15 ? 'D' : state.speed < -0.15 ? 'R' : 'N';
    ui.distance.textContent = `${(state.distance / 1000).toFixed(2)} km`;
    const degrees = ((-state.heading * 180 / Math.PI) % 360 + 360) % 360;
    ui.heading.textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
    ui['road-name'].textContent = network.nearest(state.x, state.z)?.name || 'Mapped OSM road';
  }

  let selectedCameraMode = 'chase';
  const cameraModeName = document.querySelector('#camera-mode-name');
  const cameraModeButtons = [...document.querySelectorAll('[data-camera-mode]')];
  const syncCameraModeUI = () => {
    const label = CAMERA_MODES[selectedCameraMode]?.label || CAMERA_MODES.chase.label;
    cameraModeButtons.forEach(button => {
      const active = button.dataset.cameraMode === selectedCameraMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (cameraModeName) cameraModeName.textContent = `${label} · C / O / V`;
  };
  const setCameraMode = mode => {
    if (!CAMERA_MODES[mode]) return;
    selectedCameraMode = mode;
    syncCameraModeUI();
    googleOverlay?.setCameraMode?.(mode);
  };
  syncCameraModeUI();

  async function ensureGoogleOverlay() {
    const requestGeneration = ++googleOverlayGeneration;
    googleOverlay?.dispose();
    googleOverlay = null;
    googleOverlayPromise = null;
    setGeoStatus('Loading Google vector 3D map and mapped overlay…', 'loading');
    const promise = createGoogleDriveOverlay({
      container: mapCanvas,
      data: currentData,
      state,
      worldGroup,
      vehicleGroup: vehicle.group,
      onStatus: (title, text) => {
        mapStatus.textContent = `${title} · ${text}`;
        if (/ready/i.test(title)) {
          setGeoStatus(`Google vector 3D active · the single car and ${localCoverage()} are georeferenced over the Google basemap.`, 'google');
          updateMapProvenance();
        }
        if (/unavailable|failed/i.test(title)) setGeoStatus(`Google 3D unavailable · ${text}.`, 'diagnostic');
      },
    });
    googleOverlayPromise = promise.then(result => {
      if (requestGeneration !== googleOverlayGeneration || stopped) {
        result.dispose();
        throw new Error('Google 3D request was cancelled');
      }
      googleOverlay = result;
      result.setCameraMode?.(selectedCameraMode);
      result.update(state, 1 / 60);
      return result;
    }).catch(error => {
      if (requestGeneration === googleOverlayGeneration) {
        googleOverlayPromise = null;
        googleOverlay = null;
        showGoogleFailure(error);
      }
      throw error;
    });
    try { await googleOverlayPromise; }
    catch { /* the visible status explains the Google failure */ }
  }

  async function loadCityArea(lat, lng) {
    setGeoStatus(`Loading mapped Dehradun streets near ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}…`, 'loading');
    try {
      // The default bundle already contains the complete bounded Dehradun
      // extract. Reposition locally first so a temporary Overpass outage does
      // not turn an in-city search into an HTTP error or discard the playable
      // Google scene.
      const localTarget = toLocal(lat, lng, currentData.origin);
      if (currentData.bounds && lat >= currentData.bounds.south && lat <= currentData.bounds.north
        && lng >= currentData.bounds.west && lng <= currentData.bounds.east) {
        const nextState = network.spawnNear(localTarget.x, localTarget.z);
        Object.assign(state, nextState);
        Object.assign(previous, { x: state.x, z: state.z, heading: state.heading });
        accumulator = 0;
        streamStats = null;
        streamX = state.x; streamZ = state.z; streamElapsed = 0;
        updateStreaming(true);
        syncCar(); updateHUD(); updateMapProvenance();
        googleOverlay?.update(state, 0);
        setGeoStatus(`Google vector 3D active · moved to mapped Dehradun streets near ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}.`, 'google');
        return;
      }
      const nextData = await cityLoader.load(lat, lng);
      const nextNetwork = createRoadNetwork(nextData);
      const target = toLocal(lat, lng, nextData.origin);
      let nextState;
      try { nextState = nextNetwork.spawnNear(target.x, target.z); }
      catch { nextState = createGeoState(nextNetwork); }

      mappedWorld?.dispose();
      network = nextNetwork;
      currentData = nextData;
      chunkIndex = createMapChunkIndex(nextData, { chunkSize: 320 });
      chunkStreamer = createStreamingWorld(chunkIndex);
      mappedWorld.setTimeOfDay(visualMode);
      Object.assign(state, nextState);
      Object.assign(previous, { x: state.x, z: state.z, heading: state.heading });
      accumulator = 0;
      streamStats = null;
      streamX = state.x; streamZ = state.z; streamElapsed = 0;
      updateStreaming(true);
      syncCar(); updateHUD(); updateMapProvenance();
      await ensureGoogleOverlay();
    } catch (error) {
      setGeoStatus(`Could not load that Dehradun area · ${error.message || 'map request failed'}.`, 'diagnostic');
    }
  }

  async function searchCity() {
    const inputElement = document.querySelector('#city-search-input');
    const query = inputElement?.value.trim();
    if (!query) return;
    const button = document.querySelector('#city-search-button');
    if (button) button.disabled = true;
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok || body.status !== 'ok' || !body.results?.length) throw new Error(body.error || 'No place found inside the Dehradun city region');
      const result = body.results[0];
      if (inputElement) inputElement.value = result.name.split(',')[0];
      await loadCityArea(result.lat, result.lng);
    } catch (error) {
      setGeoStatus(`Search failed · ${error.message || 'try a named place in Dehradun'}.`, 'diagnostic');
    } finally { if (button) button.disabled = false; }
  }

  function reset() {
    Object.assign(state, createGeoState(network));
    Object.assign(previous, { x: state.x, z: state.z, heading: state.heading });
    accumulator = 0;
    clearInput();
    vehicle.update(0, 0, 0.1, false);
    syncCar(); updateHUD();
    googleOverlay?.update(state, 0);
  }

  on(window, 'keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable) return;
    sound.init();
    if (event.target instanceof HTMLButtonElement && ['Space', 'Enter'].includes(event.code)) return;
    if (bindings[event.code]) { event.preventDefault(); if (!paused) keyboard.add(event.code); }
    if (!event.repeat && event.code === 'KeyP') setPaused(!paused);
    if (!event.repeat && event.code === 'KeyR') reset();
    if (!event.repeat && event.code === 'KeyN') setTimeOfDay(visualMode === 'night' ? 'day' : 'night');
    if (!event.repeat && event.code === 'KeyC') setCameraMode('chase');
    if (!event.repeat && event.code === 'KeyO') setCameraMode('wide');
    if (!event.repeat && event.code === 'KeyV') setCameraMode('preview');
    if (!event.repeat && event.code === 'KeyH') {
      const active = vehicle.toggleHeadlights();
      const button = document.querySelector('#headlights-toggle');
      if (button) {
        button.setAttribute('aria-pressed', String(active));
        button.textContent = active ? '💡 Lights On' : '💡 Lights Off';
      }
    }
  });
  on(window, 'keyup', event => keyboard.delete(event.code));
  on(window, 'blur', () => setPaused(true, { automatic: true }));
  on(window, 'focus', () => { if (!document.hidden && autoPaused) setPaused(false); });
  on(document, 'visibilitychange', () => {
    if (document.hidden) setPaused(true, { automatic: true });
    else if (autoPaused) setPaused(false);
  });
  on(pauseButton, 'click', () => { sound.init(); setPaused(!paused); pauseButton.focus({ preventScroll: true }); });
  on(document.querySelector('#reset'), 'click', () => { sound.init(); reset(); });
  on(document.querySelector('#city-search-button'), 'click', () => { sound.init(); void searchCity(); });
  on(document.querySelector('#city-search-input'), 'keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); sound.init(); void searchCity(); }
  });
  cameraModeButtons.forEach(button => on(button, 'click', () => {
    sound.init();
    setCameraMode(button.dataset.cameraMode);
  }));

  const audioToggle = document.querySelector('#audio-toggle');
  if (audioToggle) on(audioToggle, 'click', () => {
    sound.init();
    const enabled = sound.toggle();
    audioToggle.textContent = enabled ? '🔊 Sound On' : '🔇 Sound Off';
    audioToggle.setAttribute('aria-pressed', String(enabled));
  });

  const headlightsToggle = document.querySelector('#headlights-toggle');
  if (headlightsToggle) on(headlightsToggle, 'click', () => {
    const active = vehicle.toggleHeadlights();
    headlightsToggle.setAttribute('aria-pressed', String(active));
    headlightsToggle.textContent = active ? '💡 Lights On' : '💡 Lights Off';
  });
  if (timeToggle) on(timeToggle, 'click', () => setTimeOfDay(visualMode === 'night' ? 'day' : 'night'));

  document.querySelectorAll('[data-vehicle]').forEach(button => on(button, 'click', () => {
    sound.init();
    document.querySelectorAll('[data-vehicle]').forEach(item => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    vehicle.setVehicleModel(button.dataset.vehicle);
    const title = document.getElementById('vehicle-title');
    if (title) title.textContent = vehicle.getVehicleName();
  }));
  vehicle.onModelChange((key, name) => {
    const title = document.getElementById('vehicle-title');
    if (title) title.textContent = name;
    document.querySelectorAll('[data-vehicle]').forEach(button => {
      button.classList.toggle('active', button.dataset.vehicle === key);
      button.setAttribute('aria-pressed', String(button.dataset.vehicle === key));
    });
  });

  for (const button of document.querySelectorAll('[data-control]')) {
    on(button, 'pointerdown', event => {
      sound.init();
      event.preventDefault(); if (paused) return;
      button.setPointerCapture(event.pointerId);
      touch.set(event.pointerId, button.dataset.control);
      button.classList.add('pressed');
    });
    const release = event => { touch.delete(event.pointerId); button.classList.remove('pressed'); };
    on(button, 'pointerup', release);
    on(button, 'pointercancel', release);
    on(button, 'lostpointercapture', release);
  }

  const physicsStep = 1 / 120;
  const maxPhysicsSteps = 8;
  const maxFrameDelta = .1;
  let last = performance.now();
  let accumulator = 0, hudTime = 0, fpsTime = 0, fpsCount = 0;
  const previous = { x: state.x, z: state.z, heading: state.heading };
  const reportFrameFailure = error => {
    if (frameFailure) return;
    frameFailure = error;
    console.error('Google drive frame failed:', error);
    clearInput();
    setPaused(true);
    setGeoStatus(`Google drive paused · ${error?.message || 'frame update failed'}.`, 'diagnostic');
    showStatus('Driving paused.', 'The Google 3D scene hit a recoverable frame error. Press Resume to try again.');
  };

  function animate(now) {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.min(Math.max((now - last) / 1000, 0), maxFrameDelta);
    last = now;
    if (document.hidden) {
      if (!paused) setPaused(true, { automatic: true });
      fpsTime = 0; fpsCount = 0;
      return;
    }
    if (frameFailure && paused) return;
    try {
      if (!paused) {
        for (const key of Object.keys(input)) input[key] = false;
        for (const code of keyboard) input[bindings[code]] = true;
        for (const value of touch.values()) input[value] = true;
        accumulator = Math.min(accumulator + dt, physicsStep * maxPhysicsSteps);
        let physicsSteps = 0;
        while (accumulator >= physicsStep && physicsSteps < maxPhysicsSteps) {
          previous.x = state.x; previous.z = state.z; previous.heading = state.heading;
          stepGeoDriving(state, input, physicsStep, network);
          accumulator -= physicsStep;
          physicsSteps++;
        }
        const isBraking = input.brake || (input.reverse && state.speed > 0.1) || (input.forward && state.speed < -0.1);
        vehicle.update(state.speed, state.steering, dt, isBraking);
        vehicle.group.position.set(state.x, 0.02, state.z);
        vehicle.group.rotation.y = state.heading;
        const speedKmh = Math.abs(Math.round(state.speed * 3.6));
        sound.updateVehicleSound('rover', speedKmh, Boolean(input.forward || input.reverse));
      } else {
        accumulator = 0;
        previous.x = state.x; previous.z = state.z; previous.heading = state.heading;
        sound.updateVehicleSound('rover', 0, false);
      }
      streamElapsed += dt;
      updateStreaming();
      mappedWorld?.update?.(now / 1000);
      googleOverlay?.update(state, paused ? 0 : dt);
      hudTime += dt; fpsTime += dt; fpsCount++;
      if (hudTime > 0.1) { updateHUD(); hudTime = 0; }
      if (fpsTime >= 0.75) {
        ui.fps.textContent = `${Math.round(fpsCount / fpsTime)} fps`;
        fpsCount = 0; fpsTime = 0;
      }
    } catch (error) {
      reportFrameFailure(error);
    }
  }

  cityLoader = createCityLoader({ onStatus: event => {
    if (event.status === 'loading') setGeoStatus(`Loading mapped streets near ${Number(event.lat).toFixed(4)}, ${Number(event.lng).toFixed(4)}…`, 'loading');
    if (event.status === 'error') setGeoStatus(`City map unavailable · ${event.error?.message || 'request failed'}. Current Google overlay remains active.`, 'diagnostic');
  }});
  setGeoStatus('Loading Google vector 3D map and mapped overlay…', 'loading');
  updateHUD();
  reset();
  status.hidden = true;
  frame = requestAnimationFrame(animate);
  void ensureGoogleOverlay();
}

function dispose() {
  if (stopped) return;
  stopped = true;
  cancelAnimationFrame(frame);
  events.abort();
  cityLoader?.dispose?.();
  googleOverlayGeneration++;
  googleOverlay?.dispose();
  googleOverlay = null;
  googleOverlayPromise = null;
  vehicle?.dispose();
  mappedWorld?.dispose();
}

try { start(); }
catch (error) {
  dispose();
  console.error('Unable to initialise Google geographic driving scene:', error);
  showStatus('Google Maps 3D could not start.', 'Please check the Google Maps API key, map ID, and browser WebGL support.');
}
on(window, 'pagehide', event => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
