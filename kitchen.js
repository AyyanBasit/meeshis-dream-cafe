'use strict';

/* ==========================================================================
   PrepSession — one in-progress item being cooked: walks a customer's
   order through its RECIPE_STEPS, tracking per-step quality so the final
   tray item carries a real quality score back to CafeGameplayLoop.
   ========================================================================== */
const PrepStepResult = Object.freeze({ PERFECT: 'perfect', GOOD: 'good' });

class PrepSession {
  constructor(customer) {
    this.customer = customer;
    this.recipe = customer.order;
    this.steps = RECIPE_STEPS[this.recipe.id] || [];
    this.stepIndex = 0;
    this.stepResults = [];
    this.burned = false;
  }

  currentStep() {
    return this.steps[this.stepIndex] || null;
  }

  isComplete() {
    const step = this.currentStep();
    return !!step && step.kind === 'serve';
  }

  advance(result) {
    this.stepResults.push(result);
    this.stepIndex += 1;
  }

  qualityScore() {
    if (this.stepResults.length === 0) return 0;
    const total = this.stepResults.reduce(
      (sum, r) => sum + (r === PrepStepResult.PERFECT ? KitchenBalancing.qualityPerfectScore : KitchenBalancing.qualityGoodScore),
      0
    );
    return total / this.stepResults.length;
  }
}

/* ==========================================================================
   KitchenGameplay — owns the three stations, the active prep sessions, and
   the tray of finished items. Reads its work queue from the SAME shared
   CafeGameplayLoop (ctx.gameplayLoop) that the dining room uses, so an
   order generated at a table is the exact order the kitchen prepares.
   ========================================================================== */
class KitchenGameplay {
  constructor(ctx) {
    this.ctx = ctx;
    this.stations = ['coffee', 'tea', 'dessert'];
    this.activeSessionByStation = { coffee: null, tea: null, dessert: null };
    this.tray = []; // { session, quality }
    this.comboStreak = 0;
  }

  /** Orders currently waiting on a table with no prep session started yet. */
  unstartedOrders() {
    const inProgressIds = new Set(Object.values(this.activeSessionByStation).filter(Boolean).map((s) => s.customer.id));
    const onTrayIds = new Set(this.tray.map((t) => t.session.customer.id));
    return this.ctx.gameplayLoop.seatedCustomers.filter((c) =>
      c.state === CustomerState.WAITING_FOR_ORDER && c.order &&
      !inProgressIds.has(c.id) && !onTrayIds.has(c.id)
    );
  }

  /** Player picks an order off the queue to start cooking it. */
  beginPrep(customer) {
    const step = (RECIPE_STEPS[customer.order.id] || [])[0];
    if (!step) return null;
    const session = new PrepSession(customer);
    this.activeSessionByStation[step.station] = session;
    return session;
  }

  cancelPrep(station) {
    this.activeSessionByStation[station] = null;
  }

  sessionAt(station) {
    return this.activeSessionByStation[station];
  }

  /** A container/assemble step resolved — advances the session and hands
   *  it to the next station if the recipe moves there. */
  resolveNonMachineStep(station, result) {
    const session = this.activeSessionByStation[station];
    if (!session) return null;
    session.advance(result);
    this._afterStepAdvance(station, session);
    return session;
  }

  /** A machine (hold-to-pour) step resolved with a fill ratio at release time. */
  resolveMachineStep(station, fillRatio) {
    const session = this.activeSessionByStation[station];
    if (!session) return null;

    const step = session.currentStep();
    const burnRatioLimit = 1 + (KitchenBalancing.burnGraceMs / (step.holdMs || 1));
    if (fillRatio >= burnRatioLimit) {
      session.burned = true;
      this.activeSessionByStation[station] = null;
      this.comboStreak = 0;
      this.ctx.bus.emit('kitchen:burned', { station, customer: session.customer });
      return { session, burned: true };
    }

    const distanceFromPerfect = Math.abs(1 - fillRatio);
    const result = distanceFromPerfect <= 0.08 ? PrepStepResult.PERFECT : PrepStepResult.GOOD;
    session.advance(result);
    this._afterStepAdvance(station, session);
    return { session, burned: false, result };
  }

  _afterStepAdvance(station, session) {
    const next = session.currentStep();
    if (!next) return; // recipe steps exhausted — 'serve' step handles tray placement
    if (next.station !== station) {
      this.activeSessionByStation[station] = null;
      this.activeSessionByStation[next.station] = session;
    }
  }

  /** Final 'serve' step tapped — moves the finished item onto the tray. */
  placeOnTray(station) {
    const session = this.activeSessionByStation[station];
    if (!session || !session.isComplete()) return null;
    if (this.tray.length >= KitchenBalancing.trayCapacity) {
      this.ctx.bus.emit('kitchen:trayFull');
      return null;
    }

    this.activeSessionByStation[station] = null;

    const quality = session.qualityScore();
    if (quality >= KitchenBalancing.qualityPerfectThreshold) {
      this.comboStreak += 1;
      if (this.comboStreak > 0 && this.comboStreak % KitchenBalancing.comboCelebrateEvery === 0) {
        const bonus = 10;
        this.ctx.gameState.addCoins(bonus);
        this.ctx.saveManager.save();
        this.ctx.bus.emit('kitchen:comboMilestone', { streak: this.comboStreak, bonus });
      }
    } else {
      this.comboStreak = 0;
    }

    const trayItem = { session, quality };
    this.tray.push(trayItem);
    this.ctx.bus.emit('kitchen:trayAdded', trayItem);
    return trayItem;
  }

  /** Player taps a tray item — attempts to deliver it to its customer via
   *  the shared dining-room loop, wherever that customer currently is. */
  deliverTrayItem(trayItem) {
    const idx = this.tray.indexOf(trayItem);
    if (idx === -1) return null;

    const customer = trayItem.session.customer;
    const stillWaiting = this.ctx.gameplayLoop.seatedCustomers.includes(customer) &&
      customer.state === CustomerState.WAITING_FOR_ORDER;

    this.tray.splice(idx, 1);

    if (!stillWaiting) {
      this.ctx.bus.emit('kitchen:wrongCustomer', { customer });
      return { delivered: false };
    }

    const result = this.ctx.gameplayLoop.serveCustomer(customer.id, { qualityScore: trayItem.quality });
    this.ctx.bus.emit('kitchen:delivered', { customer, result, quality: trayItem.quality });
    return { delivered: !!result, result, quality: trayItem.quality };
  }
}
