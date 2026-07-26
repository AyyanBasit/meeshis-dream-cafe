'use strict';

function stationForRecipe(recipeId) {
  const steps = RECIPE_STEPS[recipeId];
  return steps && steps[0] ? steps[0].station : null;
}

class KitchenScene extends Scene {
  constructor(ctx) { super('kitchen', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cozy-bg"></div>

      <div class="cafe-hud">
        <div class="hud-stat hud-coins-wrap">\ud83e\ude99 <span class="hud-coins">0</span></div>
        <div class="hud-level-wrap">
          <span class="hud-level-label">Lv. <span class="hud-level-num">1</span></span>
          <div class="hud-level-bar"><div class="hud-level-fill"></div></div>
        </div>
        <div class="hud-stat hud-combo">Combo x0</div>
        <div class="hud-buttons">
          <button class="icon-btn dining-btn" aria-label="Dining Room">\ud83c\udf7d\ufe0f</button>
          <button class="icon-btn objectives-btn" aria-label="Daily Objectives">\ud83d\udccb</button>
          <button class="icon-btn pause-btn" aria-label="Pause">\u275a\u275a</button>
        </div>
      </div>

      <div class="kitchen-orders-strip"></div>
      <div class="kitchen-stations">
        <div class="station" data-station="coffee">
          <div class="station-header">\u2615 <span>Espresso Machine</span></div>
          <div class="station-body"></div>
        </div>
        <div class="station" data-station="tea">
          <div class="station-header">\ud83c\udff5\ufe0f <span>Kettle</span></div>
          <div class="station-body"></div>
        </div>
        <div class="station" data-station="drink">
          <div class="station-header">\ud83e\uddc3 <span>Juice Press</span></div>
          <div class="station-body"></div>
        </div>
        <div class="station" data-station="dessert">
          <div class="station-header">\ud83c\udf70 <span>Bakery &amp; Dessert Counter</span></div>
          <div class="station-body"></div>
        </div>
      </div>

      <div class="kitchen-sink" data-action="tidy">
        <span class="kitchen-sink-icon">\ud83e\uddfc</span>
        <span class="kitchen-sink-label">Cleaning Sink</span>
      </div>
      <div class="kitchen-serving-counter">
        <span class="kitchen-serving-icon">\ud83d\udecd\ufe0f</span>
        <span class="kitchen-serving-label">Serving Counter</span>
      </div>
      <div class="kitchen-tray">
        <span class="tray-capacity-label"></span>
        <div class="tray-items"></div>
      </div>
    `;

    this.coinsEl = this.element.querySelector('.hud-coins');
    this.levelNumEl = this.element.querySelector('.hud-level-num');
    this.levelFillEl = this.element.querySelector('.hud-level-fill');
    this.comboEl = this.element.querySelector('.hud-combo');
    this.ordersStripEl = this.element.querySelector('.kitchen-orders-strip');
    this.trayEl = this.element.querySelector('.tray-items');
    this.trayCapacityLabelEl = this.element.querySelector('.tray-capacity-label');
    this.stationBodies = {
      coffee: this.element.querySelector('[data-station="coffee"] .station-body'),
      tea: this.element.querySelector('[data-station="tea"] .station-body'),
      drink: this.element.querySelector('[data-station="drink"] .station-body'),
      dessert: this.element.querySelector('[data-station="dessert"] .station-body')
    };

    this.ctx.touchManager.bindButton(this.element.querySelector('.dining-btn'), () => { this.ctx.audioManager.playSfx('click'); this.ctx.sceneManager.goTo('cafe'); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.objectives-btn'), () => { this.ctx.audioManager.playSfx('click'); openObjectivesPopup(this.ctx); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.pause-btn'), () => { this.ctx.audioManager.playSfx('click'); openPausePopup(this.ctx); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.kitchen-sink'), () => this._onTidy());

    this.player = new PlayerCharacter(this.ctx);
    this.element.appendChild(this.player.element);

    this._holdState = {
      coffee: { holding: false, elapsedMs: 0 },
      tea: { holding: false, elapsedMs: 0 },
      drink: { holding: false, elapsedMs: 0 },
      dessert: { holding: false, elapsedMs: 0 }
    };
    this._lastTidyAt = 0;
    this._dragGhost = null;
    this._renderedStationKey = { coffee: '', tea: '', drink: '', dessert: '' };

    this._bindKitchenEvents();
  }

  _bindKitchenEvents() {
    this.ctx.bus.on('kitchen:burned', ({ station }) => {
      this.ctx.settingsManager.vibrate([0, 20, 40, 20]);
      this.ctx.audioManager.playSfx('burned');
      this.ctx.notificationSystem.show('Burned! That order needs to be restarted.', 'error', 2000);
      this._flashStation(station);
      CameraFX.shake(this.ctx, this.element, 5, 260);
    });
    this.ctx.bus.on('kitchen:trayFull', () => {
      this.ctx.notificationSystem.show('Tray is full \u2014 deliver something first!', 'error', 1800);
    });
    this.ctx.bus.on('kitchen:comboMilestone', ({ streak, bonus }) => {
      this.ctx.audioManager.playSfx('combo');
      this.ctx.notificationSystem.show(`${streak} perfect in a row! +${bonus} coins`, 'success', 2000);
      this.player.celebrate();
    });
    this.ctx.bus.on('kitchen:wrongCustomer', () => {
      this.ctx.notificationSystem.show('That customer is already gone.', 'error', 1800);
    });
  }

  enter() {
    this._refreshHud();
    this.player.idle();
    this._ambientHandle = window.setInterval(() => {
      if (!this.ctx.settingsManager.reducedMotion) this.ctx.particles.spawnAmbient(1);
    }, 1100);
    showTutorialHint(this.ctx, 'kitchen-intro');
  }

  exit() {
    super.exit();
    this.ctx.uiLayer.clear('popup');
    this._endAnyHold();
    window.clearInterval(this._ambientHandle);
  }

  update(deltaSec) {
    const deltaMs = deltaSec * 1000;
    this.player.update(deltaMs);
    this._tickHold(deltaMs);
    this._renderOrders();
    this._renderStations();
    this._renderTray();
    this._refreshHud();
    this.ctx.dayNightManager.applyTo(this.element);
  }

  /* --------------------------- HUD --------------------------- */

  _refreshHud() {
    const data = this.ctx.gameState.data;
    this.coinsEl.textContent = data.currency.coins;
    this.levelNumEl.textContent = data.progression.level;
    const need = GameState.xpToNextLevel(data.progression.level);
    this.levelFillEl.style.width = `${Math.min(100, (data.progression.xp / need) * 100)}%`;
    this.comboEl.textContent = `Combo x${this.ctx.kitchenGameplay.comboStreak}`;
    this.comboEl.classList.toggle('active', this.ctx.kitchenGameplay.comboStreak > 0);
  }

  _onTidy() {
    const now = performance.now();
    if (now - this._lastTidyAt < 15000) {
      this.ctx.notificationSystem.show('Already tidy!', 'info', 1200);
      return;
    }
    this._lastTidyAt = now;
    this.player.clean(() => this.player.idle());
    this.ctx.gameState.addCoins(2);
    this.ctx.saveManager.save();
    this.ctx.notificationSystem.show('Tidied up! +2 coins', 'success', 1400);
  }

  /* --------------------------- Orders strip --------------------------- */

  _renderOrders() {
    const orders = this.ctx.kitchenGameplay.unstartedOrders();
    this.ordersStripEl.innerHTML = orders.map((c) => `
      <div class="order-ticket tappable ${c.patienceRatio() <= EconomyBalancing.angryThresholdRatio ? 'order-ticket--urgent' : ''}" data-customer="${c.id}">
        ${c.personalityDef.icon ? `<span class="ticket-personality">${c.personalityDef.icon}</span>` : ''}
        <span class="ticket-face">${c.face}</span>
        <span class="ticket-emoji">${c.order.emoji}</span>
      </div>
    `).join('') || `<div class="order-ticket">No new orders yet</div>`;

    orders.forEach((c) => {
      const el = this.ordersStripEl.querySelector(`[data-customer="${c.id}"]`);
      if (el) this.ctx.touchManager.bindButton(el, () => this._onOrderTap(c));
    });
  }

  _onOrderTap(customer) {
    const station = stationForRecipe(customer.order.id);
    if (!station) return;
    if (this.ctx.kitchenGameplay.sessionAt(station)) {
      this.ctx.notificationSystem.show('That station is already busy!', 'error', 1600);
      return;
    }
    this.ctx.kitchenGameplay.beginPrep(customer);
    this._renderedStationKey[station] = ''; // force rebuild
    this.player.wave();
    this.ctx.audioManager.playSfx('click');
  }

  /* --------------------------- Stations --------------------------- */

  _tickHold(deltaMs) {
    for (const station of this.ctx.kitchenGameplay.stations) {
      const hold = this._holdState[station];
      const session = this.ctx.kitchenGameplay.sessionAt(station);
      const step = session && session.currentStep();
      if (hold.holding && step && step.kind === 'machine') {
        hold.elapsedMs += deltaMs;
        this._updateMachineFillVisual(station, step);
      }
    }
  }

  _updateMachineFillVisual(station, step) {
    const body = this.stationBodies[station];
    const fillEl = body.querySelector('.station-machine-fill');
    if (!fillEl) return;
    const holdMs = this.ctx.kitchenGameplay.effectiveHoldMs(step);
    const ratio = this._holdState[station].elapsedMs / holdMs;
    fillEl.style.height = `${Math.min(140, ratio * 100)}%`;
    const burnLimit = 1 + (KitchenBalancing.burnGraceMs / holdMs);
    fillEl.className = 'station-machine-fill' +
      (ratio >= burnLimit ? ' burn-zone' : Math.abs(1 - ratio) <= 0.08 ? ' perfect-zone' : '');
  }

  _endAnyHold() {
    for (const station of Object.keys(this._holdState)) this._holdState[station].holding = false;
  }

  _flashStation(station) {
    const el = this.element.querySelector(`[data-station="${station}"]`);
    if (!el) return;
    this.ctx.animationSystem.shake(el, 6, 300);
  }

  _renderStations() {
    for (const station of this.ctx.kitchenGameplay.stations) {
      const session = this.ctx.kitchenGameplay.sessionAt(station);
      const step = session && session.currentStep();
      const key = session ? `${session.customer.id}:${session.stepIndex}` : 'empty';
      if (this._renderedStationKey[station] === key) continue;
      this._renderedStationKey[station] = key;
      this._renderStationBody(station, session, step);
    }
  }

  _renderStationBody(station, session, step) {
    const body = this.stationBodies[station];

    if (!session) {
      body.innerHTML = `<div class="station-empty">Tap a matching order above to start cooking</div>`;
      return;
    }

    const top = `
      <div class="station-active-top">
        <span class="station-customer-face">${session.customer.face}</span>
        <span class="station-step-label">${step.label}</span>
        <span>${session.recipe.emoji}</span>
        <button class="icon-btn station-trash-btn" aria-label="Discard">\ud83d\uddd1\ufe0f</button>
      </div>
    `;

    if (step.kind === 'machine') {
      body.innerHTML = `
        ${top}
        <div class="station-machine-btn" data-hold="${station}">
          ${STATION_MACHINE_LABEL[station].emoji}
          <div class="station-machine-fill"></div>
        </div>
        <div class="station-empty">Hold to pour, release when full</div>
      `;
      const btn = body.querySelector('[data-hold]');
      this._bindHold(btn, station);
      this._bindTrashButton(body, station);
      return;
    }

    if (step.kind === 'container') {
      const chips = STATION_INGREDIENTS[station] || [];
      body.innerHTML = `
        ${top}
        <div class="station-drop-zone" data-drop="${station}">${STATION_MACHINE_LABEL[station].emoji}</div>
        <div class="station-chip-row">
          ${chips.map((c) => `<div class="ingredient-chip" data-chip="${c.id}" data-station="${station}">${c.emoji}<span class="chip-label">${c.label}</span></div>`).join('')}
        </div>
      `;
      body.querySelectorAll('.ingredient-chip').forEach((chip) => this._bindDrag(chip, station));
      this._bindTrashButton(body, station);
      return;
    }

    if (step.kind === 'assemble') {
      body.innerHTML = `
        ${top}
        <button class="btn btn--primary station-assemble-btn">Plate It</button>
      `;
      const btn = body.querySelector('.station-assemble-btn');
      this.ctx.touchManager.bindButton(btn, () => {
        this.ctx.kitchenGameplay.resolveNonMachineStep(station, PrepStepResult.PERFECT);
        this._renderedStationKey[station] = '';
      });
      this._bindTrashButton(body, station);
      return;
    }

    if (step.kind === 'serve') {
      body.innerHTML = `
        ${top}
        <button class="btn btn--primary station-serve-btn">Send to Tray</button>
      `;
      const btn = body.querySelector('.station-serve-btn');
      this.ctx.touchManager.bindButton(btn, () => {
        const item = this.ctx.kitchenGameplay.placeOnTray(station);
        if (item) {
          this._renderedStationKey[station] = '';
          this.ctx.audioManager.playSfx('serve');
          this.ctx.notificationSystem.show('Ready on the tray!', 'success', 1400);
        } else if (this.ctx.kitchenGameplay.tray.length >= this.ctx.upgradeManager.trayCapacityValue()) {
          this.ctx.notificationSystem.show('Tray is full \u2014 deliver something first!', 'error', 1800);
        }
      });
      this._bindTrashButton(body, station);
      return;
    }
  }

  _bindTrashButton(body, station) {
    const btn = body.querySelector('.station-trash-btn');
    if (!btn) return;
    this.ctx.touchManager.bindButton(btn, () => {
      this.ctx.kitchenGameplay.cancelPrep(station);
      this._renderedStationKey[station] = '';
      this.ctx.audioManager.playSfx('wrong');
      this.ctx.notificationSystem.show('Order discarded.', 'info', 1400);
    });
  }

  _bindHold(btn, station) {
    const start = (e) => {
      e.preventDefault();
      this._holdState[station].holding = true;
      this._holdState[station].elapsedMs = 0;
      btn.classList.add('pressed');
      this.ctx.audioManager.playSfx(station === 'dessert' ? 'oven' : 'steam');
      const rect = btn.getBoundingClientRect();
      this.ctx.particles.spawnBurst(rect.left + rect.width / 2, rect.top, 6, ['rgba(253,243,227,0.6)', 'rgba(253,243,227,0.35)']);
    };
    const stop = () => {
      if (!this._holdState[station].holding) return;
      this._holdState[station].holding = false;
      btn.classList.remove('pressed');

      const session = this.ctx.kitchenGameplay.sessionAt(station);
      const step = session && session.currentStep();
      if (!step || step.kind !== 'machine') return;

      const ratio = this._holdState[station].elapsedMs / this.ctx.kitchenGameplay.effectiveHoldMs(step);
      const outcome = this.ctx.kitchenGameplay.resolveMachineStep(station, ratio);
      this._renderedStationKey[station] = '';
      if (outcome && !outcome.burned) {
        this.ctx.settingsManager.vibrate(outcome.result === PrepStepResult.PERFECT ? [10, 30, 10] : 12);
      }
    };

    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  }

  _bindDrag(chip, station) {
    let ghost = null;

    const onMove = (e) => {
      if (!ghost) return;
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    };

    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      chip.classList.remove('dragging');
      if (ghost) { ghost.remove(); ghost = null; }

      const dropZone = this.element.querySelector(`[data-drop="${station}"]`);
      if (!dropZone) return;
      const rect = dropZone.getBoundingClientRect();
      const withinDrop = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!withinDrop) return;

      const session = this.ctx.kitchenGameplay.sessionAt(station);
      const step = session && session.currentStep();
      if (!step || step.kind !== 'container') return;

      const chipId = chip.dataset.chip;
      if (chipId === step.ingredient) {
        this.ctx.kitchenGameplay.resolveNonMachineStep(station, PrepStepResult.PERFECT);
        this._renderedStationKey[station] = '';
        this.ctx.settingsManager.vibrate(10);
      } else {
        dropZone.classList.add('shake');
        window.setTimeout(() => dropZone.classList.remove('shake'), 360);
        this.ctx.audioManager.playSfx('wrong');
        this.ctx.notificationSystem.show('Wrong ingredient for this step!', 'error', 1400);
      }
    };

    chip.addEventListener('pointerdown', (e) => {
      chip.classList.add('dragging');
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = chip.textContent.trim();
      document.body.appendChild(ghost);
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  /* --------------------------- Tray --------------------------- */

  _renderTray() {
    const tray = this.ctx.kitchenGameplay.tray;
    const capacity = this.ctx.upgradeManager.trayCapacityValue();
    this.trayCapacityLabelEl.textContent = `Tray ${tray.length}/${capacity}`;

    this.trayEl.innerHTML = tray.map((item, i) => {
      const isPerfectQuality = item.quality >= KitchenBalancing.qualityPerfectThreshold;
      const stars = '\u2b50'.repeat(isPerfectQuality ? 3 : item.quality >= 0.7 ? 2 : 1);
      return `
        <div class="tray-slot ${isPerfectQuality ? 'tray-slot--sparkle' : ''}" data-tray-index="${i}">
          <span class="tray-emoji">${item.session.recipe.emoji}</span>
          <span class="tray-face">${item.session.customer.face}</span>
          <span class="tray-stars">${stars}</span>
        </div>
      `;
    }).join('') || `<span class="tray-empty-label">Tray is empty \u2014 prepare something!</span>`;

    tray.forEach((item, i) => {
      const el = this.trayEl.querySelector(`[data-tray-index="${i}"]`);
      if (el) this.ctx.touchManager.bindButton(el, () => this._onTrayItemTap());
    });
  }

  _onTrayItemTap() {
    // Delivery itself happens in the dining room, where Meeshi visually
    // carries the tray over to the customer — no reward is ever granted
    // from here.
    this.ctx.notificationSystem.show('Take it to the dining room to serve it!', 'info', 1800);
  }
}
