/* Service worker: opens the options page and injects the advisor into extra sites the user enabled. */
const FILES = [
  'src/core/cards.js', 'src/core/evaluator.js', 'src/core/ranges.js', 'src/core/equity.js',
  'src/core/sizing.js', 'src/core/profiles.js', 'src/core/strategy.js', 'src/storage.js',
  'src/tracker.js', 'src/adapters/dom.js', 'src/adapters/sites.js', 'src/ui/overlay.js', 'src/content.js'
];

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: FILES });
    return true;
  } catch (e) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'open-options') chrome.runtime.openOptionsPage();
  if (msg && msg.type === 'inject' && msg.tabId) {
    inject(msg.tabId).then(sendResponse);
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !/^https?:/.test(tab.url)) return;
  const host = new URL(tab.url).hostname;
  const { pa_settings } = await chrome.storage.local.get('pa_settings');
  const extra = (pa_settings && pa_settings.extraSites) || [];
  if (!extra.includes(host)) return;
  const ok = await chrome.permissions.contains({ origins: ['*://' + host + '/*'] });
  if (ok) inject(tabId);
});
