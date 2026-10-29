/* Watches successive table snapshots, infers every player's actions and keeps
 * per-player statistics, the current hand's action context and the hero's session results. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});

  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const streetOf = (board) => (board.length >= 5 ? 'river' : board.length === 4 ? 'turn' : board.length >= 3 ? 'flop' : 'preflop');

  class Tracker {
    constructor(site, store) {
      this.site = site;
      this.store = store;
      this.hand = null;
      this.prev = null;
      this.handCount = 0;
      this.session = null;
      this.recentResults = [];
    }

    player(name) {
      return this.store.getPlayer(this.site, name);
    }

    /** Feed a new table snapshot. Returns the current hand context. */
    update(state) {
      const heroKey = state.heroCards && state.heroCards.length === 2 ? state.heroCards.slice().sort().join(',') : '';
      const board = state.board || [];
      const prevBoard = this.prev ? this.prev.board : [];
      const newHand = !this.hand ||
        (heroKey && heroKey !== this.hand.heroKey) ||
        board.length < prevBoard.length ||
        (state.handId && state.handId !== this.hand.handId);

      if (newHand) {
        if (this.hand) this.finishHand(this.prev);
        this.startHand(state, heroKey);
      } else {
        const street = streetOf(board);
        if (street !== this.hand.street) this.newStreet(street, state);
        this.diff(state);
      }
      this.trackSession(state);
      this.prev = snapshot(state);
      return this.hand;
    }

    startHand(state, heroKey) {
      const bb = state.bigBlind || Math.max(0, ...state.players.map((p) => p.bet || 0)) || 1;
      const dealt = state.players.filter((p) => !p.sittingOut && !p.folded);
      this.hand = {
        handId: state.handId || null,
        heroKey,
        street: streetOf(state.board || []),
        bigBlind: bb,
        startedAt: Date.now(),
        players: {},
        preflopRaises: 0,
        limpers: 0,
        pfAggressor: null,
        streetAggressor: null,
        aggThisStreet: 0,
        heroAggressedLastStreet: false,
        checkedThroughLastStreet: false,
        cbetPending: false,
        heroStartStack: state.hero ? state.hero.stack + (state.hero.bet || 0) : null,
        heroName: state.hero ? state.hero.name : null
      };
      for (const p of dealt) {
        this.hand.players[p.name] = {
          preflop: p.bet > 0 && p.bet <= bb ? 'blind' : null, vpip: false, pfr: false, threeBet: false,
          aggThisStreet: 0, raisedThisStreet: false, callsThisStreet: 0, aggPrevStreets: 0, callsPrevStreets: 0,
          sawFlop: false, folded: false, shown: null, facedThreeBetOpp: false
        };
      }
      // Blinds only: the first snapshot may already include actions we missed.
      const maxBet = Math.max(0, ...state.players.map((p) => p.bet || 0));
      if (maxBet > bb * 1.01) this.hand.preflopRaises = 1;
      this.handCount++;
    }

    newStreet(street, state) {
      const h = this.hand;
      const heroName = h.heroName;
      h.heroAggressedLastStreet = !!(heroName && h.players[heroName] && h.players[heroName].aggThisStreet);
      h.checkedThroughLastStreet = h.aggThisStreet === 0 && h.street !== 'preflop';
      for (const name in h.players) {
        const a = h.players[name];
        a.aggPrevStreets += a.aggThisStreet;
        a.callsPrevStreets += a.callsThisStreet;
        a.aggThisStreet = 0; a.raisedThisStreet = false; a.callsThisStreet = 0;
      }
      if (street === 'flop') {
        for (const p of state.players) {
          const a = h.players[p.name];
          if (a && !p.folded && !a.folded) { a.sawFlop = true; this.player(p.name).stats.sawFlop++; }
        }
        if (h.pfAggressor && h.players[h.pfAggressor] && !h.players[h.pfAggressor].folded) {
          this.player(h.pfAggressor).stats.cbetOpp++;
          h.cbetPending = true;
        }
      } else h.cbetPending = false;
      h.street = street;
      h.aggThisStreet = 0;
      h.streetAggressor = null;
      if (this.prev) this.prev.players.forEach((p) => (p.bet = 0));
    }

    diff(state) {
      const h = this.hand;
      if (!this.prev) return;
      const prevBy = new Map(this.prev.players.map((p) => [p.name, p]));
      let streetMax = Math.max(0, ...this.prev.players.map((p) => p.bet || 0));
      const bb = h.bigBlind;
      // Process in seat order so multiple actions between snapshots stay roughly ordered.
      for (const p of state.players) {
        const a = h.players[p.name];
        const before = prevBy.get(p.name);
        if (!a || !before) continue;
        const st = this.player(p.name).stats;
        if (p.cards && p.cards.length === 2 && !p.isHero) a.shown = p.cards.slice();

        if (!before.folded && p.folded && !a.folded) {
          a.folded = true;
          const facing = streetMax > (before.bet || 0);
          if (h.street === 'preflop') {
            if (h.preflopRaises === 1 && !a.pfr) st.threeBetOpp++;
          } else if (facing) {
            st.facedBet++; st.foldedToBet++;
            if (h.cbetActive && p.name !== h.pfAggressor) { st.facedCbet++; st.foldedToCbet++; }
          }
          continue;
        }
        const nb = p.bet || 0, ob = before.bet || 0;
        if (nb <= ob + 1e-9) continue;
        const isRaise = nb > streetMax + 1e-9 && (h.street !== 'preflop' || nb > bb * 1.01);
        if (h.street === 'preflop') {
          if (isRaise) {
            if (h.preflopRaises === 0) { a.preflop = 'raise'; a.pfr = true; st.pfr++; }
            else if (h.preflopRaises === 1) { a.preflop = '3bet'; a.pfr = true; st.pfr++; st.threeBet++; st.threeBetOpp++; }
            else { a.preflop = '4bet'; if (!a.pfr) { a.pfr = true; st.pfr++; } }
            h.preflopRaises++;
            h.pfAggressor = p.name;
          } else {
            const limp = streetMax <= bb * 1.01;
            if (limp && a.preflop !== 'blind') { a.preflop = 'limp'; h.limpers++; st.limps++; }
            else if (!limp) {
              a.preflop = 'call';
              if (h.preflopRaises === 1) st.threeBetOpp++;
            }
          }
          if (!a.vpip && !(a.preflop === 'blind' && nb <= bb)) { a.vpip = true; st.vpip++; }
        } else {
          const facing = streetMax > ob + 1e-9;
          if (isRaise) {
            a.aggThisStreet++;
            h.aggThisStreet++;
            if (streetMax > 0) { a.raisedThisStreet = true; st.raises++; } else st.bets++;
            if (facing) st.facedBet++;
            if (h.street === 'flop' && h.cbetPending && h.aggThisStreet === 1) {
              if (p.name === h.pfAggressor) { this.player(p.name).stats.cbets++; h.cbetActive = true; }
              h.cbetPending = false;
            } else if (facing && h.cbetActive && p.name !== h.pfAggressor) st.facedCbet++;
            h.streetAggressor = p.name;
          } else {
            a.callsThisStreet++; st.calls++;
            if (facing) {
              st.facedBet++;
              if (h.cbetActive && p.name !== h.pfAggressor) st.facedCbet++;
            }
          }
        }
        streetMax = Math.max(streetMax, nb);
        this.player(p.name).lastSeen = Date.now();
      }
      if (h.street !== 'flop') h.cbetActive = false;
    }

    finishHand(last) {
      const h = this.hand;
      if (!h) return;
      const shown = [];
      for (const name in h.players) {
        const a = h.players[name];
        const rec = this.player(name);
        rec.stats.hands++;
        rec.lastSeen = Date.now();
        if (a.shown && !a.folded) {
          rec.stats.showdowns++;
          rec.showdowns = (rec.showdowns || []).concat([{
            cards: a.shown.map(PA.Cards.cardToString).join(''),
            board: (last ? last.board : []).map(PA.Cards.cardToString).join(''),
            line: a.preflop || '', at: Date.now()
          }]).slice(-15);
          shown.push(name);
        }
      }
      this.store.savePlayersSoon();
      if (last && last.hero && h.heroStartStack != null) {
        const result = last.hero.stack + (last.hero.bet || 0) - h.heroStartStack;
        this.recentResults.push(result);
        if (this.recentResults.length > 20) this.recentResults.shift();
      }
    }

    trackSession(state) {
      const hero = state.hero;
      if (!hero) return;
      const total = hero.stack + (hero.bet || 0);
      const now = Date.now();
      if (!this.session) {
        this.session = { id: now, site: this.site, start: now, startStack: total, buyins: total, current: total, peak: total, hands: 0, rebuys: 0 };
      }
      const s = this.session;
      // Rebuy: stack refilled after being (nearly) busted.
      if (this.prev && this.prev.hero && this.prev.heroTotal < (this.hand.bigBlind || 1) && total > s.startStack * 0.3) {
        s.buyins += total - this.prev.heroTotal;
        s.rebuys++;
      }
      // Count results between hands only, so chips in the middle aren't shown as lost.
      if (this.hand && this.hand.heroStartStack != null && this.hand.heroName === hero.name) s.current = this.hand.heroStartStack;
      else s.current = total;
      s.peak = Math.max(s.peak, s.current);
      s.hands = this.handCount;
      s.net = s.current - s.buyins;
      s.updated = now;
      if (!this.lastSessionSave || now - this.lastSessionSave > 15000) {
        this.lastSessionSave = now;
        this.store.saveSession(Object.assign({}, s));
      }
    }

    addBuyin(amount) {
      if (!this.session) return;
      this.session.buyins += amount;
      this.session.rebuys++;
    }
  }

  function snapshot(state) {
    return {
      board: (state.board || []).slice(),
      players: state.players.map((p) => ({ name: p.name, bet: p.bet || 0, stack: p.stack, folded: p.folded })),
      hero: state.hero ? { stack: state.hero.stack, bet: state.hero.bet || 0 } : null,
      heroTotal: state.hero ? state.hero.stack + (state.hero.bet || 0) : 0
    };
  }

  PA.Tracker = Tracker;
  PA.Tracker.streetOf = streetOf;
  PA.Tracker.STREETS = STREETS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
