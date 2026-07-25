'use strict';

/* ==========================================================================
   CustomerRenderer — temporary clean silhouette visuals for customers,
   built so a future sprite-based renderer can drop in behind the exact
   same interface (mount/setPose/setFlip/remove) without touching
   CafeScene, CafeGameplayLoop, or Customer at all.

   Nothing here builds up a "person" out of separate body/hair/outfit
   layers — each customer is one silhouette shape recolored per their
   `paletteIndex`, plus a tiny face glyph for warmth and quick read.
   ========================================================================== */
const CUSTOMER_SILHOUETTE_PALETTE = [
  '#8a6a54', '#a6754f', '#6f5a7a', '#4f7a72', '#7a5252', '#5a6a8a'
];

const CustomerRenderer = {
  /** Creates the DOM element for a customer. Caller positions it. */
  mount(customer) {
    const el = document.createElement('div');
    el.className = 'customer-figure';
    el.dataset.customerId = customer.id;
    el.style.setProperty('--silhouette-color', CUSTOMER_SILHOUETTE_PALETTE[customer.paletteIndex]);

    el.innerHTML = `
      <div class="customer-figure__shadow"></div>
      <div class="customer-figure__body">
        <div class="customer-figure__head">
          <span class="customer-figure__face">${customer.face}</span>
        </div>
        <div class="customer-figure__torso"></div>
      </div>
    `;

    this.setPose(el, 'idle');
    return el;
  },

  /** Swaps the pose/state class — this is the seam a sprite renderer would
   *  replace with SpriteAnimator.play(poseName) later. */
  setPose(el, poseName) {
    if (el.dataset.pose === poseName) return;
    if (el.dataset.pose) el.classList.remove(`customer-figure--${el.dataset.pose}`);
    el.dataset.pose = poseName;
    el.classList.add('customer-figure', `customer-figure--${poseName}`);
  },

  setFlip(el, facingLeft) {
    el.classList.toggle('customer-figure--flip', !!facingLeft);
  },

  /** Purely visual move — a future sprite renderer would keep this exact
   *  signature and swap the idle pose for a walk-cycle underneath it. */
  moveTo(ctx, el, x, y, durationMs) {
    return this._tweenPosition(ctx, el, x, y, durationMs);
  },

  _tweenPosition(ctx, el, x, y, durationMs) {
    const start = { x: this._readX(el), y: this._readY(el) };
    return ctx.animationSystem.add({
      target: start,
      props: { x, y },
      duration: durationMs,
      onUpdate: () => { el.style.transform = `translate(${start.x}px, ${start.y}px)`; }
    });
  },

  _readX(el) {
    const t = el.style.transform || '';
    const m = t.match(/translate\(([-\d.]+)px/);
    return m ? parseFloat(m[1]) : 0;
  },

  _readY(el) {
    const t = el.style.transform || '';
    const m = t.match(/,\s*([-\d.]+)px\)/);
    return m ? parseFloat(m[1]) : 0;
  },

  remove(el) {
    if (el && el.parentNode) el.remove();
  }
};
