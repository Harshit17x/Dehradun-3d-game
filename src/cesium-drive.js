import * as Cesium from 'cesium';

const READY_TIMEOUT_MS = 20_000;
const ORIGIN_HEIGHT_METRES = 692;
const CAR_BODY_HEIGHT = 0.75;
const CAR_WHEEL_RADIUS = 0.34;
const CESIUM_VEHICLE_MODELS = Object.freeze({
  bmw: Object.freeze({
    name: '2024 BMW M4 Coupe Competition',
    url: '/models/2024_bmw_m4_coupe_competition.glb',
    scale: 1,
    height: 0.62,
  }),
  police: Object.freeze({
    name: 'Uttarakhand Police Interceptor',
    url: '/models/police_car_low_poly.glb',
    // This asset is authored in decimetre-like units; the Three.js vehicle
    // loader applies the same real-world correction before displaying it.
    scale: 0.12,
    height: 0.62,
  }),
});

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

function cesiumVehicleKey(vehicle) {
  const key = vehicle?.getCurrentModelKey?.();
  // Ember is the procedural Three.js fallback. Cesium should still show a
  // recognizable, authored vehicle rather than recreating the old box proxy.
  return key === 'police' ? 'police' : 'bmw';
}

async function loadCesiumVehicleModel(viewer, frame, key) {
  const definition = CESIUM_VEHICLE_MODELS[key] || CESIUM_VEHICLE_MODELS.bmw;
  const position = makePosition(frame, 0, 0, 0);
  const model = await Cesium.Model.fromGltfAsync({
    url: definition.url,
    scene: viewer.scene,
    modelMatrix: Cesium.Matrix4.fromTranslation(position, new Cesium.Matrix4()),
    scale: definition.scale,
    upAxis: Cesium.Axis.Y,
    forwardAxis: Cesium.Axis.Z,
    shadows: Cesium.ShadowMode.ENABLED,
    minimumPixelSize: 0,
    allowPicking: false,
  });
  viewer.scene.primitives.add(model);
  model.show = false;
  model._driveHeight = definition.height;
  return model;
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
  let modelGeneration = 0;
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
      const modelHeight = car.model?._driveHeight || 0;
      let position = makePosition(frame, nextState.x, nextState.z, modelHeight);
      if (viewer.scene.clampToHeightSupported) {
        try {
          const clamped = viewer.scene.clampToHeight(position, car.model ? [car.model] : (car.entities || []));
          if (Cesium.defined(clamped)) {
            position = clamped;
          }
        } catch { /* clamping is best effort during tile streaming */ }
      }
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(heading, 0, 0),
      );

      if (car.model) {
        // The authored glTF is a real vehicle, not a collection of Cesium
        // primitive boxes. Its matrix is updated as one rigid object so the
        // materials, wheels, glass, and interior remain visually coherent.
        car.model.modelMatrix = Cesium.Matrix4.fromTranslationQuaternionRotationScale(
          position,
          orientation,
          Cesium.Cartesian3.ONE,
          car.model.modelMatrix,
        );
        car.model.show = visible;
      } else {
        // Keep the old entity car only as an offline asset-load fallback.
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
      if (car?.model) car.model.show = visible;
      for (const entity of car?.entities || []) entity.show = !car.model && visible;
      if (visible) viewer?.scene?.requestRender?.();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      modelGeneration++;
      if (car?.model) {
        try { viewer?.scene?.primitives?.remove(car.model); } catch { /* best effort */ }
        try { car.model.destroy?.(); } catch { /* best effort */ }
      }
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

  async function replaceCesiumVehicle(requestedKey) {
    const generation = ++modelGeneration;
    const key = requestedKey === 'police' ? 'police' : 'bmw';
    const previous = car?.model;
    if (previous) {
      try { viewer?.scene?.primitives?.remove(previous); } catch { /* best effort */ }
      try { previous.destroy?.(); } catch { /* best effort */ }
      if (car) car.model = null;
    }
    try {
      const model = await loadCesiumVehicleModel(viewer, frame, key);
      if (disposed || generation !== modelGeneration) {
        try { viewer?.scene?.primitives?.remove(model); } catch { /* best effort */ }
        try { model.destroy?.(); } catch { /* best effort */ }
        return;
      }
      car.model = model;
      model.show = visible;
      for (const entity of car.entities) entity.show = false;
      report(onStatus, 'Real 3D vehicle ready', CESIUM_VEHICLE_MODELS[key].name);
      viewer.scene.requestRender();
    } catch (error) {
      if (disposed || generation !== modelGeneration) return;
      // A local model can be unavailable in a static deployment. Keep the
      // geographic view usable, but never prefer this proxy when the GLB loads.
      for (const entity of car?.entities || []) entity.show = visible;
      report(onStatus, 'Real 3D vehicle unavailable', error?.message || 'Using the safe fallback vehicle.');
    }
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
    for (const entity of car.entities) entity.show = false;
    vehicle.group.visible = false;
    report(onStatus, 'Loading real 3D vehicle', 'Loading the selected authored vehicle model…');
    await replaceCesiumVehicle(cesiumVehicleKey(vehicle));
    vehicle.onModelChange?.((key) => { void replaceCesiumVehicle(key); });

    let surface = 'fallback';
    let googleAttempted = false;

    // 1. Prioritize direct Google Maps API key (connects directly to tile.googleapis.com)
    if (config.googleTilesKey) {
      googleAttempted = true;
      report(onStatus, 'Loading Google 3D', 'Loading Google Photorealistic 3D Tiles…');
      try {
        if (Cesium.GoogleMaps) Cesium.GoogleMaps.defaultApiKey = config.googleTilesKey;
        if (typeof Cesium.createGooglePhotorealistic3DTileset === 'function') {
          tileset = await withTimeout(
            Cesium.createGooglePhotorealistic3DTileset({
              key: config.googleTilesKey,
              onlyUsingWithGoogleGeocoder: true,
            }),
            'Google Photorealistic 3D tiles timed out',
          );
        } else {
          tileset = await withTimeout(
            Cesium.Cesium3DTileset.fromUrl(
              `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(config.googleTilesKey)}`,
            ),
            'Google Photorealistic 3D tiles timed out',
          );
        }
        if (disposed) throw errorWithMessage('Cesium drive was disposed');
        viewer.scene.primitives.add(tileset);
        tileset.tileLoad?.addEventListener?.(() => {
          if (visible) viewer?.scene?.requestRender?.();
        });
        viewer.scene.requestRender();
        surface = 'Google Photorealistic 3D tiles';
      } catch (err) {
        console.warn('Direct Google Photorealistic 3D tiles failed, trying fallback:', err);
      }
    }

    // 2. If direct key was not set or failed, try Cesium Ion Asset (Asset 2275207)
    if (surface === 'fallback' && typeof Cesium.createGooglePhotorealistic3DTileset === 'function') {
      googleAttempted = true;
      report(onStatus, 'Loading Google 3D', 'Loading photorealistic Dehradun tiles via Cesium Ion…');
      try {
        tileset = await withTimeout(
          Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }),
          'Google Photorealistic 3D tiles timed out',
        );
        if (disposed) throw errorWithMessage('Cesium drive was disposed');
        viewer.scene.primitives.add(tileset);
        tileset.tileLoad?.addEventListener?.(() => {
          if (visible) viewer?.scene?.requestRender?.();
        });
        viewer.scene.requestRender();
        surface = 'Google Photorealistic 3D tiles';
      } catch (err) {
        console.warn('Cesium Ion 3D tiles load failed:', err);
      }
    }

    // 3. Fallback to Cesium3DTileset.fromUrl if createGooglePhotorealistic3DTileset failed but key exists
    if (surface === 'fallback' && config.googleTilesKey) {
      googleAttempted = true;
      report(onStatus, 'Loading Google 3D', 'Loading Google 3D tileset from URL…');
      try {
        tileset = await withTimeout(
          Cesium.Cesium3DTileset.fromUrl(
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(config.googleTilesKey)}`,
          ),
          'Google Photorealistic 3D tiles timed out',
        );
        if (disposed) throw errorWithMessage('Cesium drive was disposed');
        viewer.scene.primitives.add(tileset);
        tileset.tileLoad?.addEventListener?.(() => {
          if (visible) viewer?.scene?.requestRender?.();
        });
        viewer.scene.requestRender();
        surface = 'Google Photorealistic 3D tiles';
      } catch (err) {
        console.warn('Cesium3DTileset URL load failed:', err);
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
