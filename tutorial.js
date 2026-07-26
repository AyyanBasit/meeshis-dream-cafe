'use strict';

/* ==========================================================================
   TUTORIAL_TIPS — each tip fires once, the first time its triggering
   moment happens. No forced sequence, no blocking modal — just a short
   dismissible banner at the bottom of the screen so it teaches without
   ever getting in the way of someone who already knows what to do.
   ========================================================================== */
const TUTORIAL_TIPS = {
  'welcome-kitchen': 'Welcome to Meeshi\u2019s Dream Café! Tap \ud83c\udf73 Kitchen to start cooking for your first customer.',
  'kitchen-intro': 'Tap a ticket above to start an order, then follow the on-screen steps at its station.',
  'first-prep-done': 'Nicely done! Head to \ud83c\udf7d\ufe0f the Dining Room and tap the bell to deliver it.',
  'first-serve-done': 'You earned coins and XP! Keep serving happy customers to level up your café.',
  'level-up-shop': 'New things may have unlocked! Check \u2b06\ufe0f Upgrades to grow your café.',
  'decoration-unlocked': 'You can decorate now! Tap \ud83e\udded Decorate to make your café feel like home.'
};

const TUTORIAL_TIP_ORDER = Object.keys(TUTORIAL_TIPS);

class TutorialManager {
  constructor(bus, gameState, saveManager) {
    this.bus = bus;
    this.gameState = gameState;
    this.saveManager = saveManager;
  }

  hasSeen(tipId) {
    return this.gameState.data.tutorial.seenTips.includes(tipId);
  }

  /** Marks a tip seen and returns its text if it's genuinely new — callers
   *  only show a banner when this returns non-null, so re-triggering the
   *  same moment later (e.g. a second level-up) stays silent. */
  markSeen(tipId) {
    if (this.gameState.data.tutorial.completed) return null;
    if (this.hasSeen(tipId)) return null;

    const tips = this.gameState.data.tutorial.seenTips;
    tips.push(tipId);
    if (tips.length >= TUTORIAL_TIP_ORDER.length) {
      this.gameState.data.tutorial.completed = true;
    }
    this.saveManager.save();
    return TUTORIAL_TIPS[tipId];
  }
}

/* ==========================================================================
   Tutorial hint banner — one shared bottom-of-screen dismissible strip,
   used by any scene. Auto-dismisses after a few seconds or on tap.
   ========================================================================== */
function showTutorialHint(ctx, tipId) {
  const text = ctx.tutorialManager.markSeen(tipId);
  if (!text) return;

  const el = document.createElement('div');
  el.className = 'tutorial-hint';
  el.innerHTML = `<span class="tutorial-hint-icon">\ud83d\udca1</span><span class="tutorial-hint-text">${text}</span>`;
  ctx.uiLayer.get('notification').appendChild(el);

  const dismiss = () => {
    ctx.animationSystem.fadeOut(el, 220, 0, () => el.remove());
  };
  el.addEventListener('click', dismiss);

  ctx.animationSystem.slideIn(el, 16, 260);
  window.setTimeout(dismiss, 5200);
}
