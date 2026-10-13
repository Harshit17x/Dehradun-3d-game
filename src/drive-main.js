import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGeoWorld } from './geo-world.js';
import { createRoadNetwork, createGeoState } from './geo-driving.js';
import { stepGeoDriving } from './geo-driving.js';
import { createVehicle } from './drive-vehicle.js';
import { createGoogleDriveOverlay } from './google-drive-overlay.js';
import { createCesiumDrive } from './cesium-drive.js';
import { createCityLoader } from './city-loader.js';
import { toLocal } from './geo-driving.js';
import { sound } from './audio.js';
import mappedData from './dehradun-data.json' with { type: 'json' };

const canvas = document.querySelector('#scene');
const status = document.querySelector('#status');
const pauseButton = document.querySelector('#pause');
const mapToggle = document.querySelector('#map-toggle');
const mapPanel = document.querySelector('#map-panel');
const mapCanvas = document.querySelector('#map-canvas');
const mapStatus = document.querySelector('#map-status');
const cesiumPanel = document.querySelector('#cesium-panel');
const cesiumCanvas = document.querySelector('#cesium-canvas');
const cesiumStatus = document.querySelector('#cesium-status');
const cesiumToggle = document.querySelector('#cesium-toggle');
const geoStatus = document.querySelector('#geo-status');
const placeList = document.querySelector('#place-list');
const ui = Object.fromEntries(['speed', 'speed-fill', 'gear', 'distance', 'fps', 'heading', 'road-name'].map(id => [id, document.getElementById(id)]));
const events = new AbortController();
const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: events.signal });
let renderer, mappedWorld, mappedSurface, vehicle, sun, frame = 0, stopped = false;
let googleOverlay, googleOverlayPromise, googleOverlayGeneration = 0, cityLoader;
let cesiumDrive, cesiumDrivePromise;
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
  mapStatus.textContent = text;
}

const localCoverage = () => currentData.provenance?.scope || 'Dehradun city region extract';

function createMappedSurface(data, network) {
  const group = new THREE.Group();
  group.name = 'OSM geographic road surface';
  const geometries = new Set();
  const materials = new Set();
  const bounds = network.bounds;
  const width = bounds.maxX - bounds.minX + 40;
  const depth = bounds.maxZ - bounds.minZ + 40;
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#b8c49f', roughness: 1 });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: '#4d5651', roughness: 0.96, metalness: 0.01 });
  materials.add(groundMaterial); materials.add(roadMaterial);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), groundMaterial);
  geometries.add(ground.geometry);
  ground.name = 'Mapped OSM bounds';
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, -0.12, (bounds.minZ + bounds.maxZ) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const parts = [];
  const markingParts = [];
  const markingMaterial = new THREE.MeshStandardMaterial({ color: '#f5f3ec', roughness: 0.85, metalness: 0.05 });
  materials.add(markingMaterial);

  for (const road of Array.isArray(data.roads) ? data.roads : []) {
    const points = Array.isArray(road?.points) ? road.points : [];
    const rawWidth = Number.isFinite(road?.width) ? THREE.MathUtils.clamp(road.width, 3, 32) : 8;
    const roadWidth = (road.id === 'way/1556686563' || (points.length >= 20 && /roundabout/i.test(road.kind || '')))
      ? Math.max(rawWidth, 13)
      : /chakrata/i.test(road.name || '')
        ? Math.max(rawWidth, 10)
        : rawWidth;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1] || [];
      const [bx, bz] = points[i] || [];
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const part = new THREE.BoxGeometry(roadWidth, 0.08, length);
      const yaw = Math.atan2(dx, dz);
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3((ax + bx) / 2, -0.04, (az + bz) / 2),
        rot,
        new THREE.Vector3(1, 1, 1),
      );
      part.applyMatrix4(transform);
      parts.push(part);

      // White dashed centerline for standard two-lane roads
      if (roadWidth >= 6.5 && length >= 5.0) {
        const dashLen = 2.6, gapLen = 2.4;
        const totalStep = dashLen + gapLen;
        const count = Math.floor(length / totalStep);
        const startOffset = (length - count * totalStep + gapLen) / 2;
        const fx = dx / length, fz = dz / length;
        for (let k = 0; k < count; k++) {
          const midDist = startOffset + k * totalStep + dashLen / 2;
          const mx = ax + fx * midDist, mz = az + fz * midDist;
          const dash = new THREE.BoxGeometry(0.18, 0.012, dashLen);
          dash.applyMatrix4(new THREE.Matrix4().compose(
            new THREE.Vector3(mx, 0.006, mz),
            rot,
            new THREE.Vector3(1, 1, 1),
          ));
          markingParts.push(dash);
        }
      }
    }
  }

  // Zebra pedestrian crossings at major Dehradun traffic light chowks
  const ZEBRA_CHOWKS = [
    { x: 10.5, z: -5.0, angle: 0, lanes: 8 },      // Rajpur Road approach to Clock Tower
    { x: 2.5, z: 38.0, angle: Math.PI, lanes: 8 },   // Gandhi Road approach to Clock Tower
    { x: -21.0, z: 24.5, angle: -Math.PI / 2, lanes: 7 }, // Chakrata Road approach
    { x: 23.5, z: 18.0, angle: Math.PI / 2, lanes: 7 },  // Subhash Road approach
    { x: 57.0, z: 180.0, angle: 0, lanes: 8 },     // Darshan Lal Chowk (North)
    { x: 67.5, z: 200.0, angle: Math.PI, lanes: 8 },  // Darshan Lal Chowk (South)
    { x: 74.0, z: 187.0, angle: Math.PI / 2, lanes: 8 }, // Darshan Lal Chowk (East)
    { x: 50.0, z: 192.0, angle: -Math.PI / 2, lanes: 8 }, // Darshan Lal Chowk (West)
    { x: 346.0, z: 302.0, angle: 0, lanes: 8 },    // Lansdowne Chowk (North)
    { x: 356.5, z: 322.0, angle: Math.PI, lanes: 8 }, // Lansdowne Chowk (South)
  ];

  for (const chowk of ZEBRA_CHOWKS) {
    const { x, z, angle, lanes } = chowk;
    const sinA = Math.sin(angle), cosA = Math.cos(angle);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const spacing = 0.5;
    for (let i = -Math.floor(lanes / 2); i <= Math.floor(lanes / 2); i++) {
      const offsetX = -cosA * (i * spacing);
      const offsetZ = sinA * (i * spacing);
      const stripe = new THREE.BoxGeometry(0.32, 0.014, 2.8);
      stripe.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(x + offsetX, 0.007, z + offsetZ),
        rot,
        new THREE.Vector3(1, 1, 1),
      ));
      markingParts.push(stripe);
    }
  }

  if (parts.length) {
    const roads = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (roads) {
      roads.computeBoundingSphere();
      geometries.add(roads);
      const mesh = new THREE.Mesh(roads, roadMaterial);
      mesh.name = 'Mapped OSM roads';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  if (markingParts.length) {
    const markings = mergeGeometries(markingParts, false);
    for (const part of markingParts) part.dispose();
    if (markings) {
      markings.computeBoundingSphere();
      geometries.add(markings);
      const mesh = new THREE.Mesh(markings, markingMaterial);
      mesh.name = 'Mapped road centerlines and zebra crossings';
      group.add(mesh);
    }
  }

  return {
    group,
    dispose() {
      group.removeFromParent();
      group.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      geometries.clear(); materials.clear();
    },
  };
}

function addPlaceLabels(labels) {
  const entries = [];
  for (const label of labels) {
    const element = document.createElement('span');
    element.className = `place-label${label.kind === 'landmark' ? ' place-label-landmark' : ''}`;
    element.textContent = label.name || 'Mapped place';
    element.setAttribute('aria-label', label.name || 'Mapped place');
    placeList.append(element);
    entries.push({ label, element, point: new THREE.Vector3() });
  }
  return entries;
}

function updatePlaceLabels(entries, camera) {
  const width = innerWidth, height = innerHeight;
  for (const { label, element, point } of entries) {
    point.set(label.x, label.height || 3, label.z).project(camera);
    const visible = point.z > -1 && point.z < 1 && point.x > -1.15 && point.x < 1.15 && point.y > -1.15 && point.y < 1.15;
    element.hidden = !visible;
    if (visible) element.style.transform = `translate(${(point.x * 0.5 + 0.5) * width}px,${(-point.y * 0.5 + 0.5) * height}px)`;
  }
}

function buildMinimap(network) {
  const map = document.querySelector('#minimap');
  const ctx = map.getContext('2d');
  const baseMap = document.createElement('canvas');
  baseMap.width = map.width; baseMap.height = map.height;
  const bg = baseMap.getContext('2d');
  const bounds = network.bounds;
  const margin = 16;
  const scale = Math.min((map.width - margin * 2) / (bounds.maxX - bounds.minX), (map.height - margin * 2) / (bounds.maxZ - bounds.minZ));
  const mx = x => margin + (x - bounds.minX) * scale + (map.width - margin * 2 - (bounds.maxX - bounds.minX) * scale) / 2;
  const mz = z => map.height - margin - (z - bounds.minZ) * scale - (map.height - margin * 2 - (bounds.maxZ - bounds.minZ) * scale) / 2;
  bg.fillStyle = '#d9e0c9'; bg.fillRect(0, 0, map.width, map.height);
  bg.lineCap = 'round';
  for (const segment of network.segments) {
    bg.strokeStyle = segment.width >= 10 ? '#f2eee0' : '#ece8da';
    bg.lineWidth = Math.max(1.5, segment.width * scale);
    bg.beginPath(); bg.moveTo(mx(segment.ax), mz(segment.az)); bg.lineTo(mx(segment.bx), mz(segment.bz)); bg.stroke();
  }
  bg.strokeStyle = '#b6c29f'; bg.lineWidth = 1;
  bg.strokeRect(margin, margin, map.width - margin * 2, map.height - margin * 2);

  return { map, ctx, baseMap, mx, mz };
}

async function setMapVisible(visible, scene, state) {
  if (visible && cesiumPanel?.classList.contains('active')) await setCesiumVisible(false, scene, state);
  mapPanel.hidden = !visible;
  mapToggle.setAttribute('aria-pressed', String(visible));
  mapToggle.textContent = visible ? '← Local 3D' : 'Google 3D';
  mapToggle.setAttribute('aria-label', visible ? 'Return to local 3D mode' : 'Show Google Maps 3D mode');
  mapPanel.classList.toggle('google-primary', visible);
  if (!visible) {
    googleOverlayGeneration++;
    googleOverlay?.dispose();
    googleOverlay = null;
    googleOverlayPromise = null;
    canvas.style.visibility = 'visible';
    return;
  }
  if (stopped || googleOverlay) {
    googleOverlay?.update(state, 0);
    return;
  }
  canvas.style.visibility = 'hidden';
  setGeoStatus('Loading Google vector map and shared Three.js overlay…', 'loading');
  const requestGeneration = googleOverlayGeneration;
  if (!googleOverlayPromise) {
    googleOverlayPromise = createGoogleDriveOverlay({
      container: mapCanvas,
      data: currentData,
      worldGroup: mappedWorld.group,
      vehicleGroup: vehicle.group,
      onStatus: (title, text) => {
        mapStatus.textContent = `${title} · ${text}`;
        if (/ready/i.test(title)) setGeoStatus(`Google vector 3D active · the single car and ${localCoverage()} are georeferenced over the actual basemap.`, 'google');
         if (/unavailable/i.test(title)) setGeoStatus(`Google 3D unavailable · ${text} Local geographic OSM mode remains available.`, 'diagnostic');
       },
    }).then(result => {
      if (requestGeneration !== googleOverlayGeneration || mapPanel.hidden || stopped) {
        result.dispose();
        throw new Error('Google 3D request was cancelled');
      }
      googleOverlay = result;
      return result;
    }).catch(error => {
      googleOverlayPromise = null;
      googleOverlay = null;
      canvas.style.visibility = 'visible';
      setGeoStatus(`Google 3D unavailable · ${error.message}. Local geographic OSM mode remains active.`, 'diagnostic');
      mapStatus.textContent = `Google 3D unavailable · ${error.message}`;
      throw error;
    });
  }
  try { googleOverlay = await googleOverlayPromise; googleOverlay.update(state, 1 / 60); }
  catch { /* status and offline fallback are handled above */ }
}

async function setCesiumVisible(visible, scene, state) {
  cesiumToggle?.setAttribute('aria-pressed', String(visible));
  if (cesiumToggle) {
    cesiumToggle.textContent = visible ? '← Local 3D' : 'Cesium 3D';
    cesiumToggle.setAttribute('aria-label', visible ? 'Return to local 3D mode' : 'Show Cesium photorealistic 3D mode');
  }
  if (!visible) {
    cesiumDrive?.dispose();
    cesiumDrive = null;
    cesiumDrivePromise = null;
    cesiumPanel?.classList.remove('active');
    canvas.style.visibility = 'visible';
    return;
  }
  if (mapPanel && !mapPanel.hidden) await setMapVisible(false, scene, state);
  cesiumPanel?.classList.add('active');
  canvas.style.visibility = 'hidden';
  cesiumStatus.textContent = 'Loading Cesium Ion and photorealistic Dehradun 3D tiles…';
  if (!cesiumDrivePromise) {
    cesiumDrivePromise = createCesiumDrive({
      container: cesiumCanvas,
      data: currentData,
      state,
      vehicle,
      onStatus: (title, text) => {
        cesiumStatus.textContent = `${title} · ${text}`;
        if (/unavailable|failed/i.test(title)) setGeoStatus(`Cesium 3D unavailable · ${text} Local geographic mode remains active.`, 'diagnostic');
        if (/ready/i.test(title)) setGeoStatus(`Cesium 3D active · ${text}`, 'google');
      },
    }).then((result) => {
      cesiumDrive = result;
      return result;
    }).catch((error) => {
      cesiumDrivePromise = null;
      cesiumDrive = null;
      cesiumPanel?.classList.remove('active');
      canvas.style.visibility = 'visible';
      cesiumStatus.textContent = `Cesium unavailable · ${error.message || 'check VITE_CESIUM_ION_TOKEN and Cesium Ion access'}`;
      setGeoStatus(`Cesium 3D unavailable · ${error.message || 'check the private Ion token configuration'}. Local geographic mode remains active.`, 'diagnostic');
      throw error;
    });
  }
  try { cesiumDrive = await cesiumDrivePromise; cesiumDrive.update(state, 1 / 60); }
  catch { /* status and local fallback are handled above */ }
}

function start() {
  let network = createRoadNetwork(currentData);
  mappedWorld = createGeoWorld(currentData);
  mappedSurface = createMappedSurface(currentData, network);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#cbdad7', 100, 610);
  const camera = new THREE.PerspectiveCamera(53, innerWidth / innerHeight, 0.15, 1000);
  scene.add(mappedSurface.group, mappedWorld.group);
  scene.add(new THREE.HemisphereLight('#e4f1ff', '#8b8964', 2.4));
  sun = new THREE.DirectionalLight('#fff0d4', 3.0);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, near: 10, far: 240 });
  sun.shadow.normalBias = 0.045;
  sun.shadow.bias = -0.00012;
  sun.castShadow = true;
  scene.add(sun, sun.target);
  vehicle = createVehicle();
  scene.add(vehicle.group);
  const state = createGeoState(network);
  let minimap = buildMinimap(network);
  let labels = addPlaceLabels(mappedWorld.labels);
  cityLoader = createCityLoader({ onStatus: (event) => {
    if (event.status === 'loading') setGeoStatus(`Loading mapped Dehradun streets near ${Number(event.lat).toFixed(4)}, ${Number(event.lng).toFixed(4)}…`, 'loading');
    if (event.status === 'error') setGeoStatus(`City map unavailable · ${event.error?.message || 'request failed'}. Current mapped area remains active.`, 'diagnostic');
  }});
  let paused = false;
  const keyboard = new Set();
  const touch = new Map();
  const input = { forward: false, reverse: false, left: false, right: false, brake: false, boost: false };
  const bindings = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'reverse', ArrowDown: 'reverse',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'brake',
    ShiftLeft: 'boost', ShiftRight: 'boost'
  };
  const clearInput = () => {
    keyboard.clear(); touch.clear();
    document.querySelectorAll('#touch button').forEach(button => button.classList.remove('pressed'));
  };
  function setPaused(value) {
    paused = value; clearInput();
    pauseButton.textContent = paused ? '▶ Resume' : 'Ⅱ Pause';
    pauseButton.setAttribute('aria-label', paused ? 'Resume driving' : 'Pause driving');
    pauseButton.setAttribute('aria-pressed', String(paused));
    if (paused) showStatus('Take in the view.', 'Paused. Press P or Resume when you’re ready to drive.');
    else status.hidden = true;
  }
  const cameraTarget = new THREE.Vector3(), lookAt = new THREE.Vector3(), desiredLook = new THREE.Vector3(), carPosition = new THREE.Vector3();
  function syncCar() { vehicle.group.position.set(state.x, 0.02, state.z); vehicle.group.rotation.y = state.heading; }
  function updateCamera(dt, snap = false) {
    const speed = Math.abs(state.speed), behind = 10.5 + speed * 0.09;
    cameraTarget.set(state.x + Math.sin(state.heading) * behind, 6.4 + speed * 0.025, state.z + Math.cos(state.heading) * behind);
    cameraTarget.x = THREE.MathUtils.clamp(cameraTarget.x, network.bounds.minX - 40, network.bounds.maxX + 40);
    cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z, network.bounds.minZ - 40, network.bounds.maxZ + 40);
    desiredLook.set(state.x - Math.sin(state.heading) * 4.2, 1.25, state.z - Math.cos(state.heading) * 4.2);
    if (snap) { camera.position.copy(cameraTarget); lookAt.copy(desiredLook); }
    else { camera.position.lerp(cameraTarget, 1 - Math.exp(-5.5 * dt)); lookAt.lerp(desiredLook, 1 - Math.exp(-9 * dt)); }
    camera.lookAt(lookAt);

    // Speed-dependent field of view kick
    const targetFov = 53 + Math.min(speed * 0.45, 11);
    camera.fov += (targetFov - camera.fov) * Math.min(1, 8 * dt);
    camera.updateProjectionMatrix();
  }
  function reset() {
    Object.assign(state, createGeoState(network));
    Object.assign(previous, { x: state.x, z: state.z, heading: state.heading });
    accumulator = 0; clearInput(); vehicle.update(0, 0, 0.1, false); syncCar(); updateCamera(0, true); updateHUD();
  }

  async function loadCityArea(lat, lng) {
    if (cesiumPanel?.classList.contains('active')) await setCesiumVisible(false, scene, state);
    if (mapPanel.classList.contains('google-primary')) await setMapVisible(false, scene, state);
    try {
      const nextData = await cityLoader.load(lat, lng);
      const nextNetwork = createRoadNetwork(nextData);
      const nextWorld = createGeoWorld(nextData);
      const nextSurface = createMappedSurface(nextData, nextNetwork);
      const target = toLocal(lat, lng, nextData.origin);
      let nextState;
      try { nextState = nextNetwork.spawnNear(target.x, target.z); }
      catch { nextState = createGeoState(nextNetwork); }
      mappedWorld?.dispose(); mappedSurface?.dispose();
      scene.add(nextSurface.group, nextWorld.group);
      placeList.replaceChildren();
      mappedWorld = nextWorld; mappedSurface = nextSurface; network = nextNetwork; currentData = nextData;
      labels = addPlaceLabels(mappedWorld.labels);
      minimap = buildMinimap(network);
      Object.assign(state, nextState);
      Object.assign(previous, { x: state.x, z: state.z, heading: state.heading });
      accumulator = 0;
      syncCar(); updateCamera(0, true); updateHUD();
      setGeoStatus(`Mapped city cell active · ${currentData.provenance?.counts?.buildings || 0} building footprints, ${currentData.provenance?.counts?.roads || 0} roads · OSM locations, approximate façades.`, 'offline');
    } catch (error) {
      setGeoStatus(`Could not load that Dehradun area · ${error.message || 'map request failed'}.`, 'diagnostic');
    }
  }

  async function searchCity() {
    const input = document.querySelector('#city-search-input');
    const query = input?.value.trim();
    if (!query) return;
    const button = document.querySelector('#city-search-button');
    if (button) button.disabled = true;
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok || body.status !== 'ok' || !body.results?.length) throw new Error(body.error || 'No place found inside the Dehradun city region');
      const result = body.results[0];
      if (input) input.value = result.name.split(',')[0];
      await loadCityArea(result.lat, result.lng);
    } catch (error) {
      setGeoStatus(`Search failed · ${error.message || 'try a named place in Dehradun'}.`, 'diagnostic');
    } finally { if (button) button.disabled = false; }
  }
  on(window, 'keydown', event => {
    sound.init();
    if (event.target instanceof HTMLButtonElement && ['Space', 'Enter'].includes(event.code)) return;
    if (bindings[event.code]) { event.preventDefault(); if (!paused) keyboard.add(event.code); }
    if (!event.repeat && event.code === 'KeyP') setPaused(!paused);
    if (!event.repeat && event.code === 'KeyR') reset();
    if (!event.repeat && event.code === 'KeyH') {
      const active = vehicle.toggleHeadlights();
      const btn = document.querySelector('#headlights-toggle');
      if (btn) {
        btn.setAttribute('aria-pressed', String(active));
        btn.textContent = active ? '💡 Lights On' : '💡 Lights Off';
      }
    }
  });
  on(window, 'keyup', event => keyboard.delete(event.code));
  on(window, 'blur', () => setPaused(true));
  on(document, 'visibilitychange', () => { if (document.hidden) setPaused(true); });
  on(pauseButton, 'click', () => { sound.init(); setPaused(!paused); canvas.focus({ preventScroll: true }); });
  on(document.querySelector('#reset'), 'click', () => { sound.init(); reset(); canvas.focus({ preventScroll: true }); });
  on(mapToggle, 'click', () => { sound.init(); void setMapVisible(mapPanel.hidden, scene, state); });
  on(cesiumToggle, 'click', () => { sound.init(); void setCesiumVisible(!cesiumPanel.classList.contains('active'), scene, state); });
  on(document.querySelector('#city-search-button'), 'click', () => { sound.init(); void searchCity(); });
  on(document.querySelector('#city-search-input'), 'keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); sound.init(); void searchCity(); } });

  const audioToggle = document.querySelector('#audio-toggle');
  if (audioToggle) {
    on(audioToggle, 'click', () => {
      sound.init();
      const enabled = sound.toggle();
      audioToggle.textContent = enabled ? '🔊 Sound On' : '🔇 Sound Off';
      audioToggle.setAttribute('aria-pressed', String(enabled));
    });
  }

  const headlightsToggle = document.querySelector('#headlights-toggle');
  if (headlightsToggle) {
    on(headlightsToggle, 'click', () => {
      const active = vehicle.toggleHeadlights();
      headlightsToggle.setAttribute('aria-pressed', String(active));
      headlightsToggle.textContent = active ? '💡 Lights On' : '💡 Lights Off';
    });
  }

  document.querySelectorAll('[data-vehicle]').forEach(btn => {
    on(btn, 'click', () => {
      sound.init();
      document.querySelectorAll('[data-vehicle]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      vehicle.setVehicleModel(btn.dataset.vehicle);
      const titleEl = document.getElementById('vehicle-title');
      if (titleEl) titleEl.textContent = vehicle.getVehicleName();
    });
  });

  vehicle.onModelChange((key, name) => {
    const titleEl = document.getElementById('vehicle-title');
    if (titleEl) titleEl.textContent = name;
    document.querySelectorAll('[data-vehicle]').forEach(b => {
      b.classList.toggle('active', b.dataset.vehicle === key);
    });
  });

  for (const button of document.querySelectorAll('[data-control]')) {
    on(button, 'pointerdown', event => {
      sound.init();
      event.preventDefault(); if (paused) return;
      button.setPointerCapture(event.pointerId); touch.set(event.pointerId, button.dataset.control); button.classList.add('pressed');
    });
    const release = event => { touch.delete(event.pointerId); button.classList.remove('pressed'); };
    on(button, 'pointerup', release); on(button, 'pointercancel', release); on(button, 'lostpointercapture', release);
  }
  on(window, 'resize', () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75)); renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });
  on(canvas, 'webglcontextlost', event => { event.preventDefault(); setPaused(true); showStatus('Graphics paused.', 'The graphics context was lost. Waiting for your browser to restore it…'); });
  on(canvas, 'webglcontextrestored', () => setPaused(true));

  function updateHUD() {
    ui.speed.textContent = Math.round(Math.abs(state.speed) * 3.6);
    ui['speed-fill'].style.width = `${Math.min(100, Math.abs(state.speed) / 16.7 * 100)}%`;
    ui.gear.textContent = state.speed > 0.15 ? 'D' : state.speed < -0.15 ? 'R' : 'N';
    ui.distance.textContent = `${(state.distance / 1000).toFixed(2)} km`;
    const degrees = ((-state.heading * 180 / Math.PI) % 360 + 360) % 360;
    ui.heading.textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
    ui['road-name'].textContent = network.nearest(state.x, state.z)?.name || 'Mapped OSM road';
    minimap.ctx.drawImage(minimap.baseMap, 0, 0);
    minimap.ctx.save(); minimap.ctx.translate(minimap.mx(state.x), minimap.mz(state.z)); minimap.ctx.rotate(-state.heading);
    minimap.ctx.fillStyle = '#b85d39'; minimap.ctx.strokeStyle = '#fff8e8'; minimap.ctx.lineWidth = 2.5;
    minimap.ctx.beginPath(); minimap.ctx.moveTo(0, -10); minimap.ctx.lineTo(7, 8); minimap.ctx.lineTo(0, 5); minimap.ctx.lineTo(-7, 8); minimap.ctx.closePath(); minimap.ctx.fill(); minimap.ctx.stroke(); minimap.ctx.restore();
  }
  let last = performance.now(), accumulator = 0, hudTime = 0, fpsTime = 0, fpsCount = 0;
  const previous = { x: state.x, z: state.z, heading: state.heading };
  function animate(now) {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1); last = now;
    if (!paused && !document.hidden) {
      for (const key in input) input[key] = false;
      for (const code of keyboard) input[bindings[code]] = true;
      for (const value of touch.values()) input[value] = true;
      accumulator += dt;
      while (accumulator >= 1 / 120) {
        previous.x = state.x; previous.z = state.z; previous.heading = state.heading;
        stepGeoDriving(state, input, 1 / 120, network); accumulator -= 1 / 120;
      }
      const alpha = accumulator * 120;
      carPosition.set(THREE.MathUtils.lerp(previous.x, state.x, alpha), 0.02, THREE.MathUtils.lerp(previous.z, state.z, alpha));
      vehicle.group.position.copy(carPosition);
      const delta = Math.atan2(Math.sin(state.heading - previous.heading), Math.cos(state.heading - previous.heading));
      vehicle.group.rotation.y = previous.heading + delta * alpha;
      const isBraking = input.brake || (input.reverse && state.speed > 0.1) || (input.forward && state.speed < -0.1);
      vehicle.update(state.speed, state.steering, dt, isBraking);
      updateCamera(dt);
      googleOverlay?.update(state, dt);
      cesiumDrive?.update(state, dt);

      // Real vehicle audio update
      const speedKmh = Math.abs(Math.round(state.speed * 3.6));
      sound.updateVehicleSound('rover', speedKmh, Boolean(input.forward || input.reverse));
    } else {
      accumulator = 0; previous.x = state.x; previous.z = state.z; previous.heading = state.heading;
      sound.updateVehicleSound('rover', 0, false);
    }
    const texel = 130 / 2048;
    const sx = Math.round(state.x / texel) * texel, sz = Math.round(state.z / texel) * texel;
    sun.position.set(sx - 55, 95, sz - 35); sun.target.position.set(sx, 0, sz);
    mappedWorld?.update?.(now / 1000);
    renderer.render(scene, camera); updatePlaceLabels(labels, camera);
    hudTime += dt; fpsTime += dt; fpsCount++;
    if (hudTime > 0.1) { updateHUD(); hudTime = 0; }
    if (fpsTime >= 0.75) { ui.fps.textContent = `${Math.round(fpsCount / fpsTime)} fps`; fpsCount = 0; fpsTime = 0; }
  }
  setGeoStatus(`Local OSM coverage: ${localCoverage()} · search any mapped place in Dehradun to load its nearby streets.`, 'offline');
  reset();
  status.hidden = true;
  frame = requestAnimationFrame(animate);
}

function dispose() {
  if (stopped) return;
  stopped = true;
  cancelAnimationFrame(frame);
  events.abort();
  cityLoader?.dispose?.();
  googleOverlay?.dispose();
  googleOverlay = null;
  cesiumDrive?.dispose();
  cesiumDrive = null;
  cesiumDrivePromise = null;
  vehicle?.dispose(); mappedWorld?.dispose(); mappedSurface?.dispose();
  sun?.shadow.dispose(); renderer?.dispose();
  placeList.replaceChildren();
}

try { start(); }
catch (error) {
  dispose();
  console.error('Unable to initialise geographic driving scene:', error);
  showStatus('The mapped valley needs WebGL 2.', 'Please enable hardware acceleration and open this scene in a current browser.');
}
on(window, 'pagehide', event => { if (!event.persisted) dispose(); });
if (import.meta.hot) import.meta.hot.dispose(dispose);
