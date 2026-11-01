/* しんぶん数独 — 画面の動き */
(function () {
  'use strict';

  var S = window.Sudoku;
  var KEY_GAMES = 'sudoku-v1:games', KEY_SET = 'sudoku-v1:settings';
  var LEVEL_NAME = { 1: 'やさしい', 2: 'ふつう', 3: 'むずかしい', 4: 'かなり難しい' };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 保存（このスマホの中だけ） ---------- */
  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  var games = load(KEY_GAMES, []);
  var settings = load(KEY_SET, { check: false });

  function saveGames() {
    // 多すぎたら、できた問題の古いものから片づける
    games.sort(function (a, b) { return b.updated - a.updated; });
    var done = games.filter(function (g) { return g.done; });
    if (done.length > 20) {
      var drop = done.slice(20).map(function (g) { return g.id; });
      games = games.filter(function (g) { return drop.indexOf(g.id) < 0; });
    }
    if (games.length > 40) games = games.slice(0, 40);
    if (!save(KEY_GAMES, games)) toast('保存できませんでした（容量がいっぱいかも）');
  }

  /* ---------- 画面の切りかえ ---------- */
  var current = 'home';
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('on', s.id === id); });
    current = id;
    fit();
    window.scrollTo(0, 0);
    if (id === 'home') renderHome();
  }
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (current === 'play') persistPlay();
      show(b.getAttribute('data-go'));
    });
  });

  // 盤面の大きさを画面に合わせる
  function fit() {
    var reserve = current === 'play' ? 290 : current === 'edit' ? 330 : 0;
    var w = Math.min(window.innerWidth - 16, 560);
    var s = reserve ? Math.min(w, window.innerHeight - reserve) : w;
    s = Math.max(270, Math.floor(s / 9) * 9);
    document.documentElement.style.setProperty('--board', s + 'px');
    if (current === 'corners') drawCorners();
  }
  window.addEventListener('resize', fit);

  /* ---------- 小窓・お知らせ ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, 2600);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ask('文', [{label, value, cls}]) → 押したボタンの value
  function ask(html, buttons) {
    return new Promise(function (resolve) {
      var sh = $('sheet');
      sh.innerHTML = html + buttons.map(function (b, i) {
        return '<button class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + esc(b.label) + '</button>';
      }).join('');
      $('overlay').classList.remove('hidden');
      sh.querySelectorAll('button[data-i]').forEach(function (btn) {
        btn.onclick = function () { closeSheet(); resolve(buttons[+btn.getAttribute('data-i')].value); };
      });
    });
  }
  function busy(msg) {
    $('sheet').innerHTML = '<div class="spinner"></div><p>' + esc(msg) + '</p>';
    $('overlay').classList.remove('hidden');
  }
  function closeSheet() { $('overlay').classList.add('hidden'); }

  /* ---------- 盤面を描く ---------- */
  function makeBoard(el, onTap) {
    el.innerHTML = '';
    var cells = [];
    for (var i = 0; i < 81; i++) {
      var d = document.createElement('div');
      d.className = 'cell r' + ((i / 9) | 0) + ' c' + (i % 9);
      d.dataset.i = i;
      el.appendChild(d); cells.push(d);
    }
    el.addEventListener('click', function (e) {
      var c = e.target.closest('.cell'); if (c) onTap(+c.dataset.i);
    });
    return cells;
  }

  // o: { values, fixed, memos, colors, sel, err, doubt, hinted, memoHL }
  function paint(cells, o) {
    var selVal = o.sel >= 0 ? o.values[o.sel] : 0;
    for (var i = 0; i < 81; i++) {
      var c = cells[i], v = o.values[i], cls = 'cell r' + ((i / 9) | 0) + ' c' + (i % 9);
      if (o.sel >= 0 && i !== o.sel && (S.ROW[i] === S.ROW[o.sel] || S.COL[i] === S.COL[o.sel] || S.BOX[i] === S.BOX[o.sel])) cls += ' peer';
      if (selVal && v === selVal && i !== o.sel) cls += ' same';
      if (i === o.sel) cls += ' sel';
      if (o.colors && o.colors[i]) cls += ' colored';
      if (v) cls += o.fixed[i] ? ' given' : ' user';
      if (o.err && o.err[i]) cls += ' err';
      if (o.doubt && o.doubt[i]) cls += ' doubt';
      if (o.hinted && o.hinted[i] && !o.fixed[i]) cls += ' hinted';
      if (c.className.indexOf('flash') >= 0 && o.flash === i) cls += ' flash';
      c.className = cls;
      var html = '';
      if (v) html = String(v);
      else if (o.memos && o.memos[i]) {
        html = '<div class="memo">';
        for (var d = 1; d <= 9; d++) {
          var on = o.memos[i] & (1 << d);
          html += '<i' + (on && selVal === d ? ' class="hl"' : '') + '>' + (on ? d : '') + '</i>';
        }
        html += '</div>';
      }
      if (c.innerHTML !== html) c.innerHTML = html;
    }
  }

  function makePad(el, onNum) {
    var html = '';
    for (var d = 1; d <= 9; d++) html += '<button class="num" data-n="' + d + '">' + d + '</button>';
    html += '<button class="num erase" data-n="0">⌫<br>けす</button>';
    el.innerHTML = html;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.num'); if (b) onNum(+b.dataset.n);
    });
  }

  /* ---------- ホーム ---------- */
  function renderHome() {
    var list = games.filter(function (g) { return !g.done; }).sort(function (a, b) { return b.updated - a.updated; });
    $('contEmpty').classList.toggle('hidden', list.length > 0);
    $('contList').innerHTML = list.map(function (g) {
      var left = 0; for (var i = 0; i < 81; i++) if (!g.vals[i]) left++;
      var dt = new Date(g.created);
      var when = (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + dt.getHours() + ':' + ('0' + dt.getMinutes()).slice(-2);
      return '<li><button class="open" data-id="' + g.id + '"><b>' + esc(g.title) + '</b><span>' + when + '・あと ' + left + ' マス</span></button>' +
             '<button class="del" data-del="' + g.id + '">🗑 けす</button></li>';
    }).join('');
  }
  $('contList').addEventListener('click', function (e) {
    var o = e.target.closest('[data-id]'), d = e.target.closest('[data-del]');
    if (o) openGame(o.getAttribute('data-id'));
    if (d) {
      var id = d.getAttribute('data-del'), g = games.find(function (x) { return x.id === id; });
      ask('<h2>この問題をけしますか？</h2><p>「' + esc(g.title) + '」<br>途中まで解いた分も消えます。</p>',
          [{ label: 'けす', value: true, cls: 'primary' }, { label: 'やめる', value: false }]).then(function (yes) {
        if (!yes) return;
        games = games.filter(function (x) { return x.id !== id; });
        saveGames(); renderHome();
      });
    }
  });

  document.querySelectorAll('.lv').forEach(function (b) {
    b.addEventListener('click', function () { newGenerated(+b.dataset.level); });
  });

  function makePuzzle(level) {
    return new Promise(function (resolve) {
      var done = false;
      function fallback() { if (!done) { done = true; resolve(S.generate(level, 6000)); } }
      try {
        var w = new Worker('sudoku.js');
        w.onmessage = function (e) { if (!done) { done = true; resolve(e.data.result); } w.terminate(); };
        w.onerror = function () { w.terminate(); fallback(); };
        w.postMessage({ level: level, timeLimitMs: 6000 });
      } catch (e) { fallback(); }
    });
  }

  function newGenerated(level) {
    busy('「' + LEVEL_NAME[level] + '」の問題を作っています…');
    makePuzzle(level).then(function (r) {
      closeSheet();
      var g = newGame({ src: 'gen', level: level, title: '🎲 ' + LEVEL_NAME[level], givens: r.givens, solution: r.solution, status: 'ok' });
      startPlay(g);
    });
  }

  function newGame(o) {
    var g = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      src: o.src, level: o.level || 0, title: o.title, created: Date.now(), updated: Date.now(),
      givens: o.givens.slice(), solution: o.solution ? o.solution.slice() : null, status: o.status,
      vals: o.givens.slice(), memos: new Array(81).fill(0), colors: (o.colors || new Array(81).fill(0)).slice(),
      hinted: new Array(81).fill(0), hints: 0, elapsed: 0, done: false
    };
    games.push(g); saveGames();
    return g;
  }

  function openGame(id) {
    var g = games.find(function (x) { return x.id === id; });
    if (g) startPlay(g);
  }

  /* ---------- 写真を取りこむ ---------- */
  var photoCanvas = null, quad = null;
  $('btnCamera').onclick = function () { $('fileCamera').value = ''; $('fileCamera').click(); };
  $('btnPick').onclick = function () { $('filePick').value = ''; $('filePick').click(); };
  $('btnRetake').onclick = function () { $('fileCamera').value = ''; $('fileCamera').click(); };
  ['fileCamera', 'filePick'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) usePhoto(f);
    });
  });

  function usePhoto(file) {
    busy('写真を見ています…');
    OCR.loadImage(file).then(function (cv) {
      photoCanvas = cv;
      setTimeout(function () {
        quad = OCR.findCorners(cv);
        closeSheet();
        $('cornerGuide').innerHTML = quad.found
          ? '盤面の<b>四すみ</b>に ● が合っているか見てね<br><small>ずれていたら ● を指で動かせます</small>'
          : '盤面が見つかりませんでした。<br>● を指で動かして、<b>四すみ</b>に合わせてね';
        show('corners');
      }, 30);
    }).catch(function () {
      closeSheet();
      toast('写真を開けませんでした');
    });
  }

  /* ---------- 四すみ合わせ ---------- */
  var cv2 = $('cornerCanvas'), view = { s: 1 }, dragging = -1;
  function drawCorners() {
    if (!photoCanvas || !quad) return;
    var maxW = Math.min(window.innerWidth - 16, 584), maxH = window.innerHeight - 250;
    var s = Math.min(maxW / photoCanvas.width, Math.max(260, maxH) / photoCanvas.height);
    var w = Math.round(photoCanvas.width * s), h = Math.round(photoCanvas.height * s), dpr = window.devicePixelRatio || 1;
    view.s = s;
    cv2.style.width = w + 'px'; cv2.style.height = h + 'px';
    if (cv2.width !== Math.round(w * dpr)) { cv2.width = Math.round(w * dpr); cv2.height = Math.round(h * dpr); }
    var ctx = cv2.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(photoCanvas, 0, 0, w, h);
    var P = quad.map(function (p) { return [p[0] * s, p[1] * s]; });
    // 9×9 のマス目を重ねて見せる
    var H = OCR.homography(P, 9);
    ctx.lineWidth = 1.5;
    for (var k = 0; k <= 9; k++) {
      ctx.strokeStyle = k % 3 === 0 ? 'rgba(37,99,201,.95)' : 'rgba(37,99,201,.55)';
      ctx.lineWidth = k % 3 === 0 ? 2.5 : 1.2;
      var a = OCR.mapPoint(H, k, 0), b = OCR.mapPoint(H, k, 9);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      a = OCR.mapPoint(H, 0, k); b = OCR.mapPoint(H, 9, k);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    P.forEach(function (p, i) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, Math.PI * 2);
      ctx.fillStyle = i === dragging ? 'rgba(255,122,0,.85)' : 'rgba(37,99,201,.75)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
    // 動かしている間は、指の下を虫めがねで見せる
    if (dragging >= 0) {
      var p = P[dragging], R = 58, z = 3;
      var cx = p[0] < w / 2 ? w - R - 8 : R + 8, cy = R + 8;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      var sx = quad[dragging][0], sy = quad[dragging][1], half = R / z / s;
      ctx.drawImage(photoCanvas, sx - half, sy - half, half * 2, half * 2, cx - R, cy - R, R * 2, R * 2);
      ctx.strokeStyle = 'rgba(255,122,0,.95)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  function pos(e) {
    var r = cv2.getBoundingClientRect();
    return [(e.clientX - r.left) / view.s, (e.clientY - r.top) / view.s];
  }
  cv2.addEventListener('pointerdown', function (e) {
    var p = pos(e), best = -1, bd = 1e9;
    quad.forEach(function (q, i) {
      var d = Math.hypot((q[0] - p[0]) * view.s, (q[1] - p[1]) * view.s);
      if (d < bd) { bd = d; best = i; }
    });
    if (bd < 60) { dragging = best; cv2.setPointerCapture(e.pointerId); drawCorners(); e.preventDefault(); }
  });
  cv2.addEventListener('pointermove', function (e) {
    if (dragging < 0) return;
    var p = pos(e);
    quad[dragging] = [Math.max(0, Math.min(photoCanvas.width, p[0])), Math.max(0, Math.min(photoCanvas.height, p[1]))];
    drawCorners();
  });
  function endDrag() { if (dragging >= 0) { dragging = -1; drawCorners(); } }
  cv2.addEventListener('pointerup', endDrag);
  cv2.addEventListener('pointercancel', endDrag);

  $('btnRead').onclick = function () {
    busy('数字を読みとっています…');
    setTimeout(function () {
      var res;
      try { res = OCR.read(photoCanvas, quad); } catch (e) { res = null; }
      closeSheet();
      if (!res) { toast('読みとれませんでした。● の位置を見なおしてね'); return; }
      openEdit({
        digits: res.digits, doubt: res.doubt, colors: res.colors.map(function (b) { return b ? 1 : 0; }),
        feats: res.feats, photo: res.photo
      });
    }, 40);
  };

  /* ---------- 確かめ・手直し ---------- */
  var ed = null, edCells = makeBoard($('editBoard'), function (i) {
    if (ed.colorMode) { ed.colors[i] = ed.colors[i] ? 0 : 1; }
    else ed.sel = ed.sel === i ? -1 : i;
    paintEdit();
  });
  makePad($('editPad'), function (n) {
    if (ed.colorMode) { toast('色マスモードです。終わったら「色マスをつける」をもう一度押してね'); return; }
    if (ed.sel < 0) { toast('先に、直したいマスをタップしてね'); return; }
    ed.digits[ed.sel] = n; ed.doubt[ed.sel] = false;
    paintEdit();
  });

  function openEdit(o) {
    ed = {
      digits: o.digits.slice(), ocr: o.digits.slice(), doubt: o.doubt ? o.doubt.slice() : new Array(81).fill(false),
      colors: o.colors ? o.colors.slice() : new Array(81).fill(0), feats: o.feats || null, photo: o.photo || null,
      sel: -1, colorMode: false, showPhoto: false
    };
    ed.wasDoubt = ed.doubt.slice();
    var hasPhoto = !!ed.photo;
    $('editTitle').textContent = hasPhoto ? '読みとり結果' : '数字を入れる';
    $('editNote').textContent = hasPhoto
      ? '数字が合っているか確かめてね。ちがうマスはタップして直せます。'
      : '新聞に最初から入っている数字を入れてね。マスをタップ → 数字。';
    $('btnPhoto').classList.toggle('hidden', !hasPhoto);
    $('btnPhoto').parentNode.style.gridTemplateColumns = hasPhoto ? 'repeat(2, 1fr)' : '1fr';
    $('editPhoto').src = ed.photo || '';
    show('edit');
    paintEdit();
  }

  function paintEdit() {
    var bad = S.conflicts(ed.digits);
    paint(edCells, {
      values: ed.digits, fixed: ed.digits.map(Boolean), colors: ed.colors, sel: ed.sel,
      err: bad, doubt: ed.doubt
    });
    $('editBoard').classList.toggle('hidden', ed.showPhoto);
    $('editPhoto').classList.toggle('hidden', !ed.showPhoto);
    $('btnPhoto').innerHTML = ed.showPhoto ? '<span class="ic">🔢</span>読みとり結果を見る' : '<span class="ic">📷</span>写真と見くらべる';
    $('btnColorMode').classList.toggle('on', ed.colorMode);
    $('editPad').style.opacity = ed.colorMode ? '.35' : '';
    $('editMode').textContent = ed.colorMode ? '🟧 色マスにしたいマスをタップ（もう一度で外れる）' : '';
    var n = S.clueCount(ed.digits), doubts = ed.doubt.filter(function (d, i) { return d && ed.digits[i]; }).length;
    var nBad = bad.filter(Boolean).length, nColor = ed.colors.filter(Boolean).length;
    var msg = '数字 ' + n + ' こ';
    if (nColor) msg += '・色マス ' + nColor + ' こ';
    if (doubts) msg += '・自信のないマス ' + doubts + ' こ';
    $('editStatus').className = 'status' + (nBad ? ' bad' : '');
    $('editStatus').textContent = nBad ? '同じ列・行・ブロックに同じ数字があります（赤い数字）' : msg;
  }

  $('btnPhoto').onclick = function () { ed.showPhoto = !ed.showPhoto; paintEdit(); };
  $('btnColorMode').onclick = function () { ed.colorMode = !ed.colorMode; ed.sel = -1; ed.showPhoto = false; paintEdit(); };
  $('btnHand').onclick = function () { photoCanvas = null; openEdit({ digits: new Array(81).fill(0) }); };

  $('btnStart').onclick = function () {
    var g = ed.digits;
    if (S.conflicts(g).some(Boolean)) { toast('赤い数字を直してね'); return; }
    if (S.clueCount(g) < 17) { toast('数字が少なすぎます（17こ以上いります）'); return; }
    var an = S.analyze(g);
    if (an.status === 'none') {
      ask('<h2>このままだと解けません</h2><p>どこかに読みまちがいがあるかも。<br>「写真と見くらべる」で確かめてね。</p>',
          [{ label: 'もどって直す', value: 1, cls: 'primary' }]);
      return;
    }
    var go = an.status === 'ok' ? Promise.resolve(true) : ask(
      '<h2>答えが1つに決まりません</h2><p>読みもれの数字があるかも。<br>このまま遊ぶと「まちがいチェック」と「ヒント」は使えません。</p>',
      [{ label: 'もどって直す', value: false, cls: 'primary' }, { label: 'このまま遊ぶ', value: true }]);
    go.then(function (yes) {
      if (!yes) return;
      learnFromEdit();
      var dt = new Date();
      var title = (ed.photo ? '📰 新聞 ' : '✏️ 手入力 ') + (dt.getMonth() + 1) + '/' + dt.getDate();
      var game = newGame({ src: ed.photo ? 'photo' : 'hand', title: title, givens: g, solution: an.status === 'ok' ? an.solution : null,
                           status: an.status, colors: ed.colors });
      ed = null; photoCanvas = null;     // 写真はここで手放す（保存しない）
      startPlay(game);
    });
  };

  // 直したマスと、自信がなかったけど合っていたマスの字を覚える
  function learnFromEdit() {
    if (!ed.feats) return;
    for (var i = 0; i < 81; i++) {
      var f = ed.feats[i], d = ed.digits[i];
      if (!f || !d) continue;
      if (d !== ed.ocr[i] || ed.wasDoubt[i]) OCR.learn(f, d);
    }
  }

  /* ---------- 解く ---------- */
  var g = null, sel = -1, memoMode = false, colorMode = false, history = [], lastFlash = -1;
  var playCells = makeBoard($('playBoard'), function (i) {
    if (colorMode) { g.colors[i] = g.colors[i] ? 0 : 1; paintPlay(); persistPlay(); return; }
    sel = sel === i ? -1 : i; paintPlay();
  });
  makePad($('playPad'), function (n) { input(n); });

  function startPlay(game) {
    g = game; sel = -1; memoMode = false; colorMode = false; history = [];
    if (!g.colors) g.colors = new Array(81).fill(0);
    $('playTitle').textContent = g.title;
    $('btnHint').disabled = !g.solution;
    $('btnCheck').disabled = !g.solution;
    show('play');
    paintPlay();
  }

  function snapshot() { history.push({ v: g.vals.slice(), m: g.memos.slice() }); if (history.length > 300) history.shift(); }

  function input(n) {
    if (!g || g.done) return;
    if (colorMode) { toast('色マスモードです。終わったら🟧をもう一度押してね'); return; }
    if (sel < 0) { toast('先にマスをタップしてね'); return; }
    if (g.givens[sel]) { toast('最初から入っている数字は変えられません'); return; }
    if (n === 0) {
      if (!g.vals[sel] && !g.memos[sel]) return;
      snapshot(); g.vals[sel] = 0; g.memos[sel] = 0; g.hinted[sel] = 0;
    } else if (memoMode) {
      if (g.vals[sel]) { toast('数字が入っているマスにはメモできません'); return; }
      snapshot(); g.memos[sel] ^= (1 << n);
    } else {
      if (g.vals[sel] === n) { snapshot(); g.vals[sel] = 0; }
      else {
        snapshot(); g.vals[sel] = n; g.memos[sel] = 0; g.hinted[sel] = 0;
        // 同じ列・行・ブロックのメモから、その数字を消しておく
        S.PEERS[sel].forEach(function (k) { g.memos[k] &= ~(1 << n); });
      }
    }
    changed();
  }

  function changed() {
    g.updated = Date.now();
    paintPlay();
    checkClear();
    persistPlay();
  }

  function persistPlay() { if (g) { g.updated = Date.now(); saveGames(); } }

  function paintPlay() {
    var err = new Array(81).fill(false);
    if (settings.check && g.solution) {
      for (var i = 0; i < 81; i++) if (g.vals[i] && !g.givens[i] && g.vals[i] !== g.solution[i]) err[i] = true;
    }
    paint(playCells, {
      values: g.vals, fixed: g.givens.map(Boolean), memos: g.memos, colors: g.colors, sel: sel,
      err: err, hinted: g.hinted, flash: lastFlash
    });
    $('btnMemo').classList.toggle('on', memoMode);
    $('btnCheck').classList.toggle('on', !!(settings.check && g.solution));
    $('btnUndo').disabled = !history.length;
    $('btnPlayColor').classList.toggle('on', colorMode);
    $('playPad').classList.toggle('memo-mode', memoMode);
    $('playPad').style.opacity = colorMode ? '.35' : '';
    $('playMode').textContent = colorMode ? '🟧 色マスにしたいマスをタップ（もう一度で外れる）'
      : memoMode ? '✏️ メモ中：数字を押すと小さく書きこみます' : '';
    // 9こ全部置いた数字はうすくする
    var cnt = new Array(10).fill(0);
    g.vals.forEach(function (v) { if (v) cnt[v]++; });
    $('playPad').querySelectorAll('.num').forEach(function (b) {
      var n = +b.dataset.n; b.classList.toggle('used', n > 0 && cnt[n] >= 9);
    });
  }

  $('btnUndo').onclick = function () {
    var h = history.pop(); if (!h) return;
    g.vals = h.v; g.memos = h.m; changed();
  };
  $('btnMemo').onclick = function () { memoMode = !memoMode; colorMode = false; paintPlay(); };
  $('btnPlayColor').onclick = function () {
    if (g && g.done) return;
    colorMode = !colorMode; memoMode = false; sel = -1; paintPlay();
  };
  $('btnCheck').onclick = function () {
    settings.check = !settings.check; save(KEY_SET, settings);
    toast(settings.check ? 'チェック ON：ちがう数字は赤' : 'チェック OFF');
    paintPlay();
  };

  $('btnHint').onclick = function () {
    if (!g || !g.solution || g.done) return;
    var target = -1, msg = '';
    if (sel >= 0 && !g.givens[sel] && g.vals[sel] !== g.solution[sel]) target = sel;
    if (target < 0) {
      for (var i = 0; i < 81; i++) if (g.vals[i] && !g.givens[i] && g.vals[i] !== g.solution[i]) { target = i; msg = 'ここがちがっていました'; break; }
    }
    if (target < 0) {
      // いちばん候補の少ないマスを教える
      var known = g.vals.map(function (v, k) { return v && v === g.solution[k] ? v : 0; });
      var cand = S.candidates(known), bestN = 10;
      for (var k = 0; k < 81; k++) {
        if (g.vals[k]) continue;
        var n = S.popcount(cand[k]);
        if (n < bestN) { bestN = n; target = k; }
      }
    }
    if (target < 0) return;
    snapshot();
    g.vals[target] = g.solution[target]; g.memos[target] = 0; g.hinted[target] = 1; g.hints++;
    S.PEERS[target].forEach(function (k) { g.memos[k] &= ~(1 << g.solution[target]); });
    sel = target; lastFlash = target;
    playCells[target].classList.add('flash');
    toast(msg ? '💡 ' + msg : '💡 ここは ' + g.solution[target] + ' です');
    changed();
    setTimeout(function () { lastFlash = -1; }, 1300);
  };

  function checkClear() {
    if (g.done) return;
    for (var i = 0; i < 81; i++) if (!g.vals[i]) return;
    var ok = g.solution ? g.vals.every(function (v, k) { return v === g.solution[k]; }) : !S.conflicts(g.vals).some(Boolean);
    if (!ok) {
      if (!settings.check) toast('全部うまったけど、どこかちがうみたい（まちがいチェックで確かめられます）');
      return;
    }
    g.done = true; sel = -1; persistPlay(); paintPlay();
    showClear();
  }

  function fmtTime(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h ? h + '時間' + (m % 60) + '分' : m < 1 ? '1分もかからず' : m + '分';
  }

  function showClear() {
    var html = '<div class="clear-emoji">🎉</div><h2>できました！</h2>';
    html += '<p>かかった時間：' + fmtTime(g.elapsed) + (g.hints ? '　ヒント ' + g.hints + ' 回' : '') + '</p>';
    var cs = [];
    for (var i = 0; i < 81; i++) if (g.colors[i]) cs.push(g.vals[i]);
    if (cs.length) {
      var sum = cs.reduce(function (a, b) { return a + b; }, 0);
      html += '<div class="colorsum">🟧 色マスの数字<br><b>' + cs.join('・') + '</b>' +
              (cs.length > 1 ? '<br>合計 <b>' + sum + '</b>' : '') + '</div>';
    }
    var buttons = [{ label: 'ホームへ', value: 'home', cls: 'primary' }];
    if (g.src === 'gen') buttons.unshift({ label: 'もう1問（' + LEVEL_NAME[g.level] + '）', value: 'again', cls: 'ok' });
    buttons.push({ label: '盤面をながめる', value: 'stay' });
    var lv = g.level;
    ask(html, buttons).then(function (v) {
      if (v === 'home') show('home');
      if (v === 'again') newGenerated(lv);
    });
  }

  // 解いている時間（画面を見ている間だけ数える）
  setInterval(function () {
    if (current === 'play' && g && !g.done && document.visibilityState === 'visible') {
      g.elapsed += 1000;
      if (g.elapsed % 15000 === 0) persistPlay();
    }
  }, 1000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'visible' && current === 'play') persistPlay(); });

  /* ---------- はじめに ---------- */
  renderHome();
  fit();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 使えない環境では何もしない */ });
  }
  window.__app = { openEdit: function (o) { openEdit(o); }, usePhoto: usePhoto };
})();
