'use strict';

/* ==========================================================================
   AssetManifest — declarative list of everything to preload.
   Empty by default today (no art/audio has been produced yet); future
   prompts add entries here and AssetLoader below requires no changes.
   ========================================================================== */
const AssetManifest = {
  images: [
    // { key: 'logo', src: 'assets/images/logo.png' }
  ],
  audio: [
    // Real recordings can replace these paths at any time — AudioManager
    // falls back to synthesized SFX for any key that fails to load, so
    // dropping a matching file into assets/audio/ is the only step needed.
    { key: 'music-cafe', src: 'assets/audio/cafe-ambience.mp3', loop: true },
    { key: 'click', src: 'assets/audio/click.mp3' },
    { key: 'door-bell', src: 'assets/audio/door-bell.mp3' },
    { key: 'chair', src: 'assets/audio/chair.mp3' },
    { key: 'coin', src: 'assets/audio/coin.mp3' },
    { key: 'perfect', src: 'assets/audio/perfect.mp3' },
    { key: 'combo', src: 'assets/audio/combo.mp3' },
    { key: 'levelup', src: 'assets/audio/levelup.mp3' },
    { key: 'steam', src: 'assets/audio/steam.mp3' },
    { key: 'oven', src: 'assets/audio/oven.mp3' },
    { key: 'footstep', src: 'assets/audio/footstep.mp3' },
    { key: 'serve', src: 'assets/audio/serve.mp3' },
    { key: 'burned', src: 'assets/audio/burned.mp3' },
    { key: 'wrong', src: 'assets/audio/wrong.mp3' },
    { key: 'achievement', src: 'assets/audio/achievement.mp3' },
    { key: 'rare-customer', src: 'assets/audio/rare-customer.mp3' },
    { key: 'rain-ambience', src: 'assets/audio/rain-ambience.mp3', loop: true },
    { key: 'morning-ambience', src: 'assets/audio/morning-ambience.mp3', loop: true },
    { key: 'evening-ambience', src: 'assets/audio/evening-ambience.mp3', loop: true },
    { key: 'event-music', src: 'assets/audio/event-music.mp3', loop: true }
  ]
};

/* ==========================================================================
   AssetLoader — preloads everything in AssetManifest, reports progress,
   and degrades gracefully (never throws) if a single asset is missing.
   ========================================================================== */
class AssetLoader {
  constructor(bus) {
    this.bus = bus;
    this.images = new Map();
    this.audio = new Map();
    this.failed = [];
  }

  async loadAll(manifest = AssetManifest) {
    const tasks = [
      ...manifest.images.map((entry) => this._loadImage(entry)),
      ...manifest.audio.map((entry) => this._loadAudio(entry))
    ];

    const total = tasks.length;
    let done = 0;

    if (total === 0) {
      // Nothing declared yet — report a synthetic short progress so the
      // loading screen still feels intentional rather than instant.
      for (let step = 1; step <= 10; step++) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        this.bus.emit('assets:progress', { done: step, total: 10, ratio: step / 10 });
      }
      this.bus.emit('assets:complete', { failed: this.failed });
      return { failed: this.failed };
    }

    await Promise.all(tasks.map((task) =>
      task
        .catch((err) => { /* individual failures are already recorded */ })
        .finally(() => {
          done += 1;
          this.bus.emit('assets:progress', { done, total, ratio: done / total });
        })
    ));

    this.bus.emit('assets:complete', { failed: this.failed });
    return { failed: this.failed };
  }

  _loadImage({ key, src }) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.images.set(key, img); resolve(img); };
      img.onerror = () => {
        this.failed.push({ key, src, type: 'image' });
        reject(new Error(`Image failed: ${src}`));
      };
      img.src = src;
    });
  }

  _loadAudio({ key, src, loop }) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.loop = !!loop;
      audio.oncanplaythrough = () => { this.audio.set(key, audio); resolve(audio); };
      audio.onerror = () => {
        this.failed.push({ key, src, type: 'audio' });
        reject(new Error(`Audio failed: ${src}`));
      };
      audio.src = src;
    });
  }

  getImage(key) { return this.images.get(key) || null; }
  getAudio(key) { return this.audio.get(key) || null; }
}

/* ==========================================================================
   TouchManager — normalizes pointer/touch input, adds button press
   feedback, and provides simple tap/swipe detection via EventBus.
   ========================================================================== */
class TouchManager {
  constructor(bus) {
    this.bus = bus;
    this._activePointers = new Map();
    this._bindGlobalGestures();
  }

  _bindGlobalGestures() {
    window.addEventListener('pointerdown', (e) => {
      synthAudio.unlock();
      this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    }, { passive: true });

    window.addEventListener('pointerup', (e) => {
      const start = this._activePointers.get(e.pointerId);
      this._activePointers.delete(e.pointerId);
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dt = performance.now() - start.t;
      const dist = Math.hypot(dx, dy);

      if (dist < 10 && dt < 400) {
        this.bus.emit('input:tap', { x: e.clientX, y: e.clientY });
      } else if (dist > 40 && dt < 600) {
        const angle = Math.atan2(dy, dx);
        const direction = TouchManager._angleToDirection(angle);
        this.bus.emit('input:swipe', { direction, dx, dy, dt });
      }
    }, { passive: true });
  }

  static _angleToDirection(angle) {
    const deg = (angle * 180) / Math.PI;
    if (deg >= -45 && deg <= 45) return 'right';
    if (deg > 45 && deg < 135) return 'down';
    if (deg < -45 && deg > -135) return 'up';
    return 'left';
  }

  /** Wires standard press-feedback + tap-to-activate behavior onto a button element. */
  bindButton(element, onActivate) {
    if (!element) return;
    const press = () => element.classList.add('pressed');
    const release = () => element.classList.remove('pressed');

    element.addEventListener('pointerdown', press, { passive: true });
    element.addEventListener('pointerup', release, { passive: true });
    element.addEventListener('pointercancel', release, { passive: true });
    element.addEventListener('pointerleave', release, { passive: true });

    element.addEventListener('click', (e) => {
      if (element.disabled || element.classList.contains('disabled')) return;
      onActivate && onActivate(e);
    });
  }
}

/* ==========================================================================
   AnimationSystem — a small, reusable tween engine. Every scene and UI
   system builds its motion on top of this rather than hand-rolled rAF loops.
   ========================================================================== */
const Easing = {
  linear: (t) => t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadIn: (t) => t * t,
  cubicOut: (t) => 1 - Math.pow(1 - t, 3),
  cubicIn: (t) => t * t * t,
  elasticOut: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

class Tween {
  constructor({ target, props, duration, easing = Easing.quadOut, delay = 0, onUpdate, onComplete, loop = false, yoyo = false }) {
    this.target = target;
    this.props = props;
    this.duration = Math.max(1, duration);
    this.easing = easing;
    this.delay = delay;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.loop = loop;
    this.yoyo = yoyo;

    this._elapsed = 0;
    this._from = {};
    this._to = props;
    this._direction = 1;
    this.done = false;

    for (const key in props) {
      this._from[key] = target[key] ?? 0;
    }
  }

  update(deltaMs) {
    if (this.done) return;
    if (this.delay > 0) {
      this.delay -= deltaMs;
      return;
    }

    this._elapsed += deltaMs;
    let t = Math.min(1, this._elapsed / this.duration);
    const eased = this.easing(t);

    for (const key in this._to) {
      const from = this._direction === 1 ? this._from[key] : this._to[key];
      const to = this._direction === 1 ? this._to[key] : this._from[key];
      const value = from + (to - from) * eased;
      this.target[key] = value;
    }

    if (this.onUpdate) this.onUpdate(this.target, eased);

    if (t >= 1) {
      if (this.yoyo) {
        this._direction *= -1;
        this._elapsed = 0;
      } else if (this.loop) {
        this._elapsed = 0;
      } else {
        this.done = true;
        if (this.onComplete) this.onComplete();
      }
    }
  }
}

class AnimationSystem {
  constructor() {
    this._tweens = [];
  }

  update(deltaMs) {
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const tween = this._tweens[i];
      tween.update(deltaMs);
      if (tween.done) this._tweens.splice(i, 1);
    }
  }

  add(config) {
    const tween = new Tween(config);
    this._tweens.push(tween);
    return tween;
  }

  clear(target) {
    this._tweens = this._tweens.filter((tw) => tw.target !== target);
  }

  /* ------------------------- DOM convenience helpers ------------------------- */

  fadeIn(el, duration = 300, delay = 0) {
    el.style.opacity = el.style.opacity || '0';
    const state = { v: parseFloat(el.style.opacity) || 0 };
    return this.add({
      target: state, props: { v: 1 }, duration, delay, easing: Easing.quadOut,
      onUpdate: () => { el.style.opacity = state.v; }
    });
  }

  fadeOut(el, duration = 300, delay = 0, onComplete) {
    const state = { v: parseFloat(el.style.opacity ?? '1') || 1 };
    return this.add({
      target: state, props: { v: 0 }, duration, delay, easing: Easing.quadIn,
      onUpdate: () => { el.style.opacity = state.v; },
      onComplete
    });
  }

  moveTo(el, x, y, duration = 300, easing = Easing.cubicOut) {
    const state = { x: 0, y: 0 };
    return this.add({
      target: state, props: { x, y }, duration, easing,
      onUpdate: () => { el.style.transform = `translate(${state.x}px, ${state.y}px)`; }
    });
  }

  scaleTo(el, scale, duration = 250, easing = Easing.cubicOut) {
    const state = { s: 1 };
    return this.add({
      target: state, props: { s: scale }, duration, easing,
      onUpdate: () => { el.style.transform = `scale(${state.s})`; }
    });
  }

  slideIn(el, fromX = 40, duration = 350) {
    const state = { x: fromX, o: 0 };
    el.style.opacity = '0';
    return this.add({
      target: state, props: { x: 0, o: 1 }, duration, easing: Easing.cubicOut,
      onUpdate: () => {
        el.style.transform = `translateX(${state.x}px)`;
        el.style.opacity = state.o;
      }
    });
  }

  bounce(el, strength = 12, duration = 500) {
    const state = { y: 0 };
    return this.add({
      target: state, props: { y: -strength }, duration, easing: Easing.bounceOut, yoyo: true,
      onUpdate: () => { el.style.transform = `translateY(${state.y}px)`; }
    });
  }

  elastic(el, scale = 1.15, duration = 600) {
    const state = { s: 1 };
    return this.add({
      target: state, props: { s: scale }, duration, easing: Easing.elasticOut, yoyo: true,
      onUpdate: () => { el.style.transform = `scale(${state.s})`; }
    });
  }

  /** Gentle continuous vertical drift — used for logos, café steam, idle props. */
  floating(el, amplitude = 8, duration = 2200) {
    const state = { y: 0 };
    return this.add({
      target: state, props: { y: amplitude }, duration, easing: Easing.quadIn, loop: true, yoyo: true,
      onUpdate: () => { el.style.transform = `translateY(${state.y - amplitude / 2}px)`; }
    });
  }

  /** Subtle scale pulse — used for logos and idle characters to feel alive. */
  breathing(el, amount = 0.04, duration = 1800) {
    const state = { s: 1 };
    return this.add({
      target: state, props: { s: 1 + amount }, duration, easing: Easing.quadIn, loop: true, yoyo: true,
      onUpdate: () => { el.style.transform = `scale(${state.s})`; }
    });
  }

  shake(el, strength = 8, duration = 350) {
    const state = { t: 0 };
    return this.add({
      target: state, props: { t: 1 }, duration, easing: Easing.linear,
      onUpdate: () => {
        const offset = Math.sin(state.t * Math.PI * 8) * strength * (1 - state.t);
        el.style.transform = `translateX(${offset}px)`;
      },
      onComplete: () => { el.style.transform = 'translateX(0)'; }
    });
  }

  buttonPress(el) {
    const state = { s: 1 };
    return this.add({
      target: state, props: { s: 0.94 }, duration: 90, easing: Easing.quadOut, yoyo: true,
      onUpdate: () => { el.style.transform = `scale(${state.s})`; }
    });
  }
}

/* ==========================================================================
   TransitionSystem — screen-to-screen transitions built on AnimationSystem.
   ========================================================================== */
class TransitionSystem {
  constructor(animationSystem, layerElement) {
    this.animationSystem = animationSystem;
    this.layer = layerElement;
    this.overlay = document.createElement('div');
    this.overlay.className = 'transition-fade';
    this.layer.appendChild(this.overlay);
  }

  async fade(betweenCallback, duration = 260) {
    await this._animateOpacity(1, duration);
    if (betweenCallback) await betweenCallback();
    await this._animateOpacity(0, duration);
  }

  _animateOpacity(target, duration) {
    return new Promise((resolve) => {
      const state = { o: parseFloat(this.overlay.style.opacity) || 0 };
      this.animationSystem.add({
        target: state,
        props: { o: target },
        duration,
        easing: Easing.quadOut,
        onUpdate: () => { this.overlay.style.opacity = state.o; },
        onComplete: resolve
      });
    });
  }
}

/* ==========================================================================
   AudioManager — music (with crossfade) + SFX pooling. Fully functional
   even with an empty manifest: it just has nothing to play yet.
   ========================================================================== */
class AudioManager {
  constructor(bus, assetLoader, settingsManager) {
    this.bus = bus;
    this.assetLoader = assetLoader;
    this.settingsManager = settingsManager;
    this._currentMusicKey = null;
    this._musicEl = null;
    this._ambienceEl = null;
    this._ambienceKey = null;
    this._muted = false;

    this.settingsManager.bus.on('settings:musicVolume', (v) => {
      if (this._musicEl) this._musicEl.volume = this._muted ? 0 : v;
    });
    this.settingsManager.bus.on('settings:ambienceVolume', (v) => {
      if (this._ambienceEl) this._ambienceEl.volume = this._muted ? 0 : v;
    });
  }

  playMusic(key, { crossfadeMs = 600 } = {}) {
    const nextSource = this.assetLoader.getAudio(key);
    if (!nextSource) return; // gracefully no-op if the track isn't loaded yet

    const prevEl = this._musicEl;
    const nextEl = nextSource.cloneNode(true);
    nextEl.loop = true;
    nextEl.volume = 0;
    nextEl.play().catch(() => { /* autoplay restrictions — will resume on next user gesture */ });

    const targetVolume = this._muted ? 0 : this.settingsManager.musicVolume;
    const steps = Math.max(1, Math.floor(crossfadeMs / 40));
    let step = 0;

    const fadeInterval = window.setInterval(() => {
      step += 1;
      const ratio = step / steps;
      nextEl.volume = Math.min(targetVolume, targetVolume * ratio);
      if (prevEl) prevEl.volume = Math.max(0, targetVolume * (1 - ratio));
      if (step >= steps) {
        window.clearInterval(fadeInterval);
        if (prevEl) prevEl.pause();
      }
    }, 40);

    this._musicEl = nextEl;
    this._currentMusicKey = key;
  }

  stopMusic() {
    if (this._musicEl) this._musicEl.pause();
    this._musicEl = null;
    this._currentMusicKey = null;
  }

  /** Second, independent loop layer for weather/time-of-day ambience
   *  (rain-ambience, morning-ambience, evening-ambience, event-music).
   *  Gracefully does nothing until matching files exist — exactly like
   *  playMusic, just on its own audio element so the two can overlap. */
  playAmbience(key) {
    if (this._ambienceKey === key) return;
    const source = this.assetLoader.getAudio(key);
    if (this._ambienceEl) { this._ambienceEl.pause(); this._ambienceEl = null; }
    this._ambienceKey = key;
    if (!source) return; // no file yet — silently does nothing, as designed

    const el = source.cloneNode(true);
    el.loop = true;
    el.volume = this._muted ? 0 : this.settingsManager.ambienceVolume;
    el.play().catch(() => { /* autoplay restrictions — will resume on next user gesture */ });
    this._ambienceEl = el;
  }

  stopAmbience() {
    if (this._ambienceEl) this._ambienceEl.pause();
    this._ambienceEl = null;
    this._ambienceKey = null;
  }

  playSfx(key) {
    const source = this.assetLoader.getAudio(key);
    if (!source) {
      // No recorded file loaded for this key yet — synthesize it instead
      // of staying silent. The moment a real file lands in the manifest
      // and loads successfully, this branch stops being taken automatically.
      if (!this._muted) synthAudio.play(key, this.settingsManager.sfxVolume);
      return;
    }
    const instance = source.cloneNode(true);
    instance.volume = this._muted ? 0 : this.settingsManager.sfxVolume;
    instance.play().catch(() => { /* ignore — non-critical sound */ });
  }

  setMuted(muted) {
    this._muted = muted;
    if (this._musicEl) this._musicEl.volume = muted ? 0 : this.settingsManager.musicVolume;
    if (this._ambienceEl) this._ambienceEl.volume = muted ? 0 : this.settingsManager.ambienceVolume;
  }
}

/* ==========================================================================
   CameraFoundation — minimal 2D camera used by future canvas/world scenes.
   ========================================================================== */
class CameraFoundation {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this._followTarget = null;
  }

  follow(target) { this._followTarget = target; }

  update() {
    if (!this._followTarget) return;
    this.x = this._followTarget.x;
    this.y = this._followTarget.y;
  }

  applyToElement(el) {
    el.style.transform = `translate(${-this.x}px, ${-this.y}px) scale(${this.zoom})`;
  }
}

/* ==========================================================================
   ParticleFoundation — lightweight pooled canvas particle system.
   Used today for the cozy ambient drift on the main menu; general enough
   for steam, sparkles, or confetti in future scenes.
   ========================================================================== */
class Particle {
  constructor() { this.reset(); }
  reset() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.life = 0; this.maxLife = 1;
    this.size = 2;
    this.color = 'rgba(255,255,255,0.5)';
  }
}

class ParticleFoundation {
  constructor(canvas, poolSize = 60) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pool = Array.from({ length: poolSize }, () => new Particle());
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  spawnAmbient(count = 1) {
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((particle) => !particle.active);
      if (!p) return;
      p.active = true;
      p.x = Math.random() * this.width;
      p.y = this.height + 10;
      p.vx = (Math.random() - 0.5) * 6;
      p.vy = -(10 + Math.random() * 14);
      p.size = 1.5 + Math.random() * 2.5;
      p.life = 0;
      p.maxLife = 6 + Math.random() * 4;
      p.color = `rgba(224, 168, 62, ${0.15 + Math.random() * 0.25})`;
    }
  }

  /** One-shot radial burst from a screen point — coin collect, sparkles,
   *  celebration confetti. `colors` is an array of CSS color strings the
   *  burst samples from at random. */
  spawnBurst(x, y, count = 10, colors = ['rgba(224,168,62,0.9)']) {
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((particle) => !particle.active);
      if (!p) return;
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 90;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 30; // slight upward bias
      p.size = 2 + Math.random() * 3;
      p.life = 0;
      p.maxLife = 0.5 + Math.random() * 0.5;
      p.color = colors[Math.floor(Math.random() * colors.length)];
    }
  }

  update(deltaSec) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += deltaSec;
      p.x += p.vx * deltaSec;
      p.y += p.vy * deltaSec;
      if (p.life >= p.maxLife || p.y < -20) p.active = false;
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    for (const p of this.pool) {
      if (!p.active) continue;
      const fade = 1 - p.life / p.maxLife;
      this.ctx.globalAlpha = Math.max(0, fade);
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;
  }
}
