/* しんぶん数独 — 写真から盤面を読む（ぜんぶスマホの中で。通信しない）
   1) 盤面の四すみを見つける  2) まっすぐに直す  3) 1マスずつ数字を読む  4) 色マスを探す */
(function (root) {
  'use strict';

  var WARP = 540;          // まっすぐに直した盤面の大きさ（1マス 60px）
  var FEAT = 20;           // 数字の特徴をくらべる大きさ（20×20）
  var LEARN_KEY = 'sudoku-v1:ocr-learn';

  /* ---------- 画像の読みこみ ---------- */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を開けませんでした')); };
      img.src = url;
    });
  }

  function grayOf(data, w, h) {
    var g = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    return g;
  }

  // まわりより暗いところ＝インク（影やムラに強い）
  function adaptive(gray, w, h, win, C) {
    var W = w + 1, sum = new Float64Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) { row += gray[y * w + x]; sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row; }
    }
    var out = new Uint8Array(w * h), r = win >> 1;
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
        var mean = s / ((x1 - x0) * (y1 - y0));
        out[y * w + x] = gray[y * w + x] < mean - C ? 1 : 0;
      }
    }
    return out;
  }

  // つながったインクのかたまりに番号をつける（8方向）
  function components(bin, w, h, wantExtremes) {
    var label = new Int32Array(w * h), comps = [], stack = new Int32Array(w * h), id = 0;
    for (var start = 0; start < bin.length; start++) {
      if (!bin[start] || label[start]) continue;
      id++;
      var c = { id: id, n: 0, x0: w, y0: h, x1: 0, y1: 0, sMin: 1e9, sMax: -1e9, dMin: 1e9, dMax: -1e9 };
      var sp = 0; stack[sp++] = start; label[start] = id;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p / w) | 0;
        c.n++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        if (wantExtremes) {
          var s = x + y, d = x - y;
          if (s < c.sMin) { c.sMin = s; c.tl = [x, y]; } if (s > c.sMax) { c.sMax = s; c.br = [x, y]; }
          if (d > c.dMax) { c.dMax = d; c.tr = [x, y]; } if (d < c.dMin) { c.dMin = d; c.bl = [x, y]; }
        }
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            var q = yy * w + xx;
            if (bin[q] && !label[q]) { label[q] = id; stack[sp++] = q; }
          }
        }
      }
      comps.push(c);
    }
    return { label: label, comps: comps };
  }

  /* ---------- 1) 四すみを見つける ---------- */
  function findCorners(canvas) {
    var max = 900, s = Math.min(1, max / Math.max(canvas.width, canvas.height));
    var w = Math.round(canvas.width * s), h = Math.round(canvas.height * s);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); ctx.drawImage(canvas, 0, 0, w, h);
    var gray = grayOf(ctx.getImageData(0, 0, w, h).data, w, h);
    var win = Math.max(15, (Math.min(w, h) / 30) | 1);
    var bin = adaptive(gray, w, h, win, 10);
    var cc = components(bin, w, h, true), minSide = Math.min(w, h);
    var best = null, bestScore = 0;
    cc.comps.forEach(function (c) {
      var bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw < minSide * 0.25 || bh < minSide * 0.25) return;
      var asp = bw / bh; if (asp < 0.55 || asp > 1.8) return;
      var dens = c.n / (bw * bh); if (dens > 0.45) return;
      // 盤面らしさ：横線・縦線を何本またぐか（外わくだけなら2本）
      var cross = crossings(cc.label, w, c);
      if (cross < 4) return;
      var score = bw * bh * Math.min(1, cross / 8);
      if (score > bestScore) { bestScore = score; best = c; }
    });
    var inv = 1 / s;
    if (!best) {
      // 見つからないときは、まん中に正方形を置いて、指で合わせてもらう
      var W = canvas.width, Hh = canvas.height, side = Math.min(W, Hh) * 0.8;
      var lx = (W - side) / 2, ty = (Hh - side) / 2;
      var fb = [[lx, ty], [lx + side, ty], [lx + side, ty + side], [lx, ty + side]];
      fb.found = false;
      return fb;
    }
    var pts = [best.tl, best.tr, best.br, best.bl].map(function (p) { return [p[0] * inv, p[1] * inv]; });
    pts.found = true;
    return pts;
  }

  function crossings(label, w, c) {
    var total = 0, n = 0;
    [0.17, 0.5, 0.83].forEach(function (f) {
      var y = Math.round(c.y0 + (c.y1 - c.y0) * f), runs = 0, inRun = false;
      for (var x = c.x0; x <= c.x1; x++) {
        var on = label[y * w + x] === c.id;
        if (on && !inRun) runs++; inRun = on;
      }
      var x2 = Math.round(c.x0 + (c.x1 - c.x0) * f), runs2 = 0; inRun = false;
      for (var yy = c.y0; yy <= c.y1; yy++) {
        var on2 = label[yy * w + x2] === c.id;
        if (on2 && !inRun) runs2++; inRun = on2;
      }
      total += runs + runs2; n += 2;
    });
    return total / n;
  }

  /* ---------- 2) まっすぐに直す ---------- */
  // 正方形 (0..S) → 写真の四角形 への変換
  function homography(quad, S) {
    var src = [[0, 0], [S, 0], [S, S], [0, S]], A = [], B = [];
    for (var k = 0; k < 4; k++) {
      var u = src[k][0], v = src[k][1], x = quad[k][0], y = quad[k][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y);
    }
    // ガウスの消去法
    for (var col = 0; col < 8; col++) {
      var piv = col;
      for (var r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      var t = A[col]; A[col] = A[piv]; A[piv] = t; var tb = B[col]; B[col] = B[piv]; B[piv] = tb;
      for (r = 0; r < 8; r++) {
        if (r === col) continue;
        var f = A[r][col] / A[col][col];
        for (var cc2 = col; cc2 < 8; cc2++) A[r][cc2] -= f * A[col][cc2];
        B[r] -= f * B[col];
      }
    }
    return B.map(function (b, i) { return b / A[i][i]; });
  }

  function mapPoint(H, u, v) {
    var z = H[6] * u + H[7] * v + 1;
    return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
  }

  function warp(canvas, quad, S) {
    var w = canvas.width, h = canvas.height;
    var src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var H = homography(quad, S);
    var out = new ImageData(S, S), d = out.data;
    for (var v = 0; v < S; v++) {
      for (var u = 0; u < S; u++) {
        var p = mapPoint(H, u + 0.5, v + 0.5), x = p[0] - 0.5, y = p[1] - 0.5;
        var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = (v * S + u) * 4;
        if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = 255; continue; }
        var i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
        for (var ch = 0; ch < 3; ch++) {
          d[o + ch] = (src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx) * (1 - fy) + (src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx) * fy;
        }
        d[o + 3] = 255;
      }
    }
    return out;
  }

  /* ---------- 3) 数字を読む ---------- */
  // 線の本当の位置を探す（少しゆがんでいても合わせる）
  function findLines(bin, S, horizontal) {
    var prof = new Float32Array(S);
    for (var a = 0; a < S; a++) {
      var n = 0;
      for (var b = 0; b < S; b++) n += horizontal ? bin[a * S + b] : bin[b * S + a];
      prof[a] = n;
    }
    var cell = S / 9, lines = [];
    for (var k = 0; k <= 9; k++) {
      var e = Math.round(k * cell), lo = Math.max(0, e - Math.round(cell * 0.22)), hi = Math.min(S - 1, e + Math.round(cell * 0.22));
      var best = e, bv = -1;
      for (var p = lo; p <= hi; p++) if (prof[p] > bv) { best = p; bv = prof[p]; }
      lines.push(bv > S * 0.25 ? best : e);
    }
    for (k = 1; k <= 9; k++) if (lines[k] - lines[k - 1] < cell * 0.6) lines[k] = Math.round(lines[k - 1] + cell);
    return lines;
  }

  // インクのかたまりを 20×20 の特徴にする（縦横の比は保つ）
  function featureFrom(bin, bw, x0, y0, x1, y1) {
    var fw = x1 - x0 + 1, fh = y1 - y0 + 1, scale = (FEAT - 2) / Math.max(fw, fh);
    var ox = (FEAT - fw * scale) / 2, oy = (FEAT - fh * scale) / 2;
    var f = new Float32Array(FEAT * FEAT);
    for (var ty = 0; ty < FEAT; ty++) {
      for (var tx = 0; tx < FEAT; tx++) {
        var acc = 0;
        for (var sy = 0; sy < 3; sy++) for (var sx = 0; sx < 3; sx++) {
          var X = Math.floor(x0 + (tx + (sx + 0.5) / 3 - ox) / scale), Y = Math.floor(y0 + (ty + (sy + 0.5) / 3 - oy) / scale);
          if (X >= x0 && X <= x1 && Y >= y0 && Y <= y1 && bin[Y * bw + X]) acc++;
        }
        f[ty * FEAT + tx] = acc / 9;
      }
    }
    return blurNorm(f);
  }

  // 少しぼかして平均を引き、長さ1にする（字の太さのちがいに強くする）
  function blurNorm(f) {
    var g = new Float32Array(f.length), mean = 0;
    for (var y = 0; y < FEAT; y++) for (var x = 0; x < FEAT; x++) {
      var s = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= FEAT || xx >= FEAT) continue;
        var wgt = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
        s += f[yy * FEAT + xx] * wgt; n += wgt;
      }
      g[y * FEAT + x] = s / n; mean += s / n;
    }
    mean /= g.length;
    var len = 0;
    for (var i = 0; i < g.length; i++) { g[i] -= mean; len += g[i] * g[i]; }
    len = Math.sqrt(len) || 1;
    for (i = 0; i < g.length; i++) g[i] /= len;
    return g;
  }

  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // お手本：いろいろな字体で 1〜9 を書いておく
  var FONTS = [
    '900 {s}px "Hiragino Sans", sans-serif', '600 {s}px "Hiragino Sans", sans-serif', '300 {s}px "Hiragino Sans", sans-serif',
    '600 {s}px "Hiragino Mincho ProN", serif', '300 {s}px "Hiragino Mincho ProN", serif',
    'bold {s}px Helvetica, Arial, sans-serif', '{s}px Helvetica, Arial, sans-serif',
    'bold {s}px "Times New Roman", Times, serif', '{s}px "Times New Roman", Times, serif',
    'bold {s}px Georgia, serif', '{s}px Verdana, sans-serif', 'bold {s}px Verdana, sans-serif',
    'bold {s}px "Courier New", monospace', '{s}px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", sans-serif',
    'bold {s}px "Avenir Next", sans-serif', '{s}px "Gill Sans", sans-serif', 'bold {s}px Futura, sans-serif',
    '{s}px "DIN Alternate", "DIN Condensed", sans-serif', 'bold {s}px "Trebuchet MS", sans-serif'
  ];
  var templates = null;
  function buildTemplates() {
    if (templates) return templates;
    templates = [];
    var size = 64, cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    FONTS.forEach(function (font) {
      for (var d = 1; d <= 9; d++) {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000'; ctx.font = font.replace('{s}', 48);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(d), size / 2, size / 2 + 2);
        var g = grayOf(ctx.getImageData(0, 0, size, size).data, size, size), bin = new Uint8Array(size * size);
        var x0 = size, y0 = size, x1 = -1, y1 = -1;
        for (var i = 0; i < bin.length; i++) if (g[i] < 128) {
          bin[i] = 1; var x = i % size, y = (i / size) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) continue;
        templates.push({ d: d, f: featureFrom(bin, size, x0, y0, x1, y1) });
      }
    });
    return templates;
  }

  // 使う人が直した字を覚えておく（うちの新聞の字体に慣れていく）
  function learned() {
    try {
      var raw = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}'), out = [];
      Object.keys(raw).forEach(function (d) {
        raw[d].forEach(function (s) { out.push({ d: +d, f: decodeFeat(s), mine: true }); });
      });
      return out;
    } catch (e) { return []; }
  }
  function encodeFeat(f) {
    var b = '';
    for (var i = 0; i < f.length; i++) b += String.fromCharCode(Math.max(0, Math.min(255, Math.round(f[i] * 400 + 128))));
    return btoa(b);
  }
  function decodeFeat(s) {
    var b = atob(s), f = new Float32Array(b.length);
    for (var i = 0; i < b.length; i++) f[i] = (b.charCodeAt(i) - 128) / 400;
    return f;
  }
  function learn(feat, d) {
    if (!feat || !(d >= 1 && d <= 9)) return;
    try {
      var raw = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}');
      var list = raw[d] || [];
      list.push(encodeFeat(feat));
      while (list.length > 12) list.shift();
      raw[d] = list;
      localStorage.setItem(LEARN_KEY, JSON.stringify(raw));
    } catch (e) { /* 覚えられなくても読みとりは続ける */ }
  }

  function classify(feat, pool) {
    var best = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(function () { return -2; });
    pool.forEach(function (t) {
      var s = dot(feat, t.f) + (t.mine ? 0.03 : 0);
      if (s > best[t.d]) best[t.d] = s;
    });
    var d1 = 1, d2 = 2;
    for (var d = 1; d <= 9; d++) if (best[d] > best[d1]) d1 = d;
    d2 = d1 === 1 ? 2 : 1;
    for (d = 1; d <= 9; d++) if (d !== d1 && best[d] > best[d2]) d2 = d;
    return { d: d1, score: best[d1], margin: best[d1] - best[d2], second: d2 };
  }

  function readCells(img, S) {
    var gray = grayOf(img.data, S, S);
    var bin = adaptive(gray, S, S, 31, 12);
    var rows = findLines(bin, S, true), cols = findLines(bin, S, false);
    var pool = buildTemplates().concat(learned());
    var cells = [];
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        var X0 = cols[c], X1 = cols[c + 1], Y0 = rows[r], Y1 = rows[r + 1];
        var cw = X1 - X0, ch = Y1 - Y0;
        var mx = Math.round(cw * 0.12) + 1, my = Math.round(ch * 0.12) + 1;
        var x0 = X0 + mx, x1 = X1 - mx, y0 = Y0 + my, y1 = Y1 - my;
        cells.push(readOne(bin, gray, S, x0, y0, x1, y1, pool));
      }
    }
    return { cells: cells, rows: rows, cols: cols, bin: bin };
  }

  function readOne(bin, gray, S, x0, y0, x1, y1, pool) {
    var w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 6 || h < 6) return { d: 0 };
    var sub = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) sub[y * w + x] = bin[(y0 + y) * S + x0 + x];
    var cc = components(sub, w, h, false), area = w * h;
    var best = null, bestScore = 0;
    cc.comps.forEach(function (c) {
      var bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (c.n < area * 0.012 || bh < h * 0.3) return;
      // マスの線の切れはし（細長くて端にくっついている）は数字ではない
      var touches = c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1;
      if (touches && ((bw < w * 0.15 && bh > h * 0.85) || (bh < h * 0.15 && bw > w * 0.85))) return;
      if (bw > w * 0.95 && bh > h * 0.95) return;
      var cx = (c.x0 + c.x1) / 2 / w - 0.5, cy = (c.y0 + c.y1) / 2 / h - 0.5;
      var score = c.n * (1 - Math.min(0.8, Math.sqrt(cx * cx + cy * cy) * 1.6));
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (!best) return { d: 0 };
    // 同じ字の切れた部分（となりのかたまり）もまとめる
    var bx0 = best.x0, by0 = best.y0, bx1 = best.x1, by1 = best.y1;
    cc.comps.forEach(function (c) {
      if (c === best || c.n < area * 0.004) return;
      var ox = Math.min(bx1, c.x1) - Math.max(bx0, c.x0), oy = Math.min(by1, c.y1) - Math.max(by0, c.y0);
      if (ox > -2 && c.y0 >= by0 - h * 0.15 && c.y1 <= by1 + h * 0.15) {
        bx0 = Math.min(bx0, c.x0); bx1 = Math.max(bx1, c.x1); by0 = Math.min(by0, c.y0); by1 = Math.max(by1, c.y1);
      } else if (oy > -2 && c.x0 >= bx0 - w * 0.1 && c.x1 <= bx1 + w * 0.1) {
        bx0 = Math.min(bx0, c.x0); bx1 = Math.max(bx1, c.x1); by0 = Math.min(by0, c.y0); by1 = Math.max(by1, c.y1);
      }
    });
    var keep = new Uint8Array(w * h);
    for (var i = 0; i < keep.length; i++) {
      var lx = i % w, ly = (i / w) | 0;
      keep[i] = (sub[i] && lx >= bx0 && lx <= bx1 && ly >= by0 && ly <= by1) ? 1 : 0;
    }
    var feat = featureFrom(keep, w, bx0, by0, bx1, by1);
    var cl = classify(feat, pool);
    return {
      d: cl.d, score: cl.score, margin: cl.margin, second: cl.second, feat: feat,
      doubt: cl.score < 0.6 || cl.margin < 0.05
    };
  }

  /* ---------- 4) 色マスを探す ---------- */
  function findColors(img, S, rows, cols, bin) {
    var d = img.data, info = [];
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      var x0 = cols[c], x1 = cols[c + 1], y0 = rows[r], y1 = rows[r + 1];
      var mx = Math.round((x1 - x0) * 0.15), my = Math.round((y1 - y0) * 0.15);
      var br = [], sa = [];
      for (var y = y0 + my; y < y1 - my; y += 2) for (var x = x0 + mx; x < x1 - mx; x += 2) {
        if (bin[y * S + x]) continue;
        var o = (y * S + x) * 4, R = d[o], G = d[o + 1], B = d[o + 2];
        var mxv = Math.max(R, G, B), mnv = Math.min(R, G, B);
        br.push((R + G + B) / 3); sa.push(mxv ? (mxv - mnv) / mxv : 0);
      }
      info.push({ b: median(br), s: median(sa) });
    }
    var flags = info.map(function (me, i) {
      var r = (i / 9) | 0, c = i % 9, nb = [], ns = [];
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
        var rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < 9 && cc >= 0 && cc < 9) { nb.push(info[rr * 9 + cc].b); ns.push(info[rr * 9 + cc].s); }
      }
      return (me.b < median(nb) - 22) || (me.s > median(ns) + 0.14);
    });
    var n = flags.filter(Boolean).length;
    if (n > 20) flags = flags.map(function () { return false; });   // 光のムラ。色マスではない
    return flags;
  }

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[(s.length / 2) | 0];
  }

  /* ---------- まとめて読む ---------- */
  function read(canvas, quad) {
    var img = warp(canvas, quad, WARP);
    var res = readCells(img, WARP);
    var colors = findColors(img, WARP, res.rows, res.cols, res.bin);
    var cv = document.createElement('canvas'); cv.width = WARP; cv.height = WARP;
    cv.getContext('2d').putImageData(img, 0, 0);
    return {
      digits: res.cells.map(function (c) { return c.d; }),
      doubt: res.cells.map(function (c) { return !!c.doubt; }),
      feats: res.cells.map(function (c) { return c.feat || null; }),
      colors: colors,
      photo: cv.toDataURL('image/jpeg', 0.8)
    };
  }

  root.OCR = { loadImage: loadImage, findCorners: findCorners, read: read, learn: learn, homography: homography, mapPoint: mapPoint };
})(this);
