import * as Cesium from 'cesium';

const READY_TIMEOUT_MS = 20_000;
const ORIGIN_HEIGHT_METRES = 650;
const CAR_BODY_HEIGHT = 0.75;
const CAR_WHEEL_RADIUS = 0.34;

/**
 * Convert the game's local coordinates to Cesium's ENU convention.
 * The game uses x=east and z=south, while ENU uses x=east and y=north.
 */
export function localToEnu(x, z, height = 0) {
  return { x, y: height, z: -z };
}

/** Cesium headings are clockwise from north; the driving state turns the opposite way. */
export function cesiumHeading(heading) {
  return -heading;
}

function report(onStatus, title, text) {
  if (typeof onStatus !== 'function') return;
  try { onStatus(String(title), String(text)); } catch { /* status must not stop rendering */ }
}

function errorWithMessage(message) {
  return new Error(message);
}

function finiteState(state) {
  return state && [state.x, state.z, state.heading].every(Number.isFinite);
}

async function fetchConfig(configUrl) {
  let response;
  try {
    response = await fetch(configUrl, { headers: { accept: 'application/json' } });
  } catch {
    throw errorWithMessage('Cesium configuration could not be fetched');
  }
  if (!response.ok) throw errorWithMessage('Cesium configuration is unavailable');

  let config;
  try { config = await response.json(); } catch { throw errorWithMessage('Cesium configuration is invalid'); }
  if (!config || typeof config.token !== 'string' || !config.token.trim()) {
    throw errorWithMessage('Cesium Ion token is not configured');
  }
  return {
    token: config.token.trim(),
    googleTilesKey: typeof config.googleTilesKey === 'string' && config.googleTilesKey.trim()
      ? config.googleTilesKey.trim()
      : undefined,
  };
}

function withTimeout(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(errorWithMessage(message)), READY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makePosition(frame, x, z, height) {
  const local = localToEnu(x, z, height);
  // In eastNorthUpToFixedFrame: X=East (local.x), Y=North (local.z), Z=Up (local.y)
  return Cesium.Matrix4.multiplyByPoint(
    frame,
    Cesium.Cartesian3.fromElements(local.x, local.z, local.y),
    new Cesium.Cartesian3(),
  );
}

function setEntityOrientation(entity, orientation) {
  // Entity property setters accept a raw value and wrap it in a constant property.
  entity.orientation = orientation;
}

function createCarEntities(viewer) {
  const entities = [];
  const add = (options) => {
    const entity = viewer.entities.add(options);
    entities.push(entity);
    return entity;
  };

  const body = add({
    name: 'Ember GT',
    box: {
      dimensions: new Cesium.Cartesian3(1.9, 4.36, CAR_BODY_HEIGHT),
      material: Cesium.Color.fromCssColorString('#b93b22'),
    },
  });
  const roof = add({
    name: 'Ember GT roof',
    box: {
      dimensions: new Cesium.Cartesian3(1.45, 2.2, 0.6),
      material: Cesium.Color.fromCssColorString('#182d3d'),
    },
  });

  const wheels = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.3, 1.35]) {
      wheels.push({
        entity: add({
          name: 'Ember GT wheel',
          cylinder: {
            length: 0.23,
            topRadius: CAR_WHEEL_RADIUS,
            bottomRadius: CAR_WHEEL_RADIUS,
            material: Cesium.Color.fromCssColorString('#17191c'),
          },
        }),
        side,
        z,
      });
    }
  }

  return { entities, body, roof, wheels };
}

/**
 * Create a Cesium geographic driving view around the game's local Dehradun map.
 * The supplied Three.js vehicle is hidden while this view is visible so the
 * player still sees one controllable car rather than a duplicate proxy.
 */
export async function createCesiumDrive({
  container,
  data,
  state,
  vehicle,
  onStatus,
  configUrl = '/api/cesium-config',
} = {}) {
  if (!container || typeof container !== 'object' || !container.style) {
    throw new TypeError('Cesium drive requires a container element');
  }
  if (!data?.origin || !Number.isFinite(data.origin.lat) || !Number.isFinite(data.origin.lng)) {
    throw new TypeError('Cesium drive requires a geographic origin');
  }
  if (!vehicle?.group || typeof vehicle.group !== 'object') {
    throw new TypeError('Cesium drive requires the caller-owned vehicle group');
  }

  const oldVisibility = container.style.visibility;
  const oldDisplay = container.style.display;
  const oldVehicleVisibility = vehicle.group.visible;
  const ready = Promise.withResolvers
    ? Promise.withResolvers()
    : (() => {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      })();
  const readyPromise = ready.promise;
  // The async factory also rejects with the same error; this observer prevents a
  // failed initialization from producing an unhandled readiness rejection.
  readyPromise.catch(() => {});

  let viewer;
  let tileset;
  let fallbackTileset;
  let car;
  let frame;
  let disposed = false;
  let readySettled = false;
  let visible = true;
  let failed;

  const api = {
    update(nextState, dt = 0) {
      if (disposed || failed || !finiteState(nextState) || !viewer || !car) return;
      const seconds = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      const heading = cesiumHeading(nextState.heading);
      const position = makePosition(frame, nextState.x, nextState.z, 0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(heading, 0, 0),
      );

      car.body.position = makePosition(frame, nextState.x, nextState.z, 0.75);
      car.roof.position = makePosition(frame, nextState.x, nextState.z, 1.35);
      setEntityOrientation(car.body, orientation);
      setEntityOrientation(car.roof, orientation);

      const wheelAxis = Cesium.Quaternion.fromAxisAngle(
        Cesium.Cartesian3.UNIT_Y,
        Math.PI / 2,
        new Cesium.Quaternion(),
      );
      const cosH = Math.cos(nextState.heading);
      const sinH = Math.sin(nextState.heading);
      for (const wheel of car.wheels) {
        const lateral = wheel.side * 0.91;
        const longitudinal = wheel.z;
        const wx = nextState.x + lateral * cosH - longitudinal * sinH;
        const wz = nextState.z - lateral * sinH + longitudinal * cosH;
        wheel.entity.position = makePosition(
          frame,
          wx,
          wz,
          CAR_WHEEL_RADIUS,
        );
        wheel.entity.orientation = Cesium.Quaternion.multiply(
          orientation,
          wheelAxis,
          new Cesium.Quaternion(),
        );
      }

      // Keep a stable chase camera without moving the Three.js camera or world.
      if (visible && viewer.camera) {
        try {
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          viewer.camera.lookAt(
            position,
            new Cesium.HeadingPitchRange(heading + Math.PI, -0.32, 13 + seconds * 0),
          );
        } catch { /* camera can be unavailable during context teardown */ }
      }
      viewer.scene.requestRender();
    },

    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      container.style.visibility = visible ? oldVisibility : 'hidden';
      vehicle.group.visible = visible ? false : oldVehicleVisibility;
      if (visible) viewer?.scene?.requestRender?.();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entity of car?.entities || []) {
        try { viewer?.entities?.remove(entity); } catch { /* viewer may already be destroyed */ }
      }
      car = null;
      if (tileset) {
        try { viewer?.scene?.primitives?.remove(tileset); } catch { /* best effort */ }
        try { tileset.destroy?.(); } catch { /* best effort */ }
        tileset = null;
      }
      if (fallbackTileset) {
        try { viewer?.scene?.primitives?.remove(fallbackTileset); } catch { /* best effort */ }
        try { fallbackTileset.destroy?.(); } catch { /* best effort */ }
        fallbackTileset = null;
      }
      try { viewer?.destroy?.(); } catch { /* best effort */ }
      viewer = null;
      vehicle.group.visible = oldVehicleVisibility;
      container.style.visibility = oldVisibility;
      container.style.display = oldDisplay;
      if (!readySettled) {
        readySettled = true;
        ready.reject(errorWithMessage('Cesium drive was disposed before it became ready'));
      }
    },
    ready: readyPromise,
  };

  function fail(error) {
    if (failed || disposed) return;
    failed = error instanceof Error ? error : errorWithMessage('Cesium drive failed');
    report(onStatus, 'Cesium unavailable', failed.message);
    if (!readySettled) {
      readySettled = true;
      ready.reject(failed);
    }
    api.dispose();
  }

  report(onStatus, 'Loading Cesium', 'Fetching the runtime Ion configuration…');
  try {
    const config = await fetchConfig(configUrl);
    if (disposed) throw errorWithMessage('Cesium drive was disposed');

    // This is the only assignment of the runtime credential. It is never logged
    // or embedded in a URL by this module.
    Cesium.Ion.defaultAccessToken = config.token;

    viewer = new Cesium.Viewer(container, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      requestRenderMode: true,
      globe: false,
    });
    frame = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(data.origin.lng, data.origin.lat, ORIGIN_HEIGHT_METRES),
    );
    car = createCarEntities(viewer);
    vehicle.group.visible = false;

    let surface = 'fallback';
    let googleAttempted = false;
    if (typeof Cesium.createGooglePhotorealistic3DTileset === 'function') {
      googleAttempted = true;
      report(onStatus, 'Loading Google 3D', 'Loading photorealistic Dehradun tiles…');
      // 1. Prioritize Cesium Ion token (Asset 2275207)
      try {
        tileset = await withTimeout(
          Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }),
          'Google Photorealistic 3D tiles timed out',
        );
        if (disposed) throw errorWithMessage('Cesium drive was disposed');
        viewer.scene.primitives.add(tileset);
        surface = 'Google Photorealistic 3D tiles';
      } catch {
        // 2. If Ion token request fails, try direct Google Maps API key if configured
        if (config.googleTilesKey) {
          try {
            if (Cesium.GoogleMaps) Cesium.GoogleMaps.defaultApiKey = config.googleTilesKey;
            tileset = await withTimeout(
              Cesium.createGooglePhotorealistic3DTileset({
                key: config.googleTilesKey,
                onlyUsingWithGoogleGeocoder: true,
              }),
              'Google Photorealistic 3D tiles timed out',
            );
            if (disposed) throw errorWithMessage('Cesium drive was disposed');
            viewer.scene.primitives.add(tileset);
            surface = 'Google Photorealistic 3D tiles';
          } catch {
            report(onStatus, 'Google 3D unavailable', 'Using Cesium terrain and OSM buildings fallback.');
          }
        } else {
          report(onStatus, 'Google 3D unavailable', 'Using Cesium terrain and OSM buildings fallback.');
        }
      }
    } else if (config.googleTilesKey) {
      googleAttempted = true;
      report(onStatus, 'Loading Google 3D', 'Loading the Google Photorealistic 3D tileset…');
      try {
        tileset = await withTimeout(
          Cesium.Cesium3DTileset.fromUrl(
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(config.googleTilesKey)}`,
          ),
          'Google Photorealistic 3D tiles timed out',
        );
        if (disposed) throw errorWithMessage('Cesium drive was disposed');
        viewer.scene.primitives.add(tileset);
        surface = 'Google Photorealistic 3D tiles';
      } catch {
        report(onStatus, 'Google 3D unavailable', 'Using Cesium terrain and OSM buildings fallback.');
      }
    }

    if (surface === 'fallback') {
      let fallbackLoaded = false;
      if (!viewer.scene.globe && typeof Cesium.Globe === 'function') {
        viewer.scene.globe = new Cesium.Globe();
      }
      try {
        if (typeof Cesium.createWorldTerrainAsync === 'function') {
          viewer.terrainProvider = await withTimeout(
            Cesium.createWorldTerrainAsync(),
            'Cesium world terrain timed out',
          );
          fallbackLoaded = true;
        }
      } catch { /* OSM buildings may still provide a useful fallback */ }
      try {
        if (typeof Cesium.createOsmBuildingsAsync === 'function') {
          fallbackTileset = await withTimeout(
            Cesium.createOsmBuildingsAsync(),
            'Cesium OSM buildings timed out',
          );
          if (!disposed) {
            viewer.scene.primitives.add(fallbackTileset);
            fallbackLoaded = true;
          }
        }
      } catch { /* keep the viewer usable even if optional OSM buildings fail */ }
      surface = fallbackLoaded ? 'Cesium terrain/OSM buildings fallback' : 'Cesium fallback surface';
      if (!googleAttempted) report(onStatus, 'Google 3D unavailable', 'No Google tiles key or helper is available; using Cesium fallback.');
    }

    if (disposed) throw errorWithMessage('Cesium drive was disposed');
    api.update(finiteState(state) ? state : { x: 0, z: 0, heading: 0 }, 0);
    report(onStatus, 'Cesium drive ready', `${surface} active around Dehradun.`);
    readySettled = true;
    ready.resolve(api);
    return api;
  } catch (error) {
    const failure = error instanceof Error ? error : errorWithMessage('Cesium drive initialization failed');
    fail(failure);
    throw failure;
  }
}
