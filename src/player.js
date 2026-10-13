import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sound } from './audio.js';

// Controller for Player: 6-DOF Drone, 2024 BMW M4 Coupe Competition, and Orbit Map Mode
export class PlayerController {
  constructor(camera, scene, terrain) {
    this.camera = camera;
    this.scene = scene;
    this.terrain = terrain;

    this.mode = 'drone'; // 'drone' | 'rover' | 'orbit'

    // Input States
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      boost: false,
      turnLeft: false,
      turnRight: false
    };

    // Drone State
    this.dronePos = new THREE.Vector3(0, 58, 48); // Start looking towards Ghanta Ghar
    this.droneVel = new THREE.Vector3();
    this.droneYaw = 0; // Face north towards Ghanta Ghar (0, 0)
    this.dronePitch = 0;
    this.droneRoll = 0;
    this.droneMesh = null;
    this.droneRotors = [];

    // Rover / 2024 BMW M4 State
    this.roverPos = new THREE.Vector3(0, 32, 28);
    this.roverVel = new THREE.Vector3();
    this.roverHeading = 0; // Face north towards Ghanta Ghar (0, 0)
    this.roverSpeed = 0;
    this.roverMesh = null;
    this.bmwModel = null;
    this.roverHeadlights = [];

    // Orbit State
    this.orbitTarget = new THREE.Vector3(0, 32, 0); // Focus on Ghanta Ghar
    this.orbitRadius = 140;
    this.orbitTheta = Math.PI * 0.25;
    this.orbitPhi = Math.PI * 0.3;
    this.isDragging = false;
    this.prevMousePos = { x: 0, y: 0 };

    this.initMeshes();
    this.initListeners();
  }

  initMeshes() {
    // 1. Build Drone 3D Model
    this.droneMesh = new THREE.Group();

    // Central chassis
    const bodyGeom = new THREE.BoxGeometry(2.4, 0.6, 2.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.8
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    this.droneMesh.add(body);

    // Camera gimbal dome
    const camGeom = new THREE.SphereGeometry(0.5, 12, 12);
    const camMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.1, metalness: 0.9 });
    const cam = new THREE.Mesh(camGeom, camMat);
    cam.position.set(0, -0.3, -1.2);
    this.droneMesh.add(cam);

    // 4 Quadcopter Arms
    const armGeom = new THREE.BoxGeometry(0.2, 0.2, 2.6);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });

    const arm1 = new THREE.Mesh(armGeom, armMat);
    arm1.rotation.y = Math.PI / 4;
    this.droneMesh.add(arm1);

    const arm2 = new THREE.Mesh(armGeom, armMat);
    arm2.rotation.y = -Math.PI / 4;
    this.droneMesh.add(arm2);

    // 4 Rotors
    const rotorGeom = new THREE.BoxGeometry(1.6, 0.05, 0.15);
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    const armOffsets = [
      { x: -1.2, z: -1.2 },
      { x: 1.2, z: -1.2 },
      { x: -1.2, z: 1.2 },
      { x: 1.2, z: 1.2 }
    ];

    armOffsets.forEach(offset => {
      const motorGeom = new THREE.CylinderGeometry(0.25, 0.25, 0.4, 8);
      const motor = new THREE.Mesh(motorGeom, bodyMat);
      motor.position.set(offset.x, 0.25, offset.z);
      this.droneMesh.add(motor);

      const rotor = new THREE.Mesh(rotorGeom, rotorMat);
      rotor.position.set(offset.x, 0.5, offset.z);
      this.droneMesh.add(rotor);
      this.droneRotors.push(rotor);
    });

    // Navigation LEDs
    const ledGreen = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x10b981 }));
    ledGreen.position.set(0, 0.1, -1.4);
    this.droneMesh.add(ledGreen);

    const ledRed = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    ledRed.position.set(0, 0.1, 1.4);
    this.droneMesh.add(ledRed);

    this.scene.add(this.droneMesh);

    // 2. Build Driveable Vehicle Group & Load 2024 BMW M4 Coupe Competition GLB
    this.roverMesh = new THREE.Group();

    // Sleek interim sports car chassis while BMW model streams
    const interimGeom = new THREE.BoxGeometry(2.1, 0.85, 4.6);
    const interimMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb, // BMW Isle of Man Blue
      roughness: 0.2,
      metalness: 0.8
    });
    this.placeholderMesh = new THREE.Mesh(interimGeom, interimMat);
    this.placeholderMesh.position.y = 0.65;
    this.placeholderMesh.castShadow = true;
    this.roverMesh.add(this.placeholderMesh);

    // Twin High-Intensity LED Headlights
    const spotL = new THREE.SpotLight(0xffedd5, 3.8, 95, Math.PI / 5, 0.28);
    spotL.position.set(-0.8, 0.9, -2.4);
    spotL.target.position.set(-0.8, 0, -30);
    this.roverMesh.add(spotL);
    this.roverMesh.add(spotL.target);

    const spotR = new THREE.SpotLight(0xffedd5, 3.8, 95, Math.PI / 5, 0.28);
    spotR.position.set(0.8, 0.9, -2.4);
    spotR.target.position.set(0.8, 0, -30);
    this.roverMesh.add(spotR);
    this.roverMesh.add(spotR.target);

    this.roverHeadlights.push(spotL, spotR);

    // Rear Taillights
    const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    tailL.position.set(-0.8, 0.9, 2.32);
    this.roverMesh.add(tailL);

    const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    tailR.position.set(0.8, 0.9, 2.32);
    this.roverMesh.add(tailR);

    this.scene.add(this.roverMesh);

    // Load Real 2024 BMW M4 Coupe Competition Model
    const loader = new GLTFLoader();
    loader.load(
      '/models/2024_bmw_m4_coupe_competition.glb',
      (gltf) => {
        const bmw = gltf.scene;

        // Calculate bounding box and scale to exact real-world dimensions (4.8m length)
        const box = new THREE.Box3().setFromObject(bmw);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const targetLen = 4.75;
        const scale = targetLen / (size.z || 1);
        bmw.scale.setScalar(scale);

        // Center on origin with wheels resting on terrain
        bmw.position.x = -center.x * scale;
        bmw.position.y = -box.min.y * scale;
        bmw.position.z = -center.z * scale;

        // Enable shadows and enhance glossiness
        bmw.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Swap out placeholder with real BMW M4
        if (this.placeholderMesh) {
          this.roverMesh.remove(this.placeholderMesh);
        }
        this.roverMesh.add(bmw);
        this.bmwModel = bmw;
        console.log('2024 BMW M4 Coupe Competition integrated successfully!');
      },
      undefined,
      (err) => {
        console.warn('Could not load BMW M4 GLB:', err);
      }
    );

    this.updateVisibility();
  }

  updateVisibility() {
    if (this.droneMesh) this.droneMesh.visible = this.mode === 'drone';
    if (this.roverMesh) this.roverMesh.visible = this.mode === 'rover';
  }

  setMode(mode) {
    this.mode = mode;
    this.updateVisibility();

    if (mode === 'rover') {
      this.roverPos.x = this.dronePos.x;
      this.roverPos.z = this.dronePos.z;
      this.roverPos.y = this.terrain.getHeight(this.roverPos.x, this.roverPos.z);
      this.roverHeading = this.droneYaw;
      this.roverSpeed = 0;
    } else if (mode === 'drone') {
      this.dronePos.x = this.roverPos.x;
      this.dronePos.z = this.roverPos.z;
      this.dronePos.y = Math.max(this.dronePos.y, this.terrain.getHeight(this.dronePos.x, this.dronePos.z) + 20);
      this.droneVel.set(0, 0, 0);
    } else if (mode === 'orbit') {
      const curPos = this.mode === 'rover' ? this.roverPos : this.dronePos;
      this.orbitTarget.copy(curPos);
      this.orbitRadius = 150;
    }
  }

  initListeners() {
    window.addEventListener('keydown', (e) => {
      sound.init();
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.keys.forward = true;
      if (code === 'KeyS' || code === 'ArrowDown') this.keys.backward = true;
      if (code === 'KeyA' || code === 'ArrowLeft') this.keys.left = true;
      if (code === 'KeyD' || code === 'ArrowRight') this.keys.right = true;
      if (code === 'Space') { this.keys.up = true; e.preventDefault(); }
      if (code === 'KeyC' || code === 'ControlLeft' || code === 'KeyE') this.keys.down = true;
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.boost = true;
      if (code === 'KeyQ') this.keys.turnLeft = true;
      if (code === 'KeyE') this.keys.turnRight = true;
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.keys.forward = false;
      if (code === 'KeyS' || code === 'ArrowDown') this.keys.backward = false;
      if (code === 'KeyA' || code === 'ArrowLeft') this.keys.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') this.keys.right = false;
      if (code === 'Space') this.keys.up = false;
      if (code === 'KeyC' || code === 'ControlLeft' || code === 'KeyE') this.keys.down = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.boost = false;
      if (code === 'KeyQ') this.keys.turnLeft = false;
      if (code === 'KeyE') this.keys.turnRight = false;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.target.tagName !== 'CANVAS') return;
      this.isDragging = true;
      this.prevMousePos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.prevMousePos.x;
      const dy = e.clientY - this.prevMousePos.y;
      this.prevMousePos = { x: e.clientX, y: e.clientY };

      if (this.mode === 'drone') {
        this.droneYaw -= dx * 0.004;
        this.dronePitch = Math.max(-0.6, Math.min(0.6, this.dronePitch - dy * 0.003));
      } else if (this.mode === 'rover') {
        this.roverHeading -= dx * 0.004;
      } else if (this.mode === 'orbit') {
        this.orbitTheta -= dx * 0.005;
        this.orbitPhi = Math.max(0.1, Math.min(Math.PI * 0.45, this.orbitPhi - dy * 0.005));
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('wheel', (e) => {
      if (this.mode === 'orbit') {
        this.orbitRadius = Math.max(30, Math.min(600, this.orbitRadius + e.deltaY * 0.25));
      } else if (this.mode === 'drone') {
        this.dronePos.y = Math.max(
          this.terrain.getHeight(this.dronePos.x, this.dronePos.z) + 6,
          this.dronePos.y - e.deltaY * 0.1
        );
      }
    }, { passive: true });
  }

  update(delta, time) {
    if (this.mode === 'drone') {
      this.updateDrone(delta, time);
    } else if (this.mode === 'rover') {
      this.updateRover(delta, time);
    } else if (this.mode === 'orbit') {
      this.updateOrbit(delta);
    }
  }

  updateDrone(delta, time) {
    const moveSpeed = this.keys.boost ? 95 : 42;
    const accel = 60;
    const drag = 3.2;

    if (this.keys.turnLeft || this.keys.left) this.droneYaw += 2.0 * delta;
    if (this.keys.turnRight || this.keys.right) this.droneYaw -= 2.0 * delta;

    const forwardVec = new THREE.Vector3(-Math.sin(this.droneYaw), 0, -Math.cos(this.droneYaw));
    const rightVec = new THREE.Vector3(Math.cos(this.droneYaw), 0, -Math.sin(this.droneYaw));

    let inputVec = new THREE.Vector3();
    if (this.keys.forward) inputVec.add(forwardVec);
    if (this.keys.backward) inputVec.sub(forwardVec);
    if (this.keys.left && !this.keys.turnLeft) inputVec.sub(rightVec);
    if (this.keys.right && !this.keys.turnRight) inputVec.add(rightVec);

    if (inputVec.lengthSq() > 0) {
      inputVec.normalize();
      this.droneVel.addScaledVector(inputVec, accel * delta);
    }

    if (this.keys.up) this.droneVel.y += accel * 0.8 * delta;
    if (this.keys.down) this.droneVel.y -= accel * 0.8 * delta;

    this.droneVel.x -= this.droneVel.x * drag * delta;
    this.droneVel.z -= this.droneVel.z * drag * delta;
    this.droneVel.y -= this.droneVel.y * (drag * 0.8) * delta;

    const horizSpeed = Math.sqrt(this.droneVel.x ** 2 + this.droneVel.z ** 2);
    if (horizSpeed > moveSpeed) {
      this.droneVel.x = (this.droneVel.x / horizSpeed) * moveSpeed;
      this.droneVel.z = (this.droneVel.z / horizSpeed) * moveSpeed;
    }

    this.dronePos.addScaledVector(this.droneVel, delta);

    const terrainY = this.terrain.getHeight(this.dronePos.x, this.dronePos.z);
    const minAlt = terrainY + 7;
    if (this.dronePos.y < minAlt) {
      this.dronePos.y = minAlt;
      this.droneVel.y = Math.max(0, this.droneVel.y);
    }

    const targetRoll = (this.keys.left ? 0.35 : 0) - (this.keys.right ? 0.35 : 0);
    const targetPitch = (this.keys.forward ? -0.3 : 0) + (this.keys.backward ? 0.25 : 0);
    this.droneRoll += (targetRoll - this.droneRoll) * 8 * delta;

    this.droneMesh.position.copy(this.dronePos);
    this.droneMesh.rotation.set(targetPitch, this.droneYaw, this.droneRoll);

    const rotorSpeed = 45 + horizSpeed * 2;
    this.droneRotors.forEach((r, idx) => {
      r.rotation.y += rotorSpeed * delta * (idx % 2 === 0 ? 1 : -1);
    });

    const camOffset = new THREE.Vector3(0, 4.5, 14);
    camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.droneYaw);
    const targetCamPos = this.dronePos.clone().add(camOffset);

    this.camera.position.lerp(targetCamPos, 0.14);
    const lookAtTarget = this.dronePos.clone().add(new THREE.Vector3(0, 1, 0));
    this.camera.lookAt(lookAtTarget);

    const speedKmh = Math.round(horizSpeed * 3.6);
    sound.updateVehicleSound('drone', speedKmh, this.keys.forward || this.keys.up);
  }

  updateRover(delta, time) {
    const maxSpeed = this.keys.boost ? 52 : 30;
    const accelRate = this.keys.boost ? 28 : 22;
    const brakeRate = 35;
    const turnRate = 2.8;

    if (this.keys.forward) {
      this.roverSpeed = Math.min(maxSpeed, this.roverSpeed + accelRate * delta);
    } else if (this.keys.backward) {
      this.roverSpeed = Math.max(-14, this.roverSpeed - brakeRate * delta);
    } else {
      this.roverSpeed *= Math.max(0, 1 - 2.8 * delta);
    }

    // Speed-sensitive steering with low-speed maneuverability
    const speedMagnitude = Math.abs(this.roverSpeed);
    const steerFactor = 1 / (1 + speedMagnitude / 26);
    const dirSign = this.roverSpeed >= 0 ? 1 : -1;

    if (this.keys.left) {
      const maneuverSpeed = Math.max(speedMagnitude, 2.5);
      this.roverHeading += turnRate * dirSign * steerFactor * (maneuverSpeed / Math.max(speedMagnitude, 1)) * delta;
    }
    if (this.keys.right) {
      const maneuverSpeed = Math.max(speedMagnitude, 2.5);
      this.roverHeading -= turnRate * dirSign * steerFactor * (maneuverSpeed / Math.max(speedMagnitude, 1)) * delta;
    }

    const moveDist = this.roverSpeed * delta;
    this.roverPos.x -= Math.sin(this.roverHeading) * moveDist;
    this.roverPos.z -= Math.cos(this.roverHeading) * moveDist;

    // Damped suspension spring smoothing to eliminate terrain elevation jitter
    const targetY = this.terrain.getHeight(this.roverPos.x, this.roverPos.z) + 0.12;
    this.roverPos.y = THREE.MathUtils.lerp(this.roverPos.y, targetY, Math.min(1, 14 * delta));

    const normal = this.terrain.getNormal(this.roverPos.x, this.roverPos.z);
    const forward = new THREE.Vector3(-Math.sin(this.roverHeading), 0, -Math.cos(this.roverHeading));
    const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(normal, right).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward.negate());
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    this.roverMesh.quaternion.slerp(targetQuat, Math.min(1, 12 * delta));
    this.roverMesh.position.copy(this.roverPos);

    // Dynamic chase camera following BMW M4 with speed-dependent look-ahead
    const behindDist = 10.2 + speedMagnitude * 0.06;
    const heightOffset = 3.8 + speedMagnitude * 0.02;
    const camOffset = new THREE.Vector3(0, heightOffset, behindDist);
    camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.roverHeading);
    const targetCamPos = this.roverPos.clone().add(camOffset);

    this.camera.position.lerp(targetCamPos, Math.min(1, 9 * delta));
    const lookAtTarget = this.roverPos.clone()
      .add(new THREE.Vector3(0, 1.35, 0))
      .sub(forward.clone().multiplyScalar(3.5));
    this.camera.lookAt(lookAtTarget);

    const speedKmh = Math.abs(Math.round(this.roverSpeed * 3.6));
    sound.updateVehicleSound('rover', speedKmh, Boolean(this.keys.forward || this.keys.backward));
  }

  updateOrbit(delta) {
    const x = this.orbitTarget.x + this.orbitRadius * Math.sin(this.orbitPhi) * Math.sin(this.orbitTheta);
    const y = this.orbitTarget.y + this.orbitRadius * Math.cos(this.orbitPhi);
    const z = this.orbitTarget.z + this.orbitRadius * Math.sin(this.orbitPhi) * Math.cos(this.orbitTheta);

    this.camera.position.lerp(new THREE.Vector3(x, y, z), 0.12);
    this.camera.lookAt(this.orbitTarget);

    sound.updateVehicleSound('orbit', 0, false);
  }

  focusOnLandmark(landmark) {
    if (this.mode === 'orbit') {
      this.orbitTarget.copy(landmark.groundPos).add(new THREE.Vector3(0, 10, 0));
      this.orbitRadius = 120;
    } else if (this.mode === 'drone') {
      this.dronePos.copy(landmark.groundPos).add(new THREE.Vector3(0, 42, 55));
      this.droneYaw = 0;
      this.droneVel.set(0, 0, 0);
    } else if (this.mode === 'rover') {
      this.roverPos.copy(landmark.groundPos).add(new THREE.Vector3(0, 0, 24));
      this.roverPos.y = this.terrain.getHeight(this.roverPos.x, this.roverPos.z);
      this.roverHeading = 0;
      this.roverSpeed = 0;
    }
  }

  getCurrentPosition() {
    if (this.mode === 'rover') return this.roverPos;
    if (this.mode === 'drone') return this.dronePos;
    return this.orbitTarget;
  }

  getTelemetry() {
    const pos = this.getCurrentPosition();
    const lat = 30.3165 - (pos.z * 0.00009);
    const lon = 78.0322 + (pos.x * 0.00009);
    const altMeters = Math.round(640 + pos.y * 1.8);

    let speedKmh = 0;
    let headingDeg = 0;

    if (this.mode === 'drone') {
      speedKmh = Math.round(Math.sqrt(this.droneVel.x ** 2 + this.droneVel.z ** 2) * 3.6);
      headingDeg = Math.round(((this.droneYaw * 180) / Math.PI) % 360);
    } else if (this.mode === 'rover') {
      speedKmh = Math.abs(Math.round(this.roverSpeed * 3.6));
      headingDeg = Math.round(((this.roverHeading * 180) / Math.PI) % 360);
    } else {
      headingDeg = Math.round(((this.orbitTheta * 180) / Math.PI) % 360);
    }

    if (headingDeg < 0) headingDeg += 360;

    return {
      lat: lat.toFixed(4) + '° N',
      lon: lon.toFixed(4) + '° E',
      alt: altMeters + ' m',
      speed: speedKmh,
      heading: headingDeg,
      mode: this.mode
    };
  }
}
