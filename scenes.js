'use strict';

/* ==========================================================================
   LoadingScene — drives AssetLoader, shows an animated progress bar,
   then hands off to Intro (first run) or Main Menu (returning player).
   ========================================================================== */
class LoadingScene extends Scene {
  constructor(ctx) { super('loading', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cozy-bg"></div>
      <div class="loading-logo">Meeshi's Dream Café</div>
      <div class="loading-bar-track"><div class="loading-bar-fill"></div></div>
      <div class="loading-pct">0%</div>
    `;
    this.fill = this.element.querySelector('.loading-bar-fill');
    this.pctLabel = this.element.querySelector('.loading-pct');
  }

  enter() {
    this._onProgress = ({ ratio }) => {
      const pct = Math.round(ratio * 100);
      this.fill.style.width = `${pct}%`;
      this.pctLabel.textContent = `${pct}%`;
    };
    this._onComplete = () => {
      const isFirstRun = !this.ctx.gameState.hasSaveEverBeenCreated();
      window.setTimeout(() => {
        this.ctx.sceneManager.goTo(isFirstRun ? 'intro' : 'main-menu');
      }, 200);
    };

    this.ctx.bus.on('assets:progress', this._onProgress);
    this.ctx.bus.on('assets:complete', this._onComplete);
    this.ctx.assetLoader.loadAll().catch((err) => {
      // Never crash on load failure — proceed to menu regardless.
      console.error('[LoadingScene] asset load error:', err);
      this.ctx.sceneManager.goTo('main-menu');
    });
  }

  exit() {
    super.exit();
    this.ctx.bus.off('assets:progress', this._onProgress);
    this.ctx.bus.off('assets:complete', this._onComplete);
  }
}

/* ==========================================================================
   IntroScene — typewriter narrative intro, Roman Urdu ready via
   LocalizationSystem, skippable, fades onward to Main Menu.
   ========================================================================== */
class IntroScene extends Scene {
  constructor(ctx) { super('intro', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cozy-bg"></div>
      <div class="intro-text"></div>
      <button class="btn btn--ghost btn--small intro-skip"></button>
    `;
    this.textEl = this.element.querySelector('.intro-text');
    this.skipBtn = this.element.querySelector('.intro-skip');
  }

  enter() {
    this.skipBtn.textContent = this.ctx.localization.t('intro.skip');
    this.ctx.touchManager.bindButton(this.skipBtn, () => this._finish());

    this._cancelled = false;
    this._runTypewriter([
      this.ctx.localization.t('intro.line1'),
      this.ctx.localization.t('intro.line2')
    ]);
  }

  async _runTypewriter(lines) {
    for (const line of lines) {
      if (this._cancelled) return;
      await this._typeLine(line);
      await this._wait(900);
    }
    if (!this._cancelled) this._finish();
  }

  _typeLine(line) {
    return new Promise((resolve) => {
      this.textEl.textContent = '';
      let i = 0;
      const step = () => {
        if (this._cancelled) return resolve();
        this.textEl.textContent = line.slice(0, i);
        i += 1;
        if (i <= line.length) {
          window.setTimeout(step, 28);
        } else {
          resolve();
        }
      };
      step();
    });
  }

  _wait(ms) {
    return new Promise((resolve) => { window.setTimeout(resolve, ms); });
  }

  _finish() {
    if (this._cancelled) return;
    this._cancelled = true;
    this.ctx.sceneManager.goTo('main-menu');
  }

  exit() {
    super.exit();
    this._cancelled = true;
  }
}

/* ==========================================================================
   MainMenuScene — animated logo, cozy background + ambient particles,
   Start / Continue / Settings / Credits, version label, hidden iOS exit.
   ========================================================================== */
const GAME_VERSION = '0.1.0-foundation';

class MainMenuScene extends Scene {
  constructor(ctx) { super('main-menu', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cozy-bg"></div>
      <button class="exit-btn" aria-label="Exit">✕</button>
      <div class="menu-logo-wrap">
        <div class="menu-logo">Meeshi's<br>Dream Café<small>Cozy Café Sim</small></div>
      </div>
      <div class="menu-buttons">
        <button class="btn btn--primary" data-action="start"></button>
        <button class="btn" data-action="continue"></button>
        <button class="btn" data-action="settings"></button>
        <button class="btn btn--ghost" data-action="credits"></button>
      </div>
      <div class="menu-version">v${GAME_VERSION}</div>
    `;

    this.logoEl = this.element.querySelector('.menu-logo');
    this.startBtn = this.element.querySelector('[data-action="start"]');
    this.continueBtn = this.element.querySelector('[data-action="continue"]');
    this.settingsBtn = this.element.querySelector('[data-action="settings"]');
    this.creditsBtn = this.element.querySelector('[data-action="credits"]');
    this.exitBtn = this.element.querySelector('.exit-btn');
    this.versionEl = this.element.querySelector('.menu-version');

    this.ctx.touchManager.bindButton(this.startBtn, () => this._onStart());
    this.ctx.touchManager.bindButton(this.continueBtn, () => this._onContinue());
    this.ctx.touchManager.bindButton(this.settingsBtn, () => {
      this.ctx.settingsManager.vibrate();
      this.ctx.sceneManager.goTo('settings');
    });
    this.ctx.touchManager.bindButton(this.creditsBtn, () => {
      this.ctx.settingsManager.vibrate();
      this.ctx.sceneManager.goTo('credits');
    });
    this.ctx.touchManager.bindButton(this.exitBtn, () => this._attemptExit());

    this._versionTapCount = 0;
    this._versionTapTimer = null;
    this.versionEl.addEventListener('click', () => this._onVersionTap());
  }

  enter() {
    this._applyLabels();
    this.continueBtn.classList.toggle('disabled', !this.ctx.gameState.hasSaveEverBeenCreated());

    this.ctx.animationSystem.breathing(this.logoEl, 0.03, 2400);
    this.ctx.animationSystem.slideIn(this.startBtn, 30, 380);
    this.ctx.animationSystem.slideIn(this.continueBtn, 30, 420);
    this.ctx.animationSystem.slideIn(this.settingsBtn, 30, 460);
    this.ctx.animationSystem.slideIn(this.creditsBtn, 30, 500);

    this._isIOS = /iP(hone|od|ad)/.test(navigator.userAgent);
    this.exitBtn.classList.remove('visible');

    this._ambientHandle = window.setInterval(() => {
      this.ctx.particles.spawnAmbient(1);
    }, 500);
  }

  _applyLabels() {
    this.startBtn.textContent = this.ctx.localization.t('menu.start');
    this.continueBtn.textContent = this.ctx.localization.t('menu.continue');
    this.settingsBtn.textContent = this.ctx.localization.t('menu.settings');
    this.creditsBtn.textContent = this.ctx.localization.t('menu.credits');
  }

  _onStart() {
    this.ctx.settingsManager.vibrate();
    this.ctx.sceneManager.goTo('cafe');
  }

  _onContinue() {
    if (!this.ctx.gameState.hasSaveEverBeenCreated()) {
      this.ctx.notificationSystem.show(this.ctx.localization.t('notification.noSave'), 'error');
      return;
    }
    this.ctx.settingsManager.vibrate();
    this.ctx.sceneManager.goTo('cafe');
  }

  _onVersionTap() {
    if (!this._isIOS) return;
    this._versionTapCount += 1;
    window.clearTimeout(this._versionTapTimer);
    this._versionTapTimer = window.setTimeout(() => { this._versionTapCount = 0; }, 1500);

    if (this._versionTapCount >= 5) {
      this._versionTapCount = 0;
      this.exitBtn.classList.add('visible');
      this.ctx.animationSystem.fadeIn(this.exitBtn, 200);
    }
  }

  _attemptExit() {
    // Browsers largely block script-initiated tab/app closing for
    // non-script-opened windows; we attempt it and fail gracefully.
    window.close();
    window.setTimeout(() => {
      this.ctx.notificationSystem.show(this.ctx.localization.t('notification.exitUnavailable'), 'info');
    }, 150);
  }

  exit() {
    super.exit();
    window.clearInterval(this._ambientHandle);
  }
}

/* ==========================================================================
   SettingsScene — live-bound sliders/toggles, reset-save confirmation.
   ========================================================================== */
class SettingsScene extends Scene {
  constructor(ctx) { super('settings', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cozy-bg"></div>
      <button class="btn btn--ghost btn--small back-btn">‹</button>
      <div class="panel">
        <div class="panel-title"></div>

        <div class="setting-row">
          <span class="setting-label music-label"></span>
          <div class="slider-track" data-slider="music">
            <div class="slider-fill"></div>
            <div class="slider-handle"></div>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label sfx-label"></span>
          <div class="slider-track" data-slider="sfx">
            <div class="slider-fill"></div>
            <div class="slider-handle"></div>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label vibration-label"></span>
          <div class="toggle" data-toggle="vibration"><div class="toggle-knob"></div></div>
        </div>

        <div class="panel-actions">
          <button class="btn btn--ghost reset-btn"></button>
        </div>
      </div>
    `;

    this.backBtn = this.element.querySelector('.back-btn');
    this.titleEl = this.element.querySelector('.panel-title');
    this.musicLabel = this.element.querySelector('.music-label');
    this.sfxLabel = this.element.querySelector('.sfx-label');
    this.vibrationLabel = this.element.querySelector('.vibration-label');
    this.resetBtn = this.element.querySelector('.reset-btn');
    this.vibrationToggle = this.element.querySelector('[data-toggle="vibration"]');

    this.musicSlider = this._buildSlider('music', (value) => this.ctx.settingsManager.setMusicVolume(value));
    this.sfxSlider = this._buildSlider('sfx', (value) => this.ctx.settingsManager.setSfxVolume(value));

    this.ctx.touchManager.bindButton(this.backBtn, () => this.ctx.sceneManager.goTo('main-menu'));
    this.ctx.touchManager.bindButton(this.vibrationToggle, () => {
      const next = !this.ctx.settingsManager.vibrationEnabled;
      this.ctx.settingsManager.setVibration(next);
      this.ctx.settingsManager.vibrate();
      this._refreshToggle();
    });
    this.ctx.touchManager.bindButton(this.resetBtn, () => this._confirmReset());
  }

  _buildSlider(key, onChange) {
    const track = this.element.querySelector(`[data-slider="${key}"]`);
    const fill = track.querySelector('.slider-fill');
    const handle = track.querySelector('.slider-handle');

    const setFromClientX = (clientX) => {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      fill.style.width = `${ratio * 100}%`;
      handle.style.left = `${ratio * 100}%`;
      onChange(ratio);
    };

    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      setFromClientX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pressure === 0 && e.pointerType === 'mouse') return;
      if (track.hasPointerCapture(e.pointerId)) setFromClientX(e.clientX);
    });

    return { track, fill, handle, set: (ratio) => {
      fill.style.width = `${ratio * 100}%`;
      handle.style.left = `${ratio * 100}%`;
    }};
  }

  _refreshToggle() {
    this.vibrationToggle.classList.toggle('on', this.ctx.settingsManager.vibrationEnabled);
  }

  async _confirmReset() {
    const confirmed = await this.ctx.dialogFramework.confirm({
      title: this.ctx.localization.t('popup.resetTitle'),
      message: this.ctx.localization.t('popup.resetMessage')
    });
    if (!confirmed) return;

    this.ctx.saveManager.resetSave();
    this.musicSlider.set(this.ctx.settingsManager.musicVolume);
    this.sfxSlider.set(this.ctx.settingsManager.sfxVolume);
    this._refreshToggle();
    this.ctx.notificationSystem.show(this.ctx.localization.t('notification.saveReset'), 'success');
  }

  enter() {
    this.titleEl.textContent = this.ctx.localization.t('settings.title');
    this.musicLabel.textContent = this.ctx.localization.t('settings.music');
    this.sfxLabel.textContent = this.ctx.localization.t('settings.sfx');
    this.vibrationLabel.textContent = this.ctx.localization.t('settings.vibration');
    this.resetBtn.textContent = this.ctx.localization.t('settings.reset');
    this.backBtn.textContent = this.ctx.localization.t('settings.back');

    this.musicSlider.set(this.ctx.settingsManager.musicVolume);
    this.sfxSlider.set(this.ctx.settingsManager.sfxVolume);
    this._refreshToggle();

    this.ctx.animationSystem.slideIn(this.element.querySelector('.panel'), 24, 300);
  }
}

/* ==========================================================================
   CreditsScene — simple, static, back to menu.
   ========================================================================== */
class CreditsScene extends Scene {
  constructor(ctx) { super('credits', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cozy-bg"></div>
      <button class="btn btn--ghost btn--small back-btn">‹</button>
      <div class="panel">
        <div class="panel-title"></div>
        <div class="credits-text">
          Meeshi's Dream Café<br>
          A cozy café simulation<br><br>
          Built with care, one system at a time.
        </div>
      </div>
    `;
    this.backBtn = this.element.querySelector('.back-btn');
    this.titleEl = this.element.querySelector('.panel-title');
    this.ctx.touchManager.bindButton(this.backBtn, () => this.ctx.sceneManager.goTo('main-menu'));
  }

  enter() {
    this.titleEl.textContent = this.ctx.localization.t('credits.title');
    this.backBtn.textContent = this.ctx.localization.t('settings.back');
    this.ctx.animationSystem.slideIn(this.element.querySelector('.panel'), 24, 300);
  }
}
