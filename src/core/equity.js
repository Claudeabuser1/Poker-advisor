/* Monte Carlo equity vs. opponent ranges, with action-based range narrowing. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});
  const { evaluate, analyze } = PA.Evaluator;

  /**
   * opponents: [{ range: [from, to] percentile window, minLevel: 0-7, bluffRate: 0-1 }]
   *   minLevel/bluffRate model betting: a sampled hand weaker than minLevel on the current board
   *   is only kept with probability bluffRate (i.e. the opponent is bluffing with it).
   */
  function equity(hero, board, opponents, opts) {
    opts = opts || {};
    const maxIter = opts.iterations || 4000;
    const budget = opts.timeBudgetMs || 120;
    const dead = new Uint8Array(52);
    hero.forEach((c) => (dead[c] = 1));
    board.forEach((c) => (dead[c] = 1));
    if (!opponents.length) return { equity: 1, iterations: 0 };

    const ranges = opponents.map((o) => PA.Ranges.rangeCombos(o.range[0], o.range[1]));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);

    const used = new Uint8Array(52);
    const start = Date.now();
    let won = 0, iter = 0;
    const fullBoard = board.slice();
    const need = 5 - board.length;
    const oppHands = opponents.map(() => [0, 0]);

    for (; iter < maxIter; iter++) {
      if ((iter & 255) === 0 && iter > 0 && Date.now() - start > budget) break;
      used.fill(0);
      let ok = true;
      for (let o = 0; o < opponents.length && ok; o++) {
        const range = ranges[o];
        const opp = opponents[o];
        let found = false;
        for (let tries = 0; tries < 60 && !found; tries++) {
          const combo = range[(Math.random() * range.length) | 0];
          const a = combo[0], b = combo[1];
          if (dead[a] || dead[b] || used[a] || used[b]) continue;
          if (opp.minLevel > 0 && board.length >= 3) {
            const lvl = analyze(combo, board).level;
            if (lvl < opp.minLevel && Math.random() >= (opp.bluffRate || 0)) continue;
          }
          used[a] = used[b] = 1;
          oppHands[o][0] = a; oppHands[o][1] = b;
          found = true;
        }
        if (!found) {
          // Range is exhausted by dead cards; fall back to random cards.
          const pick = () => { let c; do c = deck[(Math.random() * deck.length) | 0]; while (used[c]); used[c] = 1; return c; };
          oppHands[o][0] = pick(); oppHands[o][1] = pick();
        }
      }
      for (let k = 0; k < need; k++) {
        let c;
        do c = deck[(Math.random() * deck.length) | 0]; while (used[c]);
        used[c] = 1;
        fullBoard[board.length + k] = c;
      }
      const me = evaluate(hero.concat(fullBoard));
      let best = 0, ties = 0;
      for (let o = 0; o < opponents.length; o++) {
        const v = evaluate(oppHands[o].concat(fullBoard));
        if (v > best) { best = v; ties = 1; } else if (v === best) ties++;
      }
      if (me > best) won += 1;
      else if (me === best) won += 1 / (ties + 1);
    }
    return { equity: iter ? won / iter : 0, iterations: iter };
  }

  PA.Equity = { equity };
  if (typeof module !== 'undefined' && module.exports) module.exports = PA.Equity;
})(typeof globalThis !== 'undefined' ? globalThis : this);
