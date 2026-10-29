/* Card representation: integer 0..51, rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_WORDS = {
    ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: 'T', nine: '9', eight: '8',
    seven: '7', six: '6', five: '5', four: '4', three: '3', two: '2', deuce: '2'
  };
  const SUIT_CHARS = {
    s: 's', h: 'h', d: 'd', c: 'c',
    '♠': 's', '♤': 's', '♥': 'h', '♡': 'h',
    '♦': 'd', '♢': 'd', '♣': 'c', '♧': 'c'
  };
  const SUIT_WORDS = { spade: 's', heart: 'h', diamond: 'd', club: 'c' };

  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const makeCard = (rank, suit) => rank * 4 + suit;

  function cardToString(c) {
    return RANKS[rankOf(c)] + SUITS[suitOf(c)];
  }

  function cardToPretty(c) {
    const r = RANKS[rankOf(c)];
    return (r === 'T' ? '10' : r) + SUIT_SYMBOLS[SUITS[suitOf(c)]];
  }

  function normRank(r) {
    if (!r) return null;
    r = String(r).toUpperCase();
    if (r === '10' || r === '1O') return 'T';
    if (r === '1') return 'A';
    return RANKS.includes(r) ? r : null;
  }

  function fromRankSuit(r, s) {
    const rank = normRank(r);
    const suit = SUIT_CHARS[String(s).toLowerCase()] || SUIT_CHARS[s];
    if (!rank || !suit) return null;
    return makeCard(RANKS.indexOf(rank), SUITS.indexOf(suit));
  }

  /**
   * Parse a single card from almost any representation found in poker UIs:
   * "As", "a♠", "10h", "♠A", "card_ah.png", "ace_of_spades", "spades-K", "KS.svg".
   */
  function parseCard(token) {
    if (token == null) return null;
    let t = String(token).trim();
    if (!t) return null;
    t = t.replace(/^.*[\\/]/, '').replace(/\.(png|svg|jpe?g|gif|webp)(\?.*)?$/i, '');

    let m = t.match(/^(10|[2-9tjqka])\s*([shdc♠-♧])$/i);
    if (m) return fromRankSuit(m[1], m[2]);
    m = t.match(/^([shdc♠-♧])\s*(10|[2-9tjqka])$/i);
    if (m) return fromRankSuit(m[2], m[1]);

    const lower = t.toLowerCase();
    let suit = null;
    for (const w in SUIT_WORDS) if (lower.includes(w)) suit = SUIT_WORDS[w];
    if (!suit) {
      const sym = t.match(/[♠-♧]/);
      if (sym) suit = SUIT_CHARS[sym[0]];
    }
    let rank = null;
    for (const w in RANK_WORDS) if (new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(lower)) rank = RANK_WORDS[w];
    if (!rank) {
      const parts = lower.split(/[^a-z0-9♠-♧]+/).filter(Boolean);
      for (const p of parts) {
        m = p.match(/^(10|[2-9tjqka])([shdc])$/) || p.match(/^([shdc])(10|[2-9tjqka])$/);
        if (m) {
          return /^[shdc]$/.test(m[1]) ? fromRankSuit(m[2], m[1]) : fromRankSuit(m[1], m[2]);
        }
        if (suit && /^(10|[2-9tjqka])$/.test(p)) rank = normRank(p);
      }
    }
    if (rank && suit) return fromRankSuit(rank, suit);
    return null;
  }

  /** Parse a run of cards like "AhKd", "Ah Kd", "10♠ 9♠", "A♠K♦". */
  function parseCards(str) {
    if (!str) return [];
    const out = [];
    const re = /(10|[2-9tjqka])\s*([shdc♠-♧])/gi;
    let m;
    while ((m = re.exec(String(str)))) {
      const c = fromRankSuit(m[1], m[2]);
      if (c != null && !out.includes(c)) out.push(c);
    }
    return out;
  }

  function fullDeck() {
    const d = [];
    for (let i = 0; i < 52; i++) d.push(i);
    return d;
  }

  PA.Cards = {
    RANKS, SUITS, SUIT_SYMBOLS,
    rankOf, suitOf, makeCard, cardToString, cardToPretty,
    parseCard, parseCards, fullDeck
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PA.Cards;
})(typeof globalThis !== 'undefined' ? globalThis : this);
