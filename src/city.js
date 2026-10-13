import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Real City Infrastructure, Cadmapper Road Grid, 3D Commercial Buildings, and Real Vehicle Traffic
export class CityManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.loader = new GLTFLoader();

    this.roads = [];
    this.roadMeshGroup = new THREE.Group();
    this.cadmapperRoadsGroup = new THREE.Group();
    this.buildingsGroup = new THREE.Group();
    this.treesGroup = new THREE.Group();
    this.trafficGroup = new THREE.Group();
    this.streetlightsGroup = new THREE.Group();

    this.vehicles = [];
    this.nightMaterials = [];
    this.trafficPrototypes = [];

    this.scene.add(this.roadMeshGroup);
    this.scene.add(this.cadmapperRoadsGroup);
    this.scene.add(this.buildingsGroup);
    this.scene.add(this.treesGroup);
    this.scene.add(this.trafficGroup);
    this.scene.add(this.streetlightsGroup);

    this.init();
  }

  init() {
    this.buildArterialRoads();
    this.loadCadmapperRoads();
    this.buildStreetlights();
    this.buildRealisticTrees();
    this.loadCommercialBuildingsPack();
    this.loadRealTrafficVehicles();
  }

  // Arterial Highways of Dehradun radiating from Ghanta Ghar
  buildArterialRoads() {
    // 1. Rajpur Road (Ghanta Ghar to Northern Foothills)
    const rajpurPoints = [];
    for (let z = 0; z >= -680; z -= 15) {
      const x = Math.sin(z * 0.006) * 35;
      rajpurPoints.push(new THREE.Vector2(x, z));
    }
    this.roads.push({ name: 'Rajpur Road', points: rajpurPoints, width: 14, main: true });

    // 2. Chakrata Road (Ghanta Ghar to FRI and Western Valley)
    const chakrataPoints = [];
    for (let x = 0; x >= -550; x -= 15) {
      const z = (x * 0.15) + Math.sin(x * 0.008) * 20;
      chakrataPoints.push(new THREE.Vector2(x, z));
    }
    this.roads.push({ name: 'Chakrata Road', points: chakrataPoints, width: 13, main: true });

    // 3. Haridwar Road / Gandhi Road (Ghanta Ghar to South-East)
    const haridwarPoints = [];
    for (let d = 0; d <= 600; d += 15) {
      const x = d * 0.7 + Math.sin(d * 0.007) * 25;
      const z = d * 0.8;
      haridwarPoints.push(new THREE.Vector2(x, z));
    }
    this.roads.push({ name: 'Haridwar Road', points: haridwarPoints, width: 13, main: true });

    // 4. Saharanpur Road (Ghanta Ghar to South towards ISBT & Shivalik)
    const saharanpurPoints = [];
    for (let z = 0; z <= 600; z += 15) {
      const x = -30 + Math.sin(z * 0.005) * 25;
      saharanpurPoints.push(new THREE.Vector2(x, z));
    }
    this.roads.push({ name: 'Saharanpur Road', points: saharanpurPoints, width: 12, main: true });

    // 5. Mussoorie Winding Ghat Road (Northern ascent hairpin curves)
    const mussooriePoints = [];
    for (let t = 0; t <= 35; t++) {
      const prog = t / 35;
      const z = -680 - (prog * 350);
      const x = 50 + Math.sin(t * 0.75) * 85;
      mussooriePoints.push(new THREE.Vector2(x, z));
    }
    this.roads.push({ name: 'Mussoorie Ghat Road', points: mussooriePoints, width: 10, main: false });

    // 6. EC Road cross-connector
    const ecRoadPoints = [];
    for (let z = -250; z <= 250; z += 15) {
      const x = 85 + Math.sin(z * 0.01) * 15;
      ecRoadPoints.push(new THREE.Vector2(x, z));
    }
    this.roads.push({ name: 'EC Road', points: ecRoadPoints, width: 10, main: false });

    // Render realistic asphalt roads
    const asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x1f242b,
      roughness: 0.65,
      metalness: 0.15
    });

    const markingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85
    });

    this.roads.forEach(road => {
      const pts = road.points;
      const geom = new THREE.BufferGeometry();
      const vertices = [];
      const indices = [];
      const halfW = road.width * 0.5;

      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        let dir = new THREE.Vector2(0, 1);
        if (i < pts.length - 1) {
          dir.subVectors(pts[i + 1], cur).normalize();
        } else if (i > 0) {
          dir.subVectors(cur, pts[i - 1]).normalize();
        }

        const perp = new THREE.Vector2(-dir.y, dir.x);
        const leftX = cur.x + perp.x * halfW;
        const leftZ = cur.y + perp.y * halfW;
        const rightX = cur.x - perp.x * halfW;
        const rightZ = cur.y - perp.y * halfW;

        const leftY = this.terrain.getHeight(leftX, leftZ) + 0.22;
        const rightY = this.terrain.getHeight(rightX, rightZ) + 0.22;

        vertices.push(leftX, leftY, leftZ);
        vertices.push(rightX, rightY, rightZ);

        if (i < pts.length - 1) {
          const b = i * 2;
          indices.push(b, b + 1, b + 2);
          indices.push(b + 1, b + 3, b + 2);
        }
      }

      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      const roadMesh = new THREE.Mesh(geom, asphaltMat);
      roadMesh.receiveShadow = true;
      this.roadMeshGroup.add(roadMesh);

      // Center dashed lane divider
      for (let i = 0; i < pts.length - 1; i += 2) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const midX = (p1.x + p2.x) * 0.5;
        const midZ = (p1.y + p2.y) * 0.5;
        const midY = this.terrain.getHeight(midX, midZ) + 0.28;

        const lineGeom = new THREE.BoxGeometry(0.35, 0.05, 4.5);
        const line = new THREE.Mesh(lineGeom, markingMat);
        line.position.set(midX, midY, midZ);
        const heading = Math.atan2(p2.x - p1.x, p2.y - p1.y);
        line.rotation.y = heading;
        this.roadMeshGroup.add(line);
      }
    });
  }

  // Load real Cadmapper Dehradun vector road polylines
  loadCadmapperRoads() {
    fetch('/models/cadmapper_roads.json')
      .then(res => res.json())
      .then(roadsData => {
        const minorMat = new THREE.MeshStandardMaterial({
          color: 0x2b303a,
          roughness: 0.75,
          metalness: 0.1
        });

        roadsData.forEach(r => {
          const pts = r.points;
          if (pts.length < 2) return;
          const roadWidth = r.layer === 'major_roads' ? 10 : 6.5;
          const halfW = roadWidth * 0.5;

          const geom = new THREE.BufferGeometry();
          const vertices = [];
          const indices = [];

          for (let i = 0; i < pts.length; i++) {
            const cur = pts[i];
            let dir = new THREE.Vector2(0, 1);
            if (i < pts.length - 1) {
              dir.set(pts[i + 1].x - cur.x, pts[i + 1].z - cur.z).normalize();
            } else if (i > 0) {
              dir.set(cur.x - pts[i - 1].x, cur.z - pts[i - 1].z).normalize();
            }

            const perp = new THREE.Vector2(-dir.y, dir.x);
            const leftX = cur.x + perp.x * halfW;
            const leftZ = cur.z + perp.y * halfW;
            const rightX = cur.x - perp.x * halfW;
            const rightZ = cur.z - perp.y * halfW;

            const leftY = this.terrain.getHeight(leftX, leftZ) + 0.16;
            const rightY = this.terrain.getHeight(rightX, rightZ) + 0.16;

            vertices.push(leftX, leftY, leftZ);
            vertices.push(rightX, rightY, rightZ);

            if (i < pts.length - 1) {
              const b = i * 2;
              indices.push(b, b + 1, b + 2);
              indices.push(b + 1, b + 3, b + 2);
            }
          }

          geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
          geom.setIndex(indices);
          geom.computeVertexNormals();

          const mesh = new THREE.Mesh(geom, minorMat);
          mesh.receiveShadow = true;
          this.cadmapperRoadsGroup.add(mesh);
        });
        console.log(`Loaded ${roadsData.length} real Cadmapper Dehradun road segments!`);
      })
      .catch(err => console.warn('Could not load Cadmapper roads:', err));
  }

  // Load Real 3D Commercial Buildings from low_poly_business_buildings_pack.glb
  loadCommercialBuildingsPack() {
    this.loader.load(
      '/models/low_poly_business_buildings_pack.glb',
      (gltf) => {
        const root = gltf.scene;

        // Extract individual building models
        const buildingTypes = [];
        root.traverse((child) => {
          if (child.isMesh && child.name && !child.name.includes('Collider')) {
            child.castShadow = true;
            child.receiveShadow = true;
            buildingTypes.push(child);
          }
        });

        if (buildingTypes.length === 0) {
          // If meshes were nested under parent groups
          root.children.forEach(c => {
            if (!c.name.includes('Collider')) buildingTypes.push(c);
          });
        }

        // Distribute real commercial buildings along Rajpur Road, Chakrata Road, and Paltan Bazaar
        const mainRoads = this.roads.filter(r => r.main);
        let placedCount = 0;

        mainRoads.forEach((road) => {
          const pts = road.points;
          const step = 3; // Space buildings along the boulevard

          for (let i = 2; i < pts.length - 2; i += step) {
            const cur = pts[i];
            let dir = new THREE.Vector2(0, 1);
            if (i < pts.length - 1) dir.subVectors(pts[i + 1], cur).normalize();
            const perp = new THREE.Vector2(-dir.y, dir.x);

            // Place buildings on both left and right sides of the avenue
            [-1, 1].forEach((side) => {
              const setback = road.width * 0.5 + 8.5 + (Math.random() * 4);
              const bX = cur.x + perp.x * setback * side;
              const bZ = cur.y + perp.y * setback * side;

              // Avoid placing inside Clock Tower plaza
              if (Math.abs(bX) < 26 && Math.abs(bZ) < 26) return;

              const bY = this.terrain.getHeight(bX, bZ);

              // Pick a random building from the real pack
              const template = buildingTypes[Math.floor(Math.random() * buildingTypes.length)];
              if (!template) return;

              const buildingClone = template.clone(true);

              // Scale to realistic commercial building proportions (~14m height)
              const box = new THREE.Box3().setFromObject(buildingClone);
              const size = box.getSize(new THREE.Vector3());
              const targetHeight = 12 + Math.random() * 6;
              const scale = targetHeight / (size.y || 1);
              buildingClone.scale.setScalar(scale);

              buildingClone.position.set(bX, bY, bZ);

              // Face the avenue
              const roadAngle = Math.atan2(dir.x, dir.y);
              buildingClone.rotation.y = roadAngle + (side === 1 ? -Math.PI / 2 : Math.PI / 2);

              this.buildingsGroup.add(buildingClone);
              placedCount++;
            });
          }
        });

        console.log(`Placed ${placedCount} real commercial buildings along Dehradun avenues!`);
      },
      undefined,
      (err) => {
        console.warn('Could not load commercial buildings pack:', err);
      }
    );
  }

  // Load Real Traffic 3D Vehicle Models (Police Patrol Cruiser, Ice Cream Van, Old Classic Car)
  loadRealTrafficVehicles() {
    const trafficFiles = [
      { url: '/models/police_car_low_poly.glb', name: 'Police Patrol', scaleTarget: 4.4 },
      { url: '/models/ice_cream_car.glb', name: 'Ice Cream Van', scaleTarget: 4.6 },
      { url: '/models/old_car.glb', name: 'Classic Car', scaleTarget: 4.5 }
    ];

    let loadedCount = 0;
    const modelTemplates = [];

    trafficFiles.forEach((info) => {
      this.loader.load(
        info.url,
        (gltf) => {
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const scale = info.scaleTarget / (size.z || size.x || 1);
          model.scale.setScalar(scale);
          model.position.x = -center.x * scale;
          model.position.y = -box.min.y * scale;
          model.position.z = -center.z * scale;

          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          const wrapper = new THREE.Group();
          wrapper.add(model);
          modelTemplates.push(wrapper);
          loadedCount++;

          if (loadedCount === trafficFiles.length) {
            this.spawnRealTrafficFleet(modelTemplates);
          }
        },
        undefined,
        (err) => {
          console.warn(`Could not load ${info.name}:`, err);
          loadedCount++;
          if (loadedCount === trafficFiles.length && modelTemplates.length > 0) {
            this.spawnRealTrafficFleet(modelTemplates);
          }
        }
      );
    });

    // Fallback initial fleet while GLB models stream
    this.spawnInitialFleet();
  }

  spawnInitialFleet() {
    const carGeom = new THREE.BoxGeometry(2.1, 1.1, 4.2);
    const carMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3 });
    this.headlightMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    this.taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (let i = 0; i < 40; i++) {
      const road = this.roads[Math.floor(Math.random() * this.roads.length)];
      const group = new THREE.Group();
      const body = new THREE.Mesh(carGeom, carMat);
      body.position.y = 0.6;
      group.add(body);

      this.trafficGroup.add(group);
      this.vehicles.push({
        group: group,
        road: road,
        progress: Math.random(),
        speed: 0.0007 + Math.random() * 0.0006,
        direction: Math.random() > 0.5 ? 1 : -1,
        laneOffset: (Math.random() > 0.5 ? 1 : -1) * (road.width * 0.22)
      });
    }
  }

  spawnRealTrafficFleet(templates) {
    // Clear initial fleet and spawn real 3D cars
    while (this.trafficGroup.children.length > 0) {
      this.trafficGroup.remove(this.trafficGroup.children[0]);
    }
    this.vehicles = [];

    const totalCars = 60;
    for (let i = 0; i < totalCars; i++) {
      const road = this.roads[Math.floor(Math.random() * this.roads.length)];
      const template = templates[Math.floor(Math.random() * templates.length)];
      const vehicleMesh = template.clone(true);

      // Add functional headlights
      const hlLeft = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), this.headlightMat);
      hlLeft.position.set(-0.7, 0.7, -2.2);
      vehicleMesh.add(hlLeft);

      const hlRight = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), this.headlightMat);
      hlRight.position.set(0.7, 0.7, -2.2);
      vehicleMesh.add(hlRight);

      // Add taillights
      const tlLeft = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), this.taillightMat);
      tlLeft.position.set(-0.7, 0.7, 2.2);
      vehicleMesh.add(tlLeft);

      const tlRight = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), this.taillightMat);
      tlRight.position.set(0.7, 0.7, 2.2);
      vehicleMesh.add(tlRight);

      this.trafficGroup.add(vehicleMesh);

      this.vehicles.push({
        group: vehicleMesh,
        road: road,
        progress: Math.random(),
        speed: 0.00065 + Math.random() * 0.0007,
        direction: Math.random() > 0.5 ? 1 : -1,
        laneOffset: (Math.random() > 0.5 ? 1 : -1) * (road.width * 0.22)
      });
    }
    console.log(`Spawned ${totalCars} real 3D vehicles (Police cars, Ice cream vans, Classic cars) in Dehradun traffic!`);
  }

  buildStreetlights() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    this.lampMat = lampGlowMat;
    this.nightMaterials.push(lampGlowMat);

    const poleGeom = new THREE.CylinderGeometry(0.12, 0.15, 6, 6);
    const bulbGeom = new THREE.SphereGeometry(0.4, 8, 8);

    const mainRoads = this.roads.filter(r => r.main);

    mainRoads.forEach(road => {
      const pts = road.points;
      const step = 4;

      for (let i = 0; i < pts.length; i += step) {
        const cur = pts[i];
        const halfW = road.width * 0.5 + 1.2;

        let dir = new THREE.Vector2(0, 1);
        if (i < pts.length - 1) dir.subVectors(pts[i + 1], cur).normalize();
        const perp = new THREE.Vector2(-dir.y, dir.x);

        [-1, 1].forEach(side => {
          const lX = cur.x + perp.x * halfW * side;
          const lZ = cur.y + perp.y * halfW * side;
          const lY = this.terrain.getHeight(lX, lZ);

          const pole = new THREE.Mesh(poleGeom, poleMat);
          pole.position.set(lX, lY + 3, lZ);
          this.streetlightsGroup.add(pole);

          const bulb = new THREE.Mesh(bulbGeom, lampGlowMat);
          bulb.position.set(lX, lY + 6.1, lZ);
          this.streetlightsGroup.add(bulb);
        });
      }
    });
  }

  buildRealisticTrees() {
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x163821, roughness: 0.8 });
    const broadMat = new THREE.MeshStandardMaterial({ color: 0x24592a, roughness: 0.85 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x422a1d, roughness: 0.9 });

    const pineTier1 = new THREE.ConeGeometry(2.4, 5, 7);
    const pineTier2 = new THREE.ConeGeometry(1.8, 4, 7);
    const pineTier3 = new THREE.ConeGeometry(1.2, 3, 7);
    const broadGeom = new THREE.DodecahedronGeometry(3.2, 1);
    const trunkGeom = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);

    const count = 450;

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 2200;
      const z = (Math.random() - 0.5) * 2200;
      const y = this.terrain.getHeight(x, z);

      const isNorthHills = z < -150;
      const isFRI = Math.sqrt((x + 440)**2 + (z - 90)**2) < 140;

      if (!isNorthHills && !isFRI && Math.random() > 0.25) {
        continue;
      }

      const treeGroup = new THREE.Group();
      treeGroup.position.set(x, y, z);

      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 1.75;
      treeGroup.add(trunk);

      if (isNorthHills) {
        const t1 = new THREE.Mesh(pineTier1, pineMat);
        t1.position.y = 4.8;
        t1.castShadow = true;
        treeGroup.add(t1);

        const t2 = new THREE.Mesh(pineTier2, pineMat);
        t2.position.y = 7.2;
        t2.castShadow = true;
        treeGroup.add(t2);

        const t3 = new THREE.Mesh(pineTier3, pineMat);
        t3.position.y = 9.2;
        treeGroup.add(t3);
      } else {
        const foliage = new THREE.Mesh(broadGeom, broadMat);
        foliage.position.y = 5.2;
        foliage.castShadow = true;
        treeGroup.add(foliage);
      }

      const scale = 0.8 + Math.random() * 0.6;
      treeGroup.scale.set(scale, scale, scale);
      this.treesGroup.add(treeGroup);
    }
  }

  update(delta) {
    this.vehicles.forEach(v => {
      v.progress += v.speed * v.direction;
      if (v.progress > 1.0) v.progress = 0.0;
      if (v.progress < 0.0) v.progress = 1.0;

      const pts = v.road.points;
      const totalSegs = pts.length - 1;
      const fIdx = v.progress * totalSegs;
      const idx = Math.min(Math.floor(fIdx), totalSegs - 1);
      const frac = fIdx - idx;

      const p0 = pts[idx];
      const p1 = pts[idx + 1];

      const x = p0.x + (p1.x - p0.x) * frac;
      const z = p0.y + (p1.y - p0.y) * frac;

      const dx = p1.x - p0.x;
      const dz = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const perpX = -dz / len;
      const perpZ = dx / len;

      const finalX = x + perpX * v.laneOffset;
      const finalZ = z + perpZ * v.laneOffset;
      const finalY = this.terrain.getHeight(finalX, finalZ);

      v.group.position.set(finalX, finalY, finalZ);
      const heading = Math.atan2(dx * v.direction, dz * v.direction);
      v.group.rotation.y = heading;
    });
  }

  setTrafficVisible(visible) {
    this.trafficGroup.visible = visible;
  }

  setStreetlightsVisible(visible) {
    this.streetlightsGroup.visible = visible;
  }

  updateNightLighting(isNightFactor) {
    if (this.lampMat) {
      this.lampMat.color.set(isNightFactor > 0.3 ? 0xfef08a : 0x64748b);
    }
    if (this.headlightMat) {
      this.headlightMat.color.set(isNightFactor > 0.3 ? 0xffedd5 : 0x71717a);
    }
    if (this.taillightMat) {
      this.taillightMat.color.set(isNightFactor > 0.3 ? 0xef4444 : 0x7f1d1d);
    }
  }
}
