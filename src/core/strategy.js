/* Decision engine: turns a table situation into a recommended action with reasons. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});
  const { analyze } = PA.Evaluator;
  const { percentile, handClass } = PA.Ranges;
  const { roundBet, formatAmount } = PA.Sizing;

  // Unopened raise ranges (fraction of all hands) by position, for a full-ish table.
  const OPEN = { EP: 0.13, MP: 0.17, HJ: 0.21, CO: 0.27, BTN: 0.4, SB: 0.3, BB: 0.3 };
  // Push/fold ranges at ~10bb effective.
  const PUSH = { EP: 0.12, MP: 0.15, HJ: 0.18, CO: 0.24, BTN: 0.33, SB: 0.42, BB: 0.3 };
  const LATE = { CO: 1, BTN: 1, SB: 1 };

  const DEFAULTS = { style: 'balanced', bluff: 25, safety: 70, defaultVpip: 0.38, defaultPfr: 0.12 };

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function styleMul(style) {
    return style === 'tight' ? 0.8 : style === 'aggressive' ? 1.2 : 1;
  }

  function boardWetness(board) {
    if (board.length < 3) return 0;
    const suits = [0, 0, 0, 0];
    board.forEach((c) => suits[c & 3]++);
    const maxSuit = Math.max(...suits);
    let wet = maxSuit >= 3 ? 2 : maxSuit === 2 && board.length <= 4 ? 1 : 0;
    const ranks = [...new Set(board.map((c) => c >> 2))].sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2) wet += 0.75;
    if (ranks.length < board.length) wet -= 0.5;
    return wet;
  }

  /** Opponent range model from what they did this hand. */
  function opponentSpec(o, ctx, S) {
    const m = o.model || PA.Profiles.model(null, { vpip: S.defaultVpip, pfr: S.defaultPfr });
    const act = o.actions || {};
    let range;
    if (act.preflop === '4bet') range = [0, 0.025];
    else if (act.preflop === '3bet') range = [0, clamp(m.pfr * 0.3, 0.03, 0.12)];
    else if (act.preflop === 'raise') range = [0, clamp(m.pfr, 0.06, 0.45)];
    else if (act.preflop === 'call') range = [m.af > 1.2 ? clamp(m.pfr * 0.2, 0, 0.04) : 0, clamp(m.vpip * 0.85, 0.12, 0.7)];
    else if (act.preflop === 'limp') range = [m.pfr > 0.08 ? 0.03 : 0, clamp(m.vpip, 0.2, 0.8)];
    else if (act.preflop === 'check') range = [0.05, 1];
    else range = [0, clamp(m.vpip, 0.15, 0.8)];

    let minLevel = 0;
    let bluffRate = m.bluffRate;
    const agg = act.aggThisStreet || 0;
    if (ctx.street !== 'preflop') {
      if (agg >= 2) { minLevel = 5; bluffRate *= 0.4; }
      else if (act.raisedThisStreet) { minLevel = ctx.street === 'river' ? 5 : 4; bluffRate *= 0.6; }
      else if (agg === 1) { minLevel = ctx.street === 'river' ? 3 : 2; }
      else if ((act.callsPrevStreets || 0) + (act.aggPrevStreets || 0) > 0) { minLevel = 1; bluffRate = Math.max(bluffRate, 0.35); }
      // Big bets and overbets at low stakes are mostly value.
      const potBefore = Math.max((ctx.pot || 0) - (o.bet || 0) - (ctx.hero.bet || 0), 1);
      if (agg > 0 && (o.bet || 0) >= potBefore * 0.9) { minLevel += 1; bluffRate *= 0.8; }
    }
    return { range, minLevel, bluffRate, model: m };
  }

  function makeAdvice(action, amount, extra) {
    const a = Object.assign({ action, amount: amount || 0, reasons: [] }, extra || {});
    const amt = formatAmount(a.amount);
    a.display = {
      fold: 'FOLD', check: 'CHECK', call: 'CALL ' + amt, bet: 'BET ' + amt,
      raise: 'RAISE TO ' + amt, allin: 'ALL-IN (' + amt + ')'
    }[action];
    return a;
  }

  /**
   * ctx: {
   *   street, board, pot (incl. all bets on table), toCall, bigBlind, minRaiseTo,
   *   hero: { cards, stack (behind), bet (this street), position, inPosition },
   *   opponents: [{ name, stack, bet, model, actions }]  (only players still in the hand),
   *   preflopRaises, limpers, heroIsPfAggressor, aggressor (opponent who made the current bet)
   * }
   */
  function advise(ctx, settings) {
    const S = Object.assign({}, DEFAULTS, settings || {});
    const rng = ctx.rng || Math.random;
    const hero = ctx.hero;
    if (!hero || !hero.cards || hero.cards.length !== 2) return null;
    const bb = ctx.bigBlind || 1;
    const opps = (ctx.opponents || []).filter((o) => !o.folded);
    const toCall = Math.max(0, Math.min(ctx.toCall || 0, hero.stack));
    const pot = Math.max(ctx.pot || 0, toCall);
    const heroTotal = hero.stack + (hero.bet || 0);
    const maxOppTotal = opps.length ? Math.max(...opps.map((o) => (o.stack || 0) + (o.bet || 0))) : heroTotal;
    const effStack = Math.min(heroTotal, maxOppTotal || heroTotal);
    const currentBet = (hero.bet || 0) + toCall;
    const minRaiseTo = Math.max(ctx.minRaiseTo || 0, currentBet > 0 ? currentBet * 2 : bb);

    const env = {
      ctx, S, rng, hero, bb, opps, toCall, pot, heroTotal, effStack, currentBet, minRaiseTo,
      bluffK: S.bluff / 25, safety: S.safety / 100, mul: styleMul(S.style),
      potOdds: toCall > 0 ? toCall / (pot + toCall) : 0
    };

    env.size = function (target, kind) {
      const r = roundBet(target, { bigBlind: bb, min: minRaiseTo, max: heroTotal, allInThreshold: kind === 'bluff' ? 2 : 0.8 });
      return r;
    };

    const advice = ctx.street === 'preflop' ? preflop(env) : postflop(env);
    advice.potOdds = env.potOdds;
    advice.effStackBB = effStack / bb;
    advice.spr = pot > 0 ? effStack / pot : null;
    return advice;
  }

  // ---------------------------------------------------------------- preflop

  function preflop(env) {
    const { ctx, S, hero, bb, toCall, effStack, mul, rng } = env;
    const p = percentile(hero.cards);
    const cls = handClass(hero.cards);
    const pos = hero.position || 'MP';
    const effBB = effStack / bb;
    const raises = ctx.preflopRaises != null ? ctx.preflopRaises : estimateRaises(env);
    const limpers = ctx.limpers || 0;
    const base = { equity: null, hand: cls, handPct: p, kind: 'preflop' };
    const reasons = [];
    const topPct = Math.max(1, Math.round(p * 100));
    reasons.push(p <= 0.5 ? cls + ' ranks in the top ' + topPct + '% of starting hands.' : cls + ' is a weak starting hand (bottom ' + Math.max(1, 100 - topPct) + '%).');

    // Short stack: push or fold.
    if (effBB <= 12 && (raises === 0 || toCall >= hero.stack * 0.25 || raises >= 1)) {
      if (raises === 0) {
        const range = clamp((PUSH[pos] || 0.15) * mul * Math.pow(10 / Math.max(effBB, 2), 0.6), 0.05, 0.7);
        reasons.push('Short stack (' + effBB.toFixed(0) + ' BB): push/fold strategy, shoving top ' + Math.round(range * 100) + '% from ' + pos + '.');
        if (p <= range) return makeAdvice('allin', env.heroTotal, Object.assign(base, { reasons, kind: 'value' }));
        if (toCall === 0) return makeAdvice('check', 0, Object.assign(base, { reasons }));
        return makeAdvice('fold', 0, Object.assign(base, { reasons }));
      }
      const r = raiserRange(env, raises);
      const eq = quickEquity(hero.cards, ctx.board, env.opps, r);
      const allInOdds = Math.min(env.heroTotal - (hero.bet || 0), effStack) / (env.pot + Math.min(env.heroTotal, effStack));
      reasons.push('Short stack: equity vs their range ~' + pct(eq) + ', need ' + pct(allInOdds) + ' to get it in.');
      if (eq >= allInOdds + 0.03 * env.safety && p <= Math.max(0.05, r * 0.6)) {
        return makeAdvice('allin', env.heroTotal, Object.assign(base, { reasons, equity: eq, kind: 'value' }));
      }
      if (toCall <= bb / 2 && toCall < hero.stack * 0.1) return makeAdvice('call', toCall, Object.assign(base, { reasons, equity: eq }));
      return toCall === 0 ? makeAdvice('check', 0, Object.assign(base, { reasons })) : makeAdvice('fold', 0, Object.assign(base, { reasons, equity: eq }));
    }

    if (raises === 0) {
      let range = (OPEN[pos] || 0.17) * mul;
      if (limpers > 0) range *= 0.75; // isolate limpers with value-heavy hands
      if (ctx.numPlayers && ctx.numPlayers <= 4) range = Math.max(range, (OPEN.CO * mul));
      if (p <= range) {
        let target = (LATE[pos] && !limpers ? 2.5 : 3) * bb + limpers * bb;
        if (pos === 'SB' || pos === 'BB') target += bb * 0.5;
        const r = env.size(target);
        reasons.push(limpers ? 'Raise to isolate ' + limpers + ' limper(s); weak players limp too often.' : 'Standard open raise from ' + pos + ' (opening top ' + Math.round(range * 100) + '%).');
        return makeAdvice(r.allIn ? 'allin' : 'raise', r.amount, Object.assign(base, { reasons, kind: 'value' }));
      }
      if (toCall === 0) {
        reasons.push('Not strong enough to raise; take the free flop.');
        return makeAdvice('check', 0, Object.assign(base, { reasons }));
      }
      const speculative = cls.length === 2 || cls[2] === 's';
      if (limpers >= 1 && toCall <= bb && speculative && p <= 0.5 && effStack >= 40 * bb && pos !== 'EP') {
        reasons.push('Cheap multiway pot with a speculative hand and deep stacks: over-limp for implied odds.');
        return makeAdvice('call', toCall, Object.assign(base, { reasons, kind: 'speculative' }));
      }
      if (pos === 'SB' && limpers >= 1 && toCall <= bb / 2 && p <= 0.55) {
        reasons.push('Small blind completing for half a blind in a limped pot.');
        return makeAdvice('call', toCall, Object.assign(base, { reasons }));
      }
      reasons.push('Outside the ' + pos + ' opening range: fold and wait for a better spot.');
      return makeAdvice('fold', 0, Object.assign(base, { reasons }));
    }

    // Facing a raise (or more).
    const rRange = raiserRange(env, raises);
    const aggr = ctx.aggressor;
    const typeLabel = aggr && aggr.model ? PA.Profiles.TYPES[aggr.model.type].label : 'Unknown';
    const eq = quickEquity(hero.cards, ctx.board, env.opps, rRange);
    const ip = hero.inPosition != null ? hero.inPosition : !!LATE[pos] && pos !== 'SB';
    const realize = (ip ? 0.95 : 0.78) * (env.opps.length > 1 ? 0.92 : 1);
    reasons.push('Raiser (' + (aggr ? aggr.name + ', ' : '') + typeLabel + ') range ~' + PA.Ranges.describeTop(rRange) + '. Your equity ~' + pct(eq) + '.');

    const valueCut = clamp(rRange * (raises >= 2 ? 0.35 : 0.3) * mul, raises >= 2 ? 0.012 : 0.025, 0.09);
    if (p <= valueCut) {
      const callersBets = env.opps.filter((o) => o !== aggr).reduce((s, o) => s + (o.bet || 0), 0);
      const mult = raises >= 2 ? 2.3 : ip ? 3 : 3.6;
      const target = env.currentBet * mult + callersBets;
      const r = env.size(target);
      const allIn = r.allIn || r.amount > effStack * 0.45;
      reasons.push(raises >= 2 ? 'Premium hand: re-raise for value.' : '3-bet for value; you are ahead of their range.');
      return makeAdvice(allIn ? 'allin' : 'raise', allIn ? env.heroTotal : r.amount, Object.assign(base, { reasons, equity: eq, kind: 'value' }));
    }

    // Light 3-bet bluffs with blockers/playability, only deep and against openers who fold.
    const bluffCandidate = /^A[2-5]s$|^K[9T]s$|^(T9|98|87|76|65)s$/.test(cls);
    if (raises === 1 && bluffCandidate && effStack >= 60 * env.bb && (LATE[pos] || pos === 'BB')) {
      const foldy = aggr && aggr.model ? clamp(aggr.model.pfr / 0.15, 0.5, 2) : 1;
      const station = aggr && aggr.model && (aggr.model.type === 'station' || aggr.model.type === 'maniac');
      if (!station && rng() < clamp(0.12 * env.bluffK * foldy, 0, 0.5)) {
        const target = env.currentBet * (ip ? 3 : 3.6);
        const r = env.size(target, 'bluff');
        if (r.amount <= env.heroTotal * 0.15) {
          reasons.push('Occasional light 3-bet (bluff) with a hand that blocks strong hands / plays well. Fold if they 4-bet.');
          return makeAdvice('raise', r.amount, Object.assign(base, { reasons, equity: eq, kind: 'bluff' }));
        }
      }
    }

    const isPair = cls.length === 2;
    const setMine = isPair && effStack >= 15 * toCall && toCall <= hero.stack * 0.08 && raises === 1;
    const suitedPlayable = cls[2] === 's' && p <= 0.35 && effStack >= 25 * toCall && ip && raises === 1;
    const callCap = clamp(rRange * (raises >= 2 ? 0.8 : 1.8) + (pos === 'BB' ? 0.15 : 0.03), 0.04, pos === 'BB' ? 0.6 : 0.4);
    const margin = 0.02 + 0.06 * env.safety * Math.min(1, toCall / Math.max(hero.stack, 1) * 4);
    if ((eq * realize >= env.potOdds + margin && p <= callCap) || setMine || suitedPlayable) {
      if (setMine) reasons.push('Pocket pair with deep stacks: call to try to flop a set (implied odds).');
      else if (suitedPlayable && !(eq * realize >= env.potOdds + margin)) reasons.push('Suited hand in position with deep stacks: profitable call for implied odds.');
      else reasons.push('Pot odds ' + pct(env.potOdds) + ' are good enough to call' + (ip ? ' in position.' : '.'));
      if (toCall > hero.stack * 0.35 && p > 0.03) {
        reasons.push('But calling commits too much of your stack with a non-premium hand.');
        return makeAdvice('fold', 0, Object.assign(base, { reasons, equity: eq }));
      }
      return makeAdvice('call', toCall, Object.assign(base, { reasons, equity: eq, kind: 'call' }));
    }
    reasons.push('Not enough equity vs their range for the price (' + pct(env.potOdds) + ' pot odds): fold.');
    return makeAdvice('fold', 0, Object.assign(base, { reasons, equity: eq }));
  }

  function estimateRaises(env) {
    const cb = env.currentBet, bb = env.bb;
    if (cb <= bb * 1.01) return 0;
    if (cb <= bb * 5.5) return 1;
    if (cb <= bb * 16) return 2;
    return 3;
  }

  function raiserRange(env, raises) {
    const a = env.ctx.aggressor;
    const m = a && a.model ? a.model : { pfr: env.S.defaultPfr };
    let r = raises >= 3 ? 0.025 : raises === 2 ? clamp(m.pfr * 0.35, 0.03, 0.12) : clamp(m.pfr, 0.06, 0.45);
    const sizeBB = env.currentBet / env.bb;
    if (raises === 1 && sizeBB >= 5) r *= 0.75; // big opens at low stakes are value-heavy
    if (raises === 1 && a && a.position && LATE[a.position]) r = Math.min(0.5, r * 1.25);
    return r;
  }

  function quickEquity(hero, board, opps, rangeTop) {
    const specs = [{ range: [0, rangeTop] }];
    for (let i = 1; i < Math.min(opps.length, 3); i++) specs.push({ range: [0, 0.4] });
    return PA.Equity.equity(hero, board || [], specs, { iterations: 1500, timeBudgetMs: 60 }).equity;
  }

  // ---------------------------------------------------------------- postflop

  function postflop(env) {
    const { ctx, S, hero, toCall, pot, opps, rng, bluffK, safety } = env;
    const board = ctx.board;
    const a = analyze(hero.cards, board);
    const specs = opps.map((o) => opponentSpec(o, ctx, S));
    const eqRes = PA.Equity.equity(hero.cards, board, specs.map((s) => ({ range: s.range, minLevel: s.minLevel, bluffRate: s.bluffRate })), { iterations: 5000, timeBudgetMs: 140 });
    const eq = eqRes.equity;
    const n = Math.max(1, opps.length);
    const fair = 1 / (n + 1);
    const styleAdj = S.style === 'aggressive' ? -0.03 : S.style === 'tight' ? 0.03 : 0;
    const valueEq = fair + (1 - fair) * (0.3 + styleAdj);
    const strongEq = fair + (1 - fair) * (0.55 + styleAdj);
    const spr = env.effStack / Math.max(pot, 1);
    const wet = boardWetness(board);
    const handName = a.name + (a.draws.length ? ' + ' + a.draws.join(' + ') : '');
    const base = { equity: eq, hand: handName, level: a.level, outs: a.outs, kind: 'postflop' };
    const reasons = [handName + '. Equity vs. estimated range' + (n > 1 ? 's of ' + n + ' players' : '') + ': ' + pct(eq) + '.'];
    const models = specs.map((s) => s.model);
    const anyStation = models.some((m) => m.type === 'station' || m.type === 'maniac');
    const foldProb = models.reduce((s, m) => s + (ctx.heroIsPfAggressor && ctx.street === 'flop' ? m.foldToCbet : m.foldToBet), 0) / models.length;
    const foldK = clamp(foldProb / 0.45, 0.3, 1.8);

    const requiredLevel = spr <= 1.5 ? 2 : spr <= 3 ? 3 : spr <= 6 ? 4 : safety >= 0.6 ? 5 : 4;
    const commitEq = fair + (1 - fair) * (0.35 + 0.3 * safety);
    function canCommit(added) {
      const frac = added / Math.max(hero.stack, 1e-9);
      if (frac < 0.3 - 0.1 * safety) return true;
      return eq >= commitEq && a.level >= requiredLevel;
    }
    const riverOrNoDraw = ctx.street === 'river';

    // ---------- facing a bet
    if (toCall > 0) {
      const aggr = ctx.aggressor;
      const aggrModel = aggr && aggr.model;
      const raiseTarget = env.currentBet * 3 + (env.pot - env.currentBet - (hero.bet || 0)) * 0.25;
      const r = env.size(Math.max(raiseTarget, env.minRaiseTo));
      const raiseAdd = (r.allIn ? env.heroTotal : r.amount) - (hero.bet || 0);

      if (eq >= strongEq && a.level >= 4 && canCommit(raiseAdd)) {
        const trap = aggrModel && aggrModel.type === 'maniac' && n === 1 && !riverOrNoDraw && a.level >= 6 && rng() < 0.6;
        if (trap) {
          reasons.push('Very strong hand vs a maniac: just call and let them keep betting (trap).');
          return makeAdvice('call', toCall, Object.assign(base, { reasons, kind: 'trap' }));
        }
        reasons.push('Strong hand: raise for value' + (wet >= 2 && !riverOrNoDraw ? ' and charge the draws.' : '.'));
        if (r.allIn || raiseAdd >= hero.stack * 0.6) return makeAdvice('allin', env.heroTotal, Object.assign(base, { reasons, kind: 'value' }));
        return makeAdvice('raise', r.amount, Object.assign(base, { reasons, kind: 'value' }));
      }

      let implied = 0;
      if (!riverOrNoDraw && a.outs >= 8 && spr >= 3 && !(aggrModel && aggrModel.type === 'nit')) implied = Math.min(0.08, spr * 0.008);
      const commitShare = Math.min(1, toCall / Math.max(hero.stack, 1));
      const margin = 0.01 + 0.08 * safety * commitShare;
      const callOk = eq + implied >= env.potOdds + margin;

      if (callOk && canCommit(toCall)) {
        reasons.push('Pot odds ' + pct(env.potOdds) + ' vs. equity ' + pct(eq) + (implied ? ' (+ implied odds for your draw)' : '') + ': call.');
        if (eq < valueEq) reasons.push('Not strong enough to raise; keep the pot under control.');
        return makeAdvice('call', toCall, Object.assign(base, { reasons, kind: implied ? 'draw' : 'call' }));
      }

      // Semi-bluff raise with a big draw, heads-up, against someone who can fold.
      const semi = a.outs >= 8 && ctx.street === 'flop' && n === 1 && !anyStation && !r.allIn && raiseAdd <= hero.stack * (0.35 - 0.15 * safety);
      if (semi && rng() < clamp(0.22 * bluffK * foldK, 0, 0.6)) {
        reasons.push('Big draw (' + a.outs + ' outs): semi-bluff raise. You win now if they fold, and can still hit.');
        return makeAdvice('raise', r.amount, Object.assign(base, { reasons, kind: 'semi-bluff' }));
      }

      if (callOk && !canCommit(toCall)) {
        reasons.push('Calling would put ' + Math.round(commitShare * 100) + '% of your stack at risk with a hand that is not strong enough (stack protection). Fold.');
      } else {
        reasons.push('Need ' + pct(env.potOdds + margin) + ' equity to call; you have ' + pct(eq) + '. Fold.');
      }
      if (aggrModel && aggrModel.type === 'nit') reasons.push(aggr.name + ' is a nit: their bets are almost always strong.');
      return makeAdvice('fold', 0, Object.assign(base, { reasons }));
    }

    // ---------- checked to us / first to act
    if (eq >= valueEq && a.level >= 2) {
      const allAggressive = models.every((m) => m.af >= 2.5);
      if (a.level >= 7 && wet < 1 && ctx.street === 'flop' && n === 1 && allAggressive && rng() < 0.35) {
        reasons.push('Monster on a dry board vs an aggressive player: check to let them bet (slow-play).');
        return makeAdvice('check', 0, Object.assign(base, { reasons, kind: 'trap' }));
      }
      let frac = 0.55 + (wet >= 1.5 ? 0.15 : 0) + (anyStation ? 0.15 : 0) + (riverOrNoDraw && a.level >= 5 ? 0.1 : 0);
      if (n >= 3) frac = Math.max(frac, 0.65);
      let r = env.size(pot * frac);
      let add = r.allIn ? env.heroTotal : r.amount;
      if (!canCommit(add)) {
        r = env.size(pot * 0.33);
        add = r.allIn ? env.heroTotal : r.amount;
        if (!canCommit(add)) {
          reasons.push('Good hand but a big bet would risk too much of your stack. Check (pot control).');
          return makeAdvice('check', 0, Object.assign(base, { reasons, kind: 'pot control' }));
        }
        reasons.push('Value bet, sized small to protect your stack.');
      } else {
        reasons.push('Bet for value (' + Math.round(frac * 100) + '% pot)' + (anyStation ? ': they call too much, so bet bigger.' : '.'));
      }
      return makeAdvice(r.allIn ? 'allin' : 'bet', r.allIn ? env.heroTotal : r.amount, Object.assign(base, { reasons, kind: 'value' }));
    }

    if (eq >= valueEq - 0.12 && anyStation && a.level >= 2 && n <= 2) {
      const r = env.size(pot * 0.35);
      if (!r.allIn && canCommit(r.amount)) {
        reasons.push('Thin value bet: calling stations pay off with worse hands.');
        return makeAdvice('bet', r.amount, Object.assign(base, { reasons, kind: 'thin value' }));
      }
    }

    // Bluffs: only few opponents, none of them stations, capped by stack safety.
    const bluffCap = hero.stack * (0.12 + 0.2 * (1 - safety));
    const tryBluff = (prob, frac, why, kind) => {
      if (anyStation || n > 2 || bluffK <= 0) return null;
      if (rng() >= clamp(prob, 0, 0.85)) return null;
      const r = env.size(pot * frac, 'bluff');
      if (r.allIn || r.amount > bluffCap) return null;
      reasons.push(why);
      return makeAdvice('bet', r.amount, Object.assign(base, { reasons, kind }));
    };

    let res = null;
    if (ctx.heroIsPfAggressor && ctx.street === 'flop') {
      const dry = wet < 1;
      res = tryBluff(bluffK * (dry ? 0.5 : 0.3) * foldK * (n === 1 ? 1 : 0.55), dry ? 0.4 : 0.55,
        'Continuation bet: you raised preflop and this board ' + (dry ? 'is dry and' : '') + ' favors your range.', a.outs >= 4 ? 'semi-bluff' : 'bluff');
    }
    if (!res && a.outs >= 8 && ctx.street !== 'river') {
      res = tryBluff(bluffK * 0.45 * foldK, 0.6, 'Semi-bluff with your draw (' + a.outs + ' outs): fold equity plus outs.', 'semi-bluff');
    }
    const oppsPassive = opps.every((o) => !(o.actions && o.actions.aggThisStreet));
    if (!res && ctx.street === 'river' && n === 1 && eq < 0.25 && oppsPassive && ctx.heroAggressedLastStreet) {
      res = tryBluff(bluffK * 0.2 * foldK, 0.6, 'River bluff: your line tells a strong story and they showed weakness.', 'bluff');
    }
    if (!res && ctx.street === 'turn' && n === 1 && oppsPassive && ctx.checkedThroughLastStreet) {
      res = tryBluff(bluffK * 0.22 * foldK, 0.5, 'Delayed stab: the flop checked through, so they are often weak.', 'bluff');
    }
    if (res) return res;

    if (eq >= fair) reasons.push('Medium-strength hand: check to keep the pot small.');
    else reasons.push('Weak hand' + (anyStation ? ' and they call too much to bluff' : '') + ': check, give up if they bet big.');
    return makeAdvice('check', 0, Object.assign(base, { reasons, kind: eq >= fair ? 'pot control' : 'give up' }));
  }

  function pct(x) {
    return x == null ? '-' : Math.round(x * 100) + '%';
  }

  PA.Strategy = { advise, boardWetness, opponentSpec, DEFAULTS, OPEN, PUSH, pct };
  if (typeof module !== 'undefined' && module.exports) module.exports = PA.Strategy;
})(typeof globalThis !== 'undefined' ? globalThis : this);
