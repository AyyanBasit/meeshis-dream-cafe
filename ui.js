'use strict';

/* ==========================================================================
   UILayer — small registry over the fixed DOM layers declared in index.html,
   so every system references layers by name instead of raw selectors.
   ========================================================================== */
class UILayer {
  constructor() {
    this.layers = {
      scene: document.getElementById('scene-layer'),
      particles: document.getElementById('particle-canvas'),
      ui: document.getElementById('ui-layer'),
      popup: document.getElementById('popup-layer'),
      notification: document.getElementById('notification-layer'),
      transition: document.getElementById('transition-layer')
    };
  }

  get(name) {
    const el = this.layers[name];
    if (!el) console.warn(`[UILayer] unknown layer "${name}"`);
    return el;
  }

  clear(name) {
    const el = this.get(name);
    if (el) el.innerHTML = '';
  }
}

/* ==========================================================================
   NotificationSystem — queued toast messages.
   ========================================================================== */
class NotificationSystem {
  constructor(uiLayer, animationSystem) {
    this.uiLayer = uiLayer;
    this.animationSystem = animationSystem;
    this.stack = document.createElement('div');
    this.stack.className = 'notification-stack';
    this.uiLayer.get('notification').appendChild(this.stack);
  }

  show(message, type = 'info', durationMs = 2600) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    this.stack.appendChild(toast);

    this.animationSystem.fadeIn(toast, 220);

    window.setTimeout(() => {
      this.animationSystem.fadeOut(toast, 240, 0, () => toast.remove());
    }, durationMs);
  }
}

/* ==========================================================================
   PopupSystem — generic modal builder used directly, or wrapped by
   DialogFramework for confirm/alert style flows.
   ========================================================================== */
class PopupSystem {
  constructor(uiLayer, animationSystem, touchManager) {
    this.uiLayer = uiLayer;
    this.animationSystem = animationSystem;
    this.touchManager = touchManager;
    this._current = null;
  }

  show({ title, message, buttons = [] }) {
    this.close();

    const backdrop = document.createElement('div');
    backdrop.className = 'popup-backdrop';

    const box = document.createElement('div');
    box.className = 'popup-box';

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'popup-title';
      titleEl.textContent = title;
      box.appendChild(titleEl);
    }

    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'popup-message';
      msgEl.textContent = message;
      box.appendChild(msgEl);
    }

    const buttonRow = document.createElement('div');
    buttonRow.className = 'popup-buttons';

    buttons.forEach((btnConfig) => {
      const btnEl = document.createElement('button');
      btnEl.className = `btn ${btnConfig.style === 'primary' ? 'btn--primary' : 'btn--ghost'}`;
      btnEl.textContent = btnConfig.label;
      this.touchManager.bindButton(btnEl, () => {
        if (btnConfig.onClick) btnConfig.onClick();
        this.close();
      });
      buttonRow.appendChild(btnEl);
    });

    box.appendChild(buttonRow);
    backdrop.appendChild(box);
    this.uiLayer.get('popup').appendChild(backdrop);

    this.animationSystem.add({
      target: { o: 0 }, props: { o: 1 }, duration: 200,
      onUpdate: (t) => { backdrop.style.opacity = t.o; }
    });
    this.animationSystem.scaleTo(box, 1, 260, Easing.elasticOut);
    box.style.transform = 'scale(0.85)';
    window.requestAnimationFrame(() => { this.animationSystem.scaleTo(box, 1, 260, Easing.cubicOut); });

    this._current = backdrop;
    return backdrop;
  }

  close() {
    if (!this._current) return;
    const el = this._current;
    this._current = null;
    this.animationSystem.fadeOut(el, 180, 0, () => el.remove());
  }
}

/* ==========================================================================
   DialogFramework — Promise-based confirm/alert helpers built on PopupSystem.
   ========================================================================== */
class DialogFramework {
  constructor(popupSystem, localization) {
    this.popupSystem = popupSystem;
    this.localization = localization;
  }

  confirm({ title, message, confirmLabel, cancelLabel }) {
    return new Promise((resolve) => {
      this.popupSystem.show({
        title,
        message,
        buttons: [
          { label: cancelLabel || this.localization.t('popup.cancel'), style: 'ghost', onClick: () => resolve(false) },
          { label: confirmLabel || this.localization.t('popup.confirm'), style: 'primary', onClick: () => resolve(true) }
        ]
      });
    });
  }

  alert({ title, message, buttonLabel = 'OK' }) {
    return new Promise((resolve) => {
      this.popupSystem.show({
        title,
        message,
        buttons: [{ label: buttonLabel, style: 'primary', onClick: () => resolve(true) }]
      });
    });
  }
}

/* ==========================================================================
   Shared gameplay popups — pause / daily objectives / upgrades.
   Both CafeScene and KitchenScene call these instead of each maintaining
   their own copy, since the underlying gameplay loop (and its pause state,
   objectives, and upgrades) is shared between the two scenes.
   ========================================================================== */
function openPausePopup(ctx, { onMainMenu } = {}) {
  ctx.gameplayLoop.pauseManager.pause();
  ctx.popupSystem.show({
    title: 'Paused',
    message: 'Take a breath \u2014 your caf\u00e9 will wait.',
    buttons: [
      { label: 'Main Menu', style: 'ghost', onClick: () => { if (onMainMenu) onMainMenu(); else ctx.sceneManager.goTo('main-menu'); } },
      { label: 'Resume', style: 'primary', onClick: () => ctx.gameplayLoop.pauseManager.resume() }
    ]
  });
}

function _closeCustomPopup(ctx, backdrop) {
  ctx.animationSystem.fadeOut(backdrop, 150, 0, () => backdrop.remove());
}

function openObjectivesPopup(ctx) {
  ctx.gameplayLoop.pauseManager.pause();
  const objectives = ctx.dailyObjectivesManager.list();

  const backdrop = document.createElement('div');
  backdrop.className = 'popup-backdrop';
  const box = document.createElement('div');
  box.className = 'popup-box popup-box--wide';
  box.innerHTML = `<div class="popup-title">Daily Objectives</div>`;

  objectives.forEach((obj) => {
    const complete = obj.progress >= obj.target;
    const claimed = ctx.dailyObjectivesManager.isClaimed(obj.id);
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-info">
        <span class="list-row-title">${obj.label}</span>
        <span class="list-row-sub">${Math.min(obj.progress, obj.target)} / ${obj.target} \u00b7 +${obj.reward.coins} coins</span>
      </div>
      <button class="btn btn--small ${complete && !claimed ? 'btn--primary' : 'disabled'}">${claimed ? 'Claimed' : 'Claim'}</button>
    `;
    const btn = row.querySelector('button');
    if (complete && !claimed) {
      ctx.touchManager.bindButton(btn, () => {
        ctx.dailyObjectivesManager.claim(obj.id);
        _closeCustomPopup(ctx, backdrop);
        openObjectivesPopup(ctx);
      });
    } else {
      btn.disabled = true;
    }
    box.appendChild(row);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn--ghost';
  closeBtn.style.marginTop = '14px';
  closeBtn.textContent = 'Close';
  ctx.touchManager.bindButton(closeBtn, () => { _closeCustomPopup(ctx, backdrop); ctx.gameplayLoop.pauseManager.resume(); });
  box.appendChild(closeBtn);

  backdrop.appendChild(box);
  ctx.uiLayer.get('popup').appendChild(backdrop);
  ctx.animationSystem.fadeIn(backdrop, 180);
}

function openUpgradesPopup(ctx, { onSeatUpgrade } = {}) {
  ctx.gameplayLoop.pauseManager.pause();
  const backdrop = document.createElement('div');
  backdrop.className = 'popup-backdrop';
  const box = document.createElement('div');
  box.className = 'popup-box popup-box--wide';
  box.innerHTML = `<div class="popup-title">Upgrades</div>`;

  UPGRADE_DATABASE.forEach((def) => {
    const level = ctx.gameState.data.upgrades[def.id] || 0;
    const locked = ctx.gameState.data.progression.level < def.unlockLevel;
    const maxed = ctx.upgradeManager.isMaxed(def.id);
    const cost = ctx.upgradeManager.costFor(def.id);

    const row = document.createElement('div');
    row.className = 'list-row';
    const subText = locked ? `Unlocks at Lv. ${def.unlockLevel}` : maxed ? 'Maxed out' : `Lv. ${level}/${def.maxLevel} \u00b7 ${cost} coins`;
    row.innerHTML = `
      <div class="list-row-info">
        <span class="list-row-title">${def.name}</span>
        <span class="list-row-sub">${subText}</span>
      </div>
      <button class="btn btn--small ${!locked && !maxed ? 'btn--primary' : 'disabled'}">Buy</button>
    `;
    const btn = row.querySelector('button');
    if (!locked && !maxed) {
      ctx.touchManager.bindButton(btn, () => {
        const result = ctx.upgradeManager.purchase(def.id);
        if (result.success) {
          if (def.id === 'extraSeat' && onSeatUpgrade) onSeatUpgrade();
          ctx.notificationSystem.show(`${def.name} upgraded!`, 'success', 1600);
        } else if (result.reason === 'insufficient-funds') {
          ctx.notificationSystem.show('Not enough coins.', 'error', 1600);
        }
        _closeCustomPopup(ctx, backdrop);
        openUpgradesPopup(ctx, { onSeatUpgrade });
      });
    } else {
      btn.disabled = true;
    }
    box.appendChild(row);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn--ghost';
  closeBtn.style.marginTop = '14px';
  closeBtn.textContent = 'Close';
  ctx.touchManager.bindButton(closeBtn, () => { _closeCustomPopup(ctx, backdrop); ctx.gameplayLoop.pauseManager.resume(); });
  box.appendChild(closeBtn);

  backdrop.appendChild(box);
  ctx.uiLayer.get('popup').appendChild(backdrop);
  ctx.animationSystem.fadeIn(backdrop, 180);
}
