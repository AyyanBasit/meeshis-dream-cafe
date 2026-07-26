'use strict';

(function bootstrap() {
  // ---- Core ----
  const bus = new EventBus();
  const gameState = new GameState(bus);
  const timeManager = new TimeManager();
  const saveManager = new SaveManager(bus, gameState);

  const loadResult = saveManager.load();
  if (!loadResult.loaded && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gameState.data.settings.reducedMotion = true;
  }

  const settingsManager = new SettingsManager(bus, gameState, saveManager);
  document.documentElement.classList.toggle('reduced-motion', settingsManager.reducedMotion);
  const localization = new LocalizationSystem(settingsManager);

  // ---- Systems ----
  const assetLoader = new AssetLoader(bus);
  const touchManager = new TouchManager(bus);
  const animationSystem = new AnimationSystem();
  const uiLayer = new UILayer();
  const transitionSystem = new TransitionSystem(animationSystem, uiLayer.get('transition'));
  const audioManager = new AudioManager(bus, assetLoader, settingsManager);
  const camera = new CameraFoundation();
  const particles = new ParticleFoundation(uiLayer.get('particles'));

  // ---- UI ----
  const notificationSystem = new NotificationSystem(uiLayer, animationSystem);
  const popupSystem = new PopupSystem(uiLayer, animationSystem, touchManager);
  const dialogFramework = new DialogFramework(popupSystem, localization);

  // ---- Gameplay foundation ----
  const unlockManager = new UnlockManager(bus, gameState);
  const inventoryFoundation = new InventoryFoundation(gameState);
  const upgradeManager = new UpgradeManager(bus, gameState, saveManager);
  const dailyObjectivesManager = new DailyObjectivesManager(bus, gameState, saveManager);
  const decorationManager = new DecorationManager(bus, gameState, saveManager);
  const dayNightManager = new DayNightManager(timeManager);
  const weatherManager = new WeatherManager(bus, gameState, saveManager);
  const achievementManager = new AchievementManager(bus, gameState, saveManager);
  const dailyLoginManager = new DailyLoginManager(bus, gameState, saveManager, unlockManager);
  const customerMemoryManager = new CustomerMemoryManager(gameState);
  const cafeEventManager = new CafeEventManager(bus, gameState, saveManager, weatherManager);
  const tutorialManager = new TutorialManager(bus, gameState, saveManager);

  // Meeshi's sprite frames join the same AssetManifest/AssetLoader every
  // other asset uses — must happen before LoadingScene kicks off loadAll().
  registerPlayerSpriteAssets();

  // ---- Shared context passed to every scene ----
  const ctx = {
    bus,
    gameState,
    timeManager,
    saveManager,
    settingsManager,
    localization,
    assetLoader,
    touchManager,
    animationSystem,
    uiLayer,
    transitionSystem,
    audioManager,
    camera,
    particles,
    notificationSystem,
    popupSystem,
    dialogFramework,
    unlockManager,
    inventoryFoundation,
    upgradeManager,
    dailyObjectivesManager,
    decorationManager,
    dayNightManager,
    weatherManager,
    achievementManager,
    dailyLoginManager,
    customerMemoryManager,
    cafeEventManager,
    tutorialManager
  };

  // Make sure whatever the player already unlocked by level is reflected
  // (covers first boot on this feature set, and any future level-up while offline).
  unlockManager.syncToLevel(gameState.data.progression.level);

  // Event-driven tutorial hints — fire once, wherever the player happens to be.
  bus.on('kitchen:trayAdded', () => showTutorialHint(ctx, 'first-prep-done'));
  bus.on('customer:served', () => showTutorialHint(ctx, 'first-serve-done'));
  bus.on('player:levelup', () => showTutorialHint(ctx, 'level-up-shop'));
  bus.on('unlocks:new', (items) => {
    if (items.some((u) => u.kind === 'decoration')) showTutorialHint(ctx, 'decoration-unlocked');
  });

  // A failed save should never be silent — this is the player's progress.
  bus.on('save:error', () => {
    notificationSystem.show('Couldn\u2019t save your progress \u2014 check your device storage.', 'error', 3200);
  });
  bus.on('save:unavailable', () => {
    notificationSystem.show('Saving isn\u2019t available right now \u2014 progress won\u2019t persist this session.', 'error', 3600);
  });

  // The café gameplay loop and kitchen gameplay are session-persistent —
  // shared by both CafeScene (dining room) and KitchenScene (cooking) so a
  // customer's order and patience are the exact same object in both places.
  const gameplayLoop = new CafeGameplayLoop(ctx);
  gameplayLoop.pauseManager.pause(); // idle until the player actually starts/continues
  ctx.gameplayLoop = gameplayLoop;
  ctx.kitchenGameplay = new KitchenGameplay(ctx);

  const sceneManager = new SceneManager(ctx);
  ctx.sceneManager = sceneManager;

  sceneManager.register('loading', new LoadingScene(ctx));
  sceneManager.register('intro', new IntroScene(ctx));
  sceneManager.register('main-menu', new MainMenuScene(ctx));
  sceneManager.register('settings', new SettingsScene(ctx));
  sceneManager.register('credits', new CreditsScene(ctx));
  sceneManager.register('cafe', new CafeScene(ctx));
  sceneManager.register('kitchen', new KitchenScene(ctx));

  saveManager.markSessionStart();
  saveManager.startAutoSave(30000);

  // Persist on backgrounding — mobile Safari doesn't reliably fire beforeunload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveManager.save();
  });

  // ---- Main loop ----
  function loop(timestampMs) {
    timeManager.tick(timestampMs);
    animationSystem.update(timeManager.deltaMs);
    particles.update(timeManager.deltaSec);
    particles.render();
    gameplayLoop.update(timeManager.deltaMs); // ticks regardless of active scene (cafe/kitchen share it)
    sceneManager.update(timeManager.deltaSec);
    window.requestAnimationFrame(loop);
  }

  // Global safety net — a single unexpected error must never freeze the game.
  window.addEventListener('error', (e) => {
    console.error('[Meeshi] runtime error:', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Meeshi] unhandled promise rejection:', e.reason);
  });

  sceneManager.goTo('loading', { transition: false });
  window.requestAnimationFrame(loop);
})();
