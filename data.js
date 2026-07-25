'use strict';

/* ==========================================================================
   DRINK / FOOD / RECIPE DATABASES
   Static content tables. `unlockLevel` gates availability; UnlockManager
   below is the only thing that ever mutates GameState.unlocked from these.
   ========================================================================== */
const DRINK_DATABASE = [
  { id: 'coffee-basic',  name: 'Warm Coffee',    emoji: '\u2615', type: 'drink', basePrice: 8,  xp: 4,  unlockLevel: 1, prepMs: 1600 },
  { id: 'tea-basic',     name: 'Herbal Tea',     emoji: '\ud83c\udf75', type: 'drink', basePrice: 7,  xp: 4,  unlockLevel: 1, prepMs: 1500 },
  { id: 'latte',         name: 'Honey Latte',    emoji: '\ud83e\udd5b', type: 'drink', basePrice: 12, xp: 6,  unlockLevel: 2, prepMs: 2000 },
  { id: 'iced-tea',      name: 'Iced Berry Tea', emoji: '\ud83e\uddca', type: 'drink', basePrice: 11, xp: 6,  unlockLevel: 3, prepMs: 1800 },
  { id: 'hot-cocoa',     name: 'Hot Cocoa',      emoji: '\ud83c\udf6b', type: 'drink', basePrice: 14, xp: 8,  unlockLevel: 4, prepMs: 2100 },
  { id: 'matcha',        name: 'Matcha Cream',   emoji: '\ud83c\udf75', type: 'drink', basePrice: 16, xp: 9,  unlockLevel: 6, prepMs: 2300 },
  { id: 'chai',          name: 'Spiced Chai',    emoji: '\u2615', type: 'drink', basePrice: 15, xp: 9,  unlockLevel: 8, prepMs: 2200 }
];

const FOOD_DATABASE = [
  { id: 'croissant',     name: 'Croissant',      emoji: '\ud83e\udd50', type: 'food', basePrice: 9,  xp: 5,  unlockLevel: 1, prepMs: 1700 },
  { id: 'muffin',        name: 'Blueberry Muffin', emoji: '\ud83e\uddc1', type: 'food', basePrice: 10, xp: 5,  unlockLevel: 2, prepMs: 1800 },
  { id: 'toast',         name: 'Avocado Toast',  emoji: '\ud83c\udf5e', type: 'food', basePrice: 13, xp: 7,  unlockLevel: 3, prepMs: 2000 },
  { id: 'cookie',        name: 'Choc-Chip Cookie', emoji: '\ud83c\udf6a', type: 'food', basePrice: 8,  xp: 4,  unlockLevel: 4, prepMs: 1500 },
  { id: 'cake-slice',    name: 'Café Cake Slice', emoji: '\ud83c\udf70', type: 'food', basePrice: 17, xp: 10, unlockLevel: 5, prepMs: 2400 },
  { id: 'sandwich',      name: 'Garden Sandwich', emoji: '\ud83e\udd6a', type: 'food', basePrice: 18, xp: 10, unlockLevel: 7, prepMs: 2500 },
  { id: 'waffle',        name: 'Honey Waffle',   emoji: '\ud83e\uddc7', type: 'food', basePrice: 20, xp: 12, unlockLevel: 9, prepMs: 2600 }
];

const RECIPE_DATABASE = [...DRINK_DATABASE, ...FOOD_DATABASE];

const FURNITURE_DATABASE = [
  { id: 'table-basic',  name: 'Wooden Table',    unlockLevel: 1 },
  { id: 'chair-basic',  name: 'Café Chair',      unlockLevel: 1 },
  { id: 'table-round',  name: 'Round Table',     unlockLevel: 3 },
  { id: 'bench-window', name: 'Window Bench',    unlockLevel: 5 },
  { id: 'booth-cozy',   name: 'Cozy Booth',      unlockLevel: 7 }
];

const DECORATION_DATABASE = [
  { id: 'plant-small',  name: 'Potted Plant',    unlockLevel: 2 },
  { id: 'string-lights',name: 'String Lights',   unlockLevel: 4 },
  { id: 'wall-art',     name: 'Wall Art Print',  unlockLevel: 6 },
  { id: 'rug-warm',     name: 'Warm Rug',        unlockLevel: 8 }
];

function getRecipeById(id) {
  return RECIPE_DATABASE.find((r) => r.id === id) || null;
}

/* ==========================================================================
   EconomyBalancing — every tunable number for coins/tips/bonuses lives here
   so difficulty/economy passes never require touching gameplay logic.
   ========================================================================== */
const EconomyBalancing = {
  tipMinRatio: 0.10,
  tipMaxRatio: 0.35,
  comboStep: 0.12,           // multiplier gained per consecutive good-or-better serve
  comboMax: 2.5,
  perfectBonusFlat: 5,
  perfectWindowRatio: 0.35,  // serve within this fraction of remaining patience counts as "perfect"
  angryThresholdRatio: 0.25, // patience ratio below which a customer becomes visibly angry
  baseUpgradeCost: 150,
  upgradeCostGrowth: 1.6
};

/* ==========================================================================
   DifficultyScaling — derives spawn rate & patience from player level, so
   the café gets busier and orders get tighter as progression continues.
   ========================================================================== */
class DifficultyScaling {
  static spawnIntervalMs(level) {
    return Math.max(2200, 6500 - level * 220);
  }

  static basePatienceMs(level) {
    return Math.max(9000, 16000 - level * 300);
  }

  static maxActiveOrders(level) {
    return Math.min(3 + Math.floor(level / 4), 6);
  }
}

/* ==========================================================================
   UnlockManager — the single place that decides, from player level, which
   recipes/furniture/decorations should be unlocked, and writes that into
   GameState.unlocked (append-only; never removes an unlock).
   ========================================================================== */
class UnlockManager {
  constructor(bus, gameState) {
    this.bus = bus;
    this.gameState = gameState;
  }

  /** Call after any level-up. Returns the list of newly unlocked items. */
  syncToLevel(level) {
    const newlyUnlocked = [];

    for (const recipe of RECIPE_DATABASE) {
      if (recipe.unlockLevel <= level && !this.gameState.data.unlocked.recipes.includes(recipe.id)) {
        this.gameState.data.unlocked.recipes.push(recipe.id);
        newlyUnlocked.push({ kind: 'recipe', item: recipe });
      }
    }
    for (const furniture of FURNITURE_DATABASE) {
      if (furniture.unlockLevel <= level && !this.gameState.data.unlocked.furniture.includes(furniture.id)) {
        this.gameState.data.unlocked.furniture.push(furniture.id);
        newlyUnlocked.push({ kind: 'furniture', item: furniture });
      }
    }
    for (const decoration of DECORATION_DATABASE) {
      if (decoration.unlockLevel <= level && !this.gameState.data.unlocked.decorations.includes(decoration.id)) {
        this.gameState.data.unlocked.decorations.push(decoration.id);
        newlyUnlocked.push({ kind: 'decoration', item: decoration });
      }
    }

    if (newlyUnlocked.length > 0) this.bus.emit('unlocks:new', newlyUnlocked);
    return newlyUnlocked;
  }

  unlockedRecipes() {
    return this.gameState.data.unlocked.recipes.map(getRecipeById).filter(Boolean);
  }
}

/* ==========================================================================
   InventoryFoundation — minimal stock model. Today every recipe has
   effectively infinite stock (no shopping mechanic yet), but the structure
   is real and future prompts can plug ingredient costs in without rework.
   ========================================================================== */
class InventoryFoundation {
  constructor(gameState) {
    this.gameState = gameState;
  }

  hasStock(recipeId) {
    return true; // no ingredient-consumption mechanic yet — always in stock
  }

  consume(recipeId) {
    return true;
  }
}

/* ==========================================================================
   UpgradeManager — purchasable café upgrades, paid in coins, gated by level.
   ========================================================================== */
const UPGRADE_DATABASE = [
  { id: 'extraSeat',     name: 'Add a Table',        maxLevel: 3, unlockLevel: 2,  effectPerLevel: 1 },
  { id: 'servicePace',   name: 'Faster Hands',       maxLevel: 5, unlockLevel: 3,  effectPerLevel: 0.08 },
  { id: 'patienceBoost', name: 'Cozier Ambience',    maxLevel: 5, unlockLevel: 3,  effectPerLevel: 0.10 }
];

class UpgradeManager {
  constructor(bus, gameState, saveManager) {
    this.bus = bus;
    this.gameState = gameState;
    this.saveManager = saveManager;
  }

  costFor(upgradeId) {
    const currentLevel = this.gameState.data.upgrades[upgradeId] || 0;
    return Math.round(EconomyBalancing.baseUpgradeCost * Math.pow(EconomyBalancing.upgradeCostGrowth, currentLevel));
  }

  isMaxed(upgradeId) {
    const def = UPGRADE_DATABASE.find((u) => u.id === upgradeId);
    const currentLevel = this.gameState.data.upgrades[upgradeId] || 0;
    return def ? currentLevel >= def.maxLevel : true;
  }

  purchase(upgradeId) {
    const def = UPGRADE_DATABASE.find((u) => u.id === upgradeId);
    if (!def) return { success: false, reason: 'unknown-upgrade' };
    if (this.gameState.data.progression.level < def.unlockLevel) return { success: false, reason: 'locked' };
    if (this.isMaxed(upgradeId)) return { success: false, reason: 'maxed' };

    const cost = this.costFor(upgradeId);
    if (this.gameState.data.currency.coins < cost) return { success: false, reason: 'insufficient-funds' };

    this.gameState.addCoins(-cost);
    this.gameState.data.upgrades[upgradeId] = (this.gameState.data.upgrades[upgradeId] || 0) + 1;
    this.bus.emit('upgrade:purchased', { id: upgradeId, level: this.gameState.data.upgrades[upgradeId] });
    this.saveManager.save();
    return { success: true, cost };
  }

  extraSeatCount() { return this.gameState.data.upgrades.extraSeat || 0; }
  servicePaceBonus() { return (this.gameState.data.upgrades.servicePace || 0) * UPGRADE_DATABASE.find((u) => u.id === 'servicePace').effectPerLevel; }
  patienceBonus() { return (this.gameState.data.upgrades.patienceBoost || 0) * UPGRADE_DATABASE.find((u) => u.id === 'patienceBoost').effectPerLevel; }
}

/* ==========================================================================
   RECIPE_STEPS — the multi-step preparation sequence for every recipe.
   Each step has a `kind` that tells KitchenScene which control to render:
     'container'  -> drag the matching ingredient chip onto the prep area
     'machine'    -> hold-to-pour on the named station, release to stop
     'assemble'   -> single tap on the dessert station to plate it
     'serve'      -> final step, moves the finished item onto the tray
   ========================================================================== */
const RECIPE_STEPS = {
  'coffee-basic': [
    { kind: 'container', station: 'coffee', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'machine',   station: 'coffee', ingredient: 'coffee', label: 'Pour Coffee', holdMs: 1400 },
    { kind: 'serve',     station: 'coffee', label: 'Send to Tray' }
  ],
  'tea-basic': [
    { kind: 'container', station: 'tea', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'container', station: 'tea', ingredient: 'tea', label: 'Add Tea Leaves' },
    { kind: 'machine',   station: 'tea', ingredient: 'water', label: 'Brew with Water', holdMs: 1600 },
    { kind: 'serve',     station: 'tea', label: 'Send to Tray' }
  ],
  latte: [
    { kind: 'container', station: 'coffee', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'machine',   station: 'coffee', ingredient: 'coffee', label: 'Pour Coffee', holdMs: 1400 },
    { kind: 'container', station: 'coffee', ingredient: 'milk', label: 'Add Milk' },
    { kind: 'container', station: 'coffee', ingredient: 'honey', label: 'Drizzle Honey' },
    { kind: 'serve',     station: 'coffee', label: 'Send to Tray' }
  ],
  'iced-tea': [
    { kind: 'container', station: 'tea', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'container', station: 'tea', ingredient: 'tea', label: 'Add Tea Leaves' },
    { kind: 'machine',   station: 'tea', ingredient: 'water', label: 'Brew with Water', holdMs: 1500 },
    { kind: 'container', station: 'tea', ingredient: 'berry', label: 'Add Berries' },
    { kind: 'serve',     station: 'tea', label: 'Send to Tray' }
  ],
  'hot-cocoa': [
    { kind: 'container', station: 'coffee', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'container', station: 'coffee', ingredient: 'cocoa', label: 'Add Cocoa' },
    { kind: 'machine',   station: 'coffee', ingredient: 'milk-steam', label: 'Steam Milk', holdMs: 1700 },
    { kind: 'serve',     station: 'coffee', label: 'Send to Tray' }
  ],
  matcha: [
    { kind: 'container', station: 'tea', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'container', station: 'tea', ingredient: 'matcha', label: 'Add Matcha' },
    { kind: 'machine',   station: 'tea', ingredient: 'water', label: 'Whisk with Water', holdMs: 1800 },
    { kind: 'container', station: 'tea', ingredient: 'milk', label: 'Add Cream' },
    { kind: 'serve',     station: 'tea', label: 'Send to Tray' }
  ],
  chai: [
    { kind: 'container', station: 'tea', ingredient: 'cup', label: 'Pick a Cup' },
    { kind: 'container', station: 'tea', ingredient: 'tea', label: 'Add Tea Leaves' },
    { kind: 'container', station: 'tea', ingredient: 'spice', label: 'Add Spices' },
    { kind: 'machine',   station: 'tea', ingredient: 'water', label: 'Brew with Water', holdMs: 1700 },
    { kind: 'serve',     station: 'tea', label: 'Send to Tray' }
  ],
  croissant: [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'croissant', label: 'Plate the Croissant' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ],
  muffin: [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'muffin', label: 'Plate the Muffin' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ],
  toast: [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'toast', label: 'Plate the Toast' },
    { kind: 'container', station: 'dessert', ingredient: 'avocado', label: 'Add Avocado' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ],
  cookie: [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'cookie', label: 'Plate the Cookie' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ],
  'cake-slice': [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'cake-slice', label: 'Plate the Cake' },
    { kind: 'container', station: 'dessert', ingredient: 'berry', label: 'Add Berries' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ],
  sandwich: [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'sandwich', label: 'Plate the Sandwich' },
    { kind: 'container', station: 'dessert', ingredient: 'avocado', label: 'Add Avocado' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ],
  waffle: [
    { kind: 'container', station: 'dessert', ingredient: 'plate', label: 'Pick a Plate' },
    { kind: 'assemble',  station: 'dessert', ingredient: 'waffle', label: 'Plate the Waffle' },
    { kind: 'container', station: 'dessert', ingredient: 'honey', label: 'Drizzle Honey' },
    { kind: 'serve',     station: 'dessert', label: 'Send to Tray' }
  ]
};

/** All ingredient containers a station might need, for rendering chip trays. */
const STATION_INGREDIENTS = {
  coffee: [
    { id: 'cup',    emoji: '\ud83e\udff9', label: 'Cup' },
    { id: 'milk',   emoji: '\ud83e\udd5b', label: 'Milk' },
    { id: 'honey',  emoji: '\ud83c\udf6f', label: 'Honey' },
    { id: 'cocoa',  emoji: '\ud83c\udf6b', label: 'Cocoa' }
  ],
  tea: [
    { id: 'cup',    emoji: '\ud83e\udff9', label: 'Cup' },
    { id: 'tea',    emoji: '\ud83c\udf43', label: 'Tea Leaves' },
    { id: 'spice',  emoji: '\ud83c\udf2f', label: 'Spice' },
    { id: 'milk',   emoji: '\ud83e\udd5b', label: 'Milk' },
    { id: 'matcha', emoji: '\ud83c\udf35', label: 'Matcha' },
    { id: 'berry',  emoji: '\ud83e\uded0', label: 'Berries' }
  ],
  dessert: [
    { id: 'plate',   emoji: '\ud83c\udf7d\ufe0f', label: 'Plate' },
    { id: 'avocado', emoji: '\ud83e\udd51', label: 'Avocado' },
    { id: 'berry',   emoji: '\ud83e\uded0', label: 'Berries' },
    { id: 'honey',   emoji: '\ud83c\udf6f', label: 'Honey' }
  ]
};

const STATION_MACHINE_LABEL = {
  coffee: { name: 'Espresso Machine', emoji: '\u2615' },
  tea: { name: 'Kettle', emoji: '\ud83c\udff5\ufe0f' },
  dessert: { name: 'Pastry Counter', emoji: '\ud83c\udf70' }
};

/* ==========================================================================
   Kitchen quality/timing tuning — separate from EconomyBalancing so cooking
   feel can be adjusted without touching front-of-house economy numbers.
   ========================================================================== */
const KitchenBalancing = {
  perfectHoldWindowMs: 220,   // release within this window of 100% counts as a perfect step
  burnGraceMs: 900,           // how long past 100% a held machine can go before burning
  wrongDropShakePx: 8,
  qualityPerfectScore: 1,
  qualityGoodScore: 0.7,
  qualityPerfectThreshold: 0.85,
  trayCapacity: 3,
  comboCelebrateEvery: 3
};
