'use strict';

/* ==========================================================================
   SynthAudio — generates short sound effects with the Web Audio API so the
   game has real audible feedback even before any recorded audio files
   exist. AudioManager checks for a loaded file first; this only fires when
   nothing was found for that key, and steps aside automatically the moment
   a matching file is dropped into /assets/audio and picked up by the
   AssetManifest — no gameplay code changes needed either way.
   ========================================================================== */
class SynthAudio {
  constructor() {
    this._ctx = null;
  }

  _ensureContext() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this._ctx = new Ctx();
    return this._ctx;
  }

  /** Mobile Safari suspends new AudioContexts until a user gesture; call
   *  this from the first touch handler so subsequent effects play instantly. */
  unlock() {
    const ctx = this._ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  _tone(freq, { duration = 0.12, type = 'sine', gain = 0.18, glideTo = null, startAt = 0 } = {}) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + startAt;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);

    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  _noiseBurst({ duration = 0.25, gain = 0.12, filterFreq = 2200 } = {}) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t0);
  }

  play(key, volume = 1) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const g = 0.16 * volume;
    switch (key) {
      case 'click':
        this._tone(720, { duration: 0.05, type: 'square', gain: g * 0.6 });
        break;
      case 'door-bell':
        this._tone(880, { duration: 0.14, type: 'sine', gain: g });
        this._tone(1320, { duration: 0.18, type: 'sine', gain: g * 0.7, startAt: 0.08 });
        break;
      case 'chair':
        this._noiseBurst({ duration: 0.12, gain: g * 0.5, filterFreq: 600 });
        break;
      case 'coin':
        this._tone(988, { duration: 0.08, type: 'square', gain: g });
        this._tone(1568, { duration: 0.12, type: 'square', gain: g * 0.8, startAt: 0.06 });
        break;
      case 'perfect':
        this._tone(784, { duration: 0.1, type: 'triangle', gain: g });
        this._tone(1046, { duration: 0.1, type: 'triangle', gain: g, startAt: 0.08 });
        this._tone(1568, { duration: 0.16, type: 'triangle', gain: g, startAt: 0.16 });
        break;
      case 'combo':
        this._tone(660, { duration: 0.08, type: 'sawtooth', gain: g * 0.7, glideTo: 990 });
        break;
      case 'levelup':
        this._tone(523, { duration: 0.12, type: 'triangle', gain: g, startAt: 0 });
        this._tone(659, { duration: 0.12, type: 'triangle', gain: g, startAt: 0.1 });
        this._tone(784, { duration: 0.12, type: 'triangle', gain: g, startAt: 0.2 });
        this._tone(1046, { duration: 0.22, type: 'triangle', gain: g, startAt: 0.3 });
        break;
      case 'steam':
        this._noiseBurst({ duration: 0.4, gain: g * 0.4, filterFreq: 3200 });
        break;
      case 'serve':
        this._tone(440, { duration: 0.09, type: 'sine', gain: g * 0.7, glideTo: 660 });
        break;
      case 'burned':
        this._tone(220, { duration: 0.22, type: 'sawtooth', gain: g * 0.6, glideTo: 110 });
        break;
      case 'wrong':
        this._tone(300, { duration: 0.1, type: 'square', gain: g * 0.5, glideTo: 180 });
        break;
      default:
        this._tone(600, { duration: 0.08, type: 'sine', gain: g * 0.5 });
    }
  }
}

const synthAudio = new SynthAudio();
