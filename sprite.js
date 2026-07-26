'use strict';

/* ==========================================================================
   PLAYER_SPRITE_CLIPS — Meeshi's canonical sprite sheet, sliced into one
   PNG per pose and grouped into named clips. Frame counts come directly
   from the reference sheet (Idle/Walk=11, Run/Serve/Clean/Wave=7,
   Celebrate=6); this file only ever references filenames, never redraws
   or restyles her.
   ========================================================================== */
function _buildClipFrames(clip, count) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(2, '0');
    frames.push(`assets/images/meeshi/${clip}/${clip}_${n}.png`);
  }
  return frames;
}

const PLAYER_SPRITE_CLIPS = {
  idle: _buildClipFrames('idle', 11),
  walk: _buildClipFrames('walk', 11),
  run: _buildClipFrames('run', 7),
  serve: _buildClipFrames('serve', 7),
  clean: _buildClipFrames('clean', 7),
  wave: _buildClipFrames('wave', 7),
  celebrate: _buildClipFrames('celebrate', 6)
};

/** Which frames (by index into the full clip) and playback speed each
 *  in-game animation actually uses — lets gameplay reuse a curated subset
 *  of a pose-reference row instead of every angle in it. */
const PLAYER_CLIP_CONFIG = {
  idle:      { frames: [0, 1, 2, 3], fps: 1.2, loop: true },
  walk:      { frames: [0, 1, 2, 3, 4, 5], fps: 8, loop: true },
  run:       { frames: [0, 1, 2, 3, 4, 5, 6], fps: 10, loop: true },
  serve:     { frames: [0, 1, 2, 3, 4, 5, 6], fps: 7, loop: false },
  clean:     { frames: [0, 1, 2, 3, 4, 5, 6], fps: 6, loop: true },
  wave:      { frames: [0, 1, 2, 3, 4, 5, 6], fps: 6, loop: false },
  celebrate: { frames: [0, 1, 2, 3, 4, 5], fps: 8, loop: false }
};

/** Registers every Meeshi frame into the shared AssetManifest so the
 *  existing LoadingScene/AssetLoader preload her exactly like any other
 *  declared asset — no parallel loading system needed. */
function registerPlayerSpriteAssets() {
  for (const clip of Object.keys(PLAYER_SPRITE_CLIPS)) {
    PLAYER_SPRITE_CLIPS[clip].forEach((src, i) => {
      AssetManifest.images.push({ key: `meeshi-${clip}-${i}`, src });
    });
  }
}

/* ==========================================================================
   SpriteAnimator — generic frame-sequence player. Swaps an <img>'s src on
   a timer; used by PlayerCharacter today and reusable for any future
   sprite-based actor.
   ========================================================================== */
class SpriteAnimator {
  constructor(imgEl, assetLoader, animationSystem) {
    this.imgEl = imgEl;
    this.assetLoader = assetLoader;
    this.animationSystem = animationSystem;
    this._clip = null;
    this._frameKeys = [];
    this._frameIndex = 0;
    this._frameDurationMs = 200;
    this._elapsedMs = 0;
    this._loop = true;
    this._playing = false;
    this._onComplete = null;
  }

  play(clipName, { onComplete } = {}) {
    if (this._clip === clipName && this._playing) return;
    const config = PLAYER_CLIP_CONFIG[clipName];
    if (!config) { console.warn(`[SpriteAnimator] unknown clip "${clipName}"`); return; }

    const isClipChange = this._clip !== null && this._clip !== clipName;

    this._clip = clipName;
    this._frameKeys = config.frames.map((frameIdx) => `meeshi-${clipName}-${frameIdx}`);
    this._frameDurationMs = 1000 / config.fps;
    this._loop = config.loop;
    this._frameIndex = 0;
    this._elapsedMs = 0;
    this._playing = true;
    this._onComplete = onComplete || null;

    if (isClipChange && this.animationSystem) {
      // Smooth crossfade instead of a hard snap between animations.
      this.animationSystem.clear(this.imgEl);
      const state = { o: 1 };
      this.animationSystem.add({
        target: state, props: { o: 0.35 }, duration: 70, easing: Easing.quadOut, yoyo: true,
        onUpdate: () => { this.imgEl.style.opacity = state.o; }
      });
    }
    this._applyFrame();
  }

  stop() {
    this._playing = false;
  }

  update(deltaMs) {
    if (!this._playing || this._frameKeys.length === 0) return;
    this._elapsedMs += deltaMs;
    if (this._elapsedMs < this._frameDurationMs) return;
    this._elapsedMs = 0;

    if (this._frameIndex < this._frameKeys.length - 1) {
      this._frameIndex += 1;
      this._applyFrame();
    } else if (this._loop) {
      this._frameIndex = 0;
      this._applyFrame();
    } else {
      this._playing = false;
      if (this._onComplete) this._onComplete();
    }
  }

  _applyFrame() {
    const key = this._frameKeys[this._frameIndex];
    const img = this.assetLoader.getImage(key);
    if (img) this.imgEl.src = img.src;
  }
}

/* ==========================================================================
   PlayerCharacter — thin wrapper any scene can drop in: one DOM element,
   one animator, a couple of convenience methods for the clips gameplay
   actually calls (idle/walk/serve/wave/celebrate/clean).
   ========================================================================== */
class PlayerCharacter {
  constructor(ctx) {
    this.ctx = ctx;
    this.element = document.createElement('div');
    this.element.className = 'meeshi-sprite';
    this.imgEl = document.createElement('img');
    this.imgEl.className = 'meeshi-sprite__img';
    this.imgEl.draggable = false;
    this.element.appendChild(this.imgEl);
    this.animator = new SpriteAnimator(this.imgEl, ctx.assetLoader, ctx.animationSystem);
    this._breathTween = null;
    this.idle();
  }

  _startBreathing() {
    if (this.ctx.settingsManager.reducedMotion) return;
    if (this._breathTween && !this._breathTween.done) return;
    this._breathTween = this.ctx.animationSystem.breathing(this.imgEl, 0.025, 2600);
  }

  _stopBreathing() {
    if (this._breathTween) { this.ctx.animationSystem.clear(this.imgEl); this._breathTween = null; }
    this.imgEl.style.transform = '';
  }

  idle() {
    this.animator.play('idle');
    this._startBreathing();
  }

  walk() {
    this._stopBreathing();
    this.animator.play('walk');
  }

  clean() {
    this._stopBreathing();
    this.animator.play('clean');
  }

  wave(onComplete) {
    this._stopBreathing();
    this.animator.play('wave', { onComplete: () => { this.idle(); if (onComplete) onComplete(); } });
  }

  serve(onComplete) {
    this._stopBreathing();
    this.animator.play('serve', { onComplete: () => { this.idle(); if (onComplete) onComplete(); } });
  }

  celebrate(onComplete) {
    this._stopBreathing();
    this.animator.play('celebrate', { onComplete: () => { this.idle(); if (onComplete) onComplete(); } });
  }

  update(deltaMs) {
    this.animator.update(deltaMs);
  }
}
