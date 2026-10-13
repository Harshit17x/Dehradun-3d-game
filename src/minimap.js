// 2D Top-Down Holographic Radar & Minimap of Dehradun
export class MinimapManager {
  constructor(canvas, player, landmarks, city) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.player = player;
    this.landmarks = landmarks;
    this.city = city;
    this.mapWorldSize = 2200; // Visible extent in world units

    this.initEvents();
  }

  initEvents() {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert canvas pixels to world coordinates
      const normX = (clickX / this.canvas.width) * 2 - 1;
      const normY = (clickY / this.canvas.height) * 2 - 1;

      const worldX = normX * (this.mapWorldSize * 0.5);
      const worldZ = normY * (this.mapWorldSize * 0.5);

      // Check if clicked near a landmark
      const clickedLandmark = this.landmarks.landmarks.find(l => {
        const d = Math.sqrt((l.pos.x - worldX)**2 + (l.pos.z - worldZ)**2);
        return d < 80;
      });

      if (clickedLandmark) {
        this.player.focusOnLandmark(clickedLandmark);
      } else {
        // Move current vehicle/orbit target
        const pos = this.player.getCurrentPosition();
        pos.x = worldX;
        pos.z = worldZ;
      }
    });
  }

  worldToCanvas(x, z) {
    const half = this.mapWorldSize * 0.5;
    const cX = ((x + half) / this.mapWorldSize) * this.canvas.width;
    const cY = ((z + half) / this.mapWorldSize) * this.canvas.height;
    return { x: cX, y: cY };
  }

  update() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear with dark slate backdrop
    ctx.fillStyle = 'rgba(10, 15, 29, 0.9)';
    ctx.fillRect(0, 0, w, h);

    // 1. Draw subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    const gridStep = w / 6;
    for (let x = 0; x <= w; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 2. Draw Mussoorie Mountain Ridge Haze at the Top (North)
    const gradNorth = ctx.createLinearGradient(0, 0, 0, h * 0.35);
    gradNorth.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
    gradNorth.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    ctx.fillStyle = gradNorth;
    ctx.fillRect(0, 0, w, h * 0.35);

    // 3. Draw Road Network Arteries
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)'; // Amber artery line
    ctx.lineWidth = 2.5;

    this.city.roads.forEach(road => {
      ctx.beginPath();
      road.points.forEach((pt, idx) => {
        const cPt = this.worldToCanvas(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(cPt.x, cPt.y);
        else ctx.lineTo(cPt.x, cPt.y);
      });
      ctx.stroke();
    });

    // 4. Draw River Corridors (Rispana & Bindal)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 2;
    // Rispana
    ctx.beginPath();
    for (let z = -900; z <= 900; z += 40) {
      const rx = 130 + Math.sin(z * 0.008) * 45;
      const cPt = this.worldToCanvas(rx, z);
      if (z === -900) ctx.moveTo(cPt.x, cPt.y);
      else ctx.lineTo(cPt.x, cPt.y);
    }
    ctx.stroke();

    // 5. Draw Landmark Icons
    this.landmarks.landmarks.forEach(l => {
      const cPt = this.worldToCanvas(l.pos.x, l.pos.z);

      // Outer radar pulse
      ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
      ctx.beginPath();
      ctx.arc(cPt.x, cPt.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.fillStyle = l.id === 'ghantaghar' ? '#f59e0b' : '#10b981';
      ctx.beginPath();
      ctx.arc(cPt.x, cPt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.font = '9px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(l.name.split(' ')[0], cPt.x + 5, cPt.y - 4);
    });

    // 6. Draw Player Marker & View Cone
    const playerPos = this.player.getCurrentPosition();
    const pC = this.worldToCanvas(playerPos.x, playerPos.z);
    const telemetry = this.player.getTelemetry();
    const headingRad = (telemetry.heading * Math.PI) / 180;

    // View direction cone
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.beginPath();
    ctx.moveTo(pC.x, pC.y);
    const coneAngle = 0.45;
    const coneLen = 22;
    ctx.arc(pC.x, pC.y, coneLen, headingRad - Math.PI / 2 - coneAngle, headingRad - Math.PI / 2 + coneAngle);
    ctx.closePath();
    ctx.fill();

    // Player position dot
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(pC.x, pC.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 7. Compass North Indicator
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('N', w * 0.5 - 4, 14);
  }
}
