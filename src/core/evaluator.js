/* Fast 5-7 card hand evaluator plus hand/draw analysis used for advice text and range filtering. */
(function (root) {
  'use strict';
  const PA = (root.PA = root.PA || {});

  const CATEGORY_NAMES = [
    'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight',
    'Flush', 'Full house', 'Four of a kind', 'Straight flush'
  ];

  const rankCount = new Int8Array(13);
  const suitCount = new Int8Array(4);
  const suitMask = new Int32Array(4);

  /** Highest straight in a rank bitmask (returns top rank index, 3 for the wheel) or -1. */
  function straightHigh(mask) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0x1f << (hi - 4);
      if ((mask & need) === need) return hi;
    }
    const wheel = (1 << 12) | 0xf;
    return (mask & wheel) === wheel ? 3 : -1;
  }

  function score(cat, a, b, c, d, e) {
    return cat * 1048576 + (a | 0) * 65536 + (b | 0) * 4096 + (c | 0) * 256 + (d | 0) * 16 + (e | 0);
  }

  function topRanks(mask, n, exclude1, exclude2) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) {
      if (r === exclude1 || r === exclude2) continue;
      if (mask & (1 << r)) out.push(r);
    }
    while (out.length < n) out.push(0);
    return out;
  }

  /** Evaluate 5-7 cards. Higher is better. category = Math.floor(score / 1048576). */
  function evaluate(cards) {
    rankCount.fill(0);
    suitCount.fill(0);
    suitMask.fill(0);
    let rankMask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const r = c >> 2;
      const s = c & 3;
      rankCount[r]++;
      suitCount[s]++;
      suitMask[s] |= 1 << r;
      rankMask |= 1 << r;
    }

    let flushSuit = -1;
    for (let s = 0; s < 4; s++) {
      if (suitCount[s] >= 5) {
        flushSuit = s;
        const sf = straightHigh(suitMask[s]);
        if (sf >= 0) return score(8, sf);
      }
    }

    let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1, pair3 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = rankCount[r];
      if (n === 4) quad = r;
      else if (n === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
      else if (n === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; else if (pair3 < 0) pair3 = r; }
    }

    if (quad >= 0) return score(7, quad, topRanks(rankMask, 1, quad)[0]);
    if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) return score(6, trip1, Math.max(trip2, pair1));
    if (flushSuit >= 0) {
      const t = topRanks(suitMask[flushSuit], 5);
      return score(5, t[0], t[1], t[2], t[3], t[4]);
    }
    const st = straightHigh(rankMask);
    if (st >= 0) return score(4, st);
    if (trip1 >= 0) {
      const k = topRanks(rankMask, 2, trip1);
      return score(3, trip1, k[0], k[1]);
    }
    if (pair1 >= 0 && pair2 >= 0) {
      const k = topRanks(rankMask, 1, pair1, pair2);
      return score(2, pair1, pair2, k[0]);
    }
    if (pair1 >= 0) {
      const k = topRanks(rankMask, 3, pair1);
      return score(1, pair1, k[0], k[1], k[2]);
    }
    const t = topRanks(rankMask, 5);
    return score(0, t[0], t[1], t[2], t[3], t[4]);
  }

  const categoryOf = (s) => Math.floor(s / 1048576);

  function rankMaskOf(cards) {
    let m = 0;
    for (const c of cards) m |= 1 << (c >> 2);
    return m;
  }

  /** Straight draw outs (number of ranks that complete a straight) using at least one hole card. */
  function straightDrawRanks(hole, board) {
    const all = rankMaskOf(hole.concat(board));
    const boardMask = rankMaskOf(board);
    if (straightHigh(all) >= 0) return 0;
    let n = 0;
    for (let r = 0; r < 13; r++) {
      if (all & (1 << r)) continue;
      if (straightHigh(all | (1 << r)) >= 0 && straightHigh(boardMask | (1 << r)) < 0) n++;
    }
    return n;
  }

  /**
   * Describe a hand: made-hand category, relative pair strength, draws and a coarse
   * 0-7 "strength level" used by range filtering and stack-commitment rules.
   */
  function analyze(hole, board) {
    const result = {
      category: -1, name: '', level: 0, draws: [], outs: 0,
      flushDraw: false, oesd: false, gutshot: false, nutFlushDraw: false
    };
    if (!hole || hole.length < 2) return result;
    const all = hole.concat(board || []);
    if (!board || board.length < 3) {
      const hi = Math.max(hole[0] >> 2, hole[1] >> 2);
      const pair = (hole[0] >> 2) === (hole[1] >> 2);
      result.category = pair ? 1 : 0;
      result.name = pair ? 'Pocket pair' : PA.Cards.RANKS[hi] + ' high';
      return result;
    }

    const s = evaluate(all);
    const cat = categoryOf(s);
    const boardCat = board.length >= 5 ? categoryOf(evaluate(board)) : -1;
    result.category = cat;
    result.score = s;

    const boardRanks = board.map((c) => c >> 2).sort((a, b) => b - a);
    const uniqBoard = [...new Set(boardRanks)];
    const holeRanks = hole.map((c) => c >> 2).sort((a, b) => b - a);
    const topBoard = uniqBoard[0];
    const boardPaired = uniqBoard.length < boardRanks.length;

    let level = 0;
    let name = CATEGORY_NAMES[cat];
    if (cat >= 4) {
      level = cat >= 6 ? 7 : 6;
      if (cat === 5) {
        const fs = [0, 1, 2, 3].find((x) => all.filter((c) => (c & 3) === x).length >= 5);
        const holeInFlush = hole.filter((c) => (c & 3) === fs).map((c) => c >> 2);
        if (!holeInFlush.length) { level = 2; name = 'Flush on board'; }
        else if (Math.max(...holeInFlush) >= 11) name = 'Nut-ish flush';
        if (boardPaired && level > 2) level = 5;
      }
      if (cat === 4 && boardCat === 4) { level = 2; name = 'Straight on board'; }
      if (cat === 4 && boardPaired) level = 5;
    } else if (cat === 3) {
      const tripRank = s >> 16 & 0xf;
      const isSet = holeRanks[0] === holeRanks[1] && holeRanks[0] === tripRank;
      const holeHasTrip = holeRanks.includes(tripRank);
      if (isSet) { level = 6; name = 'Set'; }
      else if (holeHasTrip) { level = 5; name = 'Trips'; }
      else { level = 1; name = 'Trips on board'; }
    } else if (cat === 2) {
      const p1 = s >> 16 & 0xf, p2 = s >> 12 & 0xf;
      const usesHole = holeRanks.includes(p1) || holeRanks.includes(p2);
      const bothHole = holeRanks.includes(p1) && holeRanks.includes(p2) && holeRanks[0] !== holeRanks[1];
      if (bothHole) { level = 5; name = 'Two pair'; }
      else if (holeRanks[0] === holeRanks[1] && holeRanks[0] > topBoard) { level = 4; name = 'Overpair (paired board)'; }
      else if (usesHole) {
        const myPair = holeRanks.includes(p1) ? p1 : p2;
        level = myPair === topBoard ? 4 : 3;
        name = myPair === topBoard ? 'Top pair (paired board)' : 'Pair + board pair';
      } else { level = 1; name = 'Board two pair'; }
    } else if (cat === 1) {
      const pr = s >> 16 & 0xf;
      const pocket = holeRanks[0] === holeRanks[1];
      if (pocket) {
        if (pr > topBoard) { level = pr >= 10 ? 4 : 3; name = 'Overpair'; }
        else if (pr > uniqBoard[uniqBoard.length - 1]) { level = 2; name = 'Underpair (middle)'; }
        else { level = 1; name = 'Underpair'; }
      } else if (!holeRanks.includes(pr)) {
        level = 0; name = 'Board pair only';
      } else if (pr === topBoard) {
        const kicker = holeRanks[0] === pr ? holeRanks[1] : holeRanks[0];
        if (kicker >= 10) { level = 4; name = 'Top pair, good kicker'; }
        else { level = 3; name = 'Top pair, weak kicker'; }
      } else if (pr === uniqBoard[1]) { level = 2; name = 'Middle pair'; }
      else { level = 1; name = 'Bottom pair'; }
    } else {
      const overs = holeRanks.filter((r) => r > topBoard).length;
      name = overs === 2 ? 'Two overcards' : PA.Cards.RANKS[holeRanks[0]] + ' high';
    }

    if (board.length < 5) {
      for (let st = 0; st < 4; st++) {
        const n = all.filter((c) => (c & 3) === st).length;
        const holeSuited = hole.filter((c) => (c & 3) === st);
        if (n === 4 && holeSuited.length && cat < 5) {
          result.flushDraw = true;
          const maxHole = Math.max(...holeSuited.map((c) => c >> 2));
          const higherMissing = [];
          for (let r = maxHole + 1; r <= 12; r++) if (!board.some((c) => (c >> 2) === r && (c & 3) === st)) higherMissing.push(r);
          result.nutFlushDraw = higherMissing.length === 0;
        }
      }
      if (cat < 4) {
        const sd = straightDrawRanks(hole, board);
        if (sd >= 2) result.oesd = true;
        else if (sd === 1) result.gutshot = true;
      }
      let outs = 0;
      if (result.flushDraw) { outs += 9; result.draws.push(result.nutFlushDraw ? 'nut flush draw' : 'flush draw'); }
      if (result.oesd) { outs += result.flushDraw ? 6 : 8; result.draws.push('open-ended straight draw'); }
      else if (result.gutshot) { outs += result.flushDraw ? 3 : 4; result.draws.push('gutshot'); }
      if (cat === 0 && board.length === 3) {
        const overs = holeRanks.filter((r) => r > topBoard).length;
        if (overs) outs += overs * 2;
      }
      result.outs = outs;
      if (level < 3 && (outs >= 12)) level = Math.max(level, 4);
      else if (level < 2 && outs >= 8) level = Math.max(level, 2);
      else if (level < 1 && outs >= 4) level = 1;
    }

    result.level = level;
    result.name = name;
    return result;
  }

  PA.Evaluator = { evaluate, categoryOf, analyze, straightHigh, CATEGORY_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = PA.Evaluator;
})(typeof globalThis !== 'undefined' ? globalThis : this);
