import * as THREE from 'three';
import { toLatLng } from './geo-driving.js';

const CONFIG_URL = '/api/maps-config';
const READY_TIMEOUT_MS = 20_000;
const DEMO_MAP_ID = 'DEMO_MAP_ID';
export const CAMERA_MODES = Object.freeze({
  chase: Object.freeze({ label: 'Chase', offset: 20, zoom: 20.2, tilt: 67.5 }),
  wide: Object.freeze({ label: 'Wide', offset: 8, zoom: 19.2, tilt: 55 }),
  preview: Object.freeze({ label: 'Preview', offset: -5, zoom: 20.8, tilt: 78 }),
});
const RAD_TO_DEG = 180 / Math.PI;

let mapsLoaderPromise;
let mapsConfigPromise;
let authHookInstalled = false;
let previousAuthFailure;
const authFailureListeners = new Set();

function status(onStatus, title, text) {
  if (typeof onStatus !== 'function') return;
  try { onStatus(String(title), String(text)); } catch { /* status reporting must not break rendering */ }
}

function makeError(message) {
  return new Error(message);
}

function installAuthHook(onFailure) {
  if (typeof window === 'undefined') return () => {};
  if (!authHookInstalled) {
    previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = (...args) => {
      if (typeof previousAuthFailure === 'function') {
        try { previousAuthFailure(...args); } catch { /* preserve the Maps lifecycle */ }
      }
      for (const listener of [...authFailureListeners]) listener();
    };
    authHookInstalled = true;
  }
  let released = false;
  const listener = typeof onFailure === 'function' ? onFailure : () => {};
  authFailureListeners.add(listener);
  return () => {
    if (released) return;
    released = true;
    authFailureListeners.delete(listener);
    if (!authFailureListeners.size && authHookInstalled && window.gm_authFailure) {
      window.gm_authFailure = previousAuthFailure;
      previousAuthFailure = undefined;
      authHookInstalled = false;
    }
  };
}

async function fetchMapsConfig(signal) {
  let response;
  try {
    response = await fetch(CONFIG_URL, { signal, headers: { accept: 'application/json' } });
  } catch {
    throw makeError('Google Maps configuration could not be fetched');
  }
  if (!response.ok) throw makeError('Google Maps configuration is unavailable');
  let config;
  try { config = await response.json(); } catch { throw makeError('Google Maps configuration is invalid'); }
  if (!config || typeof config.key !== 'string' || !config.key.trim()) throw makeError('Google Maps API key is not configured');
  return { key: config.key.trim(), mapId: typeof config.mapId === 'string' && config.mapId.trim() ? config.mapId.trim() : DEMO_MAP_ID };
}

function loadMapsOnce(signal) {
  if (mapsLoaderPromise) return mapsLoaderPromise;
  mapsConfigPromise ||= fetchMapsConfig(signal);
  if (typeof window !== 'undefined' && window.google?.maps?.Map) {
    mapsLoaderPromise = mapsConfigPromise.then(config => ({ maps: window.google.maps, mapId: config.mapId }));
    return mapsLoaderPromise;
  }
  if (mapsLoaderPromise) return mapsLoaderPromise;
  mapsLoaderPromise = (async () => {
    const { key, mapId } = await mapsConfigPromise;
    if (typeof document === 'undefined') throw makeError('Google Maps requires a browser document');
    if (window.google?.maps?.Map) return { maps: window.google.maps, mapId };
    const callbackName = `__dehradunMapsReady_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    mapsLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        try { delete window[callbackName]; } catch { /* callback cleanup is best effort */ }
        script.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(makeError('Google Maps JavaScript API failed to load'));
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        script.remove();
        reject(makeError('Google Maps JavaScript API load was cancelled'));
      };
      window[callbackName] = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (window.google?.maps?.Map) resolve({ maps: window.google.maps, mapId });
        else reject(makeError('Google Maps JavaScript API did not initialize'));
      };
      script.async = true;
      script.defer = true;
      script.addEventListener('error', onError, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=maps3d&loading=async&callback=${callbackName}`;
      document.head.append(script);
    });
    return mapsLoaderPromise;
  })();
  return mapsLoaderPromise;
}

function finiteState(state) {
  return state && [state.x, state.z, state.heading].every(Number.isFinite);
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function restoreParent(record) {
  const { object, parent, index } = record;
  if (!parent) {
    object.removeFromParent();
    return;
  }
  parent.add(object);
  const current = parent.children.indexOf(object);
  if (current >= 0) {
    parent.children.splice(current, 1);
    parent.children.splice(Math.min(index, parent.children.length), 0, object);
  }
  object.updateMatrixWorld(true);
}

/**
 * Render the caller-owned geographic Three.js groups in Google's vector map
 * WebGL context. The factory does not create or own a second vehicle.
 */
export async function createGoogleDriveOverlay({ container, data, state, worldGroup, vehicleGroup, onStatus } = {}) {
  if (!container || typeof container !== 'object' || !container.style) throw new TypeError('Google overlay requires a map container');
  if (!data?.origin || !Number.isFinite(data.origin.lat) || !Number.isFinite(data.origin.lng)) throw new TypeError('Google overlay requires a geographic origin');
  if (!worldGroup?.isObject3D || !vehicleGroup?.isObject3D) throw new TypeError('Google overlay requires Three.js world and vehicle groups');
  if (worldGroup === vehicleGroup) throw new TypeError('Google overlay requires distinct world and vehicle groups');

  const originalParents = [worldGroup, vehicleGroup].map(object => ({
    object,
    parent: object.parent,
    index: object.parent ? object.parent.children.indexOf(object) : 0,
  }));
  const oldVisibility = container.style.visibility;
  const oldDisplay = container.style.display;
  const configAbort = new AbortController();
  const authRelease = installAuthHook(() => fail(makeError('Google Maps authentication failed')));
  const root = new THREE.Group();
  root.name = 'Google Maps geographic overlay';
  root.rotation.x = Math.PI / 2;
  const overlayScene = new THREE.Scene();
  overlayScene.add(root);
  const ambient = new THREE.AmbientLight('#fff8e7', 1.8);
  const directional = new THREE.DirectionalLight('#ffe6bc', 3.0);
  directional.position.set(-90, 150, 80);
  root.add(ambient, directional);
  root.add(worldGroup, vehicleGroup);

  let maps;
  let map;
  let webglOverlay;
  let renderer;
  let camera;
  let googleGl;
  let disposed = false;
  let failed;
  let readySettled = false;
  let visible = true;
  let firstDrawTimer;
  let smoothedHeading = finiteState(state) ? state.heading : undefined;
  let latestState = finiteState(state) ? { x: state.x, z: state.z, heading: state.heading } : undefined;
  let cameraMode = 'chase';
  let cameraModeDirty = true;
  let lastCameraAt = 0;
  let lastCameraState;
  let lastRedrawAt = 0;
  let cameraFailureReported = false;
  const listeners = [];
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // The async factory may reject before it can return the API object; attach a
  // noop rejection observer so that the internal readiness promise is never an
  // unhandled rejection in that path. Callers still receive the same rejection
  // from createGoogleDriveOverlay itself.
  ready.catch(() => {});

  const api = {
    update(state, dt = 0) {
      if (disposed || failed || !finiteState(state)) return;
      const seconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      if (!Number.isFinite(smoothedHeading)) smoothedHeading = state.heading;
      smoothedHeading += shortestAngle(smoothedHeading, state.heading) * (1 - Math.exp(-8 * Math.max(seconds, 1 / 120)));
      latestState = { x: state.x, z: state.z, heading: state.heading };
      if (map && typeof map.moveCamera === 'function') {
        const mode = CAMERA_MODES[cameraMode] || CAMERA_MODES.chase;
        const now = performance.now();
        const moved = !lastCameraState || Math.hypot(state.x - lastCameraState.x, state.z - lastCameraState.z) > .12;
        const turned = !lastCameraState || Math.abs(shortestAngle(state.heading, lastCameraState.heading)) > .006;
        if (cameraModeDirty || (now - lastCameraAt >= 33 && (moved || turned))) {
          try {
            // Center slightly ahead/behind of the car so each mode reads as a
            // distinct chase, wide, or close car-preview camera.
            const forwardX = -Math.sin(smoothedHeading) * mode.offset;
            const forwardZ = -Math.cos(smoothedHeading) * mode.offset;
            const center = toLatLng(state.x + forwardX, state.z + forwardZ, data.origin);
            const heading = ((-smoothedHeading * RAD_TO_DEG) % 360 + 360) % 360;
            map.moveCamera({ center, heading, zoom: mode.zoom, tilt: mode.tilt });
            lastCameraAt = now;
            lastCameraState = { x: state.x, z: state.z, heading: state.heading };
            cameraModeDirty = false;
          } catch (error) {
            if (!cameraFailureReported) {
              cameraFailureReported = true;
              status(onStatus, 'Google camera update delayed', error?.message || 'Google Maps rejected a camera update');
            }
          }
        }
      }
      const now = performance.now();
      if (now - lastRedrawAt >= 16) {
        try { webglOverlay?.requestRedraw?.(); lastRedrawAt = now; }
        catch (error) {
          if (!cameraFailureReported) {
            cameraFailureReported = true;
            status(onStatus, 'Google overlay redraw delayed', error?.message || 'Google Maps rejected a redraw request');
          }
        }
      }
    },
    setCameraMode(mode) {
      if (!CAMERA_MODES[mode] || cameraMode === mode) return cameraMode;
      cameraMode = mode;
      cameraModeDirty = true;
      if (latestState) api.update(latestState, 0);
      return cameraMode;
    },
    getCameraMode() {
      return cameraMode;
    },
    getCameraModeLabel() {
      return CAMERA_MODES[cameraMode]?.label || CAMERA_MODES.chase.label;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(firstDrawTimer);
      configAbort.abort();
      authRelease();
      for (const listener of listeners.splice(0)) listener?.remove?.();
      try { webglOverlay?.setMap?.(null); } catch { /* map may already have lost its context */ }
      webglOverlay = null;
      renderer?.resetState?.();
      renderer?.dispose?.();
      renderer = null;
      googleGl = null;
      root.removeFromParent();
      restoreParent(originalParents[0]);
      restoreParent(originalParents[1]);
      overlayScene.clear();
      container.style.visibility = oldVisibility;
      container.style.display = oldDisplay;
      if (!readySettled) {
        readySettled = true;
        rejectReady(makeError('Google Maps overlay was disposed before its first draw'));
      }
    },
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      container.style.visibility = visible ? oldVisibility || 'visible' : 'hidden';
      if (webglOverlay && map) {
        try { webglOverlay.setMap(visible ? map : null); } catch { /* cleanup follows context loss */ }
      }
      if (visible) webglOverlay?.requestRedraw?.();
    },
    ready,
  };

  function fail(error) {
    if (disposed || failed) return;
    failed = error instanceof Error ? error : makeError('Google Maps overlay failed');
    status(onStatus, 'Google overlay unavailable', failed.message);
    if (!readySettled) {
      readySettled = true;
      rejectReady(failed);
    }
    api.dispose();
  }

  function ensureRenderer(gl) {
    if (renderer) return;
    if (!gl?.canvas || typeof gl.getContextAttributes !== 'function') throw makeError('Google Maps WebGL context is unavailable');
    googleGl = gl;
    renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl, ...gl.getContextAttributes() });
    renderer.autoClear = false;
    camera = new THREE.PerspectiveCamera();
    camera.matrixAutoUpdate = false;
    camera.matrix.identity();
    camera.matrixWorld.identity();
    camera.matrixWorldInverse.identity();
    camera.projectionMatrix.identity();
    renderer.resetState();
  }

  function draw({ gl, transformer }) {
    if (disposed || failed || !visible) return;
    try {
      ensureRenderer(gl);
      if (!transformer || typeof transformer.fromLatLngAltitude !== 'function') throw makeError('Google Maps coordinate transformer is unavailable');
      camera.matrixAutoUpdate = false;
      camera.matrix.identity();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      camera.projectionMatrix.fromArray(transformer.fromLatLngAltitude({ lat: data.origin.lat, lng: data.origin.lng, altitude: 0 }));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.resetState();
      renderer.render(overlayScene, camera);
      renderer.resetState();
      if (!readySettled) {
        readySettled = true;
        clearTimeout(firstDrawTimer);
        status(onStatus, 'Google overlay ready', 'Mapped buildings and the single vehicle are rendering over the Google vector basemap.');
        resolveReady(api);
      }
    } catch (error) {
      fail(makeError('Google Maps overlay render failed'));
    }
  }

  function contextLost() {
    fail(makeError('Google Maps WebGL context was lost'));
  }

  status(onStatus, 'Loading Google overlay', 'Loading Google Maps configuration and vector WebGL context…');
  firstDrawTimer = setTimeout(() => fail(makeError('Google Maps overlay timed out before its first draw')), READY_TIMEOUT_MS);
  try {
    const loaded = await loadMapsOnce(configAbort.signal);
    maps = loaded.maps;
    if (disposed || failed) throw failed || makeError('Google Maps overlay was disposed');
    const mapOptions = {
      center: { lat: data.origin.lat, lng: data.origin.lng },
      zoom: CAMERA_MODES.chase.zoom,
      tilt: CAMERA_MODES.chase.tilt,
      heading: 0,
      mapId: loaded.mapId,
      renderingType: maps.RenderingType?.VECTOR || 'VECTOR',
      disableDefaultUI: true,
      clickableIcons: false,
      isFractionalZoomEnabled: true,
      gestureHandling: 'greedy',
    };
    map = new maps.Map(container, mapOptions);
    if (typeof maps.WebGLOverlayView !== 'function') throw makeError('Google Maps WebGLOverlayView is unavailable');
    webglOverlay = new maps.WebGLOverlayView();
    webglOverlay.onContextRestored = ({ gl }) => {
      try { ensureRenderer(gl); } catch { contextLost(); }
    };
    webglOverlay.onContextLost = contextLost;
    webglOverlay.onDraw = draw;
    webglOverlay.onAdd = () => {};
    webglOverlay.onRemove = () => {};
    webglOverlay.setMap(visible ? map : null);
    if (latestState) api.update(latestState, 1 / 60);
    await ready;
    return api;
  } catch (error) {
    if (!failed) fail(error instanceof Error ? error : makeError('Google Maps overlay initialization failed'));
    throw failed || error;
  }
}
