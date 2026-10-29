/* Content script entry: read table -> track players -> advise -> render + highlight. */
(function () {
  'use strict';
  if (window.__POKER_ADVISOR_LOADED__) return;
  window.__POKER_ADVISOR_LOADED__ = true;
  const PA = window.PA;
  const { Store, Sites, Strategy, Profiles, Tracker } = PA;

  let settings;
  let cfg;
  let tracker;
  let ui;
  let lastKey = null;
  let lastAdvice = null;
  let previewKey = null;
  let preview = null;
  let ticking = false;

  async function init() {
    settings = await Store.getSettings();
    await Store.loadPlayers();
    configure();
    ui = new PA.Overlay({
      settings,
      onSettings: async (patch) => { settings = await Store.saveSettings(patch); lastKey = null; tick(); },
      onPanelMove: (panel) => Store.saveSettings({ panel }).then((s) => (settings = s)),
      onBuyin: (amt) => tracker.addBuyin(amt),
      onSaveNote: (name, patch) => { Object.assign(Store.getPlayer(tracker.site, name), patch); Store.savePlayersSoon(); },
      getPlayer: (name) => Store.getPlayer(tracker.site, name),
      openOptions: () => chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ type: 'open-options' }),
      runCalculator
    });
    ui.setVisible(settings.enabled);
    Store.onChange((changes) => {
      if (changes.pa_settings) {
        settings = Object.assign({}, Store.DEFAULT_SETTINGS, changes.pa_settings.newValue);
        configure(true);
        ui.setVisible(settings.enabled);
        lastKey = null;
      }
    });
    addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) { ui.toggleCollapsed(); e.preventDefault(); }
    });
    const mo = new MutationObserver(debounce(tick, 150));
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'disabled'] });
    setInterval(tick, 700);
    tick();
  }

  function configure(keepTracker) {
    const host = location.hostname;
    const custom = (settings.customSelectors || {})[host] || (settings.customSelectors || {})['*'];
    cfg = Sites.merge(Sites.siteFor(host), custom);
    const site = cfg.id === 'generic' ? host : cfg.id;
    if (!keepTracker || !tracker || tracker.site !== site) tracker = new Tracker(site, Store);
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function tick() {
    if (ticking || !ui) return;
    ticking = true;
    try { step(); } catch (e) { console.warn('[Poker Advisor]', e); } finally { ticking = false; }
  }

  function step() {
    if (!settings.enabled) { ui.highlight([]); return; }
    const state = Sites.read(cfg, settings);
    const hasTable = state.players.length > 0 || (state.heroCards || []).length > 0;
    let hand = null, ctx = null, advice = null;
    if (hasTable) {
      hand = tracker.update(state);
      ctx = buildContext(state, hand);
    }
    if (ctx && settings.mode === 'advice' && state.isHeroTurn) {
      const key = [hand.heroKey, ctx.street, ctx.board.length, ctx.toCall, Math.round(ctx.pot * 100), ctx.hero.stack].join('|');
      if (key !== lastKey) {
        lastKey = key;
        lastAdvice = Strategy.advise(ctx, settings);
      }
      advice = lastAdvice;
    } else {
      lastKey = null;
    }
    if (ctx && !advice) updatePreview(ctx);

    ui.render({
      settings, state, ctx, advice, siteLabel: cfg.label,
      preview: ctx && !advice ? preview : null,
      opponents: hasTable ? opponentRows(state, hand, ctx) : [],
      session: tracker.session,
      warnings: warnings(state, ctx)
    });
    ui.highlight(advice && settings.highlight ? highlightTargets(advice, state) : []);
  }

  // ------------------------------------------------------------ context

  const POS_NAMES = (k, n) => {
    if (n === 2) return k === 0 ? 'BTN' : 'BB';
    if (k === 0) return 'BTN';
    if (k === 1) return 'SB';
    if (k === 2) return 'BB';
    const fromEnd = n - 1 - k;
    return ['CO', 'HJ', 'MP'][fromEnd] || 'EP';
  };

  function positions(state, hand) {
    const dealt = state.players.filter((p) => !p.sittingOut && (hand.players[p.name] || p.isHero)).sort((a, b) => a.seat - b.seat);
    const n = dealt.length;
    const map = {};
    if (state.dealerSeat == null || n < 2) return { map, order: {}, n };
    let di = dealt.findIndex((p) => p.seat === state.dealerSeat);
    if (di < 0) {
      // dealer seat empty/sitting out: the button belongs to the last seat before it
      di = dealt.reduce((best, p, i) => (p.seat < state.dealerSeat ? i : best), n - 1);
    }
    const order = {};
    dealt.forEach((p, i) => {
      const k = (i - di + n) % n;
      map[p.name] = POS_NAMES(k, n);
      order[p.name] = n === 2 ? (k === 0 ? 1 : 0) : (k + n - 1) % n; // postflop acting order (BTN last)
    });
    return { map, order, n };
  }

  function modelFor(name) {
    const rec = Store.getPlayer(tracker.site, name);
    const m = Profiles.model(rec, { vpip: settings.defaultVpip, pfr: settings.defaultPfr });
    if (rec.tag) m.type = rec.tag;
    return m;
  }

  function buildContext(state, hand) {
    const hero = state.hero;
    const cards = state.heroCards || [];
    if (!hero || cards.length !== 2) return null;
    const street = Tracker.streetOf(state.board);
    const bb = state.bigBlind || hand.bigBlind || 1;
    const pos = positions(state, hand);
    const opponents = state.players
      .filter((p) => !p.isHero && !p.folded && !p.sittingOut && hand.players[p.name])
      .map((p) => ({
        name: p.name, stack: p.stack, bet: p.bet || 0, position: pos.map[p.name],
        model: modelFor(p.name), actions: hand.players[p.name]
      }));
    const maxBet = Math.max(0, ...state.players.map((p) => p.bet || 0));
    let toCall = Math.max(0, maxBet - (hero.bet || 0));
    if (state.buttons.check && !state.buttons.call) toCall = 0;
    else if (!toCall && state.callAmount) toCall = state.callAmount;
    toCall = Math.min(toCall, hero.stack);
    const bets = state.players.map((p) => p.bet || 0).sort((a, b) => b - a);
    const lastRaise = Math.max(bb, bets[0] - (bets[1] || 0));
    const aggressorP = maxBet > (hero.bet || 0) ? opponents.find((o) => o.bet === maxBet) : opponents.find((o) => o.name === hand.streetAggressor);
    const heroOrder = pos.order[hero.name];
    const inPosition = heroOrder == null ? null : opponents.every((o) => pos.order[o.name] == null || pos.order[o.name] < heroOrder);
    let preflopRaises = hand.preflopRaises;
    if (street === 'preflop' && maxBet > bb * 1.01 && !preflopRaises) preflopRaises = null;
    const limpers = street === 'preflop' && maxBet <= bb * 1.01
      ? Math.max(hand.limpers, state.players.filter((p) => !p.isHero && p.bet >= bb * 0.99 && pos.map[p.name] !== 'BB').length)
      : hand.limpers;

    return {
      street, board: state.board, pot: Math.max(state.pot || 0, toCall), toCall, bigBlind: bb,
      minRaiseTo: maxBet + lastRaise,
      hero: { name: hero.name, cards, stack: hero.stack, bet: hero.bet || 0, position: pos.map[hero.name] || null, inPosition },
      opponents, aggressor: aggressorP || null, preflopRaises, limpers,
      heroIsPfAggressor: hand.pfAggressor === hero.name,
      heroAggressedLastStreet: hand.heroAggressedLastStreet,
      checkedThroughLastStreet: hand.checkedThroughLastStreet,
      numPlayers: pos.n
    };
  }

  function updatePreview(ctx) {
    const key = ctx.hero.cards.join() + '|' + ctx.board.join() + '|' + ctx.opponents.length;
    if (key === previewKey) return;
    previewKey = key;
    const specs = ctx.opponents.map((o) => Strategy.opponentSpec(o, ctx, Object.assign({}, Strategy.DEFAULTS, settings)));
    const eq = specs.length ? PA.Equity.equity(ctx.hero.cards, ctx.board, specs, { iterations: 2500, timeBudgetMs: 60 }).equity : null;
    const a = PA.Evaluator.analyze(ctx.hero.cards, ctx.board);
    const p = PA.Ranges.percentile(ctx.hero.cards);
    const strength = p <= 0.5 ? 'top ' + Math.max(1, Math.round(p * 100)) + '%' : 'weak, bottom ' + Math.max(1, 100 - Math.round(p * 100)) + '%';
    const label = ctx.board.length ? a.name + (a.draws.length ? ' + ' + a.draws.join(' + ') : '') : PA.Ranges.handClass(ctx.hero.cards) + ' (' + strength + ')';
    preview = { equity: eq, label };
  }

  function opponentRows(state, hand, ctx) {
    const pos = ctx ? Object.fromEntries(ctx.opponents.map((o) => [o.name, o.position])) : {};
    return state.players.filter((p) => !p.isHero).map((p) => {
      const rec = Store.getPlayer(tracker.site, p.name);
      return {
        name: p.name, stack: p.stack, position: pos[p.name],
        inHand: !p.folded && !p.sittingOut && !!(hand && hand.players[p.name]),
        type: rec.tag || Profiles.classify(rec), tag: rec.tag ? Profiles.TYPES[rec.tag].label : '',
        summary: Profiles.summarize(rec), notes: rec.notes
      };
    }).sort((a, b) => b.inHand - a.inHand);
  }

  // ------------------------------------------------------------ warnings

  function warnings(state, ctx) {
    const out = [];
    const s = tracker.session;
    if (s && s.startStack > 0) {
      const buyin = s.startStack;
      if (settings.stopLossBuyins > 0 && s.net <= -settings.stopLossBuyins * buyin) {
        out.push({ bad: true, text: 'Stop-loss reached (down ' + PA.Sizing.formatAmount(-s.net) + '). Consider leaving the table.' });
      }
      if (settings.stopWinBuyins > 0 && s.net >= settings.stopWinBuyins * buyin) {
        out.push({ text: 'Win goal reached (+' + PA.Sizing.formatAmount(s.net) + '). Good time to lock in the profit.' });
      }
      const mins = (Date.now() - s.start) / 60000;
      if (settings.breakReminderMin > 0 && mins >= settings.breakReminderMin) {
        out.push({ text: 'You have been playing ' + Math.round(mins) + ' minutes. Take a short break.' });
      }
      const recent = tracker.recentResults.slice(-3);
      if (recent.length === 3 && recent.every((r) => r < -0.25 * buyin)) {
        out.push({ bad: true, text: 'Three big losses in a row. Tilt check: tighten up or take a break.' });
      }
    }
    if (ctx && ctx.bigBlind && ctx.hero.stack + ctx.hero.bet < 40 * ctx.bigBlind && ctx.hero.stack > 0) {
      out.push({ text: 'Short stack (' + Math.round((ctx.hero.stack + ctx.hero.bet) / ctx.bigBlind) + ' BB). Advice switches to push/fold under 12 BB. Top up if your game allows it.' });
    }
    if (state && !state.bigBlind && (state.players.length || (state.heroCards || []).length)) {
      out.push({ text: 'Blinds not detected. Set the big blind in the popup so bet sizes are right.' });
    }
    return out;
  }

  // ------------------------------------------------------------ highlight

  function highlightTargets(a, state) {
    const B = state.buttons;
    const amt = PA.Sizing.formatAmount(a.amount);
    const cls = a.action;
    const inputOpen = state.betInput && PA.DOM.visible(state.betInput);
    switch (a.action) {
      case 'fold':
        return B.fold ? [{ el: B.fold, label: 'Fold', cls }] : B.check ? [{ el: B.check, label: 'Check (free)', cls: 'check' }] : [];
      case 'check':
        return B.check ? [{ el: B.check, label: 'Check', cls }] : [];
      case 'call':
        return B.call ? [{ el: B.call, label: 'Call ' + amt, cls }] : B.check ? [{ el: B.check, label: 'Check', cls: 'check' }] : [];
      case 'bet':
      case 'raise':
      case 'allin': {
        const verb = a.action === 'allin' ? 'All-in ' : a.action === 'bet' ? 'Bet ' : 'Raise to ';
        if (a.action === 'allin' && B.allin) return [{ el: B.allin, label: 'All-in', cls }];
        if (inputOpen) {
          const t = [{ el: state.betInput, label: 'Enter ' + amt, cls }];
          if (state.betConfirm) t.push({ el: state.betConfirm, label: '', cls });
          return t;
        }
        const btn = (a.action === 'bet' ? B.bet || B.raise : B.raise || B.bet);
        if (btn) return [{ el: btn, label: verb + amt, cls }];
        if (a.action === 'allin' && B.call) return [{ el: B.call, label: 'Call all-in', cls }];
        return [];
      }
    }
    return [];
  }

  // ------------------------------------------------------------ calculator

  function runCalculator(c) {
    const cards = PA.Cards.parseCards(c.hole);
    const board = PA.Cards.parseCards(c.board);
    if (cards.length !== 2) return { error: 'Enter exactly two hole cards, e.g. AhKd.' };
    if (board.length && (board.length < 3 || board.length > 5)) return { error: 'Board must have 3, 4 or 5 cards (or be empty preflop).' };
    if (cards.some((x) => board.includes(x))) return { error: 'A card appears twice.' };
    const bb = +c.bb || 1;
    const toCall = +c.toCall || 0;
    const nOpp = Math.max(1, Math.min(8, +c.opps || 1));
    const street = Tracker.streetOf(board);
    let raises = null;
    if (c.facing === 'none') raises = 0; else if (c.facing === 'raise') raises = 1; else if (c.facing === '3bet') raises = 2;
    const opponents = [];
    for (let i = 0; i < nOpp; i++) {
      opponents.push({
        name: 'Opponent ' + (i + 1), stack: (+c.stack || 100) * 1.2, bet: i === 0 ? toCall : 0,
        model: Profiles.model(null, { vpip: settings.defaultVpip, pfr: settings.defaultPfr }),
        actions: { preflop: street === 'preflop' ? null : i === 0 && raises ? 'raise' : 'call', aggThisStreet: i === 0 && toCall > 0 && street !== 'preflop' ? 1 : 0 }
      });
    }
    const pot = Math.max(+c.pot || bb * 1.5 + toCall, toCall);
    return Strategy.advise({
      street, board, pot, toCall, bigBlind: bb,
      hero: { cards, stack: +c.stack || 100, bet: 0, position: c.pos },
      opponents, aggressor: toCall > 0 ? opponents[0] : null,
      preflopRaises: raises, limpers: 0, heroIsPfAggressor: false
    }, settings);
  }

  init();
})();
