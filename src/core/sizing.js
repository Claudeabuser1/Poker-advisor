/* Human-looking bet sizes: round to "nice" numbers (…, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, …). */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});

  const NICE = [1, 2.5, 5];

  function niceSteps() {
    const steps = [];
    for (let exp = -2; exp <= 7; exp++) for (const m of NICE) steps.push(+(m * Math.pow(10, exp)).toFixed(4));
    return steps;
  }
  const STEPS = niceSteps();

  const isMultiple = (a, b) => Math.abs(a / b - Math.round(a / b)) < 1e-6;

  /**
   * Coarsest "nice" step whose rounding stays within 15% of the amount and is a whole
   * number of the smallest chip, e.g. 37 -> 40, 12.3 -> 12 (1/2 game), 7.4 -> 7.5 (0.5/1 game).
   */
  function stepFor(amount, minChip) {
    for (let i = STEPS.length - 1; i >= 0; i--) {
      const s = STEPS[i];
      if (minChip && (s < minChip - 1e-9 || !isMultiple(s, minChip))) continue;
      const r = Math.round(amount / s) * s;
      if (r > 0 && Math.abs(r - amount) <= amount * 0.15) return s;
    }
    return minChip || STEPS[0];
  }

  function fix(n) {
    return +n.toFixed(4);
  }

  /**
   * Round a desired bet/raise-to amount to a natural number.
   * opts: { min, max, bigBlind, minChip, allInThreshold (fraction of max that becomes all-in) }
   */
  function roundBet(amount, opts) {
    opts = opts || {};
    const max = opts.max != null ? opts.max : Infinity;
    const min = opts.min || 0;
    const minChip = opts.minChip || (opts.bigBlind ? halfUnit(opts.bigBlind) : 0);
    if (amount >= max) return { amount: fix(max), allIn: true };
    let step = stepFor(amount, minChip);
    let r = Math.round(amount / step) * step;
    if (r < min) r = Math.ceil(min / step) * step;
    const threshold = opts.allInThreshold != null ? opts.allInThreshold : 0.85;
    if (r >= max * threshold) return { amount: fix(max), allIn: true };
    return { amount: fix(r), allIn: false };
  }

  /** Half of the big blind, snapped to a nice value (bb 2 -> 1, bb 0.10 -> 0.05, bb 0.25 -> 0.1). */
  function halfUnit(bb) {
    const target = bb / 2;
    let best = STEPS[0];
    for (const s of STEPS) if (s <= target + 1e-9) best = s;
    return best;
  }

  function formatAmount(n) {
    if (n == null || isNaN(n)) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return String(fix(n));
  }

  PA.Sizing = { roundBet, stepFor, halfUnit, formatAmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = PA.Sizing;
})(typeof globalThis !== 'undefined' ? globalThis : this);
