'use strict';

/* ==========================================================================
   OrderSystem — weighted random order generation from unlocked recipes,
   avoiding duplicates against whatever orders are currently active.
   ========================================================================== */
class OrderSystem {
  generate(unlockedRecipes, activeOrderIds = []) {
    if (unlockedRecipes.length === 0) return null;

    // Weight cheaper/earlier recipes higher so new players see variety
    // before the pricier late-unlock items dominate the random pool.
    const pool = unlockedRecipes.map((recipe) => ({
      recipe,
      weight: Math.max(1, 12 - recipe.unlockLevel)
    }));

    const notDuplicated = pool.filter((entry) => !activeOrderIds.includes(entry.recipe.id));
    const candidates = notDuplicated.length > 0 ? notDuplicated : pool; // allow dupes only if forced

    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of candidates) {
      roll -= entry.weight;
      if (roll <= 0) return entry.recipe;
    }
    return candidates[candidates.length - 1].recipe;
  }
}

/* ==========================================================================
   ComboSystem — consecutive successful serves increase a coin multiplier;
   any lost customer resets it.
   ========================================================================== */
class ComboSystem {
  constructor() {
    this.count = 0;
    this.multiplier = 1;
  }

  reset() {
    this.count = 0;
    this.multiplier = 1;
  }

  registerSuccess() {
    this.count += 1;
    this.multiplier = Math.min(EconomyBalancing.comboMax, 1 + this.count * EconomyBalancing.comboStep);
    return this.multiplier;
  }

  registerLoss() {
    this.reset();
  }
}

/* ==========================================================================
   DailyObjectivesManager — three rotating daily goals, tracked against
   running statistics deltas, claimable once complete.
   ========================================================================== */
class DailyObjectivesManager {
  constructor(bus, gameState, saveManager) {
    this.bus = bus;
    this.gameState = gameState;
    this.saveManager = saveManager;
    this._ensureFreshForToday();
  }

  static todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  _template() {
    const level = this.gameState.data.progression.level;
    return [
      { id: 'serve', label: `Serve ${6 + level} customers`, target: 6 + level, metric: 'customersServed', reward: { coins: 30 + level * 4, xp: 15 } },
      { id: 'perfect', label: 'Get 3 Perfect Serves', target: 3, metric: 'perfectServes', reward: { coins: 25, xp: 20 } },
      { id: 'earn', label: `Earn ${80 + level * 6} coins`, target: 80 + level * 6, metric: 'coinsEarnedToday', reward: { coins: 40, xp: 15 } }
    ];
  }

  _ensureFreshForToday() {
    const today = DailyObjectivesManager.todayKey();
    const stored = this.gameState.data.dailyObjectives;
    if (stored.date === today && stored.objectives.length > 0) return;

    stored.date = today;
    stored.objectives = this._template().map((t) => ({ ...t, progress: 0, startStat: null }));
    stored.claimed = [];
  }

  /** Called every gameplay tick with the running "since session start" deltas. */
  updateProgress({ customersServed, perfectServes, coinsEarnedToday }) {
    this._ensureFreshForToday();
    const metrics = { customersServed, perfectServes, coinsEarnedToday };
    for (const obj of this.gameState.data.dailyObjectives.objectives) {
      obj.progress = Math.min(obj.target, metrics[obj.metric] ?? obj.progress);
    }
  }

  isComplete(objectiveId) {
    const obj = this.gameState.data.dailyObjectives.objectives.find((o) => o.id === objectiveId);
    return obj ? obj.progress >= obj.target : false;
  }

  isClaimed(objectiveId) {
    return this.gameState.data.dailyObjectives.claimed.includes(objectiveId);
  }

  claim(objectiveId) {
    if (!this.isComplete(objectiveId) || this.isClaimed(objectiveId)) return null;
    const obj = this.gameState.data.dailyObjectives.objectives.find((o) => o.id === objectiveId);
    this.gameState.data.dailyObjectives.claimed.push(objectiveId);
    this.gameState.addCoins(obj.reward.coins);
    const levelsGained = this.gameState.addXP(obj.reward.xp);
    this.saveManager.save();
    this.bus.emit('objective:claimed', { objectiveId, reward: obj.reward, levelsGained });
    return { reward: obj.reward, levelsGained };
  }

  list() {
    this._ensureFreshForToday();
    return this.gameState.data.dailyObjectives.objectives;
  }
}

/* ==========================================================================
   PauseManager — single source of truth for whether gameplay is ticking.
   ========================================================================== */
class PauseManager {
  constructor(bus) {
    this.bus = bus;
    this.paused = false;
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.bus.emit('game:paused');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.bus.emit('game:resumed');
  }

  toggle() {
    this.paused ? this.resume() : this.pause();
    return this.paused;
  }
}

/* ==========================================================================
   CafeGameplayLoop — orchestrates spawner + seating + orders + combo +
   reputation + XP + economy + daily objectives into one update(deltaMs)
   tick. CafeScene renders whatever this reports; it holds no DOM itself.
   ========================================================================== */
class CafeGameplayLoop {
  constructor(ctx) {
    this.ctx = ctx;
    this.spawner = new CustomerSpawner({ gameState: ctx.gameState });
    this.seating = new SeatingSystem({ baseSeatCount: 4 + ctx.upgradeManager.extraSeatCount() });
    this.orderSystem = new OrderSystem();
    this.combo = new ComboSystem();
    this.pauseManager = new PauseManager(ctx.bus);

    this.seatedCustomers = []; // customers currently occupying a seat (any post-queue state)
    this._sessionStats = { customersServed: 0, perfectServes: 0, coinsEarnedToday: this._todaysEarningsSoFar() };
  }

  _todaysEarningsSoFar() {
    const eco = this.ctx.gameState.data.economy;
    const today = DailyObjectivesManager.todayKey();
    if (eco.dailyEarningsDate !== today) {
      eco.dailyEarningsDate = today;
      eco.dailyEarnings = 0;
    }
    return eco.dailyEarnings;
  }

  queueCapacity() { return 5; }

  update(deltaMs) {
    if (this.pauseManager.paused) return;

    // 1) Spawn
    const spawned = this.spawner.update(deltaMs, { queueCapacity: this.queueCapacity() });
    if (spawned) this.ctx.bus.emit('customer:spawned', spawned);

    // 2) Seat anyone waiting in the queue, if a seat is free
    let seat = this.seating.findFreeSeat();
    while (seat && this.spawner.queue.length > 0) {
      const customer = this.spawner.dequeueNext();
      this.seating.seat(customer, seat);
      customer.state = CustomerState.WAITING_FOR_ORDER;

      const unlocked = this.ctx.unlockManager.unlockedRecipes();
      const activeOrderIds = this.seatedCustomers.filter((c) => c.order).map((c) => c.order.id);
      customer.order = this.orderSystem.generate(unlocked, activeOrderIds);

      this.seatedCustomers.push(customer);
      this.ctx.bus.emit('customer:seated', customer);
      seat = this.seating.findFreeSeat();
    }

    // 3) Tick patience for everyone waiting on their order
    for (const customer of this.seatedCustomers) {
      if (customer.state !== CustomerState.WAITING_FOR_ORDER) continue;
      const wasAngry = customer.isAngry;
      customer.tickPatience(deltaMs);
      if (customer.isAngry && !wasAngry) this.ctx.bus.emit('customer:angry', customer);

      if (customer.isOutOfPatience()) {
        this._loseCustomer(customer);
      }
    }

    // 4) Advance anyone mid-reaction/leaving toward removal
    for (const customer of this.seatedCustomers.slice()) {
      if (customer.state === CustomerState.LEAVING || customer.state === CustomerState.GONE) {
        this._finalizeDeparture(customer);
      }
    }

    // 5) Daily objectives progress
    this.ctx.dailyObjectivesManager.updateProgress(this._sessionStats);
  }

  /** Player taps an order bubble — the core interaction of the gameplay loop.
   *  `qualityScore` (0..1) comes from KitchenGameplay when the item was
   *  actually cooked there; direct dining-room taps (no kitchen prep yet
   *  built for a recipe) default to a neutral 0.85 so the loop still works
   *  standalone. */
  serveCustomer(customerId, { qualityScore = 0.85 } = {}) {
    const customer = this.seatedCustomers.find((c) => c.id === customerId);
    if (!customer || customer.state !== CustomerState.WAITING_FOR_ORDER || !customer.order) return null;

    const ratio = customer.patienceRatio();
    const isTimingPerfect = ratio >= (1 - EconomyBalancing.perfectWindowRatio);
    const isQualityPerfect = qualityScore >= KitchenBalancing.qualityPerfectThreshold;
    const isPerfect = isTimingPerfect && isQualityPerfect;

    const multiplier = this.combo.registerSuccess();
    const tipRatio = EconomyBalancing.tipMinRatio + (EconomyBalancing.tipMaxRatio - EconomyBalancing.tipMinRatio) * ratio;
    const basePrice = customer.order.basePrice;
    const tip = Math.round(basePrice * tipRatio);
    const perfectBonus = isPerfect ? EconomyBalancing.perfectBonusFlat : 0;
    const coinsEarned = Math.round((basePrice + tip) * multiplier) + perfectBonus;

    this.ctx.gameState.addCoins(coinsEarned);
    const levelsGained = this.ctx.gameState.addXP(customer.order.xp);
    this.ctx.gameState.recordServeOutcome(isPerfect ? 'perfect' : 'good');

    const eco = this.ctx.gameState.data.economy;
    eco.lifetimeCoinsEarned += coinsEarned;
    eco.dailyEarnings += coinsEarned;

    const stats = this.ctx.gameState.data.statistics;
    stats.customersServed += 1;
    if (isPerfect) stats.perfectServes += 1;
    stats.bestCombo = Math.max(stats.bestCombo, this.combo.count);
    stats.totalTipsEarned += tip;

    this._sessionStats.customersServed += 1;
    if (isPerfect) this._sessionStats.perfectServes += 1;
    this._sessionStats.coinsEarnedToday = eco.dailyEarnings;

    customer.happiness = Math.min(1, (isPerfect ? 1 : 0.7) * customer.happinessBias);
    customer.state = CustomerState.EATING;
    customer.order = null;

    if (levelsGained > 0) {
      const unlocks = this.ctx.unlockManager.syncToLevel(this.ctx.gameState.data.progression.level);
      this.ctx.bus.emit('player:levelup', { levelsGained, unlocks });
    }

    this.ctx.saveManager.save();
    this.ctx.bus.emit('customer:served', { customer, coinsEarned, isPerfect, multiplier, qualityScore });

    window.setTimeout(() => {
      if (customer.state === CustomerState.EATING) {
        customer.state = CustomerState.REACTING;
        this.ctx.bus.emit('customer:reacting', customer);
        window.setTimeout(() => this._departHappy(customer), 900);
      }
    }, 1100);

    return { coinsEarned, isPerfect, multiplier, qualityScore };
  }

  _departHappy(customer) {
    if (customer.state === CustomerState.GONE) return;
    customer.state = CustomerState.LEAVING;
    this.ctx.bus.emit('customer:leaving', { customer, angry: false });
  }

  _loseCustomer(customer) {
    this.combo.registerLoss();
    this.ctx.gameState.recordServeOutcome('lost');
    this.ctx.gameState.data.statistics.customersLost += 1;
    customer.happiness = 0;
    customer.order = null;
    customer.state = CustomerState.LEAVING;
    this.ctx.saveManager.save();
    this.ctx.bus.emit('customer:leaving', { customer, angry: true });
  }

  _finalizeDeparture(customer) {
    if (customer.state !== CustomerState.LEAVING) return;
    customer.state = CustomerState.GONE;
    this.seating.vacate(customer);
    this.seatedCustomers = this.seatedCustomers.filter((c) => c !== customer);
    this.ctx.bus.emit('customer:left', customer);
  }

  applyExtraSeatUpgrade() {
    this.seating.setSeatCount(4 + this.ctx.upgradeManager.extraSeatCount());
  }
}
