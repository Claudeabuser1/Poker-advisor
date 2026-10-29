/* End-to-end: loads the unpacked extension in Chromium, serves a PokerNow-like table at
 * https://www.pokernow.com/games/test via request interception, plays through a hand and
 * checks advice, highlight placement and player tracking. Screenshots go to tests/output/. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'pokernow-table.html'), 'utf8');
const GENERIC = fs.readFileSync(path.join(__dirname, 'fixtures', 'generic-table.html'), 'utf8');
const cardSvg = (code) => '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="56"><rect width="40" height="56" rx="4" fill="#fff"/>' +
  '<text x="5" y="22" font-size="16" font-family="Arial">' + code + '</text></svg>';

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
  console.log('  ✓ ' + msg);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  await ctx.route('https://www.pokernow.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (/Poker Advisor|error/i.test(m.text())) console.log('  [page]', m.text()); });
  await page.goto('https://www.pokernow.com/games/test');
  await page.waitForSelector('#poker-advisor-root', { state: 'attached', timeout: 10000 });
  console.log('Extension content script loaded on pokernow.com');

  const panelText = () => page.evaluate(() => document.querySelector('#poker-advisor-root').shadowRoot.querySelector('.panel').innerText);
  const rings = () => page.evaluate(() => Array.from(document.querySelector('#poker-advisor-highlight').shadowRoot.querySelectorAll('.ring'))
    .filter((r) => r.style.display !== 'none').map((r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, cls: r.className }; }));
  const tags = () => page.evaluate(() => Array.from(document.querySelector('#poker-advisor-highlight').shadowRoot.querySelectorAll('.tag')).filter((t) => t.style.display !== 'none').map((t) => t.textContent));
  const center = (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  const render = (s) => page.evaluate((st) => window.T.render(st), s);
  const settle = () => page.waitForTimeout(900);

  const base = (over) => Object.assign({ dealer: 3, pot: 0, board: [] }, over);
  const P = (seat, name, stack, extra) => Object.assign({ seat, name, stack }, extra || {});

  // ---- Hand 1: hero (seat 1) with KK faces a raise from Alice.
  // Seats clockwise 1..4, dealer seat 3 -> seat 4 SB (Bob), seat 1 BB (hero), seat 2 = UTG (Alice), seat 3 BTN (Carl).
  console.log('Hand 1: preflop, KK facing a raise');
  await render(base({ players: [P(1, 'Hero', 198, { you: 1, cards: ['Kd', 'Kc'], bet: 2 }), P(2, 'Alice', 200), P(3, 'Carl', 200), P(4, 'Bob', 199, { bet: 1 })] }));
  await settle();
  await render(base({ players: [P(1, 'Hero', 198, { you: 1, cards: ['Kd', 'Kc'], bet: 2 }), P(2, 'Alice', 194, { bet: 6 }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { bet: 1, fold: 1 })] }));
  await settle();
  await render(base({ players: [P(1, 'Hero', 198, { you: 1, cards: ['Kd', 'Kc'], bet: 2, turn: 1 }), P(2, 'Alice', 194, { bet: 6 }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { bet: 1, fold: 1 })], buttons: ['Fold', 'Call 4', 'Raise'] }));
  await settle();
  let txt = await panelText();
  assert(/RAISE TO \d+/.test(txt), 'recommends a 3-bet with KK: ' + txt.match(/RAISE TO \d+/));
  const amount = +txt.match(/RAISE TO (\d+)/)[1];
  assert(amount % 1 === 0 && amount >= 16 && amount <= 30, '3-bet size is a round number (' + amount + ')');
  assert(/BB/.test(txt), 'hero position detected as BB');
  let r = await rings();
  let raiseC = await center('.action-buttons .raise');
  assert(r.length === 1 && Math.abs(r[0].x - raiseC.x) < 3 && Math.abs(r[0].y - raiseC.y) < 3, 'highlight ring is on the Raise button');
  assert((await tags())[0] === 'Raise to ' + amount, 'highlight label says "Raise to ' + amount + '"');
  await page.screenshot({ path: path.join(OUT, '1-preflop-3bet.png') });

  // Raise form opened: highlight moves to the amount input
  await render(base({ players: [P(1, 'Hero', 198, { you: 1, cards: ['Kd', 'Kc'], bet: 2, turn: 1 }), P(2, 'Alice', 194, { bet: 6 }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { bet: 1, fold: 1 })], buttons: ['Fold', 'Call 4', 'Raise'], raiseOpen: 1 }));
  await settle();
  r = await rings();
  const inputC = await center('.raise-controller-form input[type=number]');
  assert(r.some((x) => Math.abs(x.x - inputC.x) < 3 && Math.abs(x.y - inputC.y) < 3), 'after opening the raise box, the amount input is highlighted');
  assert((await tags()).includes('Enter ' + amount), 'label tells you the amount to enter');
  await page.screenshot({ path: path.join(OUT, '2-raise-input.png') });

  // Hero 3-bets, Alice calls -> flop
  await render(base({ players: [P(1, 'Hero', 180, { you: 1, cards: ['Kd', 'Kc'], bet: 20 }), P(2, 'Alice', 194, { bet: 6 }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { fold: 1 })] }));
  await settle();
  await render(base({ players: [P(1, 'Hero', 180, { you: 1, cards: ['Kd', 'Kc'], bet: 20 }), P(2, 'Alice', 180, { bet: 20 }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { fold: 1 })] }));
  await settle();

  console.log('Hand 1: flop, overpair checked to');
  await render(base({ pot: 41, board: ['Qs', '7c', '2d'], players: [P(1, 'Hero', 180, { you: 1, cards: ['Kd', 'Kc'], turn: 1 }), P(2, 'Alice', 180), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { fold: 1 })], buttons: ['Fold', 'Check', 'Bet'] }));
  await settle();
  txt = await panelText();
  assert(/BET \d+/.test(txt), 'value bets the overpair on the flop: ' + txt.match(/BET \d+/));
  const flopBet = +txt.match(/BET (\d+)/)[1];
  assert(flopBet % 5 === 0, 'flop bet is a round number (' + flopBet + ')');
  assert(/Overpair/.test(txt), 'hand described as an overpair');
  assert(/NET\s*\+0/.test(txt), 'session net is not counted as lost while chips are in the pot');
  r = await rings();
  const betC = await center('.action-buttons .bet');
  assert(r.length === 1 && Math.abs(r[0].x - betC.x) < 3, 'highlight ring is on the Bet button');
  await page.screenshot({ path: path.join(OUT, '3-flop-value-bet.png') });

  console.log('Hand 1: river, facing an all-in overbet with one pair');
  await render(base({ pot: 101, board: ['Qs', '7c', '2d', 'Jh', '9h'], players: [P(1, 'Hero', 150, { you: 1, cards: ['Kd', 'Kc'], turn: 1 }), P(2, 'Alice', 0, { bet: 150 }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { fold: 1 })], buttons: ['Fold', 'Call 150'] }));
  await settle();
  txt = await panelText();
  console.log('  advice:', (txt.match(/(FOLD|CALL[^\n]*)/) || [])[0]);
  r = await rings();
  assert(r.length === 1, 'exactly one button highlighted on the river');

  // Alice shows down; next hand starts (new hole cards, board cleared)
  await render(base({ pot: 401, board: ['Qs', '7c', '2d', 'Jh', '9h'], players: [P(1, 'Hero', 150, { you: 1, cards: ['Kd', 'Kc'] }), P(2, 'Alice', 0, { bet: 150, cards: ['Th', '8h'] }), P(3, 'Carl', 200, { fold: 1 }), P(4, 'Bob', 199, { fold: 1 })] }));
  await settle();

  console.log('Hand 2: not hero\'s turn -> no highlight, HUD shows tracked stats');
  await render(base({ dealer: 1, players: [P(1, 'Hero', 150, { you: 1, cards: ['9s', '4d'] }), P(2, 'Alice', 400, { bet: 1 }), P(3, 'Carl', 198, { bet: 2 }), P(4, 'Bob', 199, { turn: 1 })] }));
  await settle();
  r = await rings();
  assert(r.length === 0, 'no highlight while waiting for other players');
  txt = await panelText();
  assert(/Alice/.test(txt) && /VPIP 100 · PFR 100/.test(txt), 'Alice\'s preflop raise was tracked (VPIP/PFR 100 after 1 hand)');
  assert(/Waiting for your turn/.test(txt), 'panel waits for hero\'s turn');
  await page.screenshot({ path: path.join(OUT, '4-hud-waiting.png') });

  const stored = await (async () => {
    const [sw] = ctx.serviceWorkers().length ? ctx.serviceWorkers() : [await ctx.waitForEvent('serviceworker')];
    await page.waitForTimeout(1800); // player saves are debounced
    return sw.evaluate(() => chrome.storage.local.get('pa_players'));
  })();
  const alice = stored.pa_players && stored.pa_players['pokernow:Alice'];
  assert(alice && alice.stats.hands === 1 && alice.stats.pfr === 1, 'Alice saved to chrome.storage with 1 hand, 1 PFR');
  assert(alice.showdowns && alice.showdowns[0].cards === 'Th8h', 'Alice\'s showdown hand (Th8h) saved to her profile');

  console.log('Calculator view');
  await page.evaluate(() => document.querySelector('#poker-advisor-root').shadowRoot.querySelector('[data-a="calc"]').click());
  await page.evaluate(() => {
    const s = document.querySelector('#poker-advisor-root').shadowRoot;
    const set = (k, v) => { const el = s.querySelector('[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('hole', 'AhQh'); set('board', 'Kh7h2c'); set('pot', '20'); set('toCall', '10'); set('stack', '200'); set('bb', '2');
    s.querySelector('[data-a="calc-run"]').click();
  });
  await page.waitForTimeout(400);
  txt = await panelText();
  assert(/CALL 10|RAISE TO \d+/.test(txt), 'calculator gives advice for a nut flush draw: ' + (txt.match(/CALL 10|RAISE TO \d+/) || [])[0]);
  await page.screenshot({ path: path.join(OUT, '5-calculator.png') });

  // ---- Generic heuristic reader (no PokerNow markup) on kgpoker.fly.dev
  console.log('Generic reader on kgpoker.fly.dev (image cards, text-only buttons)');
  await ctx.route('https://kgpoker.fly.dev/**', (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/^\/cards\/(\w+)\.svg$/);
    if (m) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: cardSvg(m[1]) });
    return route.fulfill({ status: 200, contentType: 'text/html', body: GENERIC });
  });
  const g = await ctx.newPage();
  await g.goto('https://kgpoker.fly.dev/table/1');
  await g.waitForSelector('#poker-advisor-root', { state: 'attached', timeout: 10000 });
  const gText = () => g.evaluate(() => document.querySelector('#poker-advisor-root').shadowRoot.querySelector('.panel').innerText);
  const gp = (i, name, stack, extra) => Object.assign({ name, stack }, extra || {});
  await g.evaluate((st) => window.G.render(st), { dealer: 3, pot: 0, players: [gp(0, 'Me', 990, { me: 1, cards: ['As', 'Ah'], bet: 10 }), gp(1, 'Dana', 1000), gp(2, 'Eli', 1000), gp(3, 'Fay', 995, { bet: 5 })] });
  await g.waitForTimeout(900);
  await g.evaluate((st) => window.G.render(st), { dealer: 3, pot: 0, players: [gp(0, 'Me', 990, { me: 1, cards: ['As', 'Ah'], bet: 10 }), gp(1, 'Dana', 970, { bet: 30 }), gp(2, 'Eli', 1000), gp(3, 'Fay', 995, { bet: 5 })], buttons: ['Fold', 'Call 20', 'Raise'] });
  await g.waitForTimeout(1200);
  const gt = await gText();
  assert(/RAISE TO \d+|ALL-IN/.test(gt), 'generic reader: AA facing a raise gets a re-raise: ' + (gt.match(/RAISE TO \d+|ALL-IN[^\n]*/) || [])[0]);
  const diag = await g.evaluate(() => {
    const s = document.querySelector('#poker-advisor-root').shadowRoot;
    s.querySelector('[data-a="diag"]').click();
    return s.querySelector('pre').innerText;
  });
  console.log(diag.split('\n').map((l) => '    ' + l).join('\n'));
  assert(/cards: As Ah|cards: Ah As/.test(diag), 'generic reader found hero hole cards from images');
  assert(/Blinds: 5\/10/.test(diag), 'generic reader found blinds 5/10');
  await g.screenshot({ path: path.join(OUT, '6-generic-site.png') });

  await ctx.close();
  console.log('\nAll end-to-end checks passed. Screenshots in tests/output/');
})().catch((e) => { console.error(e); process.exit(1); });
