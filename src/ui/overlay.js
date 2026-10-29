/* In-page UI: the advice panel (shadow DOM) and the click highlighter. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});
  const { cardToPretty } = PA.Cards;
  const fmt = PA.Sizing.formatAmount;
  const pct = (x) => (x == null ? '-' : Math.round(x * 100) + '%');

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .panel { position: fixed; z-index: 2147483646; width: 318px; max-height: calc(100vh - 20px); overflow: hidden auto;
    background: #12161c; color: #e6e9ee; border: 1px solid #2a313b; border-radius: 12px;
    box-shadow: 0 10px 34px rgba(0,0,0,.45); font-size: 12px; line-height: 1.4; }
  .hdr { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #1a2029; cursor: move;
    border-bottom: 1px solid #2a313b; user-select: none; border-radius: 12px 12px 0 0; position: sticky; top: 0; z-index: 2; }
  .logo { font-weight: 700; font-size: 13px; letter-spacing: .2px; white-space: nowrap; }
  .logo b { color: #3ecf8e; }
  .site { color: #8a93a0; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .sp { flex: 1; }
  .ib { background: #232b36; color: #c9d1db; border: 1px solid #333d4a; border-radius: 6px; padding: 2px 7px; font-size: 11px; cursor: pointer; }
  .ib:hover { background: #2c3644; }
  .ib.on { background: #1f6f4c; border-color: #2b9467; color: #fff; }
  .body { padding: 10px; }
  .collapsed .body { display: none; }
  .rec { border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: #1a2029; border: 1px solid #2a313b; }
  .act { font-size: 22px; font-weight: 800; letter-spacing: .5px; }
  .act.fold { color: #ff6b6b; } .act.check, .act.call { color: #5cb3ff; } .act.bet, .act.raise { color: #3ecf8e; } .act.allin { color: #ffb020; }
  .kind { display: inline-block; margin-left: 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .6px; padding: 1px 6px;
    border-radius: 10px; background: #2a313b; color: #b8c2cf; vertical-align: middle; }
  .kind.bluff, .kind.semi-bluff { background: #4a2b5e; color: #e2c2ff; }
  .kind.value, .kind.thin.value { background: #1d4634; color: #9ff0c8; }
  .waiting { color: #8a93a0; font-size: 13px; }
  .cards { display: flex; gap: 4px; align-items: center; margin: 4px 0; flex-wrap: wrap; }
  .c { background: #f4f5f7; color: #111; border-radius: 4px; padding: 1px 5px; font-weight: 700; font-size: 13px; min-width: 26px; text-align: center; }
  .c.r { color: #d62828; } .c.d { color: #1d6fd8; } .c.cl { color: #128a3f; }
  .sep { color: #59626e; margin: 0 2px; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 6px; }
  .m { background: #161b22; border-radius: 6px; padding: 4px; text-align: center; }
  .m span { display: block; color: #7d8794; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; }
  .m b { font-size: 12px; }
  .bar { height: 5px; background: #2a313b; border-radius: 3px; overflow: hidden; margin-top: 6px; }
  .bar i { display: block; height: 100%; background: linear-gradient(90deg, #ff6b6b, #ffb020, #3ecf8e); }
  ul.why { margin: 6px 0 0; padding-left: 16px; color: #c3cad4; }
  ul.why li { margin: 2px 0; }
  h4 { margin: 10px 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #7d8794; display: flex; align-items: center; gap: 6px; }
  .opp { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; padding: 5px 6px; border-radius: 6px; cursor: pointer; }
  .opp:hover { background: #1a2029; }
  .opp .n { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .opp .s { color: #9aa4b1; font-size: 11px; grid-column: 1 / 3; }
  .opp .note { color: #d9c27a; font-size: 11px; grid-column: 1 / 3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 10px; color: #0d1117; font-weight: 700; }
  .opp.out { opacity: .45; }
  .warn { background: #3b2a12; border: 1px solid #6b4b16; color: #ffd28a; border-radius: 6px; padding: 5px 7px; margin: 4px 0; }
  .warn.bad { background: #3a1517; border-color: #7a2a2f; color: #ffb3b3; }
  .sess { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .pos { color: #3ecf8e; } .neg { color: #ff6b6b; }
  .row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  input, select, textarea { background: #0d1117; color: #e6e9ee; border: 1px solid #333d4a; border-radius: 6px; padding: 4px 6px; font-size: 12px; width: 100%; }
  label { display: block; color: #8a93a0; font-size: 10px; margin-top: 5px; text-transform: uppercase; letter-spacing: .5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
  .btn { background: #2b9467; color: #fff; border: 0; border-radius: 6px; padding: 6px 10px; font-weight: 600; cursor: pointer; font-size: 12px; }
  .btn.sec { background: #2a313b; color: #c9d1db; }
  pre { white-space: pre-wrap; word-break: break-word; background: #0d1117; padding: 6px; border-radius: 6px; font-size: 10.5px; color: #b8c2cf; max-height: 220px; overflow: auto; }
  .muted { color: #7d8794; }
  `;

  const HL_CSS = `
  :host { all: initial; }
  .ring { box-sizing: border-box; position: fixed; pointer-events: none; z-index: 2147483645; border: 3px solid #3ecf8e; border-radius: 10px;
    box-shadow: 0 0 0 4px rgba(62,207,142,.25), 0 0 22px rgba(62,207,142,.8); animation: pulse 1.1s ease-in-out infinite; }
  .ring.fold { border-color: #ff6b6b; box-shadow: 0 0 0 4px rgba(255,107,107,.25), 0 0 22px rgba(255,107,107,.8); }
  .ring.call, .ring.check { border-color: #5cb3ff; box-shadow: 0 0 0 4px rgba(92,179,255,.25), 0 0 22px rgba(92,179,255,.8); }
  .ring.allin { border-color: #ffb020; box-shadow: 0 0 0 4px rgba(255,176,32,.25), 0 0 22px rgba(255,176,32,.8); }
  .tag { position: fixed; pointer-events: none; z-index: 2147483646; background: #12161c; color: #fff; font: 700 12px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 4px 8px; border-radius: 6px; border: 1px solid #3ecf8e; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: .75; } }
  `;

  function cardHtml(c) {
    const s = c & 3;
    const cls = s === 1 ? 'r' : s === 2 ? 'd' : s === 3 ? 'cl' : '';
    return '<span class="c ' + cls + '">' + cardToPretty(c) + '</span>';
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  class Overlay {
    constructor(opts) {
      this.opts = opts;
      this.view = 'main';
      this.editing = null;
      this.host = document.createElement('div');
      this.host.id = 'poker-advisor-root';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = '<style>' + CSS + '</style><div class="panel"><div class="hdr"></div><div class="body"></div></div>';
      this.panel = this.shadow.querySelector('.panel');
      this.hdr = this.shadow.querySelector('.hdr');
      this.body = this.shadow.querySelector('.body');
      document.documentElement.appendChild(this.host);

      this.hlHost = document.createElement('div');
      this.hlHost.id = 'poker-advisor-highlight';
      this.hlShadow = this.hlHost.attachShadow({ mode: 'open' });
      this.hlShadow.innerHTML = '<style>' + HL_CSS + '</style>';
      document.documentElement.appendChild(this.hlHost);
      this.targets = [];

      this.applyPosition(opts.settings.panel || {});
      this.bindDrag();
      this.panel.addEventListener('click', (e) => this.onClick(e));
      this.panel.addEventListener('change', (e) => this.onChange(e));
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    applyPosition(p) {
      const x = p.x != null ? p.x : innerWidth - 330;
      this.panel.style.left = Math.max(0, Math.min(innerWidth - 120, x)) + 'px';
      this.panel.style.top = Math.max(0, Math.min(innerHeight - 40, p.y || 80)) + 'px';
      this.panel.classList.toggle('collapsed', !!p.collapsed);
    }

    bindDrag() {
      let sx, sy, ox, oy, dragging = false;
      this.hdr.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        ox = this.panel.offsetLeft; oy = this.panel.offsetTop;
        e.preventDefault();
      });
      addEventListener('mousemove', (e) => {
        if (!dragging) return;
        this.panel.style.left = ox + e.clientX - sx + 'px';
        this.panel.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
      });
      addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        this.opts.onPanelMove({ x: this.panel.offsetLeft, y: this.panel.offsetTop, collapsed: this.panel.classList.contains('collapsed') });
      });
    }

    setVisible(v) {
      this.host.style.display = v ? '' : 'none';
      if (!v) this.highlight([]);
    }

    toggleCollapsed() {
      this.panel.classList.toggle('collapsed');
      this.opts.onPanelMove({ x: this.panel.offsetLeft, y: this.panel.offsetTop, collapsed: this.panel.classList.contains('collapsed') });
    }

    // ------------------------------------------------------------ rendering

    render(data) {
      this.data = data;
      const s = data.settings;
      this.hdr.innerHTML =
        '<span class="logo">&spades; Poker <b>Advisor</b></span><span class="site">' + esc(data.siteLabel || '') + '</span><span class="sp"></span>' +
        '<button class="ib ' + (s.mode === 'advice' ? 'on' : '') + '" data-a="mode-advice" title="Recommend moves and highlight buttons">Advice</button>' +
        '<button class="ib ' + (s.mode === 'hud' ? 'on' : '') + '" data-a="mode-hud" title="Only show player stats">HUD</button>' +
        '<button class="ib" data-a="collapse" title="Collapse (Alt+A)">' + (this.panel.classList.contains('collapsed') ? '+' : '&minus;') + '</button>';
      if (this.view === 'diag') return this.renderDiag();
      if (this.view !== 'main') return; // calculator / notes forms: never clobber what the user is typing
      this.body.innerHTML = this.mainHtml(data);
    }

    mainHtml(d) {
      const s = d.settings;
      let h = '';
      const st = d.state;
      if (!st || (!st.players.length && !(st.heroCards || []).length)) {
        h += '<div class="rec"><div class="waiting">No poker table detected on this page yet.</div><div class="muted" style="margin-top:4px">Open a table, or use the Calculator below. If the table is open but nothing shows, check Diagnostics.</div></div>';
        return h + this.footerHtml();
      }
      const a = d.advice;
      if (a && s.mode === 'advice') {
        h += '<div class="rec"><div class="act ' + a.action + '">' + esc(a.display) + (a.kind && a.kind !== 'preflop' && a.kind !== 'postflop' ? '<span class="kind ' + esc(a.kind) + '">' + esc(a.kind) + '</span>' : '') + '</div>';
        h += this.handLine(d);
        h += '<div class="meta">' +
          '<div class="m"><span>Equity</span><b>' + pct(a.equity) + '</b></div>' +
          '<div class="m"><span>Pot odds</span><b>' + (a.potOdds ? pct(a.potOdds) : '-') + '</b></div>' +
          '<div class="m"><span>Stack</span><b>' + (a.effStackBB != null ? Math.round(a.effStackBB) + 'bb' : '-') + '</b></div>' +
          '<div class="m"><span>SPR</span><b>' + (a.spr != null ? a.spr.toFixed(1) : '-') + '</b></div></div>';
        if (a.equity != null) h += '<div class="bar"><i style="width:' + Math.round(a.equity * 100) + '%"></i></div>';
        if (s.showReasons) h += '<ul class="why">' + a.reasons.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>';
        h += '</div>';
      } else {
        h += '<div class="rec"><div class="waiting">' + (st.hero && (st.heroCards || []).length === 2 ? (s.mode === 'advice' ? 'Waiting for your turn…' : 'HUD mode') : 'Not in this hand') + '</div>';
        h += this.handLine(d);
        if (d.preview) h += '<div class="muted" style="margin-top:4px">' + esc(d.preview.label) + ' · equity vs. table ~' + pct(d.preview.equity) + '</div>';
        h += '</div>';
      }
      for (const w of d.warnings || []) h += '<div class="warn ' + (w.bad ? 'bad' : '') + '">' + esc(w.text) + '</div>';
      if (s.showHud && d.opponents && d.opponents.length) {
        h += '<h4>Players <span class="muted" style="text-transform:none;letter-spacing:0">(click to add notes)</span></h4>';
        for (const o of d.opponents) h += this.oppHtml(o);
      }
      if (d.session) {
        const se = d.session;
        const net = se.net || 0;
        const mins = Math.round((Date.now() - se.start) / 60000);
        h += '<h4>Session</h4><div class="sess">' +
          '<div class="m"><span>Net</span><b class="' + (net >= 0 ? 'pos' : 'neg') + '">' + (net >= 0 ? '+' : '') + fmt(net) + '</b></div>' +
          '<div class="m"><span>Hands</span><b>' + se.hands + '</b></div>' +
          '<div class="m"><span>Time</span><b>' + mins + 'm</b></div></div>';
      }
      return h + this.footerHtml();
    }

    handLine(d) {
      const st = d.state;
      const hc = st.heroCards || [];
      if (hc.length !== 2) return '';
      let h = '<div class="cards">' + hc.map(cardHtml).join('');
      if (st.board.length) h += '<span class="sep">|</span>' + st.board.map(cardHtml).join('');
      h += '</div>';
      const info = [];
      if (d.ctx && d.ctx.hero.position) info.push(d.ctx.hero.position);
      if (d.advice && d.advice.hand) info.push(d.advice.hand);
      if (st.pot) info.push('Pot ' + fmt(st.pot));
      if (d.ctx && d.ctx.toCall) info.push('To call ' + fmt(d.ctx.toCall));
      if (info.length) h += '<div class="muted">' + esc(info.join(' · ')) + '</div>';
      return h;
    }

    oppHtml(o) {
      const t = PA.Profiles.TYPES[o.type] || PA.Profiles.TYPES.unknown;
      const st = o.summary;
      const f = (x) => (x == null ? '–' : Math.round(x * 100));
      return '<div class="opp ' + (o.inHand ? '' : 'out') + '" data-a="note" data-name="' + esc(o.name) + '" title="' + esc(t.tip) + '">' +
        '<span class="n">' + esc(o.name) + (o.position ? ' <span class="muted">' + o.position + '</span>' : '') + '</span>' +
        '<span class="badge" style="background:' + t.color + '">' + esc(o.tag || t.label) + '</span>' +
        '<span class="s">VPIP ' + f(st.vpip) + ' · PFR ' + f(st.pfr) + ' · AF ' + (st.af == null ? '–' : st.af.toFixed(1)) +
        ' · F2B ' + f(st.foldToBet) + ' · ' + st.hands + 'h · ' + fmt(o.stack) + '</span>' +
        (o.notes ? '<span class="note">&#9998; ' + esc(o.notes) + '</span>' : '') + '</div>';
    }

    footerHtml() {
      return '<div class="row"><button class="btn sec" data-a="calc">Calculator</button><button class="btn sec" data-a="diag">Diagnostics</button>' +
        '<button class="btn sec" data-a="buyin" title="Record a rebuy/top-up for session tracking">+ Buy-in</button></div>';
    }

    renderCalc() {
      const c = this.calc || (this.calc = { hole: '', board: '', pot: '', toCall: '0', stack: '100', bb: '1', opps: '1', pos: 'BTN', facing: 'auto' });
      const out = this.calcResult;
      this.body.innerHTML =
        '<div class="muted">Manual calculator: works on any site. Cards like <b>AhKd</b>, board like <b>Qs7c2d</b>.</div>' +
        '<div class="grid2"><div><label>Your cards</label><input data-k="hole" value="' + esc(c.hole) + '" placeholder="AhKd"></div>' +
        '<div><label>Board</label><input data-k="board" value="' + esc(c.board) + '" placeholder="Qs7c2d"></div>' +
        '<div><label>Pot (incl. bets)</label><input data-k="pot" value="' + esc(c.pot) + '" type="number" step="any"></div>' +
        '<div><label>To call</label><input data-k="toCall" value="' + esc(c.toCall) + '" type="number" step="any"></div>' +
        '<div><label>Your stack</label><input data-k="stack" value="' + esc(c.stack) + '" type="number" step="any"></div>' +
        '<div><label>Big blind</label><input data-k="bb" value="' + esc(c.bb) + '" type="number" step="any"></div>' +
        '<div><label>Opponents in hand</label><input data-k="opps" value="' + esc(c.opps) + '" type="number" min="1" max="8"></div>' +
        '<div><label>Position</label><select data-k="pos">' + ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map((p) => '<option ' + (p === c.pos ? 'selected' : '') + '>' + p + '</option>').join('') + '</select></div></div>' +
        '<label>Preflop action before you</label><select data-k="facing">' +
        [['auto', 'Auto (from amount to call)'], ['none', 'Unopened / limped'], ['raise', 'Facing a raise'], ['3bet', 'Facing a 3-bet']].map(([v, t]) => '<option value="' + v + '" ' + (v === c.facing ? 'selected' : '') + '>' + t + '</option>').join('') + '</select>' +
        '<div class="row"><button class="btn" data-a="calc-run">Get advice</button><button class="btn sec" data-a="back">Back</button></div>' +
        (out ? '<div class="rec" style="margin-top:8px">' + (out.error ? '<div class="warn bad">' + esc(out.error) + '</div>' :
          '<div class="act ' + out.action + '">' + esc(out.display) + (out.kind ? '<span class="kind ' + esc(out.kind) + '">' + esc(out.kind) + '</span>' : '') + '</div>' +
          '<div class="muted">Equity ' + pct(out.equity) + (out.potOdds ? ' · pot odds ' + pct(out.potOdds) : '') + '</div>' +
          '<ul class="why">' + out.reasons.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>') + '</div>' : '');
    }

    renderDiag() {
      const st = this.data && this.data.state;
      let txt = 'No state read.';
      if (st) {
        const cs = (a) => (a || []).map(PA.Cards.cardToString).join(' ') || '-';
        txt = [
          'Site profile: ' + st.siteLabel,
          'Players: ' + st.players.length + '  ' + st.players.map((p) => p.name + (p.isHero ? '*' : '') + '[s' + (typeof p.seat === 'number' ? Math.round(p.seat) : '?') + ' ' + fmt(p.stack) + (p.bet ? ' b' + fmt(p.bet) : '') + (p.folded ? ' F' : '') + ']').join(', '),
          'Hero: ' + (st.hero ? st.hero.name : 'not found') + '  cards: ' + cs(st.heroCards),
          'Board: ' + cs(st.board) + '   Pot: ' + fmt(st.pot) + '   Blinds: ' + (st.bigBlind ? fmt(st.smallBlind) + '/' + fmt(st.bigBlind) : 'not found (set in options)'),
          'Dealer seat: ' + (st.dealerSeat != null ? st.dealerSeat : 'not found'),
          'Buttons: ' + (Object.keys(st.buttons).join(', ') || 'none') + (st.betInput ? ', bet input' : ''),
          'Your turn: ' + st.isHeroTurn + '   Call amount: ' + (st.callAmount != null ? st.callAmount : '-'),
          'Warnings: ' + (st.warnings.join(' | ') || 'none')
        ].join('\n');
      }
      this.body.innerHTML = '<div class="muted">What the advisor can read from this page. If something is missing, add custom CSS selectors on the options page.</div><pre>' + esc(txt) + '</pre>' +
        '<div class="row"><button class="btn sec" data-a="back">Back</button><button class="btn sec" data-a="options">Options</button></div>';
    }

    renderNote() {
      const p = this.opts.getPlayer(this.editing);
      if (!p) { this.view = 'main'; return; }
      const sd = (p.showdowns || []).slice(-6).reverse();
      this.body.innerHTML = '<div><b>' + esc(p.name) + '</b> <span class="muted">' + p.stats.hands + ' hands seen</span></div>' +
        '<label>Tag (overrides auto type)</label><select data-k="tag"><option value="">Auto</option>' +
        Object.keys(PA.Profiles.TYPES).filter((k) => k !== 'unknown').map((k) => '<option value="' + k + '" ' + (p.tag === k ? 'selected' : '') + '>' + PA.Profiles.TYPES[k].label + '</option>').join('') + '</select>' +
        '<label>Notes</label><textarea data-k="notes" rows="4" placeholder="e.g. overbets river with draws, folds to 3-bets">' + esc(p.notes || '') + '</textarea>' +
        (sd.length ? '<label>Shown at showdown</label><pre>' + sd.map((s) => esc(s.cards + '  on ' + (s.board || '-') + (s.line ? '  (' + s.line + ' pre)' : ''))).join('\n') + '</pre>' : '') +
        '<div class="row"><button class="btn" data-a="note-save">Save</button><button class="btn sec" data-a="back">Back</button></div>';
    }

    onClick(e) {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.getAttribute('data-a');
      if (a === 'collapse') return this.toggleCollapsed();
      if (a === 'mode-advice' || a === 'mode-hud') return this.opts.onSettings({ mode: a.slice(5) });
      if (a === 'calc') { this.view = 'calc'; return this.renderCalc(); }
      if (a === 'diag') { this.view = 'diag'; return this.renderDiag(); }
      if (a === 'options') return this.opts.openOptions();
      if (a === 'buyin') {
        const v = prompt('Amount added to your stack (rebuy / top-up):');
        if (v && +v > 0) this.opts.onBuyin(+v);
        return;
      }
      if (a === 'back') { this.view = 'main'; this.editing = null; this.calcResult = null; return this.data && this.render(this.data); }
      if (a === 'note') { this.editing = b.getAttribute('data-name'); this.view = 'note'; return this.renderNote(); }
      if (a === 'note-save') {
        const notes = this.body.querySelector('[data-k="notes"]').value;
        const tag = this.body.querySelector('[data-k="tag"]').value;
        this.opts.onSaveNote(this.editing, { notes, tag });
        this.editing = null; this.view = 'main';
        return this.data && this.render(this.data);
      }
      if (a === 'calc-run') {
        this.body.querySelectorAll('[data-k]').forEach((el) => (this.calc[el.getAttribute('data-k')] = el.value));
        this.calcResult = this.opts.runCalculator(this.calc);
        return this.renderCalc();
      }
    }

    onChange(e) {
      const k = e.target.getAttribute && e.target.getAttribute('data-k');
      if (k && this.calc && this.view === 'calc') this.calc[k] = e.target.value;
    }

    // ------------------------------------------------------------ highlight

    /** targets: [{ el, label, cls }] */
    highlight(targets) {
      this.targets = targets || [];
      this.hlShadow.querySelectorAll('.ring,.tag').forEach((n) => n.remove());
      this.rings = this.targets.map((t) => {
        const ring = document.createElement('div');
        ring.className = 'ring ' + (t.cls || '');
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = t.label || '';
        tag.style.display = t.label ? '' : 'none';
        this.hlShadow.appendChild(ring);
        this.hlShadow.appendChild(tag);
        return { t, ring, tag };
      });
      this.positionRings();
    }

    positionRings() {
      for (const r of this.rings || []) {
        const el = r.t.el;
        if (!el || !el.isConnected) { r.ring.style.display = r.tag.style.display = 'none'; continue; }
        const b = el.getBoundingClientRect();
        if (b.width < 1) { r.ring.style.display = r.tag.style.display = 'none'; continue; }
        r.ring.style.display = '';
        r.ring.style.left = b.left - 6 + 'px';
        r.ring.style.top = b.top - 6 + 'px';
        r.ring.style.width = b.width + 12 + 'px';
        r.ring.style.height = b.height + 12 + 'px';
        if (r.t.label) {
          r.tag.style.display = '';
          const above = b.top > 34;
          r.tag.style.left = Math.max(4, b.left + b.width / 2 - r.tag.offsetWidth / 2) + 'px';
          r.tag.style.top = (above ? b.top - 36 : b.bottom + 10) + 'px';
        }
      }
    }

    loop() {
      if (this.rings && this.rings.length) this.positionRings();
      requestAnimationFrame(this.loop);
    }
  }

  PA.Overlay = Overlay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
