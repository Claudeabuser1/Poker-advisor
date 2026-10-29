(async function () {
  const { Store } = window.PA;
  let s = await Store.getSettings();
  const $ = (id) => document.getElementById(id);

  const bluffLabel = (v) => (v == 0 ? 'never' : v <= 15 ? 'rarely' : v <= 35 ? 'sometimes' : v <= 60 ? 'often' : 'very often');
  const safetyLabel = (v) => (v >= 80 ? 'very safe' : v >= 55 ? 'safe' : v >= 30 ? 'normal' : 'gamble more');

  function paint() {
    $('enabled').checked = s.enabled;
    document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.mode));
    $('style').value = s.style;
    $('bluff').value = s.bluff; $('bluffV').textContent = bluffLabel(s.bluff);
    $('safety').value = s.safety; $('safetyV').textContent = safetyLabel(s.safety);
    $('bigBlindOverride').value = s.bigBlindOverride || 0;
    $('heroName').value = s.heroName || '';
  }
  const save = async (patch) => { s = await Store.saveSettings(patch); paint(); };

  $('enabled').onchange = (e) => save({ enabled: e.target.checked });
  document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => save({ mode: b.dataset.v })));
  $('style').onchange = (e) => save({ style: e.target.value });
  $('bluff').oninput = (e) => save({ bluff: +e.target.value });
  $('safety').oninput = (e) => save({ safety: +e.target.value });
  $('bigBlindOverride').onchange = (e) => save({ bigBlindOverride: +e.target.value || 0 });
  $('heroName').onchange = (e) => save({ heroName: e.target.value.trim() });
  $('opts').onclick = () => chrome.runtime.openOptionsPage();

  // Site status / enable on other sites
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const box = $('siteBox');
  let host = '';
  try { const u = new URL(tab.url); if (/^https?:$/.test(u.protocol)) host = u.hostname; } catch (e) { /* no URL access */ }
  const builtIn = /(^|\.)pokernow\.(com|club)$|(^|\.)kgpoker\.fly\.dev$/.test(host);
  if (!host) box.innerHTML = '<span class="muted">Open a poker table to get advice.</span>';
  else if (builtIn) box.innerHTML = '<b>' + host + '</b><div class="muted">Supported site: the advisor panel runs automatically.</div>';
  else {
    const on = (s.extraSites || []).includes(host);
    box.innerHTML = '<b>' + host + '</b><div class="muted" style="margin:4px 0 8px">' +
      (on ? 'Enabled on this site.' : 'Not a built-in site. Enable to try the generic table reader here.') + '</div>' +
      '<div class="row"><button id="siteBtn">' + (on ? 'Disable on this site' : 'Enable on this site') + '</button></div>';
    $('siteBtn').onclick = async () => {
      if (on) {
        await save({ extraSites: (s.extraSites || []).filter((h) => h !== host) });
        chrome.tabs.reload(tab.id);
        window.close();
        return;
      }
      const granted = await chrome.permissions.request({ origins: ['*://' + host + '/*'] });
      if (!granted) return;
      await save({ extraSites: [...new Set([...(s.extraSites || []), host])] });
      await chrome.runtime.sendMessage({ type: 'inject', tabId: tab.id });
      window.close();
    };
  }
  paint();
})();
