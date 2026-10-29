/* Site adapters. Each reads the page into a normalized table state:
 * { site, players[], hero, dealerSeat, board[], pot, bigBlind, smallBlind, buttons{}, betInput, isHeroTurn, callAmount }
 * Missing pieces fall back to the generic heuristics in dom.js, and every selector can be
 * overridden from the options page (settings.customSelectors).
 */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});
  const D = PA.DOM;

  const POKERNOW = {
    id: 'pokernow',
    label: 'PokerNow',
    match: /(^|\.)pokernow\.(com|club)$/,
    player: ['.table-player:not(.table-player-seat)'],
    playerName: ['.table-player-name a', '.table-player-name'],
    playerStack: ['.table-player-stack .chips-value', '.table-player-stack'],
    playerBet: ['.table-player-bet-value .chips-value', '.table-player-bet-value'],
    playerCards: ['.table-player-cards'],
    card: ['.card-container', '.card'],
    heroClass: /\byou-player\b/,
    turnClass: /\bdecision-current\b/,
    foldedClass: /\b(fold|folded)\b/,
    seatFromClass: /table-player-(\d+)/,
    dealer: ['.dealer-button-ctn'],
    dealerFromClass: /dealer-position-(\d+)/,
    board: ['.table-cards'],
    pot: ['.table-pot-size'],
    blinds: ['.blind-value-ctn .chips-value', '.blind-value-ctn', '.blind-value'],
    actions: ['.action-buttons', '.game-decisions-ctn'],
    buttons: {
      fold: ['.action-buttons .fold', 'button.fold'],
      check: ['.action-buttons .check', 'button.check'],
      call: ['.action-buttons .call', 'button.call'],
      raise: ['.action-buttons .raise', 'button.raise']
    },
    betInput: ['.raise-controller-form input[type="number"]', '.raise-controller-form .value-input-ctn input', '.raise-controller-form input:not([type="submit"])'],
    betConfirm: ['.raise-controller-form input[type="submit"]', '.raise-controller-form button[type="submit"]', '.raise-controller-form .bet']
  };

  // KG Poker's markup is not published; these are educated guesses and the heuristics fill the gaps.
  const KGPOKER = {
    id: 'kgpoker',
    label: 'KG Poker',
    match: /(^|\.)kgpoker\.fly\.dev$/,
    player: ['.player', '.seat.occupied', '.seat', '[class*="player-seat"]', '[data-seat]'],
    playerName: ['.player-name', '.name', '[class*="name"]'],
    playerStack: ['.player-stack', '.stack', '.chips', '[class*="stack"]'],
    playerBet: ['.player-bet', '.bet', '[class*="bet-amount"]', '[class*="bet"]'],
    playerCards: ['.hole-cards', '.cards', '.player-cards', '[class*="cards"]'],
    card: ['.card', '[class*="card"]', 'img'],
    heroClass: /\b(you|me|self|hero|current-user|my-seat|is-me)\b/i,
    turnClass: /\b(active|acting|current|turn|to-act)\b/i,
    foldedClass: /\b(fold|folded|inactive)\b/i,
    seatFromAttr: 'data-seat',
    dealer: ['.dealer', '.dealer-button', '[class*="dealer"]'],
    board: ['.board', '.community-cards', '.community', '[class*="community"]', '[class*="board"]'],
    pot: ['.pot', '[class*="pot"]'],
    blinds: ['[class*="blind"]', '[class*="stakes"]'],
    buttons: {},
    betInput: [],
    betConfirm: []
  };

  const GENERIC = Object.assign({}, KGPOKER, { id: 'generic', label: 'Generic', match: /.*/ });

  function siteFor(host) {
    if (POKERNOW.match.test(host)) return POKERNOW;
    if (KGPOKER.match.test(host)) return KGPOKER;
    return GENERIC;
  }

  function merge(cfg, custom) {
    if (!custom) return cfg;
    const out = Object.assign({}, cfg, { buttons: Object.assign({}, cfg.buttons) });
    const keys = ['player', 'playerName', 'playerStack', 'playerBet', 'playerCards', 'card', 'board', 'pot', 'blinds', 'dealer', 'betInput', 'betConfirm'];
    for (const k of keys) if (custom[k]) out[k] = [custom[k]].concat(cfg[k] || []);
    for (const b of ['fold', 'check', 'call', 'raise', 'bet', 'allin']) {
      if (custom[b + 'Button']) out.buttons[b] = [custom[b + 'Button']].concat(cfg.buttons[b] || []);
    }
    if (custom.heroCards) out.heroCards = [custom.heroCards];
    return out;
  }

  function classOf(el) {
    return typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
  }

  function read(cfg, settings) {
    const state = { site: cfg.id, siteLabel: cfg.label, players: [], board: [], buttons: {}, warnings: [] };

    // ---- players
    let boxes = D.qa(cfg.player).filter(D.visible);
    if (!boxes.length && cfg.id !== 'pokernow') boxes = D.scanPlayers();
    boxes.forEach((el, i) => {
      const cls = classOf(el);
      const nameEl = D.q(cfg.playerName, el);
      const stackEl = D.q(cfg.playerStack, el);
      const betEl = D.q(cfg.playerBet, el);
      let name = D.text(nameEl).split('\n')[0].trim();
      if (!name) name = (D.text(el).split('\n').find((l) => /[a-z]/i.test(l) && !/^\s*[\d,.$]+\s*$/.test(l)) || '').trim();
      if (!name) return;
      let stack = stackEl ? D.num(D.text(stackEl)) : null;
      if (stack == null) { const nums = D.allNums(D.text(el)); stack = nums.length ? Math.max(...nums) : 0; }
      const bet = betEl && D.visible(betEl) ? D.num(D.text(betEl)) || 0 : 0;
      let seat = i;
      const sm = cfg.seatFromClass && cls.match(cfg.seatFromClass);
      if (sm) seat = +sm[1];
      else if (cfg.seatFromAttr && el.getAttribute(cfg.seatFromAttr) != null) seat = +el.getAttribute(cfg.seatFromAttr);
      const cardsBox = D.q(cfg.playerCards, el);
      const cards = cardsBox ? D.cardsIn(cardsBox, cfg.card) : [];
      const statusText = D.text(el).toLowerCase();
      const folded = cfg.foldedClass.test(cls) || /\bfold(ed)?\b/.test(statusText) ||
        (cardsBox && cfg.foldedClass.test(classOf(cardsBox))) || +getComputedStyle(el).opacity < 0.55;
      const sittingOut = /sitting out|away|\bbusted\b/.test(statusText);
      state.players.push({
        el, name: name.slice(0, 40), seat, stack: stack || 0, bet, cards, folded, sittingOut,
        isHero: cfg.heroClass.test(cls) || (settings && settings.heroName && name === settings.heroName),
        isTurn: cfg.turnClass.test(cls)
      });
    });

    // Angle-based seat order for heuristic layouts (clockwise around the table centre).
    if (state.players.length && !cfg.seatFromClass && !boxes.some((b) => cfg.seatFromAttr && b.getAttribute(cfg.seatFromAttr) != null)) {
      const pts = state.players.map((p) => D.center(p.el));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      state.players.forEach((p, i) => { p.seat = Math.atan2(pts[i].y - cy, pts[i].x - cx); });
      [...state.players].sort((a, b) => a.seat - b.seat).forEach((p, i) => (p.seat = i));
    }

    // ---- board
    const boardEl = D.q(cfg.board);
    state.board = boardEl ? D.cardsIn(boardEl, cfg.card) : [];

    // ---- hero
    let hero = state.players.find((p) => p.isHero);
    let heroCards = cfg.heroCards ? D.cardsIn(D.q(cfg.heroCards), cfg.card) : hero ? hero.cards : [];
    if (heroCards.length !== 2 || !state.board.length) {
      // Heuristic: 2-card group lowest on screen = hero; 3-5 card group nearest the centre = board.
      const groups = D.scanCards();
      if (!state.board.length) {
        const midY = innerHeight / 2, midX = innerWidth / 2;
        const b = groups.filter((g) => g.cards.length >= 3 && g.cards.length <= 5)
          .sort((a, c) => Math.hypot(a.cx - midX, a.cy - midY) - Math.hypot(c.cx - midX, c.cy - midY))[0];
        if (b) state.board = b.cards;
      }
      if (heroCards.length !== 2) {
        const owned = hero ? groups.filter((g) => g.cards.length === 2 && hero.el.contains(g.el)) : [];
        const h = owned[0] || groups.filter((g) => g.cards.length === 2 && !g.cards.some((c) => state.board.includes(c))).sort((a, c) => c.cy - a.cy)[0];
        if (h) {
          heroCards = h.cards;
          if (!hero) hero = state.players.find((p) => p.el.contains(h.el)) || null;
        }
      }
    }
    if (!hero && state.players.length) {
      // closest player box to the bottom centre of the screen
      hero = [...state.players].sort((a, b) => {
        const pa = D.center(a.el), pb = D.center(b.el);
        return Math.hypot(pa.x - innerWidth / 2, innerHeight - pa.y) - Math.hypot(pb.x - innerWidth / 2, innerHeight - pb.y);
      })[0];
      state.warnings.push('Hero seat guessed from screen position. Set your player name in the options if this is wrong.');
    }
    if (hero) { hero.isHero = true; hero.cards = heroCards; }
    state.hero = hero || null;
    state.heroCards = heroCards;

    // ---- dealer
    const dealerEl = D.q(cfg.dealer);
    if (dealerEl) {
      const dm = cfg.dealerFromClass && classOf(dealerEl).match(cfg.dealerFromClass);
      if (dm) state.dealerSeat = +dm[1];
      else if (state.players.length && D.visible(dealerEl)) {
        const dc = D.center(dealerEl);
        const near = [...state.players].sort((a, b) => {
          const pa = D.center(a.el), pb = D.center(b.el);
          return Math.hypot(pa.x - dc.x, pa.y - dc.y) - Math.hypot(pb.x - dc.x, pb.y - dc.y);
        })[0];
        state.dealerSeat = near.seat;
      }
    }

    // ---- pot & blinds
    const betsOnTable = state.players.reduce((s, p) => s + (p.bet || 0), 0);
    const potEl = D.q(cfg.pot);
    let potInfo = null;
    if (potEl) {
      const t = D.text(potEl);
      const total = t.match(/total[^\d]*(\d[\d,.]*\s*[kKmM]?)/i);
      potInfo = total ? { total: D.num(total[1]) } : { main: D.num(t) };
    }
    if (!potInfo || (potInfo.main == null && potInfo.total == null)) potInfo = D.findPot();
    state.pot = potInfo ? (potInfo.total != null ? Math.max(potInfo.total, betsOnTable) : (potInfo.main || 0) + betsOnTable) : betsOnTable;

    let blinds = null;
    const bEl = D.q(cfg.blinds);
    if (bEl) {
      const nums = D.allNums(D.text(bEl));
      if (nums.length >= 2) blinds = { sb: nums[0], bb: nums[1] };
    }
    blinds = blinds || D.findBlinds();
    if (settings && settings.bigBlindOverride > 0) blinds = { bb: +settings.bigBlindOverride, sb: settings.bigBlindOverride / 2 };
    if (blinds) { state.bigBlind = blinds.bb; state.smallBlind = blinds.sb; }

    // ---- action buttons
    const scope = D.q(cfg.actions) || document;
    for (const k in cfg.buttons) {
      const el = D.qa(cfg.buttons[k], scope).find(D.enabled) || D.qa(cfg.buttons[k]).find(D.enabled);
      if (el) state.buttons[k] = el;
    }
    const found = D.findButtons();
    for (const k in found) if (!state.buttons[k]) state.buttons[k] = found[k];
    state.betInput = D.qa(cfg.betInput).find(D.visible) || (state.buttons.raise || state.buttons.bet ? D.findBetInput() : null);
    state.betConfirm = D.qa(cfg.betConfirm).find(D.enabled) || null;
    if (state.betInput && !state.betConfirm) {
      const form = state.betInput.closest('form') || state.betInput.parentElement && state.betInput.parentElement.parentElement;
      const b = form && D.findButtons(form);
      state.betConfirm = b && (b.raise || b.bet) || null;
    }

    const callBtn = state.buttons.call;
    state.callAmount = callBtn ? D.num(D.text(callBtn) || callBtn.value) : null;
    state.isHeroTurn = !!(state.buttons.fold || state.buttons.check) && !!(state.buttons.call || state.buttons.check || state.buttons.raise || state.buttons.bet);
    if (hero && hero.isTurn) state.isHeroTurn = true;
    return state;
  }

  PA.Sites = { POKERNOW, KGPOKER, GENERIC, siteFor, merge, read };
})(typeof globalThis !== 'undefined' ? globalThis : this);
