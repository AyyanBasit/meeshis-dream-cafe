'use strict';

/* ==========================================================================
   CafeScene — the dining room. Customers walk in, sit at real tables,
   order, wait, and are served by Meeshi carrying a tray over from the
   counter. Cooking itself happens in KitchenScene; this scene owns the
   physical room, the customers' visible lifecycle, and the final delivery.
   ========================================================================== */
class CafeScene extends Scene {
  constructor(ctx) { super('cafe', ctx); }

  init() {
    this.element.innerHTML = `
      <div class="cafe-room">
        <div class="cafe-wall">
          <div class="cafe-window"></div>
          <div class="cafe-window"></div>
          <div class="cafe-light"></div>
          <div class="cafe-light"></div>
          <div class="cafe-wall-art"></div>
          <div class="deco-wall-slots"></div>
        </div>
        <div class="cafe-counter">
          <div class="cafe-counter-top"></div>
          <div class="cafe-espresso-deco">\u2615</div>
          <div class="cafe-dessert-case">\ud83c\udf70</div>
        </div>
        <div class="cafe-plant cafe-plant--left">\ud83e\udea4</div>
        <div class="cafe-plant cafe-plant--right">\ud83e\udea4</div>
        <div class="cafe-door" data-door="true">\ud83d\udeaa</div>
        <div class="deco-floor-slots"></div>
        <div class="cafe-rain"></div>
        <div class="cafe-floor"></div>
      </div>

      <div class="cafe-hud">
        <div class="hud-stat hud-coins-wrap">\ud83e\ude99 <span class="hud-coins">0</span></div>
        <div class="hud-level-wrap">
          <span class="hud-level-label">Lv. <span class="hud-level-num">1</span></span>
          <div class="hud-level-bar"><div class="hud-level-fill"></div></div>
        </div>
        <div class="hud-stat hud-reputation">\u2b50 <span class="hud-rep-num">3</span></div>
        <div class="hud-stat hud-combo">x1.0</div>
        <div class="hud-buttons">
          <button class="icon-btn kitchen-btn" aria-label="Kitchen">\ud83c\udf73</button>
          <button class="icon-btn decorate-btn" aria-label="Decorate">\ud83e\udded</button>
          <button class="icon-btn objectives-btn" aria-label="Daily Objectives">\ud83d\udccb</button>
          <button class="icon-btn upgrades-btn" aria-label="Upgrades">\u2b06\ufe0f</button>
          <button class="icon-btn pause-btn" aria-label="Pause">\u275a\u275a</button>
        </div>
      </div>

      <div class="event-banner hidden">
        <span class="event-banner-icon"></span>
        <span class="event-banner-text"></span>
      </div>

      <div class="cafe-queue"></div>
    `;

    this.coinsEl = this.element.querySelector('.hud-coins');
    this.levelNumEl = this.element.querySelector('.hud-level-num');
    this.levelFillEl = this.element.querySelector('.hud-level-fill');
    this.repNumEl = this.element.querySelector('.hud-rep-num');
    this.comboEl = this.element.querySelector('.hud-combo');
    this.queueEl = this.element.querySelector('.cafe-queue');
    this.floorEl = this.element.querySelector('.cafe-floor');
    this.roomEl = this.element.querySelector('.cafe-room');
    this.counterEl = this.element.querySelector('.cafe-counter');
    this.wallSlotsEl = this.element.querySelector('.deco-wall-slots');
    this.floorSlotsEl = this.element.querySelector('.deco-floor-slots');
    this.eventBannerEl = this.element.querySelector('.event-banner');

    this.ctx.touchManager.bindButton(this.element.querySelector('.pause-btn'), () => { this._click(); this._openPauseMenu(); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.objectives-btn'), () => { this._click(); this._openObjectives(); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.upgrades-btn'), () => { this._click(); this._openUpgrades(); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.kitchen-btn'), () => { this._click(); this.ctx.sceneManager.goTo('kitchen'); });
    this.ctx.touchManager.bindButton(this.element.querySelector('.decorate-btn'), () => { this._click(); this._openDecorate(); });

    // Meeshi stands by the counter by default, and walks out to deliver.
    this.player = new PlayerCharacter(this.ctx);
    this.player.element.classList.add('meeshi-counter');
    this.roomEl.appendChild(this.player.element);
    this._meeshiBusy = false;

    this._seatElements = [];
    this._visualByCustomerId = new Map(); // customerId -> { el, figureEl }
    this._buildSeatSlots();
    this._bindLifecycleEvents();
  }

  _click() { this.ctx.audioManager.playSfx('click'); }

  _bindLifecycleEvents() {
    this.ctx.bus.on('customer:seated', (customer) => this._onCustomerSeated(customer));
    this.ctx.bus.on('customer:reacting', (customer) => this._onCustomerReacting(customer));
    this.ctx.bus.on('customer:angry', (customer) => this._onCustomerAngry(customer));
    this.ctx.bus.on('customer:leaving', ({ customer, angry }) => this._onCustomerLeaving(customer, angry));
    this.ctx.bus.on('customer:spawned', () => this.ctx.audioManager.playSfx('door-bell'));
    this.ctx.bus.on('player:levelup', () => this._onLevelUp());
    this.ctx.bus.on('achievements:unlocked', (list) => this._onAchievementsUnlocked(list));
    this.ctx.bus.on('cafeEvent:started', ({ def }) => this._onCafeEventStarted(def));
    this.ctx.bus.on('cafeEvent:ended', () => this._onCafeEventEnded());
    this.ctx.bus.on('specialVisitor:arrived', (customer) => this._onSpecialVisitorArrived(customer));
  }

  enter() {
    this.loop = this.ctx.gameplayLoop;
    this.loop.pauseManager.resume();
    if (this._seatElements.length !== this.loop.seating.seats.length) this._buildSeatSlots();
    this.player.idle();
    this._refreshHud();
    this._ambientHandle = window.setInterval(() => {
      if (!this.ctx.settingsManager.reducedMotion) this.ctx.particles.spawnAmbient(1);
    }, 900);
    this.ctx.weatherManager.rollForNewDayIfNeeded();
    this._decorRenderKey = '';
    this._renderDecorations();

    if (!this._dailyRewardOfferedThisSession) {
      this._dailyRewardOfferedThisSession = true;
      if (this.ctx.dailyLoginManager.canClaimToday()) {
        window.setTimeout(() => openDailyRewardPopup(this.ctx), 500);
      }
    }
    this.ctx.achievementManager.checkAll();
    showTutorialHint(this.ctx, 'welcome-kitchen');
  }

  exit() {
    super.exit();
    this.ctx.uiLayer.clear('popup');
    window.clearInterval(this._ambientHandle);
  }

  _buildSeatSlots() {
    // Preserve any currently-mounted customer visuals when rebuilding
    // (e.g. after buying the extraSeat upgrade) instead of discarding them.
    this.floorEl.innerHTML = '';
    this._seatElements = this.loop.seating.seats.map((seat) => {
      const tableEl = document.createElement('div');
      tableEl.className = 'seat';
      tableEl.dataset.seatIndex = seat.index;
      tableEl.innerHTML = `
        <div class="table-shadow"></div>
        <div class="table-top"></div>
        <div class="chair chair--back"></div>
        <div class="chair chair--front"></div>
        <div class="seat-occupant"></div>
      `;
      this.floorEl.appendChild(tableEl);

      if (seat.occupant) {
        // Re-attach an existing customer's figure into the rebuilt table.
        const existing = this._visualByCustomerId.get(seat.occupant.id);
        if (existing) tableEl.querySelector('.seat-occupant').appendChild(existing.el);
        if (seat.occupant.order) this._buildOrderBubble(tableEl, seat.occupant);
      }
      return tableEl;
    });
  }

  _renderDecorations() {
    const placed = this.ctx.gameState.data.decorations.placed;
    const key = placed.join(',');
    if (this._decorRenderKey === key) return;
    this._decorRenderKey = key;

    const wall = this.ctx.decorationManager.placedInSlot('wall');
    const floor = this.ctx.decorationManager.placedInSlot('floor');
    this.wallSlotsEl.innerHTML = wall.map((d) => `<span class="deco-item deco-item--wall" title="${d.name}">${d.emoji}</span>`).join('');
    this.floorSlotsEl.innerHTML = floor.map((d) => `<span class="deco-item deco-item--floor" title="${d.name}">${d.emoji}</span>`).join('');
  }

  update(deltaSec) {
    if (!this.loop) return;
    const deltaMs = deltaSec * 1000;
    this.player.update(deltaMs);

    if (this._seatElements.length !== this.loop.seating.seats.length) this._buildSeatSlots();

    this._renderQueue();
    this._renderPatienceBars();
    this._renderReadyBadges();
    this._refreshHud();
    this.ctx.dayNightManager.applyTo(this.roomEl);
    const weather = this.ctx.weatherManager.applyTo(this.roomEl);

    if (this.ctx.cafeEventManager.activeKey) {
      this.ctx.audioManager.playAmbience('event-music');
    } else if (weather === 'rain') {
      this.ctx.audioManager.playAmbience('rain-ambience');
    } else {
      const phase = this.ctx.dayNightManager.currentPhase();
      if (phase === 'morning') this.ctx.audioManager.playAmbience('morning-ambience');
      else if (phase === 'evening' || phase === 'night') this.ctx.audioManager.playAmbience('evening-ambience');
      else this.ctx.audioManager.stopAmbience();
    }
  }

  _renderQueue() {
    const queue = this.loop.spawner.queue;
    if (this.queueEl.childElementCount !== queue.length) {
      this.queueEl.innerHTML = queue.map((c) => `<div class="queue-avatar">${c.face}</div>`).join('');
    }
  }

  /* --------------------------- Customer visual lifecycle --------------------------- */

  _onCustomerSeated(customer) {
    const seatEl = this._seatElements[customer.seatIndex];
    if (!seatEl) return;
    const occupantSlot = seatEl.querySelector('.seat-occupant');

    const figureEl = CustomerRenderer.mount(customer);
    if (customer.specialDef) figureEl.classList.add('customer-figure--special');
    occupantSlot.appendChild(figureEl);
    this._visualByCustomerId.set(customer.id, { el: figureEl });

    const isReturning = this.ctx.customerMemoryManager.isReturning(customer);
    const greeting = customer.specialDef ? '' : isReturning ? '\ud83d\udc4b' : '\u2026';

    // Walk in from the door instead of popping/fading into existence.
    const doorEl = this.element.querySelector('.cafe-door');
    figureEl.style.opacity = '0';
    if (doorEl) {
      const doorRect = doorEl.getBoundingClientRect();
      const seatRect = seatEl.getBoundingClientRect();
      const startDx = (doorRect.left) - (seatRect.left + seatRect.width / 2);
      const startDy = (doorRect.top) - (seatRect.top + seatRect.height - 30);
      CustomerRenderer.setPose(figureEl, 'walking');
      const state = { x: startDx, y: startDy, o: 0 };
      figureEl.style.transform = `translate(${state.x}px, ${state.y}px)`;
      this.ctx.animationSystem.add({
        target: state,
        props: { x: 0, y: 0, o: 1 },
        duration: Math.max(420, customer.walkSpeedMs),
        easing: Easing.quadOut,
        onUpdate: () => { figureEl.style.transform = `translate(${state.x}px, ${state.y}px)`; figureEl.style.opacity = state.o; },
        onComplete: () => {
          figureEl.style.transform = '';
          CustomerRenderer.setPose(figureEl, 'idle');
          if (greeting) spawnSpeechBubble(this.ctx, seatEl, greeting);
        }
      });
    } else {
      figureEl.style.transform = 'translateY(14px) scale(0.9)';
      this.ctx.animationSystem.add({
        target: { y: 14, s: 0.9, o: 0 },
        props: { y: 0, s: 1, o: 1 },
        duration: 360,
        easing: Easing.cubicOut,
        onUpdate: (t) => { figureEl.style.transform = `translateY(${t.y}px) scale(${t.s})`; figureEl.style.opacity = t.o; }
      });
    }

    this._buildOrderBubble(seatEl, customer);
    this.ctx.audioManager.playSfx('chair');
  }

  _buildOrderBubble(seatEl, customer) {
    let bubble = seatEl.querySelector('.order-bubble');
    if (bubble) bubble.remove();
    if (!customer.order) return;

    bubble = document.createElement('div');
    bubble.className = 'order-bubble';
    bubble.innerHTML = `
      <div class="order-emoji">${customer.order.emoji}</div>
      <div class="patience-bar"><div class="patience-fill"></div></div>
    `;
    seatEl.appendChild(bubble);
    bubble.style.transform = 'translateY(6px) scale(0.6)';
    bubble.style.opacity = '0';
    this.ctx.animationSystem.add({
      target: { y: 6, s: 0.6, o: 0 },
      props: { y: 0, s: 1, o: 1 },
      duration: 260,
      easing: Easing.elasticOut,
      onUpdate: (t) => { bubble.style.transform = `translateY(${t.y}px) scale(${t.s})`; bubble.style.opacity = t.o; }
    });
  }

  _renderPatienceBars() {
    for (const customer of this.loop.seatedCustomers) {
      if (customer.state !== CustomerState.WAITING_FOR_ORDER || !customer.order) continue;
      const seatEl = this._seatElements[customer.seatIndex];
      if (!seatEl) continue;
      const fill = seatEl.querySelector('.patience-fill');
      if (!fill) continue;
      const ratio = customer.patienceRatio();
      fill.style.width = `${Math.round(ratio * 100)}%`;
      fill.className = `patience-fill ${ratio <= EconomyBalancing.angryThresholdRatio ? 'danger' : ratio <= 0.5 ? 'warning' : ''}`;

      const visual = this._visualByCustomerId.get(customer.id);
      if (visual) {
        const tier = customer.moodTier();
        CustomerRenderer.setPose(visual.el, tier === 'angry' ? 'angry' : tier === 'annoyed' ? 'annoyed' : 'idle');
      }
    }
  }

  _onCustomerAngry(customer) {
    const visual = this._visualByCustomerId.get(customer.id);
    if (visual) this.ctx.animationSystem.shake(visual.el, 4, 260);
    const seatEl = this._seatElements[customer.seatIndex];
    if (seatEl) spawnSpeechBubble(this.ctx, seatEl, '!');
    CameraFX.shake(this.ctx, this.roomEl, 3, 200);
  }

  _onCustomerReacting(customer) {
    const visual = this._visualByCustomerId.get(customer.id);
    const seatEl = this._seatElements[customer.seatIndex];
    if (seatEl) {
      const bubble = seatEl.querySelector('.order-bubble');
      if (bubble) bubble.remove();
      spawnSpeechBubble(this.ctx, seatEl, customer.happiness > 0.7 ? '\u2764\ufe0f' : customer.happiness > 0 ? '\ud83d\ude42' : '\ud83d\ude20');
    }
    if (!visual) return;
    CustomerRenderer.setPose(visual.el, customer.happiness > 0 ? 'happy' : 'sad');
    this.ctx.animationSystem.bounce(visual.el, 8, 380);
  }

  _onCustomerLeaving(customer, angry) {
    const visual = this._visualByCustomerId.get(customer.id);
    this._visualByCustomerId.delete(customer.id);
    if (!visual) return;

    if (angry) {
      CameraFX.shake(this.ctx, this.roomEl, 5, 240);
      this.ctx.animationSystem.shake(this.player.element, 3, 220);
    }
    CustomerRenderer.setPose(visual.el, angry ? 'angry' : 'happy');

    const doorEl = this.element.querySelector('.cafe-door');
    const seatEl = this._seatElements[customer.seatIndex];
    let targetX = 0, targetY = 16;
    if (doorEl && seatEl) {
      const doorRect = doorEl.getBoundingClientRect();
      const seatRect = seatEl.getBoundingClientRect();
      targetX = doorRect.left - (seatRect.left + seatRect.width / 2);
      targetY = doorRect.top - (seatRect.top + seatRect.height - 30);
    }

    CustomerRenderer.setFlip(visual.el, targetX < 0);
    const state = { x: 0, y: 0, o: 1 };
    this.ctx.animationSystem.add({
      target: state,
      props: { x: targetX, y: targetY, o: 0 },
      duration: Math.max(380, customer.walkSpeedMs),
      easing: Easing.quadIn,
      onUpdate: () => { visual.el.style.transform = `translate(${state.x}px, ${state.y}px)`; visual.el.style.opacity = state.o; },
      onComplete: () => CustomerRenderer.remove(visual.el)
    });

    if (seatEl) {
      const bubble = seatEl.querySelector('.order-bubble');
      if (bubble) this.ctx.animationSystem.fadeOut(bubble, 250, 0, () => bubble.remove());
    }
  }

  /* --------------------------- Serving (tray → table) --------------------------- */

  _renderReadyBadges() {
    const tray = this.ctx.kitchenGameplay.tray;
    for (const seatEl of this._seatElements) {
      const seatIndex = Number(seatEl.dataset.seatIndex);
      const seat = this.loop.seating.seats[seatIndex];
      const customer = seat && seat.occupant;
      const trayItem = customer && tray.find((t) => t.session.customer.id === customer.id);

      let badge = seatEl.querySelector('.ready-badge');
      if (trayItem && !badge) {
        badge = document.createElement('button');
        badge.className = 'ready-badge';
        if (trayItem.quality >= KitchenBalancing.qualityPerfectThreshold) badge.classList.add('order-bubble--sparkle');
        badge.textContent = '\ud83d\udd14';
        seatEl.appendChild(badge);
        this.ctx.touchManager.bindButton(badge, () => this._onDeliverTap(customer, trayItem));
        this.ctx.animationSystem.elastic(badge, 1.25, 400);
      } else if (!trayItem && badge) {
        badge.remove();
      }
    }
  }

  _onDeliverTap(customer, trayItem) {
    if (this._meeshiBusy) return;
    const seatEl = this._seatElements[customer.seatIndex];
    if (!seatEl) return;
    this._meeshiBusy = true;

    const badge = seatEl.querySelector('.ready-badge');
    if (badge) badge.remove();

    const homeRect = this.player.element.getBoundingClientRect();
    const seatRect = seatEl.getBoundingClientRect();
    const dx = (seatRect.left + seatRect.width / 2) - (homeRect.left + homeRect.width / 2);
    const dy = (seatRect.top + seatRect.height / 2) - (homeRect.top + homeRect.height / 2);

    this._walkPlayerTo(dx, dy, () => this._deliverAtTable(customer, trayItem, { x: dx, y: dy }));
  }

  /** Two-leg waypoint walk (aisle-first, then across to the table) instead
   *  of a single diagonal tween — a lightweight stand-in for real
   *  pathfinding that still reads as "walking the room" rather than
   *  floating through furniture. */
  _walkPlayerTo(dx, dy, onArrive) {
    this.player.walk();
    this.player.element.classList.toggle('facing-left', dx < 0);
    this.ctx.audioManager.playSfx('footstep');

    const state = { x: 0, y: 0 };
    const applyTransform = () => { this.player.element.style.transform = `translate(${state.x}px, ${state.y}px)`; };
    const totalDist = Math.abs(dx) + Math.abs(dy);
    const leg1Duration = totalDist > 0 ? Math.max(160, 480 * (Math.abs(dy) / totalDist)) : 0;
    const leg2Duration = totalDist > 0 ? Math.max(160, 480 * (Math.abs(dx) / totalDist)) : 260;

    this.ctx.animationSystem.add({
      target: state,
      props: { y: dy },
      duration: leg1Duration,
      easing: Easing.linear,
      onUpdate: applyTransform,
      onComplete: () => {
        this.ctx.audioManager.playSfx('footstep');
        this.ctx.animationSystem.add({
          target: state,
          props: { x: dx },
          duration: leg2Duration,
          easing: Easing.linear,
          onUpdate: applyTransform,
          onComplete: onArrive
        });
      }
    });
  }

  _deliverAtTable(customer, trayItem, walkState) {
    this.player.serve(() => {
      const outcome = this.ctx.kitchenGameplay.deliverTrayItem(trayItem);
      const seatEl = this._seatElements[customer.seatIndex];

      if (outcome && outcome.delivered) {
        this.ctx.audioManager.playSfx('coin');
        if (outcome.result.isPerfect) {
          this.ctx.audioManager.playSfx('perfect');
          this.player.celebrate();
        }
        if (seatEl) {
          const rect = seatEl.getBoundingClientRect();
          const floorRect = this.floorEl.getBoundingClientRect();
          spawnFloatingText(this.ctx, this.floorEl, {
            x: rect.left - floorRect.left + rect.width / 2,
            y: rect.top - floorRect.top,
            text: `+${outcome.result.coinsEarned}`,
            className: 'floating-text--coin'
          });
          this.ctx.particles.spawnBurst(
            rect.left + rect.width / 2, rect.top,
            outcome.quality >= KitchenBalancing.qualityPerfectThreshold ? 16 : 8,
            ['rgba(224,168,62,0.9)', 'rgba(253,243,227,0.9)']
          );
          if (outcome.quality >= KitchenBalancing.qualityPerfectThreshold) {
            CameraFX.zoomPulse(this.ctx, this.roomEl, 0.015, 220);
          }
        }
        if (this.loop.combo.count > 1) this.ctx.audioManager.playSfx('combo');
      } else {
        this.ctx.notificationSystem.show('That customer already left \u2014 no reward.', 'error', 1800);
      }

      // Walk back to the counter via the same two-leg aisle path, reversed.
      const backState = { x: walkState.x, y: walkState.y };
      const applyBack = () => { this.player.element.style.transform = `translate(${backState.x}px, ${backState.y}px)`; };
      this.player.walk();
      this.player.element.classList.toggle('facing-left', walkState.x > 0);
      this.ctx.animationSystem.add({
        target: backState,
        props: { x: 0 },
        duration: 260,
        easing: Easing.linear,
        onUpdate: applyBack,
        onComplete: () => {
          this.ctx.animationSystem.add({
            target: backState,
            props: { y: 0 },
            duration: 260,
            easing: Easing.linear,
            onUpdate: applyBack,
            onComplete: () => {
              this.player.element.classList.remove('facing-left');
              this.player.idle();
              this._meeshiBusy = false;
            }
          });
        }
      });
    });
  }

  _onLevelUp() {
    this.ctx.audioManager.playSfx('levelup');
    CameraFX.zoomPulse(this.ctx, this.roomEl, 0.02, 320);
    this.player.celebrate();
    this.ctx.notificationSystem.show('Level Up!', 'success', 1800);
  }

  _onAchievementsUnlocked(list) {
    // Queue them one at a time so multiple simultaneous unlocks don't overlap.
    list.forEach((def, i) => {
      window.setTimeout(() => {
        this.ctx.audioManager.playSfx('achievement');
        CameraFX.zoomPulse(this.ctx, this.roomEl, 0.02, 300);
        showAchievementPopup(this.ctx, def);
      }, i * 1400);
    });
  }

  _onCafeEventStarted(def) {
    this.eventBannerEl.querySelector('.event-banner-icon').textContent = def.icon;
    this.eventBannerEl.querySelector('.event-banner-text').textContent = def.bannerText;
    this.eventBannerEl.classList.remove('hidden');
    this.ctx.animationSystem.slideIn(this.eventBannerEl, -20, 320);
    this.ctx.audioManager.playSfx('combo');
    this.ctx.notificationSystem.show(`${def.icon} ${def.name} has started!`, 'info', 2200);
  }

  _onCafeEventEnded() {
    this.ctx.animationSystem.fadeOut(this.eventBannerEl, 260, 0, () => this.eventBannerEl.classList.add('hidden'));
  }

  _onSpecialVisitorArrived(customer) {
    const seatEl = this._seatElements[customer.seatIndex];
    if (!seatEl) return;
    this.ctx.audioManager.playSfx('rare-customer');
    this.ctx.settingsManager.vibrate([0, 15, 30, 15]);
    window.setTimeout(() => {
      spawnSpeechBubble(this.ctx, seatEl, customer.specialDef.dialogueGreeting);
    }, 500);
    this.ctx.notificationSystem.show(`${customer.specialDef.icon} A ${customer.specialDef.name} has arrived!`, 'success', 2400);
    CameraFX.zoomPulse(this.ctx, this.roomEl, 0.015, 280);
  }

  _refreshHud() {
    const data = this.ctx.gameState.data;
    this.coinsEl.textContent = data.currency.coins;
    this.levelNumEl.textContent = data.progression.level;
    const need = GameState.xpToNextLevel(data.progression.level);
    this.levelFillEl.style.width = `${Math.min(100, (data.progression.xp / need) * 100)}%`;
    this.repNumEl.textContent = data.reputation.stars;

    const multiplier = this.loop.combo.multiplier;
    this.comboEl.textContent = `x${multiplier.toFixed(1)}`;
    this.comboEl.classList.toggle('active', this.loop.combo.count > 0);
  }

  /* --------------------------- Popups --------------------------- */

  _openPauseMenu() {
    openPausePopup(this.ctx);
  }

  _openObjectives() {
    openObjectivesPopup(this.ctx);
  }

  _openUpgrades() {
    openUpgradesPopup(this.ctx, { onSeatUpgrade: () => this.loop.applyExtraSeatUpgrade() });
  }

  _openDecorate() {
    openDecoratePopup(this.ctx, { onChange: () => { this._decorRenderKey = ''; this._renderDecorations(); } });
  }
}
