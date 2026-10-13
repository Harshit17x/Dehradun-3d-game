import * as THREE from 'three';
import { TerrainManager } from './terrain.js';
import { LandmarkManager } from './landmarks.js';
import { CityManager } from './city.js';
import { PlayerController } from './player.js';
import { MinimapManager } from './minimap.js';
import { sound } from './audio.js';

// Keep credentials out of source. The legacy explorer reads the same private
// Vite environment variable as the geographic driving scene.
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Dehradun 3D Interactive Map & Valley Explorer Main Application
class DehradunApp {
  constructor() {
    this.container = document.getElementById('app');
    this.timeOfDay = 0.5; // Start at bright noon
    this.clockSeconds = 12 * 3600; // Simulated clock time (12:00 PM)

    this.initScene();
    this.initLighting();
    this.initManagers();
    this.updateAtmosphere(); // Safe to update atmosphere now that all managers exist
    this.initUI();
    this.initRaycasting();
    this.animate = this.animate.bind(this);

    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame(this.animate);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x94a3b8, 0.00085);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.5,
      5000
    );
    this.camera.position.set(0, 120, 180);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);
  }

  initLighting() {
    // Ambient light
    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.7);
    this.scene.add(this.hemiLight);

    // Directional Sun / Moon
    this.sunLight = new THREE.DirectionalLight(0xffedd5, 1.8);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 1200;
    const shadowD = 350;
    this.sunLight.shadow.camera.left = -shadowD;
    this.sunLight.shadow.camera.right = shadowD;
    this.sunLight.shadow.camera.top = shadowD;
    this.sunLight.shadow.camera.bottom = -shadowD;
    this.sunLight.shadow.bias = -0.0004;

    this.scene.add(this.sunLight);

    // Starfield for night sky
    const starGeom = new THREE.BufferGeometry();
    const starCount = 1800;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      starPos[i] = (Math.random() - 0.5) * 3600;
      starPos[i + 1] = 200 + Math.random() * 1200;
      starPos[i + 2] = (Math.random() - 0.5) * 3600;
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
      transparent: true,
      opacity: 0.0
    });
    this.stars = new THREE.Points(starGeom, this.starMat);
    this.scene.add(this.stars);
  }

  initManagers() {
    this.terrain = new TerrainManager(this.scene);
    this.landmarks = new LandmarkManager(this.scene, this.terrain);
    this.city = new CityManager(this.scene, this.terrain);
    this.player = new PlayerController(this.camera, this.scene, this.terrain);

    const minimapCanvas = document.getElementById('minimap-canvas');
    if (minimapCanvas) {
      this.minimap = new MinimapManager(minimapCanvas, this.player, this.landmarks, this.city);
    }
  }

  updateAtmosphere() {
    // TimeOfDay: 0 = Midnight, 0.25 = Dawn, 0.5 = Noon, 0.75 = Sunset
    const t = this.timeOfDay;
    const sunAngle = (t - 0.25) * Math.PI * 2;

    const sunX = Math.sin(sunAngle) * 600;
    const sunY = Math.sin((t - 0.25) * Math.PI) * 750;
    const sunZ = Math.cos(sunAngle) * 450;

    this.sunLight.position.set(sunX, Math.max(sunY, -200), sunZ);
    this.sunLight.target.position.set(0, 30, 0);

    const isNight = t < 0.2 || t > 0.8;
    const isSunset = (t > 0.68 && t <= 0.8) || (t >= 0.2 && t < 0.32);

    let skyColor, fogColor, sunColor, sunIntensity, hemiIntensity;

    if (t >= 0.32 && t <= 0.68) {
      // Clear Day in Doon Valley
      skyColor = new THREE.Color(0x7dd3fc);
      fogColor = new THREE.Color(0xbae6fd);
      sunColor = new THREE.Color(0xffedd5);
      sunIntensity = 1.9;
      hemiIntensity = 0.85;
      this.starMat.opacity = 0.0;
      if (this.city) this.city.updateNightLighting(0);
    } else if (isSunset) {
      // Golden Hour over Shivaliks / Himalayan Dusk
      skyColor = new THREE.Color(0xfb923c);
      fogColor = new THREE.Color(0xf472b6);
      sunColor = new THREE.Color(0xf97316);
      sunIntensity = 1.4;
      hemiIntensity = 0.6;
      this.starMat.opacity = 0.2;
      if (this.city) this.city.updateNightLighting(0.5);
    } else {
      // Starry Valley Night
      skyColor = new THREE.Color(0x050814);
      fogColor = new THREE.Color(0x090d1a);
      sunColor = new THREE.Color(0x38bdf8); // Moonlight
      sunIntensity = 0.35;
      hemiIntensity = 0.25;
      this.starMat.opacity = 0.85;
      if (this.city) this.city.updateNightLighting(1.0);
    }

    this.scene.background = skyColor;
    this.scene.fog.color = fogColor;
    this.sunLight.color = sunColor;
    this.sunLight.intensity = sunIntensity;
    this.hemiLight.intensity = hemiIntensity;
  }

  initRaycasting() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    window.addEventListener('click', (e) => {
      // Ignore if clicking UI elements
      if (e.target.closest('#hud-overlay') && !e.target.closest('#compass-bar')) return;

      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.landmarks.beaconGroup.children, true);

      if (intersects.length > 0) {
        // Find top-level beacon with userData
        let obj = intersects[0].object;
        while (obj && !obj.userData?.landmark && obj.parent) {
          obj = obj.parent;
        }
        if (obj && obj.userData?.landmark) {
          this.selectLandmark(obj.userData.landmark);
        }
      }
    });
  }

  selectLandmark(landmark) {
    this.player.focusOnLandmark(landmark);
    this.showLandmarkCard(landmark);
    sound.playClick();
    if (landmark.id === 'ghantaghar') {
      sound.playChime();
    }
  }

  showLandmarkCard(l) {
    const card = document.getElementById('landmark-card');
    if (!card) return;

    card.classList.remove('hidden');
    document.getElementById('lm-title').textContent = l.name;
    document.getElementById('lm-hindi').textContent = l.hindiName;
    document.getElementById('lm-category').textContent = l.category;
    document.getElementById('lm-altitude').textContent = l.altitude;
    document.getElementById('lm-year').textContent = l.year;
    document.getElementById('lm-desc').textContent = l.desc;

    // Load Live Google Street View Photo
    const svImg = document.getElementById('lm-streetview-img');
    const gLink = document.getElementById('lm-google-maps-link');
    if (svImg && l.lat && l.lng) {
      svImg.src = `https://maps.googleapis.com/maps/api/streetview?size=500x260&location=${l.lat},${l.lng}&fov=85&heading=${l.heading || 0}&pitch=5&key=${GOOGLE_API_KEY}`;
    }
    if (gLink && l.lat && l.lng) {
      gLink.href = `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
    }

    const highlightsList = document.getElementById('lm-highlights');
    highlightsList.innerHTML = '';
    l.highlights.forEach(h => {
      const li = document.createElement('li');
      li.textContent = h;
      highlightsList.appendChild(li);
    });
  }

  initUI() {
    // 1. Populate Landmark Select dropdown
    const select = document.getElementById('landmark-select');
    if (select) {
      this.landmarks.landmarks.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = `${l.name} (${l.hindiName})`;
        select.appendChild(opt);
      });

      select.addEventListener('change', (e) => {
        const id = e.target.value;
        const target = this.landmarks.landmarks.find(l => l.id === id);
        if (target) {
          this.selectLandmark(target);
        }
      });
    }

    // Google Places Search
    const searchInput = document.getElementById('google-search-input');
    const searchBtn = document.getElementById('google-search-btn');

    const handleGoogleSearch = () => {
      const query = (searchInput.value || '').trim();
      if (!query) return;

      searchBtn.textContent = '...';
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query + ', Dehradun, Uttarakhand')}&key=${GOOGLE_API_KEY}`;

      fetch(url)
        .then(res => res.json())
        .then(data => {
          searchBtn.textContent = 'Go';
          if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const lat = result.geometry.location.lat;
            const lng = result.geometry.location.lng;

            // Map GPS to 3D scene units centered at Ghanta Ghar
            const sZ = -(lat - 30.3244) * 11100;
            const sX = (lng - 78.0416) * 9600;
            const sY = this.terrain.getHeight(sX, sZ);

            const searchLandmark = {
              id: 'search_' + Date.now(),
              name: result.formatted_address.split(',')[0] || query,
              hindiName: 'खोजा गया स्थान',
              pos: new THREE.Vector3(sX, sY + 25, sZ),
              groundPos: new THREE.Vector3(sX, sY, sZ),
              lat: lat,
              lng: lng,
              heading: 0,
              category: 'Google Search Result',
              year: 'Live GPS',
              altitude: Math.round(sY + 640) + 'm',
              desc: `Real location in Dehradun found via Google Maps: ${result.formatted_address}.`,
              highlights: [
                `Latitude: ${lat.toFixed(5)}° N`,
                `Longitude: ${lng.toFixed(5)}° E`,
                `Accurate GPS Pinpoint`
              ]
            };

            this.selectLandmark(searchLandmark);
          } else {
            alert('Location not found in Dehradun. Try another landmark or street!');
          }
        })
        .catch(err => {
          searchBtn.textContent = 'Go';
          console.error('Google search error:', err);
        });
    };

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', handleGoogleSearch);
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleGoogleSearch();
      });
    }

    // 2. Mode Switches (Drone / Rover / Orbit)
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        this.player.setMode(mode);
        sound.playClick();
        this.updateControlHelp(mode);
      });
    });

    // 3. Time of Day Presets & Live Slider
    const timeSlider = document.getElementById('time-slider');
    if (timeSlider) {
      timeSlider.addEventListener('input', (e) => {
        this.timeOfDay = parseFloat(e.target.value);
        this.updateAtmosphere();
      });
    }

    const timePresetBtns = document.querySelectorAll('.time-preset');
    timePresetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        timePresetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const timeVal = parseFloat(btn.dataset.time);
        this.timeOfDay = timeVal;
        if (timeSlider) timeSlider.value = timeVal;
        this.updateAtmosphere();
        sound.playClick();
      });
    });

    // 4. Layer Toggles (Traffic, Buildings, Contours, Beacons)
    const toggleTraffic = document.getElementById('toggle-traffic');
    if (toggleTraffic) {
      toggleTraffic.addEventListener('change', (e) => {
        this.city.setTrafficVisible(e.target.checked);
      });
    }

    const toggleContours = document.getElementById('toggle-contours');
    if (toggleContours) {
      toggleContours.addEventListener('change', (e) => {
        this.terrain.setContoursVisible(e.target.checked);
      });
    }

    const toggleBeacons = document.getElementById('toggle-beacons');
    if (toggleBeacons) {
      toggleBeacons.addEventListener('change', (e) => {
        this.landmarks.setBeaconsVisible(e.target.checked);
      });
    }

    // 5. Audio Toggle
    const audioBtn = document.getElementById('audio-btn');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const isMuted = !sound.toggle();
        audioBtn.classList.toggle('active', !isMuted);
        audioBtn.innerHTML = isMuted
          ? '<span>🔇</span> Audio Off'
          : '<span>🔊</span> Sound Active';
      });
    }

    // 6. Close Landmark Card
    const closeCardBtn = document.getElementById('close-card-btn');
    if (closeCardBtn) {
      closeCardBtn.addEventListener('click', () => {
        document.getElementById('landmark-card').classList.add('hidden');
      });
    }

    // 7. Chime button on card
    const chimeBtn = document.getElementById('chime-btn');
    if (chimeBtn) {
      chimeBtn.addEventListener('click', () => {
        sound.init();
        sound.playChime();
      });
    }

    // Initial default landmark: Ghanta Ghar
    this.showLandmarkCard(this.landmarks.landmarks[0]);
  }

  updateControlHelp(mode) {
    const helpContainer = document.getElementById('controls-help');
    if (!helpContainer) return;

    if (mode === 'drone') {
      helpContainer.innerHTML = `
        <div class="key-pill"><span>W</span><span>S</span> Fly Pitch</div>
        <div class="key-pill"><span>A</span><span>D</span> Roll / Turn</div>
        <div class="key-pill"><span>Space</span> Climb Alt</div>
        <div class="key-pill"><span>C</span> Descend</div>
        <div class="key-pill"><span>Shift</span> Turbo 95 km/h</div>
      `;
    } else if (mode === 'rover') {
      helpContainer.innerHTML = `
        <div class="key-pill"><span>W</span><span>S</span> Drive BMW M4</div>
        <div class="key-pill"><span>A</span><span>D</span> Steer Left / Right</div>
        <div class="key-pill"><span>Shift</span> Turbo 85 km/h</div>
        <div class="key-pill"><span>Mouse Drag</span> Look Camera</div>
      `;
    } else {
      helpContainer.innerHTML = `
        <div class="key-pill"><span>Left Click Drag</span> Orbit View</div>
        <div class="key-pill"><span>Scroll Wheel</span> Zoom</div>
        <div class="key-pill"><span>Click Pin</span> Focus Landmark</div>
      `;
    }
  }

  updateHUD() {
    const tel = this.player.getTelemetry();
    const latEl = document.getElementById('hud-lat');
    const lonEl = document.getElementById('hud-lon');
    const altEl = document.getElementById('hud-alt');
    const spdEl = document.getElementById('hud-speed');
    const hdgEl = document.getElementById('hud-heading');

    if (latEl) latEl.textContent = tel.lat;
    if (lonEl) lonEl.textContent = tel.lon;
    if (altEl) altEl.textContent = tel.alt;
    if (spdEl) spdEl.textContent = tel.speed + ' km/h';
    if (hdgEl) hdgEl.textContent = tel.heading + '°';

    // Compass Tape Indicator
    const compassTape = document.getElementById('compass-tape');
    if (compassTape) {
      compassTape.style.transform = `translateX(-${(tel.heading / 360) * 100}%)`;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    const timeSec = now * 0.001;
    const delta = Math.min(0.05, 0.016); // Smooth timestep cap

    this.clockSeconds += delta * 12; // Advance simulated time
    this.landmarks.update(timeSec, this.clockSeconds);
    this.city.update(delta);
    this.player.update(delta, timeSec);

    if (this.minimap) {
      this.minimap.update();
    }

    this.updateHUD();
    this.renderer.render(this.scene, this.camera);
  }
}

// Start application safely whether DOM is loading or already parsed
function startApp() {
  try {
    new DehradunApp();
  } catch (err) {
    console.error('Failed to initialize Dehradun 3D App:', err);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
