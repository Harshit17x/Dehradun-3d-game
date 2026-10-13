import * as THREE from 'three';

// High-detail 3D Landmarks of Dehradun
export class LandmarkManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.landmarks = [];
    this.interactivePins = [];
    this.clockFaces = [];
    this.beaconGroup = new THREE.Group();
    this.scene.add(this.beaconGroup);
    this.init();
  }

  init() {
    this.createClockTower();
    this.createFRI();
    this.createRobbersCave();
    this.createTapkeshwarTemple();
    this.createSahastradhara();
    this.createMussoorieOverlook();
    this.createPacificMall();
    this.createLandmarkBeacons();
  }

  // 1. GHANTA GHAR (CLOCK TOWER) - Heart of Dehradun
  createClockTower() {
    const x = 0;
    const z = 0;
    const baseY = this.terrain.getHeight(x, z);
    const towerGroup = new THREE.Group();
    towerGroup.position.set(x, baseY, z);

    // Roundabout Plaza
    const plazaGeom = new THREE.CylinderGeometry(28, 29, 0.8, 32);
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0x224229, roughness: 0.9 });
    const plaza = new THREE.Mesh(plazaGeom, plazaMat);
    plaza.position.y = 0.4;
    plaza.receiveShadow = true;
    towerGroup.add(plaza);

    // Circular stone curb
    const curbGeom = new THREE.TorusGeometry(28.5, 0.5, 8, 36);
    curbGeom.rotateX(Math.PI / 2);
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.8 });
    const curb = new THREE.Mesh(curbGeom, curbMat);
    curb.position.y = 0.6;
    towerGroup.add(curb);

    // Base Tier (Hexagonal Stone Plinth)
    const baseGeom = new THREE.CylinderGeometry(5.2, 5.8, 4.5, 6);
    const brickMat = new THREE.MeshStandardMaterial({
      color: 0x943d2c, // Red brick
      roughness: 0.75,
      metalness: 0.05
    });
    const baseMesh = new THREE.Mesh(baseGeom, brickMat);
    baseMesh.position.y = 2.65;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    towerGroup.add(baseMesh);

    // Main Hexagonal Shaft
    const shaftGeom = new THREE.CylinderGeometry(3.8, 4.8, 24, 6);
    const shaftMesh = new THREE.Mesh(shaftGeom, brickMat);
    shaftMesh.position.y = 16.9;
    shaftMesh.castShadow = true;
    towerGroup.add(shaftMesh);

    // Decorative White Cornices and quoins
    const corniceMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.6 });
    for (let cY of [4.8, 14, 25, 29]) {
      const corniceGeom = new THREE.CylinderGeometry(4.2, 4.4, 0.7, 6);
      const cornice = new THREE.Mesh(corniceGeom, corniceMat);
      cornice.position.y = cY;
      towerGroup.add(cornice);
    }

    // Clock Chamber (Hexagonal)
    const clockChamberGeom = new THREE.CylinderGeometry(4.2, 4.2, 5.5, 6);
    const clockChamber = new THREE.Mesh(clockChamberGeom, brickMat);
    clockChamber.position.y = 29.5;
    towerGroup.add(clockChamber);

    // 6 Functional Glowing Clock Faces
    const clockMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      emissive: 0xfef08a,
      emissiveIntensity: 0.6,
      roughness: 0.3
    });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4 });

    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const radius = 3.75;
      const fX = Math.sin(angle) * radius;
      const fZ = Math.cos(angle) * radius;

      const clockFace = new THREE.Group();
      clockFace.position.set(fX, 29.5, fZ);
      clockFace.rotation.y = angle;

      // Clock dial
      const dialGeom = new THREE.CircleGeometry(1.4, 24);
      const dial = new THREE.Mesh(dialGeom, clockMat);
      clockFace.add(dial);

      // Rim
      const rimGeom = new THREE.RingGeometry(1.35, 1.55, 24);
      const rim = new THREE.Mesh(rimGeom, rimMat);
      rim.position.z = 0.02;
      clockFace.add(rim);

      // Hands
      const handGeom = new THREE.BoxGeometry(0.08, 0.9, 0.04);
      const handMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
      const hourHand = new THREE.Mesh(handGeom, handMat);
      hourHand.position.set(0, 0.35, 0.04);
      clockFace.add(hourHand);

      const minHandGeom = new THREE.BoxGeometry(0.06, 1.2, 0.04);
      const minHand = new THREE.Mesh(minHandGeom, handMat);
      minHand.position.set(0, 0.45, 0.05);
      minHand.rotation.z = Math.PI / 4;
      clockFace.add(minHand);

      towerGroup.add(clockFace);
      this.clockFaces.push({ hour: hourHand, minute: minHand });
    }

    // Bell / Dome Pavilion & Golden Spire
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Golden bronze
      metalness: 0.85,
      roughness: 0.25
    });

    const domeGeom = new THREE.SphereGeometry(3.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeom, domeMat);
    dome.position.y = 32.2;
    towerGroup.add(dome);

    // Spire Needle
    const spireGeom = new THREE.CylinderGeometry(0.1, 0.6, 8, 8);
    const spire = new THREE.Mesh(spireGeom, domeMat);
    spire.position.y = 38.5;
    towerGroup.add(spire);

    // Night Illuminator Light on the Tower
    const towerLight = new THREE.PointLight(0xffedd5, 1.5, 45);
    towerLight.position.set(0, 29.5, 0);
    towerGroup.add(towerLight);

    this.scene.add(towerGroup);

    this.landmarks.push({
      id: 'ghantaghar',
      name: 'Clock Tower (Ghanta Ghar)',
      hindiName: 'घंटा घर',
      pos: new THREE.Vector3(x, baseY + 36, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      lat: 30.3243,
      lng: 78.0416,
      heading: 45,
      category: 'Historic Monument',
      year: '1953',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'The iconic beating heart of Dehradun! This magnificent six-faced hexagonal red-brick tower connects Rajpur Road, Paltan Bazaar, and Chakrata Road, chiming across the valley since 1953.',
      highlights: ['Six functioning clock dials', 'Hexagonal colonial architecture', 'Historic commercial crossroads']
    });
  }

  // 2. FOREST RESEARCH INSTITUTE (FRI)
  createFRI() {
    const x = -440;
    const z = 90;
    const baseY = this.terrain.getHeight(x, z);
    const friGroup = new THREE.Group();
    friGroup.position.set(x, baseY, z);

    // Sprawling Main Building (Greco-Roman Colonial Architecture)
    const brickMat = new THREE.MeshStandardMaterial({
      color: 0xa84835, // Deep terracotta red brick
      roughness: 0.7,
      metalness: 0.05
    });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.6 });
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x059669, metalness: 0.6, roughness: 0.3 }); // Patina copper

    // Central Portico Building
    const centerGeom = new THREE.BoxGeometry(45, 18, 30);
    const centerBuilding = new THREE.Mesh(centerGeom, brickMat);
    centerBuilding.position.y = 9;
    centerBuilding.castShadow = true;
    friGroup.add(centerBuilding);

    // Classical Columns along front facade
    for (let cX = -18; cX <= 18; cX += 7.2) {
      const colGeom = new THREE.CylinderGeometry(0.7, 0.8, 16, 12);
      const col = new THREE.Mesh(colGeom, stoneMat);
      col.position.set(cX, 8, 16);
      friGroup.add(col);
    }

    // Pediment roof over columns
    const pedimentGeom = new THREE.ConeGeometry(22, 5, 4);
    pedimentGeom.rotateY(Math.PI / 4);
    const pediment = new THREE.Mesh(pedimentGeom, stoneMat);
    pediment.position.set(0, 18.5, 14);
    friGroup.add(pediment);

    // Central Grand Dome
    const domeGeom = new THREE.SphereGeometry(9, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeom, domeMat);
    dome.position.set(0, 18, 0);
    friGroup.add(dome);

    // Long Symmetrical East & West Wings (Colonnades)
    const wingGeom = new THREE.BoxGeometry(65, 12, 22);
    const leftWing = new THREE.Mesh(wingGeom, brickMat);
    leftWing.position.set(-52, 6, 0);
    leftWing.castShadow = true;
    friGroup.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeom, brickMat);
    rightWing.position.set(52, 6, 0);
    rightWing.castShadow = true;
    friGroup.add(rightWing);

    // Green Forestry Campus Lawns & Palm Trees
    const lawnGeom = new THREE.BoxGeometry(190, 0.4, 90);
    const lawnMat = new THREE.MeshStandardMaterial({ color: 0x1f4728, roughness: 0.95 });
    const lawn = new THREE.Mesh(lawnGeom, lawnMat);
    lawn.position.set(0, 0.2, 45);
    lawn.receiveShadow = true;
    friGroup.add(lawn);

    this.scene.add(friGroup);

    this.landmarks.push({
      id: 'fri',
      name: 'Forest Research Institute (FRI)',
      hindiName: 'वन अनुसंधान संस्थान',
      pos: new THREE.Vector3(x, baseY + 26, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      lat: 30.3438,
      lng: 77.9978,
      heading: 90,
      category: 'National Heritage',
      year: '1906',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'One of the oldest and largest forestry institutes in the world, spanning 450 hectares. Renowned for its magnificent Greco-Roman colonial brick architecture, lush botanical gardens, and Indira Gandhi National Forest Academy.',
      highlights: ['Greco-Roman architecture', 'Largest brick structure in Asia', 'Sprawling botanical lawns']
    });
  }

  // 3. ROBBER'S CAVE (GUCHHUPANI)
  createRobbersCave() {
    const x = -90;
    const z = -380;
    const baseY = this.terrain.getHeight(x, z);
    const caveGroup = new THREE.Group();
    caveGroup.position.set(x, baseY, z);

    // Towering limestone rock walls & gorge canyon
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x5a5347,
      roughness: 0.95,
      metalness: 0.05
    });

    const leftCliffGeom = new THREE.BoxGeometry(22, 28, 70);
    const leftCliff = new THREE.Mesh(leftCliffGeom, rockMat);
    leftCliff.position.set(-16, 14, 0);
    leftCliff.rotation.y = 0.08;
    leftCliff.castShadow = true;
    caveGroup.add(leftCliff);

    const rightCliffGeom = new THREE.BoxGeometry(24, 26, 70);
    const rightCliff = new THREE.Mesh(rightCliffGeom, rockMat);
    rightCliff.position.set(17, 13, 0);
    rightCliff.rotation.y = -0.06;
    rightCliff.castShadow = true;
    caveGroup.add(rightCliff);

    // Flowing cave water stream
    const waterGeom = new THREE.PlaneGeometry(12, 68);
    waterGeom.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.8
    });
    const water = new THREE.Mesh(waterGeom, waterMat);
    water.position.y = 0.3;
    caveGroup.add(water);

    // Wooden pedestrian walking boardwalk
    const boardGeom = new THREE.BoxGeometry(2.5, 0.4, 60);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x78563c, roughness: 0.9 });
    const board = new THREE.Mesh(boardGeom, boardMat);
    board.position.set(-3.5, 0.5, 0);
    caveGroup.add(board);

    this.scene.add(caveGroup);

    this.landmarks.push({
      id: 'robberscave',
      name: "Robber's Cave (Guchhupani)",
      hindiName: 'गुच्छूपानी',
      pos: new THREE.Vector3(x, baseY + 24, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      lat: 30.3773,
      lng: 78.0583,
      heading: 180,
      category: 'Natural Wonder',
      year: 'Natural Formation',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'A 600m natural limestone gorge formed in the northern Doon valley. Cold spring water gushes through the narrow canyon where visitors wade ankle-deep. Historically used as a hideout by robbers during British rule.',
      highlights: ['Limestone cavern gorge', 'Underground disappearing river', 'Refreshing mountain creek']
    });
  }

  // 4. TAPKESHWAR MAHADEV TEMPLE
  createTapkeshwarTemple() {
    const x = -280;
    const z = -140;
    const baseY = this.terrain.getHeight(x, z);
    const templeGroup = new THREE.Group();
    templeGroup.position.set(x, baseY, z);

    // Rock cave envelope
    const caveRockGeom = new THREE.ConeGeometry(25, 22, 7);
    const caveRockMat = new THREE.MeshStandardMaterial({ color: 0x47423a, roughness: 0.95 });
    const caveRock = new THREE.Mesh(caveRockGeom, caveRockMat);
    caveRock.position.set(0, 11, -8);
    caveRock.castShadow = true;
    templeGroup.add(caveRock);

    // Temple Shikhara (Traditional Tower Spire)
    const shikharaGeom = new THREE.ConeGeometry(5, 14, 8);
    const templeMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.4 });
    const shikhara = new THREE.Mesh(shikharaGeom, templeMat);
    shikhara.position.set(0, 13, 0);
    templeGroup.add(shikhara);

    // Sanctum Mandapa
    const mandapaGeom = new THREE.BoxGeometry(12, 7, 12);
    const mandapaMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 }); // Sacred saffron
    const mandapa = new THREE.Mesh(mandapaGeom, mandapaMat);
    mandapa.position.set(0, 3.5, 0);
    templeGroup.add(mandapa);

    // Sacred saffron flags
    const flagPoleGeom = new THREE.CylinderGeometry(0.1, 0.1, 5);
    const pole = new THREE.Mesh(flagPoleGeom, new THREE.MeshBasicMaterial({ color: 0xd1d5db }));
    pole.position.set(0, 21, 0);
    templeGroup.add(pole);

    const flagGeom = new THREE.ConeGeometry(1.2, 2.5, 3);
    flagGeom.rotateZ(Math.PI / 2);
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    const flag = new THREE.Mesh(flagGeom, flagMat);
    flag.position.set(1.2, 22, 0);
    templeGroup.add(flag);

    this.scene.add(templeGroup);

    this.landmarks.push({
      id: 'tapkeshwar',
      name: 'Tapkeshwar Mahadev Temple',
      hindiName: 'टपकेश्वर महादेव',
      pos: new THREE.Vector3(x, baseY + 22, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      lat: 30.3547,
      lng: 78.0163,
      heading: 270,
      category: 'Sacred Pilgrimage',
      year: 'Ancient',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'One of the most revered Lord Shiva shrines in Uttarakhand, situated on the bank of the Tons river. Water naturally drips continuously from the ceiling of the natural limestone cave upon the holy Shivalinga.',
      highlights: ['Natural cave dripping water', 'Lord Shiva lingam sanctum', 'Tons river bank serene setting']
    });
  }

  // 5. SAHASTRADHARA (THOUSAND SPRINGS)
  createSahastradhara() {
    const x = 440;
    const z = -340;
    const baseY = this.terrain.getHeight(x, z);
    const springsGroup = new THREE.Group();
    springsGroup.position.set(x, baseY, z);

    // Terraced travertine sulfur cliffs
    const terraceMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.85 });
    const sulfurWaterMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4, // Cyan mineral sulfur water
      roughness: 0.1,
      metalness: 0.7,
      transparent: true,
      opacity: 0.85
    });

    for (let t = 0; t < 4; t++) {
      const stepGeom = new THREE.CylinderGeometry(18 - t * 3, 20 - t * 3, 3, 14);
      const step = new THREE.Mesh(stepGeom, terraceMat);
      step.position.set(0, t * 2.8 + 1.5, t * 2);
      springsGroup.add(step);

      // Turquoise sulfur water pool on each step
      const poolGeom = new THREE.CircleGeometry(16 - t * 3, 16);
      poolGeom.rotateX(-Math.PI / 2);
      const pool = new THREE.Mesh(poolGeom, sulfurWaterMat);
      pool.position.set(0, t * 2.8 + 3.02, t * 2);
      springsGroup.add(pool);
    }

    // Ropeway cable tower representation
    const towerGeom = new THREE.CylinderGeometry(0.4, 0.8, 22, 6);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.7 });
    const cableTower = new THREE.Mesh(towerGeom, towerMat);
    cableTower.position.set(-15, 12, 0);
    springsGroup.add(cableTower);

    this.scene.add(springsGroup);

    this.landmarks.push({
      id: 'sahastradhara',
      name: 'Sahastradhara (Thousand Springs)',
      hindiName: 'सहस्त्रधारा',
      pos: new THREE.Vector3(x, baseY + 20, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      lat: 30.3846,
      lng: 78.1278,
      heading: 120,
      category: 'Natural Spring & Spa',
      year: 'Natural Spring',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'Famous for its therapeutic sulfur water springs that cascade over limestone terraces. The water has medicinal properties for skin and wellness, framed against the dramatic eastern hills of Doon.',
      highlights: ['Sulphur mineral water pools', 'Limestone dripping caves', 'Ropeway mountain viewpoint']
    });
  }

  // 6. MUSSOORIE RIDGE OVERLOOK (FOOTHILLS VIEWPOINT)
  createMussoorieOverlook() {
    const x = 60;
    const z = -680;
    const baseY = this.terrain.getHeight(x, z);
    const overlookGroup = new THREE.Group();
    overlookGroup.position.set(x, baseY, z);

    // Stone Gazebo / Pavilion overlooking the entire Doon Valley
    const deckGeom = new THREE.CylinderGeometry(14, 15, 1.5, 20);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
    const deck = new THREE.Mesh(deckGeom, deckMat);
    deck.position.y = 0.75;
    deck.receiveShadow = true;
    overlookGroup.add(deck);

    // Perimeter Railing
    const railGeom = new THREE.TorusGeometry(13.8, 0.3, 6, 32);
    railGeom.rotateX(Math.PI / 2);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const rail = new THREE.Mesh(railGeom, railMat);
    rail.position.y = 2.1;
    overlookGroup.add(rail);

    // Mountain Gazebo Pavilion
    const roofGeom = new THREE.ConeGeometry(7, 3.5, 8);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x047857, roughness: 0.4 });
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.y = 8.5;
    overlookGroup.add(roof);

    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const pGeom = new THREE.CylinderGeometry(0.25, 0.25, 6);
      const pillar = new THREE.Mesh(pGeom, railMat);
      pillar.position.set(Math.sin(a) * 5.2, 4.5, Math.cos(a) * 5.2);
      overlookGroup.add(pillar);
    }

    // High Viewpoint Beacon Spotlight
    const beaconLight = new THREE.PointLight(0x38bdf8, 2, 70);
    beaconLight.position.set(0, 9, 0);
    overlookGroup.add(beaconLight);

    this.scene.add(overlookGroup);

    this.landmarks.push({
      id: 'mussoorie_view',
      name: 'Mussoorie Foothills Overlook',
      hindiName: 'मसूरी रिज व्यू पॉइंट',
      pos: new THREE.Vector3(x, baseY + 20, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      lat: 30.4012,
      lng: 78.0834,
      heading: 200,
      category: 'Scenic Panorama',
      year: 'Historic Gateway',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'The gateway road ascending up to Queen of Hills - Mussoorie! Offers a breathtaking panoramic vista of the entire glittering Doon Valley floor, Rispana river line, and the distant Shivalik ridge.',
      highlights: ['Bird’s eye vista of Dehradun', 'Cool Himalayan mountain breeze', 'Night city lights panorama']
    });
  }

  // 7. PACIFIC MALL & RAJPUR ROAD COMMERCIAL HUB
  createPacificMall() {
    const x = 50;
    const z = -200;
    const baseY = this.terrain.getHeight(x, z);
    const mallGroup = new THREE.Group();
    mallGroup.position.set(x, baseY, z);

    // Multi-tiered Modern Glass & Steel Architecture
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.1,
      metalness: 0.9
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });

    const baseGeom = new THREE.BoxGeometry(42, 14, 32);
    const baseMesh = new THREE.Mesh(baseGeom, glassMat);
    baseMesh.position.y = 7;
    baseMesh.castShadow = true;
    mallGroup.add(baseMesh);

    const topGeom = new THREE.BoxGeometry(32, 10, 24);
    const topMesh = new THREE.Mesh(topGeom, frameMat);
    topMesh.position.y = 19;
    mallGroup.add(topMesh);

    // Glowing Atrium / Billboard Sign
    const signGeom = new THREE.BoxGeometry(18, 4, 1);
    const signMat = new THREE.MeshStandardMaterial({
      color: 0xec4899,
      emissive: 0xdb2777,
      emissiveIntensity: 0.9
    });
    const sign = new THREE.Mesh(signGeom, signMat);
    sign.position.set(0, 16, 16.5);
    mallGroup.add(sign);

    this.scene.add(mallGroup);

    this.landmarks.push({
      id: 'pacificmall',
      name: 'Pacific Mall (Rajpur Road)',
      hindiName: 'पैसिफिक मॉल',
      pos: new THREE.Vector3(x, baseY + 28, z),
      groundPos: new THREE.Vector3(x, baseY, z),
      category: 'Shopping & Urban Hub',
      year: '2013',
      altitude: Math.round(baseY + 640) + 'm',
      desc: 'Dehradun’s premier modern retail and entertainment destination located on the bustling Rajpur Road boulevard, home to flagship stores, cinema, and dining.',
      highlights: ['Rajpur Road lifestyle center', 'Modern glass facade', 'Urban youth gathering hub']
    });
  }

  // 3D Animated Floating Holographic Beacons for each Landmark
  createLandmarkBeacons() {
    this.landmarks.forEach((l) => {
      const beacon = new THREE.Group();
      beacon.position.copy(l.pos);
      beacon.userData = { landmark: l };

      // Pulsing outer ring
      const ringGeom = new THREE.RingGeometry(3.5, 4.5, 32);
      ringGeom.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      beacon.add(ring);

      // Glowing Diamond / Gem
      const gemGeom = new THREE.OctahedronGeometry(2.2, 0);
      const gemMat = new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x059669,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.8
      });
      const gem = new THREE.Mesh(gemGeom, gemMat);
      gem.position.y = 1.5;
      beacon.add(gem);

      // Vertical guide beam downward to ground
      const heightAboveGround = l.pos.y - l.groundPos.y;
      const beamGeom = new THREE.CylinderGeometry(0.12, 0.12, heightAboveGround, 8);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.45
      });
      const beam = new THREE.Mesh(beamGeom, beamMat);
      beam.position.y = -heightAboveGround * 0.5;
      beacon.add(beam);

      this.beaconGroup.add(beacon);
      this.interactivePins.push({ group: beacon, ring, gem, landmark: l });
    });
  }

  update(time, clockTimeSec) {
    // 1. Rotate clock hands on Ghanta Ghar
    if (this.clockFaces.length > 0) {
      const minutes = (clockTimeSec / 60) % 60;
      const hours = (clockTimeSec / 3600) % 12;
      const mAngle = -(minutes / 60) * Math.PI * 2;
      const hAngle = -(hours / 12) * Math.PI * 2;
      this.clockFaces.forEach(f => {
        f.minute.rotation.z = mAngle;
        f.hour.rotation.z = hAngle;
      });
    }

    // 2. Animate landmark beacon diamonds and pulsing rings
    this.interactivePins.forEach((pin, idx) => {
      pin.gem.rotation.y = time * 1.5 + idx;
      pin.gem.position.y = 1.5 + Math.sin(time * 2.5 + idx) * 0.6;
      const scale = 1 + Math.sin(time * 3 + idx) * 0.2;
      pin.ring.scale.set(scale, scale, 1);
    });
  }

  setBeaconsVisible(visible) {
    this.beaconGroup.visible = visible;
  }
}
