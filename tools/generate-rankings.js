/* Regenerates the 169-hand preflop ordering in src/core/ranges.js.
 * Ranks each starting hand by the average of its rank in heads-up equity and in 4-way equity
 * vs random hands, so suited/connected hands keep their multiway playability.
 * Usage: node tools/generate-rankings.js [iterations]
 */
require('../src/core/cards.js');
require('../src/core/evaluator.js');
const { RANKS } = PA.Cards;
const { evaluate } = PA.Evaluator;
const ITER = Number(process.argv[2] || 20000);

function classes() {
  const out = [];
  for (let i = 12; i >= 0; i--) for (let j = i; j >= 0; j--) {
    if (i === j) out.push({ name: RANKS[i] + RANKS[j], cards: [i * 4, j * 4 + 1] });
    else {
      out.push({ name: RANKS[i] + RANKS[j] + 's', cards: [i * 4, j * 4] });
      out.push({ name: RANKS[i] + RANKS[j] + 'o', cards: [i * 4, j * 4 + 1] });
    }
  }
  return out;
}

function equity(hole, nOpp) {
  let won = 0;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!hole.includes(c)) deck.push(c);
  for (let it = 0; it < ITER; it++) {
    for (let k = 0; k < 5 + nOpp * 2; k++) {
      const j = k + Math.floor(Math.random() * (deck.length - k));
      const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
    }
    const board = deck.slice(0, 5);
    const me = evaluate(hole.concat(board));
    let best = 0, ties = 1;
    for (let o = 0; o < nOpp; o++) {
      const v = evaluate([deck[5 + o * 2], deck[6 + o * 2]].concat(board));
      if (v > best) { best = v; ties = 1; } else if (v === best) ties++;
    }
    if (me > best) won += 1;
    else if (me === best) won += 1 / (ties + 1);
  }
  return won / ITER;
}

const list = classes().map((h) => ({ ...h, hu: equity(h.cards, 1), mw: equity(h.cards, 3) }));
[...list].sort((a, b) => b.hu - a.hu).forEach((h, i) => (h.rHu = i));
[...list].sort((a, b) => b.mw - a.mw).forEach((h, i) => (h.rMw = i));
list.sort((a, b) => (a.rHu + a.rMw) - (b.rHu + b.rMw) || b.hu - a.hu);
console.log(JSON.stringify(list.map((h) => h.name)));
