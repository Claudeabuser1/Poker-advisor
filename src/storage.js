/* Persistence: settings, the player database and session history (chrome.storage.local). */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});

  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: 'advice',          // 'advice' (recommend + highlight) | 'hud' (stats only)
    style: 'balanced',       // 'tight' | 'balanced' | 'aggressive'
    bluff: 25,               // 0-100 bluffing frequency
    safety: 70,              // 0-100 stack protection (higher = less risk with medium hands)
    highlight: true,
    showReasons: true,
    showHud: true,
    heroName: '',
    bigBlindOverride: 0,
    defaultVpip: 0.38,
    defaultPfr: 0.12,
    stopLossBuyins: 2,
    stopWinBuyins: 0,
    breakReminderMin: 90,
    customSelectors: {},
    extraSites: [],
    panel: { x: null, y: 80, collapsed: false }
  };

  const mem = {};
  const area = root.chrome && root.chrome.storage && root.chrome.storage.local;

  function get(keys) {
    if (area) return new Promise((res) => area.get(keys, (v) => res(v || {})));
    const out = {};
    for (const k of [].concat(keys)) if (k in mem) out[k] = JSON.parse(JSON.stringify(mem[k]));
    return Promise.resolve(out);
  }
  function set(obj) {
    if (area) return new Promise((res) => area.set(obj, res));
    Object.assign(mem, JSON.parse(JSON.stringify(obj)));
    return Promise.resolve();
  }

  async function getSettings() {
    const { pa_settings } = await get('pa_settings');
    return Object.assign({}, DEFAULT_SETTINGS, pa_settings || {});
  }
  async function saveSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign(cur, patch);
    await set({ pa_settings: next });
    return next;
  }

  const playerKey = (site, name) => (site || 'site') + ':' + name;

  let playersCache = null;
  let saveTimer = null;
  async function loadPlayers() {
    if (playersCache) return playersCache;
    const { pa_players } = await get('pa_players');
    playersCache = pa_players || {};
    return playersCache;
  }
  function getPlayer(site, name) {
    const key = playerKey(site, name);
    if (!playersCache) playersCache = {};
    if (!playersCache[key]) {
      playersCache[key] = { name, site, stats: PA.Profiles.emptyStats(), notes: '', tag: '', showdowns: [], firstSeen: Date.now(), lastSeen: Date.now() };
    }
    return playersCache[key];
  }
  function savePlayersSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => set({ pa_players: playersCache }), 1500);
  }
  async function replacePlayers(obj) {
    playersCache = obj || {};
    await set({ pa_players: playersCache });
  }

  async function getSessions() {
    const { pa_sessions } = await get('pa_sessions');
    return pa_sessions || [];
  }
  async function saveSession(session) {
    const list = await getSessions();
    const i = list.findIndex((s) => s.id === session.id);
    if (i >= 0) list[i] = session; else list.push(session);
    while (list.length > 200) list.shift();
    await set({ pa_sessions: list });
  }

  function onChange(cb) {
    if (root.chrome && root.chrome.storage && root.chrome.storage.onChanged) {
      root.chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.pa_players) playersCache = changes.pa_players.newValue || {};
        cb(changes);
      });
    }
  }

  PA.Store = { DEFAULT_SETTINGS, get, set, getSettings, saveSettings, playerKey, loadPlayers, getPlayer, savePlayersSoon, replacePlayers, getSessions, saveSession, onChange };
})(typeof globalThis !== 'undefined' ? globalThis : this);
