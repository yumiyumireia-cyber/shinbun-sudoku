/* しんぶん数独 — 数独のしくみ（解く・作る・むずかしさを決める）
   盤面は 81 マスの数字の並び（0 = 空欄）。左上から右へ、1行ずつ。 */
(function (root) {
  'use strict';

  var ROW = [], COL = [], BOX = [], UNITS = [], PEERS = [];
  var i, r, c, b;
  for (i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0; COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }
  for (r = 0; r < 9; r++) { var ur = []; for (c = 0; c < 9; c++) ur.push(r * 9 + c); UNITS.push(ur); }
  for (c = 0; c < 9; c++) { var uc = []; for (r = 0; r < 9; r++) uc.push(r * 9 + c); UNITS.push(uc); }
  for (b = 0; b < 9; b++) {
    var ub = [], br = ((b / 3) | 0) * 3, bc = (b % 3) * 3;
    for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) ub.push((br + r) * 9 + bc + c);
    UNITS.push(ub);
  }
  for (i = 0; i < 81; i++) {
    var p = [];
    for (var j = 0; j < 81; j++) {
      if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) p.push(j);
    }
    PEERS.push(p);
  }

  var ALL = 0x3FE;               // 1〜9 のビット
  function bit(d) { return 1 << d; }
  function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }
  function digitsOf(m) { var a = []; for (var d = 1; d <= 9; d++) if (m & (1 << d)) a.push(d); return a; }
  function firstDigit(m) { for (var d = 1; d <= 9; d++) if (m & (1 << d)) return d; return 0; }

  function shuffle(a) {
    for (var k = a.length - 1; k > 0; k--) { var j = (Math.random() * (k + 1)) | 0; var t = a[k]; a[k] = a[j]; a[j] = t; }
    return a;
  }

  // 同じ列・行・ブロックに同じ数字があるマス
  function conflicts(g) {
    var bad = new Array(81).fill(false);
    UNITS.forEach(function (u) {
      for (var a = 0; a < 9; a++) {
        var x = g[u[a]]; if (!x) continue;
        for (var k = a + 1; k < 9; k++) if (g[u[k]] === x) { bad[u[a]] = true; bad[u[k]] = true; }
      }
    });
    return bad;
  }

  // 置ける数字の候補（空欄だけ）
  function candidates(g) {
    var cand = new Array(81).fill(0);
    for (var k = 0; k < 81; k++) {
      if (g[k]) continue;
      var m = ALL;
      PEERS[k].forEach(function (q) { if (g[q]) m &= ~bit(g[q]); });
      cand[k] = m;
    }
    return cand;
  }

  // 答えを数える（limit まで）。out を渡すと最初の答えを入れる
  function countSolutions(g, limit, out, randomOrder) {
    var a = g.slice(), rm = [0,0,0,0,0,0,0,0,0], cm = rm.slice(), bm = rm.slice();
    for (var k = 0; k < 81; k++) {
      var d = a[k]; if (!d) continue;
      var m = bit(d);
      if ((rm[ROW[k]] | cm[COL[k]] | bm[BOX[k]]) & m) return 0;
      rm[ROW[k]] |= m; cm[COL[k]] |= m; bm[BOX[k]] |= m;
    }
    var count = 0;
    (function rec() {
      var best = -1, bestMask = 0, bestN = 10;
      for (var k = 0; k < 81; k++) {
        if (a[k]) continue;
        var m = ALL & ~(rm[ROW[k]] | cm[COL[k]] | bm[BOX[k]]);
        var n = popcount(m);
        if (n === 0) return;
        if (n < bestN) { best = k; bestMask = m; bestN = n; if (n === 1) break; }
      }
      if (best < 0) {
        count++;
        if (out && count === 1) for (var q = 0; q < 81; q++) out[q] = a[q];
        return;
      }
      var ds = digitsOf(bestMask);
      if (randomOrder) shuffle(ds);
      for (var t = 0; t < ds.length; t++) {
        var mm = bit(ds[t]), R = ROW[best], C = COL[best], B = BOX[best];
        a[best] = ds[t]; rm[R] |= mm; cm[C] |= mm; bm[B] |= mm;
        rec();
        a[best] = 0; rm[R] &= ~mm; cm[C] &= ~mm; bm[B] &= ~mm;
        if (count >= limit) return;
      }
    })();
    return count;
  }

  // 答えを調べる：{ status: 'ok' | 'none' | 'many', solution }
  function analyze(g) {
    var out = new Array(81).fill(0);
    var n = countSolutions(g, 2, out);
    if (n === 0) return { status: 'none', solution: null };
    if (n > 1) return { status: 'many', solution: out };
    return { status: 'ok', solution: out };
  }

  function fullGrid() {
    var out = new Array(81).fill(0);
    countSolutions(new Array(81).fill(0), 1, out, true);
    return out;
  }

  /* ---------- むずかしさを決める（人の解き方で解いてみる） ----------
     1 = 「ここしか入らない」だけで解ける
     2 = 候補のしぼりこみ（ブロックと列の関係・2つ組）が要る
     3 = 3つ組・X-wing・XY-wing・Swordfish が要る
     4 = それでも解けない（当てずっぽうが要る。アプリでは出さない） */
  function grade(givens) {
    var v = givens.slice(), cand = candidates(v);
    var level = 1;

    function place(k, d) {
      v[k] = d; cand[k] = 0;
      var m = ~bit(d);
      PEERS[k].forEach(function (q) { cand[q] &= m; });
    }
    function solved() { for (var k = 0; k < 81; k++) if (!v[k]) return false; return true; }

    function singles() {
      var moved = false;
      for (var k = 0; k < 81; k++) {
        if (!v[k] && popcount(cand[k]) === 1) { place(k, firstDigit(cand[k])); moved = true; }
      }
      for (var u = 0; u < 27; u++) {
        var U = UNITS[u];
        for (var d = 1; d <= 9; d++) {
          var where = -1, n = 0, m = bit(d);
          for (var t = 0; t < 9; t++) if (cand[U[t]] & m) { n++; where = U[t]; }
          if (n === 1) { place(where, d); moved = true; }
        }
      }
      return moved;
    }

    function eliminate(cells, m) {
      var hit = false;
      cells.forEach(function (k) { if (cand[k] & m) { cand[k] &= ~m; hit = true; } });
      return hit;
    }

    function locked() {
      var hit = false;
      for (var bx = 0; bx < 9; bx++) {
        var U = UNITS[18 + bx];
        for (var d = 1; d <= 9; d++) {
          var m = bit(d), cells = U.filter(function (k) { return cand[k] & m; });
          if (cells.length < 2) continue;
          var rr = ROW[cells[0]], cc = COL[cells[0]];
          if (cells.every(function (k) { return ROW[k] === rr; })) {
            hit = eliminate(UNITS[rr].filter(function (k) { return BOX[k] !== bx; }), m) || hit;
          }
          if (cells.every(function (k) { return COL[k] === cc; })) {
            hit = eliminate(UNITS[9 + cc].filter(function (k) { return BOX[k] !== bx; }), m) || hit;
          }
        }
      }
      for (var u = 0; u < 18; u++) {
        var L = UNITS[u];
        for (var d2 = 1; d2 <= 9; d2++) {
          var m2 = bit(d2), cs = L.filter(function (k) { return cand[k] & m2; });
          if (cs.length < 2) continue;
          var bb = BOX[cs[0]];
          if (cs.every(function (k) { return BOX[k] === bb; })) {
            hit = eliminate(UNITS[18 + bb].filter(function (k) { return L.indexOf(k) < 0; }), m2) || hit;
          }
        }
      }
      return hit;
    }

    // n 個組（naked / hidden）。n = 2 か 3
    function subsets(n) {
      var hit = false;
      for (var u = 0; u < 27; u++) {
        var U = UNITS[u];
        var empt = U.filter(function (k) { return !v[k]; });
        if (empt.length <= n) continue;
        // naked
        var pool = empt.filter(function (k) { var p = popcount(cand[k]); return p >= 2 && p <= n; });
        combos(pool, n).forEach(function (set) {
          var m = 0; set.forEach(function (k) { m |= cand[k]; });
          if (popcount(m) === n) hit = eliminate(empt.filter(function (k) { return set.indexOf(k) < 0; }), m) || hit;
        });
        // hidden
        var ds = [];
        for (var d = 1; d <= 9; d++) {
          var cnt = empt.filter(function (k) { return cand[k] & bit(d); }).length;
          if (cnt >= 2 && cnt <= n) ds.push(d);
        }
        combos(ds, n).forEach(function (set) {
          var dm = 0; set.forEach(function (d) { dm |= bit(d); });
          var cells = empt.filter(function (k) { return cand[k] & dm; });
          if (cells.length === n) {
            cells.forEach(function (k) { if (cand[k] & ~dm) { cand[k] &= dm; hit = true; } });
          }
        });
      }
      return hit;
    }

    // X-wing（size 2）と Swordfish（size 3）
    function fish(size) {
      var hit = false;
      for (var d = 1; d <= 9; d++) {
        var m = bit(d);
        for (var dir = 0; dir < 2; dir++) {
          var lines = [];
          for (var a = 0; a < 9; a++) {
            var L = UNITS[dir * 9 + a], pos = 0;
            for (var t = 0; t < 9; t++) if (cand[L[t]] & m) pos |= 1 << t;
            var n = popcount(pos);
            if (n >= 2 && n <= size) lines.push({ a: a, pos: pos });
          }
          combos(lines, size).forEach(function (set) {
            var u = 0, base = set.map(function (s) { u |= s.pos; return s.a; });
            if (popcount(u) !== size) return;
            for (var t = 0; t < 9; t++) {
              if (!(u & (1 << t))) continue;
              hit = eliminate(UNITS[(1 - dir) * 9 + t].filter(function (k) {
                return base.indexOf(dir === 0 ? ROW[k] : COL[k]) < 0;
              }), m) || hit;
            }
          });
        }
      }
      return hit;
    }

    function isPeer(a, b2) { return ROW[a] === ROW[b2] || COL[a] === COL[b2] || BOX[a] === BOX[b2]; }

    // XY-wing：候補2つのマス3つで、はさまれたマスから消す
    function xywing() {
      var hit = false;
      for (var pv = 0; pv < 81; pv++) {
        if (v[pv] || popcount(cand[pv]) !== 2) continue;
        var wings = PEERS[pv].filter(function (k) {
          return !v[k] && popcount(cand[k]) === 2 && popcount(cand[k] & cand[pv]) === 1;
        });
        for (var x = 0; x < wings.length; x++) {
          for (var y = x + 1; y < wings.length; y++) {
            var A = wings[x], B = wings[y];
            var shared = cand[A] & cand[B] & ~cand[pv];
            if (popcount(shared) !== 1 || (cand[A] & cand[pv]) === (cand[B] & cand[pv])) continue;
            hit = eliminate(PEERS[A].filter(function (k) {
              return k !== B && k !== pv && isPeer(k, B);
            }), shared) || hit;
          }
        }
      }
      return hit;
    }

    for (var guard = 0; guard < 500; guard++) {
      if (solved()) return level;
      for (var k = 0; k < 81; k++) if (!v[k] && !cand[k]) return 4;  // 行きづまり（ふつうは無い）
      if (singles()) continue;
      if (locked() || subsets(2)) { level = Math.max(level, 2); continue; }
      if (subsets(3) || fish(2) || xywing() || fish(3)) { level = Math.max(level, 3); continue; }
      return 4;
    }
    return 4;
  }

  function combos(arr, n) {
    var out = [];
    (function rec(start, acc) {
      if (acc.length === n) { out.push(acc.slice()); return; }
      for (var k = start; k < arr.length; k++) { acc.push(arr[k]); rec(k + 1, acc); acc.pop(); }
    })(0, []);
    return out;
  }

  // 答えを1つに保ったまま、点対称に数字を抜けるだけ抜く
  function minimize(sol) {
    var g = sol.slice(), order = [];
    for (var k = 0; k <= 40; k++) order.push(k);
    shuffle(order);
    order.forEach(function (k) {
      var k2 = 80 - k, a = g[k], b2 = g[k2];
      g[k] = 0; g[k2] = 0;
      if (countSolutions(g, 2) !== 1) { g[k] = a; g[k2] = b2; }
    });
    return g;
  }

  function clueCount(g) { var n = 0; for (var k = 0; k < 81; k++) if (g[k]) n++; return n; }

  // 答えから数字を足して、目標の数まで増やす（やさしくする）
  function addClues(g, sol, target) {
    var empties = [];
    for (var k = 0; k <= 40; k++) if (!g[k]) empties.push(k);
    shuffle(empties);
    for (var t = 0; t < empties.length && clueCount(g) < target; t++) {
      var k1 = empties[t]; g[k1] = sol[k1]; g[80 - k1] = sol[80 - k1];
    }
    return g;
  }

  var LEVELS = {
    1: { name: 'やさしい',     want: function (gr) { return gr === 1; }, clues: 38 },
    2: { name: 'ふつう',       want: function (gr) { return gr === 1; }, clues: 30 },
    3: { name: 'むずかしい',   want: function (gr) { return gr === 2; }, clues: 0 },
    4: { name: 'かなり難しい', want: function (gr) { return gr === 3; }, clues: 0 }
  };

  // 問題を作る：{ givens, solution, level, grade }
  function generate(level, timeLimitMs) {
    var L = LEVELS[level] || LEVELS[2];
    var start = Date.now(), limit = timeLimitMs || 8000, best = null;
    for (var tries = 0; tries < 400; tries++) {
      var sol = fullGrid(), puz = minimize(sol), gr = grade(puz);
      if (L.want(gr)) {
        if (L.clues) addClues(puz, sol, L.clues);
        return { givens: puz, solution: sol, level: level, grade: gr };
      }
      // 時間切れのときに使う「いちばん近いもの」
      var dist = Math.abs(gr - (level <= 2 ? 1 : level === 3 ? 2 : 3));
      if (!best || dist < best.dist) best = { givens: puz, solution: sol, grade: gr, dist: dist };
      if (Date.now() - start > limit) break;
    }
    if (L.clues) addClues(best.givens, best.solution, L.clues);
    return { givens: best.givens, solution: best.solution, level: level, grade: best.grade };
  }

  var api = {
    ROW: ROW, COL: COL, BOX: BOX, UNITS: UNITS, PEERS: PEERS,
    conflicts: conflicts, candidates: candidates, countSolutions: countSolutions,
    analyze: analyze, grade: grade, generate: generate, digitsOf: digitsOf,
    popcount: popcount, clueCount: clueCount, LEVELS: LEVELS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sudoku = api;

  // Web Worker として読み込まれたときは、問題作りを引き受ける
  if (typeof window === 'undefined' && typeof importScripts === 'function') {
    self.onmessage = function (e) {
      var d = e.data || {};
      self.postMessage({ id: d.id, result: generate(d.level, d.timeLimitMs) });
    };
  }
})(this);
