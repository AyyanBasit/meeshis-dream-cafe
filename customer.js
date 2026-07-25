'use strict';

/* ==========================================================================
   Customer — one visiting guest, driven by an explicit state machine.
   States: ENTERING -> QUEUING -> MOVING_TO_SEAT -> WAITING_FOR_ORDER
           -> EATING -> REACTING -> LEAVING -> GONE
   (Order is generated the moment a customer sits, so there is no separate
   "ordering" input state — the bubble appearing above their head IS the
   order, and the player serves it by tapping.)
   ========================================================================== */
const CustomerState = Object.freeze({
  ENTERING: 'entering',
  QUEUING: 'queuing',
  MOVING_TO_SEAT: 'moving_to_seat',
  WAITING_FOR_ORDER: 'waiting_for_order',
  EATING: 'eating',
  REACTING: 'reacting',
  LEAVING: 'leaving',
  GONE: 'gone'
});

const CUSTOMER_FACES = ['\ud83d\ude0a', '\ud83d\ude03', '\ud83d\ude0c', '\ud83d\ude42', '\ud83e\udd70'];

/** Number of distinct silhouette color variants CustomerRenderer supports.
 *  Kept here (with the rest of a customer's generated traits) so the
 *  renderer stays a pure consumer of trait data and can be swapped for a
 *  sprite-based implementation later without this file changing. */
const CUSTOMER_PALETTE_SIZE = 6;

let _customerAutoId = 1;

class Customer {
  constructor({ level, patienceMs }) {
    this.id = `cust-${_customerAutoId++}`;
    this.face = CUSTOMER_FACES[Math.floor(Math.random() * CUSTOMER_FACES.length)];
    this.state = CustomerState.ENTERING;

    this.seatIndex = null;
    this.order = null; // recipe object once assigned

    // Randomized per-customer traits — "different patience levels", "random
    // walking speed", "different happiness personalities" from the design.
    const patienceJitter = 0.85 + Math.random() * 0.3; // 0.85x .. 1.15x
    this.patienceMaxMs = Math.round(patienceMs * patienceJitter);
    this.patienceRemainingMs = this.patienceMaxMs;
    this.isAngry = false;

    this.paletteIndex = Math.floor(Math.random() * CUSTOMER_PALETTE_SIZE);
    this.walkSpeedMs = Math.round(650 + Math.random() * 350); // ms to walk between two points
    this.happinessBias = 0.85 + Math.random() * 0.3; // colors how happy a "good" serve feels to them

    this.happiness = 1; // 0..1, used for the reaction + reputation outcome
  }

  patienceRatio() {
    return Math.max(0, this.patienceRemainingMs / this.patienceMaxMs);
  }

  tickPatience(deltaMs) {
    if (this.state !== CustomerState.WAITING_FOR_ORDER) return;
    this.patienceRemainingMs -= deltaMs;
    if (this.patienceRemainingMs <= 0) {
      this.patienceRemainingMs = 0;
    }
    this.isAngry = this.patienceRatio() <= EconomyBalancing.angryThresholdRatio;
  }

  isOutOfPatience() {
    return this.state === CustomerState.WAITING_FOR_ORDER && this.patienceRemainingMs <= 0;
  }
}

/* ==========================================================================
   CustomerSpawner — decides when a new customer should appear and hands
   them into the queue. Pure timing/logic; rendering happens in CafeScene.
   ========================================================================== */
class CustomerSpawner {
  constructor({ gameState }) {
    this.gameState = gameState;
    this._timeSinceLastSpawnMs = 0;
    this.queue = [];
    this.paused = false;
  }

  reset() {
    this._timeSinceLastSpawnMs = 0;
    this.queue = [];
  }

  update(deltaMs, { queueCapacity }) {
    if (this.paused) return null;
    this._timeSinceLastSpawnMs += deltaMs;

    const level = this.gameState.data.progression.level;
    const interval = DifficultyScaling.spawnIntervalMs(level);

    if (this._timeSinceLastSpawnMs < interval) return null;
    if (this.queue.length >= queueCapacity) return null; // café's full — no room to queue

    this._timeSinceLastSpawnMs = 0;

    const patienceMs = DifficultyScaling.basePatienceMs(level);
    const customer = new Customer({ level, patienceMs });
    this.queue.push(customer);
    return customer;
  }

  dequeueNext() {
    return this.queue.shift() || null;
  }

  removeFromQueue(customer) {
    const idx = this.queue.indexOf(customer);
    if (idx >= 0) this.queue.splice(idx, 1);
  }
}

/* ==========================================================================
   SeatingSystem — fixed seat slots; assigns/frees seats for customers.
   Seat count scales with the "extraSeat" upgrade.
   ========================================================================== */
class SeatingSystem {
  constructor({ baseSeatCount = 4 } = {}) {
    this.baseSeatCount = baseSeatCount;
    this.seats = this._buildSeats(baseSeatCount);
  }

  _buildSeats(count) {
    return Array.from({ length: count }, (_, i) => ({ index: i, occupant: null }));
  }

  setSeatCount(count) {
    if (count === this.seats.length) return;
    if (count > this.seats.length) {
      for (let i = this.seats.length; i < count; i++) this.seats.push({ index: i, occupant: null });
    } else {
      // Never forcibly evict a seated customer — shrink only affects future capacity.
      this.seats = this.seats.slice(0, Math.max(count, this._highestOccupiedIndex() + 1));
    }
  }

  _highestOccupiedIndex() {
    let max = -1;
    this.seats.forEach((s) => { if (s.occupant) max = Math.max(max, s.index); });
    return max;
  }

  findFreeSeat() {
    return this.seats.find((s) => !s.occupant) || null;
  }

  seat(customer, seat) {
    seat.occupant = customer;
    customer.seatIndex = seat.index;
  }

  vacate(customer) {
    const seat = this.seats.find((s) => s.occupant === customer);
    if (seat) seat.occupant = null;
    customer.seatIndex = null;
  }

  occupiedCount() {
    return this.seats.filter((s) => s.occupant).length;
  }
}
