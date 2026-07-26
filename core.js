'use strict';

/* ==========================================================================
   EventBus — simple pub/sub used across every system so managers never
   need direct references to each other.
   ========================================================================== */
class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  off(event, handler) {
    if (this._listeners.has(event)) this._listeners.get(event).delete(handler);
  }

  emit(event, payload) {
    if (!this._listeners.has(event)) return;
    for (const handler of Array.from(this._listeners.get(event))) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${event}" threw:`, err);
      }
    }
  }
}

/* ==========================================================================
   GameState — single source of truth for player/session data.
   Never touches localStorage directly; SaveManager owns persistence.
   ========================================================================== */
const SAVE_SCHEMA_VERSION = 1;

class GameState {
  constructor(bus) {
    this.bus = bus;
    this.data = GameState.defaultData();
  }

  static defaultData() {
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      profile: {
        playerName: 'Meeshi',
        createdAt: null,
        lastPlayedAt: null
      },
      currency: {
        coins: 0,
        premium: 0
      },
      progression: {
        xp: 0,
        level: 1
      },
      unlocked: {
        furniture: ['table-basic', 'chair-basic'],
        recipes: ['coffee-basic', 'tea-basic'],
        decorations: []
      },
      achievements: [],
      dailyRewards: {
        streak: 0,
        lastClaimedAt: null
      },
      settings: {
        musicVolume: 0.8,
        sfxVolume: 0.9,
        ambienceVolume: 0.6,
        vibration: true,
        language: 'en',
        reducedMotion: false
      },
      statistics: {
        totalSessions: 0,
        totalPlayTimeMs: 0,
        customersServed: 0,
        customersLost: 0,
        perfectServes: 0,
        bestCombo: 0,
        totalTipsEarned: 0,
        recipesServed: {},
        objectivesCompleted: 0
      },
      reputation: {
        stars: 3,
        recentOutcomes: []
      },
      upgrades: {
        extraSeat: 0,
        servicePace: 0,
        patienceBoost: 0,
        trayCapacity: 0
      },
      economy: {
        lifetimeCoinsEarned: 0,
        dailyEarnings: 0,
        dailyEarningsDate: null
      },
      dailyObjectives: {
        date: null,
        objectives: [],
        claimed: []
      },
      decorations: {
        placed: []
      },
      environment: {
        weather: 'sunny'
      },
      customerMemory: {},
      cafeEvents: {
        lastEventAt: null,
        eventsSeen: []
      },
      specialVisitors: {
        history: []
      },
      tutorial: {
        completed: false,
        seenTips: []
      },
      currentScene: 'main-menu'
    };
  }

  /** Recursively fills any keys missing from `target` using `source` as the
   *  template, without touching values `target` already has. Lets new
   *  fields introduced by later features reach saves created before them. */
  static deepFillDefaults(target, source) {
    for (const key of Object.keys(source)) {
      if (!(key in target)) {
        target[key] = JSON.parse(JSON.stringify(source[key]));
      } else if (
        source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
      ) {
        GameState.deepFillDefaults(target[key], source[key]);
      }
    }
    return target;
  }

  replace(newData) {
    this.data = newData;
    this.bus.emit('state:replaced', this.data);
  }

  get(path) {
    return path.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), this.data);
  }

  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, key) => (obj[key] = obj[key] ?? {}), this.data);
    target[last] = value;
    this.bus.emit('state:changed', { path, value });
    return value;
  }

  addCoins(amount) {
    this.data.currency.coins = Math.max(0, this.data.currency.coins + amount);
    this.bus.emit('state:changed', { path: 'currency.coins', value: this.data.currency.coins });
    return this.data.currency.coins;
  }

  hasSaveEverBeenCreated() {
    return !!this.data.profile.createdAt;
  }

  /** XP required to advance FROM the given level to the next one. */
  static xpToNextLevel(level) {
    return Math.round(50 * Math.pow(level, 1.35));
  }

  /** Adds XP, resolves any level-ups, and returns how many levels were gained. */
  addXP(amount) {
    this.data.progression.xp += amount;
    let levelsGained = 0;
    while (this.data.progression.xp >= GameState.xpToNextLevel(this.data.progression.level)) {
      this.data.progression.xp -= GameState.xpToNextLevel(this.data.progression.level);
      this.data.progression.level += 1;
      levelsGained += 1;
    }
    this.bus.emit('state:changed', { path: 'progression', value: this.data.progression });
    return levelsGained;
  }

  /** Rolling reputation: keeps the last N serve outcomes and converts the
   *  ratio of good outcomes into a 1-5 star rating. */
  recordServeOutcome(outcome) {
    const list = this.data.reputation.recentOutcomes;
    list.push(outcome); // 'perfect' | 'good' | 'lost'
    if (list.length > 20) list.shift();

    const score = list.reduce((sum, o) => sum + (o === 'perfect' ? 1 : o === 'good' ? 0.6 : -0.4), 0);
    const ratio = Math.max(0, Math.min(1, score / list.length));
    this.data.reputation.stars = Math.max(1, Math.min(5, Math.round(1 + ratio * 4)));
    this.bus.emit('state:changed', { path: 'reputation', value: this.data.reputation });
    return this.data.reputation.stars;
  }
}

/* ==========================================================================
   TimeManager — frame delta timing + real-world elapsed time tracking
   (used for daily reward eligibility, session stats, animation ticking).
   ========================================================================== */
class TimeManager {
  constructor() {
    this.now = 0;
    this.deltaMs = 0;
    this.deltaSec = 0;
    this.elapsedMs = 0;
    this._last = null;
  }

  tick(timestampMs) {
    if (this._last == null) this._last = timestampMs;
    this.deltaMs = Math.min(timestampMs - this._last, 250); // clamp to avoid huge jumps on tab-resume
    this.deltaSec = this.deltaMs / 1000;
    this.elapsedMs += this.deltaMs;
    this.now = timestampMs;
    this._last = timestampMs;
  }

  static nowISO() {
    return new Date().toISOString();
  }

  static msSinceISO(isoString) {
    if (!isoString) return Infinity;
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return Infinity;
    return Date.now() - then;
  }

  static formatClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}

/* ==========================================================================
   SaveManager — localStorage persistence with corruption recovery.
   Keeps a rolling backup so a corrupted primary save can self-heal.
   ========================================================================== */
class SaveManager {
  constructor(bus, gameState) {
    this.bus = bus;
    this.gameState = gameState;
    this.PRIMARY_KEY = 'meeshi_save_v1';
    this.BACKUP_KEY = 'meeshi_save_v1_backup';
    this._autoSaveHandle = null;
  }

  storageAvailable() {
    try {
      const testKey = '__meeshi_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  load() {
    if (!this.storageAvailable()) {
      this.bus.emit('save:unavailable');
      this.gameState.replace(GameState.defaultData());
      return { loaded: false, recovered: false };
    }

    const primaryRaw = window.localStorage.getItem(this.PRIMARY_KEY);
    const parsedPrimary = this._safeParse(primaryRaw);

    if (parsedPrimary) {
      this.gameState.replace(this._migrate(parsedPrimary));
      this.bus.emit('save:loaded', { recovered: false });
      return { loaded: true, recovered: false };
    }

    // Primary missing or corrupted — attempt backup recovery.
    const backupRaw = window.localStorage.getItem(this.BACKUP_KEY);
    const parsedBackup = this._safeParse(backupRaw);

    if (parsedBackup) {
      this.gameState.replace(this._migrate(parsedBackup));
      this.save(); // repair primary from backup
      this.bus.emit('save:recovered');
      return { loaded: true, recovered: true };
    }

    // No usable save anywhere — start fresh, never crash.
    this.gameState.replace(GameState.defaultData());
    this.bus.emit('save:new');
    return { loaded: false, recovered: false };
  }

  _safeParse(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.schemaVersion !== 'number') return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  _migrate(data) {
    // Forward-compatible slot for future schema migrations, plus a
    // non-destructive fill for any fields added by newer feature sets.
    data.schemaVersion = SAVE_SCHEMA_VERSION;
    GameState.deepFillDefaults(data, GameState.defaultData());
    return data;
  }

  save() {
    if (!this.storageAvailable()) return false;
    try {
      const serialized = JSON.stringify(this.gameState.data);
      // Rotate current primary into backup before overwriting, so a failed
      // write never destroys the only good copy.
      const currentPrimary = window.localStorage.getItem(this.PRIMARY_KEY);
      if (currentPrimary) window.localStorage.setItem(this.BACKUP_KEY, currentPrimary);
      window.localStorage.setItem(this.PRIMARY_KEY, serialized);
      this.bus.emit('save:written');
      return true;
    } catch (err) {
      console.error('[SaveManager] write failed:', err);
      this.bus.emit('save:error', err);
      return false;
    }
  }

  markSessionStart() {
    if (!this.gameState.data.profile.createdAt) {
      this.gameState.data.profile.createdAt = TimeManager.nowISO();
    }
    this.gameState.data.profile.lastPlayedAt = TimeManager.nowISO();
    this.gameState.data.statistics.totalSessions += 1;
    this.save();
  }

  startAutoSave(intervalMs = 30000) {
    this.stopAutoSave();
    this._autoSaveHandle = window.setInterval(() => this.save(), intervalMs);
  }

  stopAutoSave() {
    if (this._autoSaveHandle) window.clearInterval(this._autoSaveHandle);
    this._autoSaveHandle = null;
  }

  resetSave() {
    try {
      window.localStorage.removeItem(this.PRIMARY_KEY);
      window.localStorage.removeItem(this.BACKUP_KEY);
    } catch (err) {
      console.error('[SaveManager] reset failed:', err);
    }
    this.gameState.replace(GameState.defaultData());
    this.bus.emit('save:reset');
  }
}

/* ==========================================================================
   SettingsManager — thin, focused wrapper over GameState.data.settings.
   Anything that changes a setting goes through here so persistence and
   downstream systems (audio, haptics) stay in sync.
   ========================================================================== */
class SettingsManager {
  constructor(bus, gameState, saveManager) {
    this.bus = bus;
    this.gameState = gameState;
    this.saveManager = saveManager;
  }

  get musicVolume() { return this.gameState.get('settings.musicVolume'); }
  get sfxVolume() { return this.gameState.get('settings.sfxVolume'); }
  get ambienceVolume() { return this.gameState.get('settings.ambienceVolume'); }
  get vibrationEnabled() { return this.gameState.get('settings.vibration'); }
  get language() { return this.gameState.get('settings.language'); }
  get reducedMotion() { return this.gameState.get('settings.reducedMotion'); }

  setMusicVolume(value) {
    const clamped = Math.min(1, Math.max(0, value));
    this.gameState.set('settings.musicVolume', clamped);
    this.bus.emit('settings:musicVolume', clamped);
    this.saveManager.save();
  }

  setSfxVolume(value) {
    const clamped = Math.min(1, Math.max(0, value));
    this.gameState.set('settings.sfxVolume', clamped);
    this.bus.emit('settings:sfxVolume', clamped);
    this.saveManager.save();
  }

  setAmbienceVolume(value) {
    const clamped = Math.min(1, Math.max(0, value));
    this.gameState.set('settings.ambienceVolume', clamped);
    this.bus.emit('settings:ambienceVolume', clamped);
    this.saveManager.save();
  }

  setVibration(enabled) {
    this.gameState.set('settings.vibration', enabled);
    this.bus.emit('settings:vibration', enabled);
    this.saveManager.save();
  }

  setLanguage(langCode) {
    this.gameState.set('settings.language', langCode);
    this.bus.emit('settings:language', langCode);
    this.saveManager.save();
  }

  setReducedMotion(enabled) {
    this.gameState.set('settings.reducedMotion', enabled);
    this.bus.emit('settings:reducedMotion', enabled);
    document.documentElement.classList.toggle('reduced-motion', enabled);
    this.saveManager.save();
  }

  vibrate(pattern = 15) {
    if (!this.vibrationEnabled) return;
    if (typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch (err) { /* silently ignore unsupported devices */ }
    }
  }
}

/* ==========================================================================
   LocalizationSystem — key-based text lookup, language-switch ready,
   with Roman Urdu included alongside English from day one.
   ========================================================================== */
class LocalizationSystem {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.dictionaries = {
      en: {
        'menu.start': 'Start',
        'menu.continue': 'Continue',
        'menu.settings': 'Settings',
        'menu.credits': 'Credits',
        'settings.title': 'Settings',
        'settings.music': 'Music Volume',
        'settings.sfx': 'Sound Effects',
        'settings.ambience': 'Ambience Volume',
        'settings.vibration': 'Vibration',
        'settings.reducedMotion': 'Reduced Motion',
        'settings.language': 'Language',
        'settings.reset': 'Reset Save',
        'settings.back': 'Back',
        'credits.title': 'Credits',
        'intro.line1': 'Welcome to Meeshi\u2019s Dream Café.',
        'intro.line2': 'A cozy corner, waiting to be filled with warmth.',
        'intro.skip': 'Skip',
        'popup.resetTitle': 'Reset your save?',
        'popup.resetMessage': 'This will erase all progress. This cannot be undone.',
        'popup.cancel': 'Cancel',
        'popup.confirm': 'Reset',
        'notification.comingSoon': 'The café opens soon \u2014 gameplay is on its way.',
        'notification.noSave': 'No saved café found yet.',
        'notification.saveReset': 'Save cleared. Starting fresh.',
        'notification.exitUnavailable': 'Use the Home button to exit.'
      },
      'ur-roman': {
        'menu.start': 'Shuru Karein',
        'menu.continue': 'Jaari Rakhein',
        'menu.settings': 'Settings',
        'menu.credits': 'Credits',
        'settings.title': 'Settings',
        'settings.music': 'Music ki Awaaz',
        'settings.sfx': 'Sound Effects',
        'settings.ambience': 'Ambience ki Awaaz',
        'settings.vibration': 'Vibration',
        'settings.reducedMotion': 'Kam Harkat Mode',
        'settings.language': 'Zaban',
        'settings.reset': 'Save Reset Karein',
        'settings.back': 'Wapas',
        'credits.title': 'Credits',
        'intro.line1': 'Meeshi ke Dream Café mein khush aamdeed.',
        'intro.line2': 'Ek pyara sa gosha, jo garmjoshi se bharne ka intezaar kar raha hai.',
        'intro.skip': 'Skip Karein',
        'popup.resetTitle': 'Save reset karein?',
        'popup.resetMessage': 'Yeh sari progress mita dega. Yeh wapas nahi ho sakta.',
        'popup.cancel': 'Cancel',
        'popup.confirm': 'Reset Karein',
        'notification.comingSoon': 'Café jald khulega \u2014 gameplay aa raha hai.',
        'notification.noSave': 'Abhi tak koi saved café nahi mila.',
        'notification.saveReset': 'Save saaf ho gaya. Naye sire se shuru.',
        'notification.exitUnavailable': 'Exit ke liye Home button use karein.'
      }
    };
  }

  t(key) {
    const lang = this.settingsManager ? this.settingsManager.language : 'en';
    const dict = this.dictionaries[lang] || this.dictionaries.en;
    return dict[key] ?? this.dictionaries.en[key] ?? key;
  }
}
