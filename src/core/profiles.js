/* Player statistics -> readable stats, player type and exploit advice. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});

  const MIN_HANDS = 12;

  function emptyStats() {
    return {
      hands: 0, vpip: 0, pfr: 0, threeBet: 0, threeBetOpp: 0, limps: 0,
      bets: 0, raises: 0, calls: 0, checks: 0,
      facedBet: 0, foldedToBet: 0, facedCbet: 0, foldedToCbet: 0,
      cbetOpp: 0, cbets: 0, sawFlop: 0, showdowns: 0, wonShowdown: 0
    };
  }

  const pct = (a, b) => (b > 0 ? a / b : null);

  function summarize(p) {
    const s = Object.assign(emptyStats(), (p && p.stats) || {});
    const af = s.calls > 0 ? (s.bets + s.raises) / s.calls : s.bets + s.raises > 0 ? 4 : null;
    return {
      hands: s.hands,
      vpip: pct(s.vpip, s.hands),
      pfr: pct(s.pfr, s.hands),
      threeBet: pct(s.threeBet, s.threeBetOpp),
      af,
      foldToBet: pct(s.foldedToBet, s.facedBet),
      foldToCbet: pct(s.foldedToCbet, s.facedCbet),
      cbet: pct(s.cbets, s.cbetOpp),
      wtsd: pct(s.showdowns, s.sawFlop)
    };
  }

  const TYPES = {
    unknown: { label: 'Unknown', color: '#8a8f98', tip: 'Not enough hands yet: assume a typical loose-passive low-stakes player.' },
    nit: { label: 'Nit', color: '#4aa3ff', tip: 'Very tight. Steal their blinds, fold to their raises without a strong hand, do not pay them off.' },
    tag: { label: 'TAG', color: '#3ecf8e', tip: 'Tight-aggressive. Respect their raises, avoid marginal spots against them.' },
    lag: { label: 'LAG', color: '#f5a623', tip: 'Loose-aggressive. 3-bet strong hands for value, call down a little lighter.' },
    maniac: { label: 'Maniac', color: '#ff4d4f', tip: 'Bets and raises constantly. Trap with strong hands, call down lighter, never bluff them.' },
    station: { label: 'Calling station', color: '#b37feb', tip: 'Calls too much. Value bet thinner and bigger. Never bluff.' },
    fish: { label: 'Loose-passive', color: '#13c2c2', tip: 'Plays too many hands passively. Isolate with value hands and bet your strong hands.' },
    reg: { label: 'Regular', color: '#d9d9d9', tip: 'Balanced-looking player. Play solid fundamentals.' }
  };

  function classify(p) {
    const s = summarize(p);
    if (!s.hands || s.hands < MIN_HANDS || s.vpip == null) return 'unknown';
    const vpip = s.vpip, pfr = s.pfr || 0, af = s.af == null ? 1.5 : s.af;
    if (vpip > 0.45 && af > 3 && pfr > 0.25) return 'maniac';
    if (vpip < 0.17 && pfr < 0.14) return 'nit';
    if (vpip > 0.35 && pfr < vpip * 0.4) return af < 1.5 ? 'station' : 'fish';
    if (vpip <= 0.27 && pfr >= vpip * 0.6) return 'tag';
    if (vpip > 0.27 && pfr >= vpip * 0.55) return 'lag';
    return 'reg';
  }

  /**
   * Modelling numbers the strategy engine uses. Unknown players default to typical
   * low-stakes tendencies (loose, passive, call too much).
   */
  function model(p, defaults) {
    defaults = defaults || {};
    const s = summarize(p);
    const n = s.hands || 0;
    // Blend observed stats with priors so a few hands don't swing estimates wildly.
    const w = n / (n + 20);
    const blend = (obs, prior) => (obs == null ? prior : obs * w + prior * (1 - w));
    const vpip = blend(s.vpip, defaults.vpip || 0.38);
    const pfr = blend(s.pfr, defaults.pfr || 0.12);
    const af = blend(s.af, 1.6);
    const foldToBet = blend(s.foldToBet, 0.42);
    const foldToCbet = blend(s.foldToCbet, 0.45);
    const type = classify(p);
    let bluffRate = af < 1 ? 0.06 : af < 2 ? 0.12 : af < 3.5 ? 0.2 : 0.32;
    if (type === 'maniac') bluffRate = 0.4;
    if (type === 'nit') bluffRate = 0.05;
    return { vpip, pfr, af, foldToBet, foldToCbet, type, bluffRate, hands: n };
  }

  PA.Profiles = { emptyStats, summarize, classify, model, TYPES, MIN_HANDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PA.Profiles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
