const test = require('node:test');
const assert = require('node:assert');
const PA = require('./load');
const P = PA.Cards.parseCards;
const cat = (s) => PA.Evaluator.CATEGORY_NAMES[PA.Evaluator.categoryOf(PA.Evaluator.evaluate(P(s)))];

test('card parsing handles common site formats', () => {
  const c = PA.Cards;
  for (const [input, out] of [['As', 'As'], ['a♠', 'As'], ['10h', 'Th'], ['♦Q', 'Qd'], ['card_kc.png', 'Kc'], ['ace_of_spades.svg', 'As'], ['spades-K', 'Ks'], ['/img/cards/2C.svg', '2c'], ['ten of hearts', 'Th']]) {
    assert.strictEqual(c.cardToString(c.parseCard(input)), out, input);
  }
  assert.strictEqual(c.parseCard('hello'), null);
  assert.deepStrictEqual(P('Ah Kd 10s').map(c.cardToString), ['Ah', 'Kd', 'Ts']);
});

test('hand categories', () => {
  assert.strictEqual(cat('AsKsQsJsTs'), 'Straight flush');
  assert.strictEqual(cat('As2d3c4h5s9d'), 'Straight');
  assert.strictEqual(cat('AhAdAcKsKd2c'), 'Full house');
  assert.strictEqual(cat('2c2d2h2s3c'), 'Four of a kind');
  assert.strictEqual(cat('AsKs9s4s2sQh'), 'Flush');
  assert.strictEqual(cat('AsAd9c4s2hKh7c'), 'Pair');
  assert.strictEqual(cat('AsAd9c9s2hKh7c'), 'Two pair');
});

test('evaluator ranks kickers and wheel correctly', () => {
  const E = PA.Evaluator.evaluate;
  assert.ok(E(P('AsKd9c4s2h')) > E(P('AsQd9c4s2h')));
  assert.ok(E(P('6s5d4c3s2h')) > E(P('As5d4c3s2h')), '6-high straight beats wheel');
  assert.ok(E(P('AhAd3c3s2h')) < E(P('AhAdKcKs2h')));
  assert.strictEqual(E(P('AhKdQc7s2d9h3c')), E(P('AcKhQd7c2h9s3d')));
});

test('hand analysis finds pairs and draws', () => {
  const a = PA.Evaluator.analyze(P('AhKh'), P('Kd7h2h'));
  assert.strictEqual(a.name, 'Top pair, good kicker');
  assert.ok(a.flushDraw && a.nutFlushDraw);
  const b = PA.Evaluator.analyze(P('9c8c'), P('Td7s2h'));
  assert.ok(b.oesd);
  assert.strictEqual(PA.Evaluator.analyze(P('7c7d'), P('Kh7h2d')).name, 'Set');
  assert.strictEqual(PA.Evaluator.analyze(P('QcQd'), P('Jh7h2d')).name, 'Overpair');
});

test('equity is accurate for known matchups', () => {
  const eq = PA.Equity.equity(P('AsAd'), [], [{ range: [0, 1] }], { iterations: 20000, timeBudgetMs: 10000 }).equity;
  assert.ok(Math.abs(eq - 0.852) < 0.02, 'AA vs random ~85%: ' + eq);
  const qq = PA.Ranges.PERCENTILE.QQ;
  const eq2 = PA.Equity.equity(P('AsKs'), [], [{ range: [qq - 0.001, qq + 0.001] }], { iterations: 20000, timeBudgetMs: 10000 }).equity;
  assert.ok(Math.abs(eq2 - 0.46) < 0.025, 'AKs vs QQ ~46%: ' + eq2);
});

test('bet sizes are rounded to natural numbers', () => {
  const r = (a, bb, extra) => PA.Sizing.roundBet(a, Object.assign({ bigBlind: bb, max: 1e6 }, extra)).amount;
  assert.strictEqual(r(37, 2), 40);
  assert.strictEqual(r(12.3, 2), 12);
  assert.strictEqual(r(23, 2), 25);
  assert.strictEqual(r(22.55, 2), 25);
  assert.strictEqual(r(2.6, 1), 2.5);
  assert.strictEqual(r(0.62, 0.05), 0.6);
  assert.strictEqual(r(1234, 10), 1250);
  for (let i = 0; i < 300; i++) {
    const bb = [0.02, 0.1, 0.25, 1, 2, 5, 10][i % 7];
    const amt = r(bb * (1 + Math.random() * 60), bb);
    const half = PA.Sizing.halfUnit(bb);
    assert.ok(Math.abs(amt / half - Math.round(amt / half)) < 1e-6, amt + ' is a multiple of ' + half);
  }
  const shove = PA.Sizing.roundBet(90, { bigBlind: 2, max: 100 });
  assert.ok(shove.allIn && shove.amount === 100, 'near-stack bets become all-in');
});

// ---------------------------------------------------------------- strategy

const opp = (o) => Object.assign({ name: 'V', stack: 200, bet: 0, actions: {} }, o);
const advise = (ctx, settings) => PA.Strategy.advise(Object.assign({ board: [], bigBlind: 2, rng: () => 0.99 }, ctx), settings);
const pre = (cards, pos, extra) => advise(Object.assign({ street: 'preflop', pot: 3, toCall: 2, hero: { cards: P(cards), stack: 200, bet: 0, position: pos }, opponents: [opp(), opp()] }, extra));

test('preflop: opens strong hands, folds trash', () => {
  assert.strictEqual(pre('AsAd', 'EP').action, 'raise');
  assert.strictEqual(pre('7s2d', 'EP').action, 'fold');
  assert.strictEqual(pre('KsTs', 'BTN').action, 'raise');
  assert.strictEqual(pre('9s4d', 'EP').action, 'fold');
});

test('preflop: 3-bets premiums, set-mines small pairs, folds weak hands to a raise', () => {
  const facing = (cards) => pre(cards, 'CO', { pot: 9, toCall: 6, opponents: [opp({ bet: 6 })], aggressor: opp({ bet: 6 }) });
  assert.strictEqual(facing('KdKc').action, 'raise');
  assert.strictEqual(facing('5d5c').action, 'call');
  assert.strictEqual(facing('Kd4c').action, 'fold');
});

test('preflop: short stack plays push/fold', () => {
  const a = pre('Ad9c', 'SB', { toCall: 1, hero: { cards: P('Ad9c'), stack: 19, bet: 1, position: 'SB' } });
  assert.strictEqual(a.action, 'allin');
  const b = pre('8d3c', 'EP', { hero: { cards: P('8d3c'), stack: 18, bet: 0, position: 'EP' } });
  assert.strictEqual(b.action, 'fold');
});

test('postflop: value bets strong hands with rounded sizes', () => {
  const a = advise({ street: 'flop', board: P('Kc7s2d'), pot: 12, toCall: 0, hero: { cards: P('AhKd'), stack: 190, bet: 0 }, opponents: [opp({ actions: { preflop: 'call' } })] });
  assert.strictEqual(a.action, 'bet');
  assert.ok(a.amount >= 5 && a.amount <= 10 && Number.isInteger(a.amount), 'bet ' + a.amount);
});

test('postflop: stack protection folds one pair to a big river shove', () => {
  const v = opp({ bet: 150, stack: 0, actions: { preflop: 'call', aggThisStreet: 1 } });
  const a = advise({ street: 'river', board: P('Kc7s2d9h4c'), pot: 210, toCall: 150, hero: { cards: P('AhKd'), stack: 150, bet: 0 }, opponents: [v], aggressor: v });
  assert.strictEqual(a.action, 'fold');
});

test('postflop: calls with a good draw and correct odds, raises sets', () => {
  const v = opp({ bet: 8, actions: { preflop: 'raise', aggThisStreet: 1 } });
  const draw = advise({ street: 'flop', board: P('Kh7h2d'), pot: 24, toCall: 8, hero: { cards: P('Ah5h'), stack: 190, bet: 0 }, opponents: [v], aggressor: v });
  assert.strictEqual(draw.action, 'call');
  const set = advise({ street: 'flop', board: P('Kh7h2d'), pot: 24, toCall: 8, hero: { cards: P('7c7d'), stack: 190, bet: 0 }, opponents: [v], aggressor: v });
  assert.strictEqual(set.action, 'raise');
});

test('postflop: never bluffs calling stations, sometimes bluffs folders', () => {
  const station = { name: 'S', stack: 200, bet: 0, actions: { preflop: 'call' }, model: Object.assign(PA.Profiles.model(null), { type: 'station', foldToBet: 0.2, foldToCbet: 0.2 }) };
  let bluffs = 0, stationBluffs = 0;
  for (let i = 0; i < 400; i++) {
    const base = { street: 'flop', board: P('Kc7s2d'), pot: 12, toCall: 0, heroIsPfAggressor: true, hero: { cards: P('QhJc'), stack: 190, bet: 0 }, rng: Math.random };
    if (advise(Object.assign({}, base, { opponents: [opp({ actions: { preflop: 'call' } })] })).action === 'bet') bluffs++;
    if (advise(Object.assign({}, base, { opponents: [station] })).action === 'bet') stationBluffs++;
  }
  assert.strictEqual(stationBluffs, 0);
  assert.ok(bluffs > 40 && bluffs < 360, 'bluff frequency mixed: ' + bluffs + '/400');
  const none = advise({ street: 'flop', board: P('Kc7s2d'), pot: 12, toCall: 0, heroIsPfAggressor: true, hero: { cards: P('QhJc'), stack: 190, bet: 0 }, opponents: [opp({})], rng: () => 0 }, { bluff: 0 });
  assert.strictEqual(none.action, 'check', 'bluff slider at 0 disables bluffs');
});

test('profiles classify players from stats', () => {
  const mk = (hands, vpip, pfr, bets, calls) => ({ stats: Object.assign(PA.Profiles.emptyStats(), { hands, vpip, pfr, bets, calls }) });
  assert.strictEqual(PA.Profiles.classify(mk(50, 6, 5, 4, 3)), 'nit');
  assert.strictEqual(PA.Profiles.classify(mk(50, 30, 4, 2, 30)), 'station');
  assert.strictEqual(PA.Profiles.classify(mk(50, 11, 9, 8, 4)), 'tag');
  assert.strictEqual(PA.Profiles.classify(mk(50, 30, 20, 40, 5)), 'maniac');
  assert.strictEqual(PA.Profiles.classify(mk(5, 5, 5, 5, 5)), 'unknown');
});
