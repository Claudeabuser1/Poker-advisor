/* DOM helpers + site-independent heuristics for reading a poker table. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});
  const { parseCard, parseCards } = PA.Cards;

  function qa(sel, ctx) {
    if (!sel) return [];
    const sels = Array.isArray(sel) ? sel : [sel];
    for (const s of sels) {
      try {
        const found = Array.from((ctx || document).querySelectorAll(s));
        if (found.length) return found;
      } catch (e) { /* invalid custom selector */ }
    }
    return [];
  }
  const q = (sel, ctx) => qa(sel, ctx)[0] || null;

  function text(el) {
    return el ? (el.innerText != null ? el.innerText : el.textContent || '').trim() : '';
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  }

  function enabled(el) {
    return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && visible(el);
  }

  /** Parse "1,234.5", "$12", "1.2k", "Pot: 3.5M" -> number (first number found). */
  function num(str) {
    if (str == null) return null;
    const m = String(str).replace(/ /g, ' ').match(/(-?\d[\d,\s]*(?:\.\d+)?|\.\d+)\s*([kKmMbB])?\b/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/[,\s]/g, ''));
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') n *= 1e3; else if (suf === 'm') n *= 1e6; else if (suf === 'b') n *= 1e9;
    return isNaN(n) ? null : n;
  }

  function allNums(str) {
    const out = [];
    const re = /(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?/g;
    let m;
    while ((m = re.exec(String(str || '')))) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
      out.push(n);
    }
    return out;
  }

  /** Read a card from an element using text, classes, data attributes, aria-label, img alt/src. */
  function cardFromElement(el) {
    if (!el) return null;
    const attrs = ['data-card', 'data-value', 'data-code', 'aria-label', 'title', 'alt'];
    for (const a of attrs) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const c = parseCard(v); if (c != null) return c; const cs = parseCards(v); if (cs.length === 1) return cs[0]; }
    }
    const t = text(el).replace(/\s+/g, '');
    if (t && t.length <= 4) { const c = parseCard(t); if (c != null) return c; }
    if (t && t.length <= 8) { const cs = parseCards(t); if (cs.length === 1) return cs[0]; }
    if (el.tagName === 'IMG' && el.src) { const c = parseCard(el.src); if (c != null) return c; }
    const bg = el.style && el.style.backgroundImage;
    if (bg) { const c = parseCard(bg.replace(/^url\(["']?|["']?\)$/g, '')); if (c != null) return c; }
    const cls = typeof el.className === 'string' ? el.className : '';
    for (const token of cls.split(/\s+/)) {
      if (!/card|^[2-9tjqka]{1,2}[shdc]$|^[shdc][2-9tjqka]{1,2}$/i.test(token)) continue;
      const c = parseCard(token.replace(/^card[-_]?/i, ''));
      if (c != null) return c;
    }
    // Structured: <div class="card"><span class="value">A</span><span class="suit">s</span></div>
    const v = el.querySelector && el.querySelector('[class*="value"],[class*="rank"]');
    const s = el.querySelector && el.querySelector('[class*="suit"]');
    if (v && s) {
      const suitCls = typeof s.className === 'string' ? s.className : '';
      const suitWord = (suitCls.match(/spade|heart|diamond|club|\b[shdc]\b|suit-([shdc])/i) || [])[0] || text(s);
      const c = parseCard(text(v) + ' of ' + suitWord) ?? parseCard(text(v) + text(s));
      if (c != null) return c;
    }
    const img = el.querySelector && el.querySelector('img');
    if (img) return cardFromElement(img);
    return null;
  }

  function cardsIn(container, cardSel) {
    if (!container) return [];
    const els = cardSel ? qa(cardSel, container) : [container];
    const out = [];
    for (const el of els) {
      const c = cardFromElement(el);
      if (c != null && !out.includes(c)) out.push(c);
    }
    return out;
  }

  /** Heuristic scan for visible face-up cards, grouped by container. */
  function scanCards(scope) {
    const rootEl = scope || document.body;
    const cand = rootEl.querySelectorAll('img, [class*="card" i], [data-card], [aria-label]');
    const hits = [];
    for (const el of cand) {
      if (el.closest('#poker-advisor-root')) continue;
      const c = cardFromElement(el);
      if (c == null || !visible(el)) continue;
      hits.push({ el, card: c });
    }
    // keep outermost element per card
    const filtered = hits.filter((h) => !hits.some((o) => o !== h && o.card === h.card && o.el.contains(h.el)));
    const groups = new Map();
    for (const h of filtered) {
      let g = h.el.parentElement;
      for (let i = 0; i < 2 && g && g.children.length < 2; i++) g = g.parentElement;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(h);
    }
    return Array.from(groups.entries()).map(([el, items]) => {
      const rect = el.getBoundingClientRect();
      return { el, cards: [...new Set(items.map((i) => i.card))], cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    });
  }

  const BUTTON_PATTERNS = {
    fold: /^\s*fold\b/i,
    check: /^\s*check\b(?!\s*\/)/i,
    call: /^\s*call\b/i,
    raise: /^\s*(raise|re-?raise|bet\s*\/\s*raise)\b/i,
    bet: /^\s*bet\b/i,
    allin: /^\s*(all[\s-]?in|shove|max)\b/i
  };

  function findButtons(scope) {
    const out = {};
    const els = (scope || document).querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.button, .button, .btn');
    for (const el of els) {
      if (el.closest('#poker-advisor-root') || !enabled(el)) continue;
      const t = (el.value && el.tagName === 'INPUT' ? el.value : text(el)).replace(/\s+/g, ' ');
      if (!t || t.length > 40 || /\/|auto|pre/i.test(t)) continue;
      for (const k in BUTTON_PATTERNS) if (!out[k] && BUTTON_PATTERNS[k].test(t)) out[k] = el;
    }
    return out;
  }

  function findBetInput(scope) {
    const els = (scope || document).querySelectorAll('input[type="number"], input[type="text"], input:not([type])');
    for (const el of els) {
      if (el.closest('#poker-advisor-root') || !visible(el)) continue;
      const ctx = (el.name + ' ' + el.id + ' ' + el.className + ' ' + (el.placeholder || '') + ' ' + text(el.parentElement)).toLowerCase();
      if (/bet|raise|amount|chips|value/.test(ctx) || el.type === 'number') return el;
    }
    return null;
  }

  /** Big/small blind from text like "Blinds 1/2", "NLH ~ 0.10 / 0.20". */
  function findBlinds(scope) {
    const els = (scope || document).querySelectorAll('[class*="blind" i], [class*="stakes" i], [class*="game-info" i], header, title');
    for (const el of els) {
      const m = text(el).match(/(\d[\d,]*(?:\.\d+)?)\s*\/\s*(\d[\d,]*(?:\.\d+)?)/);
      if (m) return { sb: parseFloat(m[1].replace(/,/g, '')), bb: parseFloat(m[2].replace(/,/g, '')) };
    }
    const m = (document.title || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (m) return { sb: +m[1], bb: +m[2] };
    return null;
  }

  function findPot(scope) {
    const els = qa(['[class*="pot" i]'], scope).filter((e) => !e.closest('#poker-advisor-root') && visible(e));
    let best = null;
    for (const el of els) {
      const t = text(el);
      const total = t.match(/total[^\d]*(\d[\d,.]*\s*[kKmM]?)/i);
      if (total) return { total: num(total[1]) };
      const n = num(t);
      if (n != null && (best == null || n > best)) best = n;
    }
    if (best == null) {
      const m = text(document.body).match(/pot[:\s]*\$?(\d[\d,.]*)/i);
      if (m) best = num(m[1]);
    }
    return best == null ? null : { main: best };
  }

  /** Heuristic player boxes: repeated elements with "player"/"seat" classes containing a name and a number. */
  function scanPlayers(scope) {
    const cands = qa(['[class*="player" i]', '[class*="seat" i]'], scope).filter((e) => !e.closest('#poker-advisor-root') && visible(e));
    const byClass = new Map();
    for (const el of cands) {
      const key = (typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '') + '|' + depth(el);
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key).push(el);
    }
    let best = [];
    for (const list of byClass.values()) {
      const good = list.filter((el) => allNums(text(el)).length && /[a-z]/i.test(text(el)));
      if (good.length >= 2 && good.length <= 10 && good.length > best.length) best = good;
    }
    return best;
  }

  function depth(el) {
    let d = 0;
    while (el && el.parentElement) { d++; el = el.parentElement; }
    return d;
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  PA.DOM = { q, qa, text, visible, enabled, num, allNums, cardFromElement, cardsIn, scanCards, findButtons, findBetInput, findBlinds, findPot, scanPlayers, center, BUTTON_PATTERNS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
