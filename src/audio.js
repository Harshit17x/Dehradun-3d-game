// Audio Synthesizer for 3D Dehradun Explorer using Web Audio API
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.droneOsc = null;
    this.droneGain = null;
    this.roverOsc = null;
    this.roverGain = null;
    this.windGain = null;
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.setupWindAmbience();
    this.setupDroneEngine();
    this.setupRoverEngine();
  }

  toggle() {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.enabled = !this.enabled;
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(this.enabled ? 0.08 : 0, this.ctx.currentTime, 0.1);
    }
    if (!this.enabled) {
      if (this.droneGain) this.droneGain.gain.setValueAtTime(0, this.ctx.currentTime);
      if (this.roverGain) this.roverGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    return this.enabled;
  }

  setupWindAmbience() {
    // Generate pink-noise filtered mountain wind
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2) * 0.08;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;

    whiteNoise.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.ctx.destination);
    whiteNoise.start(0);
  }

  setupDroneEngine() {
    // Twin oscillator hover hum
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.value = 110;
    osc2.frequency.value = 220;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 450;

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(this.droneGain);
    this.droneGain.connect(this.ctx.destination);

    osc1.start(0);
    osc2.start(0);
    this.droneOsc1 = osc1;
    this.droneOsc2 = osc2;
  }

  setupRoverEngine() {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 180;

    this.roverGain = this.ctx.createGain();
    this.roverGain.gain.value = 0;

    osc.connect(filter);
    filter.connect(this.roverGain);
    this.roverGain.connect(this.ctx.destination);

    osc.start(0);
    this.roverOsc = osc;
    this.roverFilter = filter;
  }

  updateVehicleSound(mode, speed, throttle) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (mode === 'drone') {
      if (this.roverGain) this.roverGain.gain.setTargetAtTime(0, now, 0.1);
      const targetGain = 0.05 + Math.min(speed / 80, 0.09) + (throttle ? 0.04 : 0);
      const targetFreq = 110 + (speed * 1.5) + (throttle ? 35 : 0);
      this.droneGain.gain.setTargetAtTime(targetGain, now, 0.08);
      this.droneOsc1.frequency.setTargetAtTime(targetFreq, now, 0.08);
      this.droneOsc2.frequency.setTargetAtTime(targetFreq * 2, now, 0.08);
    } else if (mode === 'rover') {
      if (this.droneGain) this.droneGain.gain.setTargetAtTime(0, now, 0.1);
      const targetGain = 0.04 + Math.min(speed / 60, 0.08) + (throttle ? 0.05 : 0);
      const targetFreq = 45 + (speed * 2.2);
      this.roverGain.gain.setTargetAtTime(targetGain, now, 0.08);
      this.roverOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);
      this.roverFilter.frequency.setTargetAtTime(140 + speed * 4, now, 0.08);
    } else {
      if (this.droneGain) this.droneGain.gain.setTargetAtTime(0, now, 0.1);
      if (this.roverGain) this.roverGain.gain.setTargetAtTime(0, now, 0.1);
    }
  }

  playChime() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Clock tower bell harmonic series
    const freqs = [440, 880, 1320, 1760];
    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);

      const amp = 0.08 / (idx + 1);
      gain.gain.setValueAtTime(amp, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5 - idx * 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 2.6);
    });
  }

  playClick() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }
}

export const sound = new SoundEngine();
