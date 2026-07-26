'use strict';

/* ==========================================================================
   Speech bubbles — small ephemeral reaction bubbles above a customer's
   table ("...", "!", reaction emoji). Visually distinct from FloatingText
   (which drifts/fades) — speech bubbles pop in, hold briefly, pop out.
   ========================================================================== */
function spawnSpeechBubble(ctx, anchorEl, text) {
  const bubble = document.createElement('div');
  bubble.className = 'speech-bubble';
  bubble.textContent = text;
  anchorEl.appendChild(bubble);

  const state = { s: 0.4, o: 0 };
  ctx.animationSystem.add({
    target: state,
    props: { s: 1, o: 1 },
    duration: 220,
    easing: Easing.elasticOut,
    onUpdate: () => { bubble.style.transform = `translateX(-50%) scale(${state.s})`; bubble.style.opacity = state.o; },
    onComplete: () => {
      window.setTimeout(() => {
        ctx.animationSystem.add({
          target: state,
          props: { s: 0.6, o: 0 },
          duration: 220,
          easing: Easing.quadIn,
          onUpdate: () => { bubble.style.transform = `translateX(-50%) scale(${state.s})`; bubble.style.opacity = state.o; },
          onComplete: () => bubble.remove()
        });
      }, 900);
    }
  });
}

/* ==========================================================================
   FloatingText — spawns a small label that drifts up and fades out from a
   given point in a container. Used for "+coins", "+XP", "Perfect!", etc.
   ========================================================================== */
function spawnFloatingText(ctx, containerEl, { x, y, text, className = '' }) {
  const el = document.createElement('div');
  el.className = `floating-text ${className}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  containerEl.appendChild(el);

  const state = { y: 0, o: 1 };
  ctx.animationSystem.add({
    target: state,
    props: { y: -46, o: 0 },
    duration: 900,
    easing: Easing.cubicOut,
    onUpdate: () => {
      el.style.transform = `translate(-50%, ${state.y}px)`;
      el.style.opacity = state.o;
    },
    onComplete: () => el.remove()
  });
}

/* ==========================================================================
   CameraFX — tiny, deliberately restrained zoom/shake feedback applied to
   a scene's floor element. Built on the existing CameraFoundation + one
   AnimationSystem tween each — never more than a couple of percent scale
   or a few pixels, per the "never become distracting" requirement.
   ========================================================================== */
const CameraFX = {
  zoomPulse(ctx, targetEl, amount = 0.03, duration = 260) {
    if (ctx.settingsManager.reducedMotion) return;
    const state = { s: 1 };
    ctx.animationSystem.add({
      target: state,
      props: { s: 1 + amount },
      duration: duration / 2,
      easing: Easing.quadOut,
      yoyo: true,
      onUpdate: () => { targetEl.style.transform = `scale(${state.s})`; },
      onComplete: () => { targetEl.style.transform = ''; }
    });
  },

  shake(ctx, targetEl, strength = 5, duration = 260) {
    if (ctx.settingsManager.reducedMotion) return;
    ctx.animationSystem.shake(targetEl, strength, duration);
  }
};
