(async function () {
  const { Store, Profiles } = window.PA;
  const fmt = PA.Sizing.formatAmount;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let s = await Store.getSettings();

  // ---- settings
  const fields = {
    style: 'value', bluff: 'num', safety: 'num', defaultVpip: 'pct', defaultPfr: 'pct',
    highlight: 'check', showReasons: 'check', showHud: 'check', heroName: 'value', bigBlindOverride: 'num',
    stopLossBuyins: 'num', stopWinBuyins: 'num', breakReminderMin: 'num'
  };
  for (const [k, t] of Object.entries(fields)) {
    const el = $(k);
    if (t === 'check') el.checked = !!s[k];
    else if (t === 'pct') el.value = Math.round(s[k] * 100);
    else el.value = s[k];
    el.addEventListener('change', async () => {
      const v = t === 'check' ? el.checked : t === 'num' ? +el.value || 0 : t === 'pct' ? (+el.value || 0) / 100 : el.value.trim();
      s = await Store.saveSettings({ [k]: v });
    });
  }

  // ---- selectors
  $('selectors').value = JSON.stringify(Object.keys(s.customSelectors || {}).length ? s.customSelectors : {
    'kgpoker.fly.dev': { heroCards: '', board: '', pot: '' }
  }, null, 2);
  $('saveSel').onclick = async () => {
    try {
      const obj = JSON.parse($('selectors').value || '{}');
      for (const h in obj) for (const k in obj[h]) if (!obj[h][k]) delete obj[h][k];
      s = await Store.saveSettings({ customSelectors: obj });
      $('selMsg').textContent = 'Saved. Reload the poker tab.';
    } catch (e) {
      $('selMsg').textContent = 'Invalid JSON: ' + e.message;
    }
  };

  // ---- sessions
  const sessions = (await Store.getSessions()).slice().reverse();
  $('sessions').innerHTML = sessions.length ? '<table><thead><tr><th>Date</th><th>Site</th><th>Hands</th><th>Net</th></tr></thead><tbody>' +
    sessions.slice(0, 25).map((x) => '<tr><td>' + new Date(x.start).toLocaleString() + '</td><td>' + esc(x.site) + '</td><td>' + x.hands +
      '</td><td class="' + ((x.net || 0) >= 0 ? 'pos' : 'neg') + '">' + ((x.net || 0) >= 0 ? '+' : '') + fmt(x.net || 0) + '</td></tr>').join('') + '</tbody></table>' +
    '<p class="muted" style="margin-bottom:0">Total: <b class="' + (sessions.reduce((a, x) => a + (x.net || 0), 0) >= 0 ? 'pos' : 'neg') + '">' + fmt(sessions.reduce((a, x) => a + (x.net || 0), 0)) + '</b> over ' + sessions.length + ' sessions</p>'
    : '<span class="muted">No sessions yet.</span>';

  // ---- players
  let players = await Store.loadPlayers();
  const pctS = (x) => (x == null ? '–' : Math.round(x * 100));
  function renderPlayers() {
    const q = $('search').value.toLowerCase();
    const list = Object.entries(players)
      .filter(([, p]) => !q || p.name.toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q))
      .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));
    $('pcount').textContent = '(' + Object.keys(players).length + ' saved)';
    $('players').querySelector('tbody').innerHTML = list.map(([key, p]) => {
      const sm = Profiles.summarize(p);
      const type = p.tag || Profiles.classify(p);
      const t = Profiles.TYPES[type];
      return '<tr data-key="' + esc(key) + '"><td><b>' + esc(p.name) + '</b><br><span class="muted">' + esc(p.site) + '</span></td>' +
        '<td><span class="badge" style="background:' + t.color + '">' + t.label + '</span><br><select data-f="tag"><option value="">Auto</option>' +
        Object.keys(Profiles.TYPES).filter((k) => k !== 'unknown').map((k) => '<option value="' + k + '"' + (p.tag === k ? ' selected' : '') + '>' + Profiles.TYPES[k].label + '</option>').join('') + '</select></td>' +
        '<td class="stats">' + sm.hands + ' hands<br>VPIP ' + pctS(sm.vpip) + ' / PFR ' + pctS(sm.pfr) + '<br>AF ' + (sm.af == null ? '–' : sm.af.toFixed(1)) + ' · F2B ' + pctS(sm.foldToBet) + ' · WTSD ' + pctS(sm.wtsd) + '</td>' +
        '<td style="width:40%"><textarea data-f="notes" rows="2" style="width:100%">' + esc(p.notes || '') + '</textarea>' +
        ((p.showdowns || []).length ? '<div class="muted" style="font-size:11px">Shown: ' + p.showdowns.slice(-4).map((x) => esc(x.cards)).join(', ') + '</div>' : '') + '</td>' +
        '<td><button class="danger" data-f="del">Delete</button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">No players yet. Play some hands with the advisor open.</td></tr>';
  }
  $('players').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-key]');
    const f = e.target.dataset.f;
    if (!tr || !f) return;
    players[tr.dataset.key][f] = e.target.value;
    await Store.replacePlayers(players);
    if (f === 'tag') renderPlayers();
  });
  $('players').addEventListener('click', async (e) => {
    if (e.target.dataset.f !== 'del') return;
    const tr = e.target.closest('tr[data-key]');
    if (!confirm('Delete ' + players[tr.dataset.key].name + '?')) return;
    delete players[tr.dataset.key];
    await Store.replacePlayers(players);
    renderPlayers();
  });
  $('search').oninput = renderPlayers;
  $('export').onclick = () => {
    const blob = new Blob([JSON.stringify({ players, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'poker-advisor-players.json';
    a.click();
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = data.players || data;
      for (const k in incoming) {
        if (!players[k]) players[k] = incoming[k];
        else if ((incoming[k].stats || {}).hands > (players[k].stats || {}).hands) players[k] = Object.assign(incoming[k], { notes: players[k].notes || incoming[k].notes });
      }
      await Store.replacePlayers(players);
      renderPlayers();
    } catch (err) {
      alert('Could not import: ' + err.message);
    }
  };
  $('clear').onclick = async () => {
    if (!confirm('Delete ALL saved players and notes?')) return;
    players = {};
    await Store.replacePlayers(players);
    renderPlayers();
  };
  renderPlayers();
})();
