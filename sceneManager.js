'use strict';

/* ==========================================================================
   Scene — base class every screen extends. Owns one DOM element appended
   to the scene layer; lifecycle hooks keep setup/teardown symmetrical so
   nothing leaks listeners or tweens between screens.
   ========================================================================== */
class Scene {
  constructor(name, ctx) {
    this.name = name;
    this.ctx = ctx; // shared systems: bus, gameState, animationSystem, etc.
    this.element = document.createElement('div');
    this.element.className = `scene scene--${name}`;
    this.element.dataset.scene = name;
  }

  /** Called once, right before the scene is first shown. Build DOM here. */
  init() {}

  /** Called every time the scene becomes active. */
  enter() {}

  /** Called every time the scene is replaced by another. */
  exit() {
    this.ctx.animationSystem.clear(this.element);
  }

  /** Called every frame while active. */
  update(deltaSec) {}

  /** Called when the scene is permanently discarded (not used today, but future-proof). */
  destroy() {
    this.ctx.animationSystem.clear(this.element);
    this.element.remove();
  }
}

/* ==========================================================================
   SceneManager — registry + active-scene switcher, using TransitionSystem
   for the crossfade between screens.
   ========================================================================== */
class SceneManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.scenes = new Map();
    this.current = null;
    this._initialized = new Set();
  }

  register(name, sceneInstance) {
    this.scenes.set(name, sceneInstance);
  }

  async goTo(sceneName, { transition = true } = {}) {
    const next = this.scenes.get(sceneName);
    if (!next) {
      console.error(`[SceneManager] no scene registered as "${sceneName}"`);
      return;
    }

    const doSwitch = () => {
      if (this.current) {
        this.current.exit();
        this.current.element.remove();
      }

      if (!this._initialized.has(sceneName)) {
        next.init();
        this._initialized.add(sceneName);
      }

      this.ctx.uiLayer.get('scene').appendChild(next.element);
      next.element.style.opacity = '1';
      this.current = next;
      next.enter();

      this.ctx.gameState.set('currentScene', sceneName);
      this.ctx.saveManager.save();
    };

    if (transition) {
      await this.ctx.transitionSystem.fade(async () => { doSwitch(); }, 220);
    } else {
      doSwitch();
    }
  }

  update(deltaSec) {
    if (this.current) this.current.update(deltaSec);
  }
}
