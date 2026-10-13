import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** One car, facing local -Z. Steering is a signed front-wheel angle in radians. */
export function createVehicle() {
  const group = new THREE.Group();
  group.name = 'Ember GT';
  const body = new THREE.Group();
  group.add(body);
  const geometries = new Set();
  const materials = new Set();
  const material = (options) => {
    const result = new THREE.MeshStandardMaterial(options);
    materials.add(result);
    return result;
  };
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xb93b22, metalness: 0.58, roughness: 0.27, clearcoat: 1, clearcoatRoughness: 0.18,
  });
  materials.add(paint);
  const dark = material({ color: 0x131921, roughness: 0.48, metalness: 0.25 });
  const rubber = material({ color: 0x17191c, roughness: 0.92 });
  const glass = material({ color: 0x102c43, metalness: 0.55, roughness: 0.14, side: THREE.DoubleSide });
  const alloy = material({ color: 0xb4c0c8, metalness: 0.9, roughness: 0.23 });
  const smoked = material({ color: 0x35434d, metalness: 0.75, roughness: 0.3 });
  const headlamp = material({ color: 0xe8f5ff, emissive: 0xb9e6ff, emissiveIntensity: 1.5, roughness: 0.15 });
  const taillamp = material({ color: 0xd71a21, emissive: 0xff1018, emissiveIntensity: 0.7, roughness: 0.22 });
  const plate = material({ color: 0xe4ded0, roughness: 0.5 });
  const brakeCaliper = material({ color: 0xd45a30, metalness: 0.5, roughness: 0.35 });

  function mesh(geometry, mat, parent = body) {
    geometries.add(geometry);
    const result = new THREE.Mesh(geometry, mat);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function box(w, h, d, x, y, z, mat = paint, parent = body) {
    const result = mesh(new THREE.BoxGeometry(w, h, d), mat, parent);
    result.position.set(x, y, z);
    return result;
  }
  function panel(points, mat = glass, parent = body) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return mesh(geometry, mat, parent);
  }
  // Cross sections [z, half-width at base, half-width at top, base-y, top-y].
  function shell(sections, mat) {
    const vertices = [];
    for (const [z, base, top, low, high] of sections) {
      vertices.push(-base, low, z, base, low, z, top, high, z, -top, high, z);
    }
    const indices = [0, 2, 1, 0, 3, 2];
    for (let i = 0; i < sections.length - 1; i++) {
      for (let side = 0; side < 4; side++) {
        const a = i * 4 + side;
        const b = i * 4 + (side + 1) % 4;
        indices.push(a, b, b + 4, a, b + 4, a + 4);
      }
    }
    const end = (sections.length - 1) * 4;
    indices.push(end, end + 1, end + 2, end, end + 2, end + 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    // Face normals retain the clean shoulder lines and chamfered silhouette.
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    flat.computeVertexNormals();
    return mesh(flat, mat);
  }

  shell([
    [-2.13, 0.73, 0.76, 0.43, 0.78],
    [-1.77, 0.84, 0.88, 0.43, 0.94],
    [-0.91, 0.86, 0.88, 0.44, 1.01],
    [0.8, 0.86, 0.88, 0.44, 1.02],
    [1.72, 0.84, 0.86, 0.44, 0.96],
    [2.12, 0.75, 0.78, 0.46, 0.88],
  ], paint);
  shell([
    [-0.99, 0.81, 0.79, 0.98, 1.025],
    [-0.35, 0.81, 0.66, 1.0, 1.5],
    [0.78, 0.81, 0.66, 1.0, 1.5],
    [1.51, 0.8, 0.78, 0.97, 1.025],
  ], paint);
  // Front and rear glass sit on their sloped cabin surfaces.
  panel([[-0.755, 1.059, -0.935], [0.755, 1.059, -0.935], [0.623, 1.467, -0.397], [-0.623, 1.467, -0.397]]);
  panel([[-0.623, 1.467, 0.831], [0.623, 1.467, 0.831], [0.742, 1.065, 1.449], [-0.742, 1.065, 1.449]]);
  for (const side of [-1, 1]) {
    const p = (x, y, z) => [x * side, y, z];
    panel([p(0.787, 1.071, -0.865), p(0.676, 1.447, -0.316), p(0.676, 1.447, 0.18), p(0.79, 1.071, 0.18)]);
    panel([p(0.79, 1.071, 0.28), p(0.676, 1.447, 0.28), p(0.676, 1.447, 0.737), p(0.79, 1.071, 1.349)]);
    box(0.035, 0.038, 2.36, side * 0.813, 1.035, 0.25, alloy);
    box(0.08, 0.1, 2.03, side * 0.872, 0.47, 0.03, dark);
    // Door shut line and inset handles.
    box(0.012, 0.46, 0.014, side * 0.883, 0.756, 0.23, dark);
    for (const z of [-0.03, 1.04]) box(0.018, 0.035, 0.18, side * 0.887, 0.94, z, smoked);
    const stalk = box(0.12, 0.045, 0.07, side * 0.868, 1.072, -0.71, dark);
    stalk.rotation.z = -side * 0.2;
    box(0.18, 0.105, 0.24, side * 0.963, 1.105, -0.72);
    box(0.145, 0.073, 0.013, side * 0.968, 1.105, -0.594, alloy);
    const lamp = box(0.39, 0.075, 0.075, side * 0.535, 0.804, -2.089, headlamp);
    lamp.rotation.y = -side * 0.15;
    box(0.38, 0.095, 0.055, side * 0.54, 0.86, 2.105, taillamp);
    box(0.3, 0.105, 0.06, side * 0.56, 0.565, -2.125, dark);
  }
  // Hood creases, roof, rear spoiler, grille and diffuser.
  for (const x of [-0.48, 0.48]) {
    const crease = box(0.018, 0.012, 0.77, x, 0.977, -1.33, smoked);
    crease.rotation.x = -0.08;
  }
  box(1.17, 0.018, 0.84, 0, 1.508, 0.21, dark);
  box(1.48, 0.052, 0.19, 0, 1.124, 1.39);
  box(0.39, 0.032, 0.03, 0, 1.114, 1.49, taillamp);
  box(0.87, 0.23, 0.06, 0, 0.625, -2.133, dark);
  for (const y of [0.55, 0.6, 0.65, 0.7]) box(0.79, 0.014, 0.009, 0, y, -2.168, smoked);
  box(1.53, 0.065, 0.13, 0, 0.439, -2.09, dark);
  box(1.47, 0.13, 0.13, 0, 0.484, 2.095, dark);
  for (const x of [-0.49, 0, 0.49]) box(0.03, 0.095, 0.19, x, 0.424, 2.06, dark);
  for (const z of [-2.175, 2.151]) {
    box(0.4, 0.11, 0.012, 0, 0.754, z, plate);
    // Abstract plate lettering, without a font or a texture dependency.
    for (let i = 0; i < 6; i++) box(0.028, 0.052, 0.014, -0.133 + i * 0.052, 0.754, z + Math.sign(z) * 0.009, dark);
  }
  const badge = box(0.066, 0.055, 0.013, 0, 0.868, -2.144, alloy);
  badge.rotation.z = Math.PI / 4;

  const wheels = [];
  const radius = 0.34;
  function cylinder(r, depth, mat, parent, x = 0) {
    const geometry = new THREE.CylinderGeometry(r, r, depth, 32);
    geometry.rotateZ(Math.PI / 2);
    const result = mesh(geometry, mat, parent);
    result.position.x = x;
    return result;
  }
  for (const side of [-1, 1]) {
    for (const z of [-1.3, 1.35]) {
      const well = cylinder(0.355, 0.018, dark, body);
      well.position.set(side * 0.882, 0.385, z);
      const pivot = new THREE.Group();
      pivot.name = `${z < 0 ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}-steering`;
      pivot.position.set(side * 0.835, radius, z);
      group.add(pivot);
      const spin = new THREE.Group();
      spin.name = 'rotating-tire-and-rim';
      pivot.add(spin);
      cylinder(radius, 0.235, rubber, spin);
      cylinder(0.247, 0.243, dark, spin);
      // Both faces are modeled so a steered wheel never exposes an empty back.
      for (const face of [-1, 1]) {
        const rimGeometry = new THREE.TorusGeometry(0.239, 0.018, 8, 32);
        rimGeometry.rotateY(Math.PI / 2);
        const rim = mesh(rimGeometry, alloy, spin);
        rim.position.x = face * 0.124;
        cylinder(0.202, 0.012, smoked, spin, face * 0.114);
        cylinder(0.07, 0.02, alloy, spin, face * 0.134);
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5;
          const spoke = box(0.028, 0.165, 0.033, face * 0.137,
            Math.cos(angle) * 0.143, Math.sin(angle) * 0.143, alloy, spin);
          spoke.rotation.x = angle;
          cylinder(0.012, 0.012, dark, spin, face * 0.15)
            .position.set(face * 0.15, Math.cos(angle) * 0.045, Math.sin(angle) * 0.045);
        }
      }
      // Calipers turn with the wheel assembly, but do not spin with the rim.
      box(0.026, 0.1, 0.06, side * 0.124, 0.01, 0.163, brakeCaliper, pivot);
      wheels.push({ pivot, spin, front: z < 0 });
    }
  }

  // Batch details within each independently animated group. The four wheel
  // assemblies stay separate; rim spokes and static body trim need not each
  // cost a draw call (including in the shadow pass).
  for (const parent of [body, ...wheels.flatMap(wheel => [wheel.pivot, wheel.spin])]) {
    const byMaterial = new Map();
    for (const child of [...parent.children]) {
      if (!child.isMesh) continue;
      child.updateMatrix();
      const baked = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      baked.applyMatrix4(child.matrix);
      // Procedural panels do not have UVs; the car uses solid materials only.
      baked.deleteAttribute('uv');
      if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
      byMaterial.get(child.material).push(baked);
      parent.remove(child);
      child.geometry.dispose();
      geometries.delete(child.geometry);
    }
    for (const [mat, parts] of byMaterial) {
      const merged = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      mesh(merged, mat, parent);
    }
  }

  let disposed = false;
  let currentModelKey = 'ember';
  let activeGltfModel = null;
  const modelCache = new Map();
  const modelContainer = new THREE.Group();
  modelContainer.name = 'GLTF-Vehicle-Model';
  group.add(modelContainer);

  // Dynamic Headlights (illuminates roads and buildings in evening/night)
  const headlightGroup = new THREE.Group();
  headlightGroup.name = 'vehicle-headlights';
  const spotL = new THREE.SpotLight(0xfff6e6, 3.8, 120, Math.PI / 4.8, 0.35, 1.2);
  spotL.position.set(-0.68, 0.72, -2.15);
  spotL.target.position.set(-0.68, 0.05, -45);
  const spotR = new THREE.SpotLight(0xfff6e6, 3.8, 120, Math.PI / 4.8, 0.35, 1.2);
  spotR.position.set(0.68, 0.72, -2.15);
  spotR.target.position.set(0.68, 0.05, -45);
  headlightGroup.add(spotL, spotL.target, spotR, spotR.target);

  // Soft forward ambient beam
  const beamFill = new THREE.PointLight(0xffedd5, 1.2, 14);
  beamFill.position.set(0, 0.7, -2.3);
  headlightGroup.add(beamFill);
  group.add(headlightGroup);

  const VEHICLE_DEFS = {
    bmw: {
      name: '2024 BMW M4 Coupe Competition',
      url: '/models/2024_bmw_m4_coupe_competition.glb',
      targetLen: 4.5,
      rotY: Math.PI, // The BMW GLTF model faces +Z; rotating by 180° aligns with driving forward direction -Z
      yOffset: 0.0,
      badge: '🏎️ BMW M4'
    },
    police: {
      name: 'Uttarakhand Police Interceptor',
      url: '/models/police_car_low_poly.glb',
      targetLen: 4.35,
      rotY: 0,
      yOffset: 0.0,
      badge: '🚓 Police'
    },
    ember: {
      name: 'Ember GT Concept',
      url: null,
      targetLen: 4.4,
      rotY: 0,
      yOffset: 0.0,
      badge: '⚡ Ember GT'
    }
  };

  let onModelChangeListeners = [];

  function loadGltfModel(key) {
    if (typeof window === 'undefined') return;
    const def = VEHICLE_DEFS[key];
    if (!def || !def.url) {
      applyModel('ember', null);
      return;
    }

    if (modelCache.has(key)) {
      applyModel(key, modelCache.get(key));
      return;
    }

    try {
      const loader = new GLTFLoader();
      loader.load(
        def.url,
        (gltf) => {
          if (disposed) return;
          const root = gltf.scene;

          // Wrap root in dedicated pivot group
          const wrapper = new THREE.Group();
          wrapper.name = `${key}-wrapper`;
          wrapper.add(root);

          // Apply rotation to face forward (local -Z)
          root.rotation.y = def.rotY || 0;
          root.updateMatrixWorld(true);

          // Measure size of oriented model
          const box = new THREE.Box3().setFromObject(wrapper);
          const size = box.getSize(new THREE.Vector3());
          const modelLength = size.z > 0.5 ? size.z : size.x;
          const scale = def.targetLen / (modelLength || 1);
          root.scale.setScalar(scale);
          root.updateMatrixWorld(true);

          // Re-measure after scale and precisely center (X=0, Z=0) with bottom at y=0
          const scaledBox = new THREE.Box3().setFromObject(wrapper);
          const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

          root.position.x = -scaledCenter.x;
          root.position.y = -scaledBox.min.y + (def.yOffset || 0);
          root.position.z = -scaledCenter.z;
          root.updateMatrixWorld(true);

          root.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material) {
                if (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial) {
                  child.material.envMapIntensity = 1.35;
                }
              }
            }
          });

          modelCache.set(key, wrapper);
          applyModel(key, wrapper);
        },
        undefined,
        (err) => {
          console.warn(`[Vehicle] Could not load ${def.name}:`, err);
        }
      );
    } catch (err) {
      console.warn('[Vehicle] GLTFLoader error:', err);
    }
  }

  function applyModel(key, modelGroup) {
    if (disposed) return;
    const def = VEHICLE_DEFS[key] || VEHICLE_DEFS.ember;
    currentModelKey = key;
    group.name = def.name;

    modelContainer.clear();
    if (modelGroup) {
      modelContainer.add(modelGroup);
      modelGroup.visible = true;
      activeGltfModel = modelGroup;
    } else {
      activeGltfModel = null;
    }

    if (key === 'ember') {
      body.visible = true;
      for (const w of wheels) w.pivot.visible = true;
    } else {
      // 3D model active: hide procedural body AND hide procedural wheels
      body.visible = false;
      for (const w of wheels) w.pivot.visible = false;
    }

    onModelChangeListeners.forEach(fn => fn(currentModelKey, def.name));
    console.log(`[Vehicle] Successfully active: ${def.name}`);
  }

  // In browser, default to real 3D BMW M4 Coupe Competition
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      loadGltfModel('bmw');
    }, 10);
  }

  return {
    group,
    setVehicleModel(key) {
      loadGltfModel(key);
    },
    getVehicleName() {
      return VEHICLE_DEFS[currentModelKey]?.name || group.name;
    },
    getCurrentModelKey() {
      return currentModelKey;
    },
    onModelChange(fn) {
      onModelChangeListeners.push(fn);
    },
    toggleHeadlights(enabled) {
      headlightGroup.visible = enabled !== undefined ? enabled : !headlightGroup.visible;
      return headlightGroup.visible;
    },
    update(speed = 0, steering = 0, dt = 0, braking = false) {
      if (disposed) return;
      const seconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      const velocity = Number.isFinite(speed) ? speed : 0;
      const angle = Number.isFinite(steering) ? Math.max(-0.65, Math.min(0.65, steering)) : 0;
      for (const wheel of wheels) {
        if (wheel.front) wheel.pivot.rotation.y = angle;
        // Negative X rotation rolls toward local -Z; reverse unwinds it.
        wheel.spin.rotation.x = (wheel.spin.rotation.x - velocity * seconds / radius) % (Math.PI * 2);
      }
      const blend = 1 - Math.exp(-8 * seconds);
      const roll = Math.max(-0.018, Math.min(0.018, angle * velocity * Math.abs(velocity) * 0.00014));
      body.rotation.z += (roll - body.rotation.z) * blend;
      const pitch = braking && Math.abs(velocity) > 0.2 ? -Math.sign(velocity) * 0.012 : 0;
      body.rotation.x += (pitch - body.rotation.x) * blend;

      if (activeGltfModel && activeGltfModel.visible) {
        activeGltfModel.rotation.z += (roll - activeGltfModel.rotation.z) * blend;
        activeGltfModel.rotation.x += (pitch - activeGltfModel.rotation.x) * blend;
      }

      taillamp.emissiveIntensity = braking ? 3.8 : 0.7;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const [, root] of modelCache) {
        root.traverse(child => {
          if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material?.dispose();
          }
        });
      }
      modelCache.clear();
      group.clear();
      geometries.clear();
      materials.clear();
      onModelChangeListeners = [];
    },
  };
}
