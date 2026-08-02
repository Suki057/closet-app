/* 抠图引擎：边框背景采样 → 泛洪填充 → 软边羽化 → 去色边 → 噪点清理 → 自动裁剪
   可选：联网使用 AI 模型做精细抠图（@imgly/background-removal） */
(function (global) {
  'use strict';

  var MAX_SIDE = 1100;
  var THUMB_SIDE = 340;
  var aiModule = null;

  /* ---------- 基础工具 ---------- */

  function loadBitmap(file) {
    if (file && file.width && (file instanceof HTMLImageElement || (global.ImageBitmap && file instanceof ImageBitmap))) {
      return Promise.resolve(file);
    }
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaImgTag(file); });
    }
    return viaImgTag(file);
  }

  function viaImgTag(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  function drawToCanvas(bmp, maxSide) {
    var w = bmp.width, h = bmp.height;
    var s = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, cw, ch);
    return c;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }

  function percentile(arr, p) {
    if (!arr.length) return 0;
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.floor(a.length * p))];
  }

  function boxBlur(src, w, h, r) {
    var out = new Float32Array(w * h);
    var i, x, y, dx, dy, sum, cnt, xx, yy;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        sum = 0; cnt = 0;
        for (dy = -r; dy <= r; dy++) {
          yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (dx = -r; dx <= r; dx++) {
            xx = x + dx; if (xx < 0 || xx >= w) continue;
            sum += src[yy * w + xx]; cnt++;
          }
        }
        out[y * w + x] = sum / cnt;
      }
    }
    return out;
  }

  /* 把 alpha 边缘从“灰蒙蒙”推向 0/255，让主体边缘更利落但仍保留 1px 抗锯齿 */
  function sharpenAlpha(alpha, threshold, strength) {
    if (typeof threshold !== 'number') threshold = 128;
    if (typeof strength !== 'number') strength = 2.0;
    var n = alpha.length, i;
    var out = new Float32Array(n);
    var t = threshold / 255;
    for (i = 0; i < n; i++) {
      var v = alpha[i] / 255;
      if (v <= 0.001 || v >= 0.999) { out[i] = alpha[i]; continue; }
      var u = (v - t) * strength + t;
      u = Math.max(0, Math.min(1, u));
      var s = u * u * (3 - 2 * u);
      out[i] = s * 255;
    }
    return out;
  }

  /* ---------- 核心：本地抠图 ---------- */

  function localCutout(canvas, tolerance) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var w = canvas.width, h = canvas.height;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var n = w * h;

    /* 1. 采样边框，估计背景色 */
    var band = Math.max(2, Math.round(Math.min(w, h) * 0.022));
    var rs = [], gs = [], bs = [];
    var x, y, i;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (x >= band && x < w - band && y >= band && y < h - band) { x = w - band - 1; continue; }
        i = (y * w + x) * 4;
        rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
      }
    }
    var bg = [median(rs), median(gs), median(bs)];

    /* 2. 距离场 */
    var dist = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var p = i * 4;
      var dr = d[p] - bg[0], dg = d[p + 1] - bg[1], db = d[p + 2] - bg[2];
      dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
    }

    /* 3. 阈值：由边框噪声水平 + 用户强度决定 */
    var borderDists = [];
    for (y = 0; y < h; y += 2) {
      for (x = 0; x < w; x += 2) {
        if (x >= band && x < w - band && y >= band && y < h - band) continue;
        borderDists.push(dist[y * w + x]);
      }
    }
    var noise = percentile(borderDists, 0.88);
    var base = Math.max(24, noise * 1.75);
    var thr = Math.max(12, Math.min(150, base * (0.5 + tolerance)));

    /* 4. 从四边泛洪，只移除与画面边缘连通的背景 */
    var isBg = new Uint8Array(n);
    var stack = new Int32Array(n);
    var sp = 0;
    function push(idx) { if (!isBg[idx] && dist[idx] <= thr) { isBg[idx] = 1; stack[sp++] = idx; } }
    for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp > 0) {
      var cur = stack[--sp];
      var cx = cur % w, cy = (cur / w) | 0;
      if (cx > 0) push(cur - 1);
      if (cx < w - 1) push(cur + 1);
      if (cy > 0) push(cur - w);
      if (cy < h - 1) push(cur + w);
    }

    var bgCount = 0;
    for (i = 0; i < n; i++) if (isBg[i]) bgCount++;
    var fgRatio = 1 - bgCount / n;

    /* 保护：几乎全被判为背景 → 说明背景与主体过于接近，放弃抠图 */
    if (fgRatio < 0.0025) {
      return { canvas: canvas, failed: true, reason: '主体与背景颜色太接近' };
    }
    var warn = fgRatio > 0.94 ? '背景比较复杂，可调高抠图强度试试' : '';

    /* 5. 二值 mask → 软边 */
    var mask = new Float32Array(n);
    for (i = 0; i < n; i++) mask[i] = isBg[i] ? 0 : 255;
    var soft = sharpenAlpha(boxBlur(mask, w, h, 1), 140, 2.2);

    var alpha = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var a = soft[i];
      if (a <= 6) { alpha[i] = 0; continue; }
      if (a >= 249) { alpha[i] = 255; continue; }
      // 边界带：结合与背景色的差异做半透明，减少毛边
      var ramp = Math.max(0, Math.min(255, (dist[i] / (thr * 1.15)) * 255));
      alpha[i] = Math.min(a, ramp);
    }

    /* 6. 清理小噪点（保留主要连通块） */
    var label = new Int32Array(n).fill(-1);
    var areas = [];
    var q = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (alpha[i] < 128 || label[i] !== -1) continue;
      var id = areas.length, head = 0, tail = 0, cnt = 0;
      q[tail++] = i; label[i] = id;
      while (head < tail) {
        var c2 = q[head++]; cnt++;
        var x2 = c2 % w, y2 = (c2 / w) | 0;
        if (x2 > 0 && alpha[c2 - 1] >= 128 && label[c2 - 1] === -1) { label[c2 - 1] = id; q[tail++] = c2 - 1; }
        if (x2 < w - 1 && alpha[c2 + 1] >= 128 && label[c2 + 1] === -1) { label[c2 + 1] = id; q[tail++] = c2 + 1; }
        if (y2 > 0 && alpha[c2 - w] >= 128 && label[c2 - w] === -1) { label[c2 - w] = id; q[tail++] = c2 - w; }
        if (y2 < h - 1 && alpha[c2 + w] >= 128 && label[c2 + w] === -1) { label[c2 + w] = id; q[tail++] = c2 + w; }
      }
      areas.push(cnt);
    }
    var maxArea = areas.length ? Math.max.apply(null, areas) : 0;
    var keepMin = Math.max(50, maxArea * 0.05);
    if (areas.length) {
      for (i = 0; i < n; i++) {
        var lb = label[i];
        if (lb >= 0 && areas[lb] < keepMin) alpha[i] = 0;
        else if (lb < 0 && alpha[i] > 0 && alpha[i] < 128) {
          // 孤立的半透明像素：看邻域是否有保留块
          var keep = false;
          if (i > 0 && label[i - 1] >= 0 && areas[label[i - 1]] >= keepMin) keep = true;
          if (!keep && i < n - 1 && label[i + 1] >= 0 && areas[label[i + 1]] >= keepMin) keep = true;
          if (!keep && i >= w && label[i - w] >= 0 && areas[label[i - w]] >= keepMin) keep = true;
          if (!keep && i < n - w && label[i + w] >= 0 && areas[label[i + w]] >= keepMin) keep = true;
          if (!keep) alpha[i] = 0;
        }
      }
    }

    /* 7. 写回像素 + 去色边（去掉边缘残留的背景色） */
    for (i = 0; i < n; i++) {
      var pp = i * 4;
      var av = alpha[i];
      if (av <= 0) { d[pp + 3] = 0; continue; }
      if (av < 250) {
        var f = av / 255;
        d[pp] = Math.max(0, Math.min(255, (d[pp] - bg[0] * (1 - f)) / f));
        d[pp + 1] = Math.max(0, Math.min(255, (d[pp + 1] - bg[1] * (1 - f)) / f));
        d[pp + 2] = Math.max(0, Math.min(255, (d[pp + 2] - bg[2] * (1 - f)) / f));
      }
      d[pp + 3] = Math.round(av);
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: canvas, failed: false, bg: bg, thr: thr, warn: warn };
  }

  /* ---------- 区域抠图（基于用户选择范围） ---------- */

  function gaussLL(r, g, b, m) {
    var ll = 0;
    var ch = [r, g, b], c;
    for (c = 0; c < 3; c++) {
      var d = ch[c] - m.mu[c];
      ll += -0.5 * Math.log(2 * Math.PI * m.var[c]) - (d * d) / (2 * m.var[c]);
    }
    return ll;
  }

  function computeModel(d, w, h, seed) {
    var sum = [0, 0, 0], sum2 = [0, 0, 0], cnt = 0, i, p, c;
    for (i = 0; i < w * h; i++) {
      if (!seed[i]) continue;
      p = i * 4;
      for (c = 0; c < 3; c++) { sum[c] += d[p + c]; sum2[c] += d[p + c] * d[p + c]; }
      cnt++;
    }
    var mu = [0, 0, 0], vari = [0, 0, 0];
    if (cnt) for (c = 0; c < 3; c++) {
      mu[c] = sum[c] / cnt;
      vari[c] = Math.max(4, sum2[c] / cnt - mu[c] * mu[c]);
    }
    return { mu: mu, var: vari, n: cnt };
  }

  function morphMask(src, w, h, r, mode) {
    if (r <= 0) return src.slice();
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    var x, y, i, k, lo, hi, best, v;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      lo = x - r < 0 ? 0 : x - r; hi = x + r >= w ? w - 1 : x + r;
      best = mode === 'max' ? 0 : 1;
      for (k = lo; k <= hi; k++) { v = src[y * w + k]; if (mode === 'max') { if (v > best) best = v; } else { if (v < best) best = v; } }
      tmp[y * w + x] = best;
    }
    for (x = 0; x < w; x++) for (y = 0; y < h; y++) {
      lo = y - r < 0 ? 0 : y - r; hi = y + r >= h ? h - 1 : y + r;
      best = mode === 'max' ? 0 : 1;
      for (k = lo; k <= hi; k++) { v = tmp[k * w + x]; if (mode === 'max') { if (v > best) best = v; } else { if (v < best) best = v; } }
      out[y * w + x] = best;
    }
    return out;
  }

  function boxMask(w, h, sel) {
    var m = new Uint8Array(w * h);
    var xa = Math.min(sel.x0, sel.x1), xb = Math.max(sel.x0, sel.x1);
    var ya = Math.min(sel.y0, sel.y1), yb = Math.max(sel.y0, sel.y1);
    xa = Math.max(0, Math.min(1, xa)); xb = Math.max(0, Math.min(1, xb));
    ya = Math.max(0, Math.min(1, ya)); yb = Math.max(0, Math.min(1, yb));
    var px0 = Math.floor(xa * w), px1 = Math.ceil(xb * w), py0 = Math.floor(ya * h), py1 = Math.ceil(yb * h);
    px0 = Math.max(0, px0); py0 = Math.max(0, py0); px1 = Math.min(w - 1, px1); py1 = Math.min(h - 1, py1);
    for (var y = py0; y <= py1; y++) for (var x = px0; x <= px1; x++) m[y * w + x] = 1;
    return m;
  }

  function fillPolyMask(w, h, pts) {
    var m = new Uint8Array(w * h);
    var n = pts.length;
    if (n < 3) return m;
    var minY = 1e9, maxY = -1e9, i;
    for (i = 0; i < n; i++) { var yy = pts[i].y; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
    var y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    for (var y = y0; y <= y1; y++) {
      var xs = [];
      for (i = 0; i < n; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          var x = a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x);
          xs.push(x);
        }
      }
      xs.sort(function (p, q) { return p - q; });
      for (i = 0; i + 1 < xs.length; i += 2) {
        var xa = Math.max(0, Math.round(xs[i])), xb = Math.min(w - 1, Math.round(xs[i + 1]));
        for (var x = xa; x <= xb; x++) m[y * w + x] = 1;
      }
    }
    return m;
  }

  function cleanComponents(alpha, w, h, frac) {
    var n = w * h, i;
    var label = new Int32Array(n).fill(-1);
    var areas = [];
    var q = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (alpha[i] < 128 || label[i] !== -1) continue;
      var id = areas.length, head = 0, tail = 0, cnt = 0;
      q[tail++] = i; label[i] = id;
      while (head < tail) {
        var c2 = q[head++]; cnt++;
        var x2 = c2 % w, y2 = (c2 / w) | 0;
        if (x2 > 0 && alpha[c2 - 1] >= 128 && label[c2 - 1] === -1) { label[c2 - 1] = id; q[tail++] = c2 - 1; }
        if (x2 < w - 1 && alpha[c2 + 1] >= 128 && label[c2 + 1] === -1) { label[c2 + 1] = id; q[tail++] = c2 + 1; }
        if (y2 > 0 && alpha[c2 - w] >= 128 && label[c2 - w] === -1) { label[c2 - w] = id; q[tail++] = c2 - w; }
        if (y2 < h - 1 && alpha[c2 + w] >= 128 && label[c2 + w] === -1) { label[c2 + w] = id; q[tail++] = c2 + w; }
      }
      areas.push(cnt);
    }
    var maxArea = areas.length ? Math.max.apply(null, areas) : 0;
    var keepMin = Math.max(50, maxArea * frac);
    if (areas.length) for (i = 0; i < n; i++) {
      var lb = label[i];
      if (lb >= 0 && areas[lb] < keepMin) alpha[i] = 0;
      else if (lb < 0 && alpha[i] > 0 && alpha[i] < 128) {
        var keep = false;
        if (i > 0 && label[i - 1] >= 0 && areas[label[i - 1]] >= keepMin) keep = true;
        if (!keep && i < n - 1 && label[i + 1] >= 0 && areas[label[i + 1]] >= keepMin) keep = true;
        if (!keep && i >= w && label[i - w] >= 0 && areas[label[i - w]] >= keepMin) keep = true;
        if (!keep && i < n - w && label[i + w] >= 0 && areas[label[i + w]] >= keepMin) keep = true;
        if (!keep) alpha[i] = 0;
      }
    }
  }

  /* 基于用户框选范围做抠图：范围外=背景，范围内用颜色模型(mini grabcut)抽出主体 */
  function regionCutout(canvas, sel, tolerance) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var w = canvas.width, h = canvas.height, n = w * h;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;

    var mask = sel.type === 'box' ? boxMask(w, h, sel) : fillPolyMask(w, h, sel.pts);
    var inside = 0, i;
    for (i = 0; i < n; i++) inside += mask[i];
    if (inside < 0.02 * n) return { canvas: canvas, failed: true, reason: '选择范围太小，请框住更大区域' };

    var E = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    var B = Math.max(3, Math.round(Math.min(w, h) * 0.018));
    var eroded = morphMask(mask, w, h, E, 'min');
    var dilated = morphMask(mask, w, h, B, 'max');
    var fgSeed = new Uint8Array(n), bgSeed = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (mask[i] && eroded[i]) fgSeed[i] = 1;
      if (!mask[i] && dilated[i]) bgSeed[i] = 1;
    }
    var fgN = 0, bgN = 0;
    for (i = 0; i < n; i++) { fgN += fgSeed[i]; bgN += bgSeed[i]; }
    if (fgN < 40 || bgN < 40) {
      var fb = localCutout(canvas, tolerance);
      return { canvas: fb.canvas, failed: fb.failed, reason: fb.reason, bg: fb.bg, thr: fb.thr, warn: fb.warn };
    }

    var fg = computeModel(d, w, h, fgSeed);
    var bg = computeModel(d, w, h, bgSeed);
    var tolBias = (tolerance - 0.5) * 6;
    var PRI = 9, scale = 0.6;
    var alpha = new Float32Array(n);
    for (i = 0; i < n; i++) alpha[i] = mask[i] ? 235 : 5;

    var p, c, k;
    for (k = 0; k < 3; k++) {
      for (i = 0; i < n; i++) {
        p = i * 4;
        var fll = gaussLL(d[p], d[p + 1], d[p + 2], fg);
        var bll = gaussLL(d[p], d[p + 1], d[p + 2], bg);
        var score = fll - bll + (mask[i] ? PRI : -PRI) + tolBias;
        alpha[i] = 255 / (1 + Math.exp(-score * scale));
      }
      var fgSum = [0, 0, 0], fgSum2 = [0, 0, 0], fgC = 0;
      var bgSum = [0, 0, 0], bgSum2 = [0, 0, 0], bgC = 0;
      for (i = 0; i < n; i++) {
        if (alpha[i] >= 205) { p = i * 4; for (c = 0; c < 3; c++) { fgSum[c] += d[p + c]; fgSum2[c] += d[p + c] * d[p + c]; } fgC++; }
        else if (alpha[i] <= 50) { p = i * 4; for (c = 0; c < 3; c++) { bgSum[c] += d[p + c]; bgSum2[c] += d[p + c] * d[p + c]; } bgC++; }
      }
      if (fgC > 40) for (c = 0; c < 3; c++) { fg.mu[c] = fgSum[c] / fgC; fg.var[c] = Math.max(4, fgSum2[c] / fgC - fg.mu[c] * fg.mu[c]); }
      if (bgC > 40) for (c = 0; c < 3; c++) { bg.mu[c] = bgSum[c] / bgC; bg.var[c] = Math.max(4, bgSum2[c] / bgC - bg.mu[c] * bg.mu[c]); }
    }

    cleanComponents(alpha, w, h, 0.05);
    var soft = sharpenAlpha(boxBlur(alpha, w, h, 1), 140, 2.2);
    for (i = 0; i < n; i++) alpha[i] = soft[i];

    var fgCount = 0;
    for (i = 0; i < n; i++) if (alpha[i] > 90) fgCount++;
    if (fgCount < 0.005 * n) return { canvas: canvas, failed: true, reason: '该范围内没识别到主体，换个框法试试' };

    var bgc = bg.mu;
    for (i = 0; i < n; i++) {
      p = i * 4; var a = alpha[i];
      if (a <= 0) { d[p + 3] = 0; continue; }
      if (a < 250) {
        var f = a / 255;
        d[p] = Math.max(0, Math.min(255, (d[p] - bgc[0] * (1 - f)) / f));
        d[p + 1] = Math.max(0, Math.min(255, (d[p + 1] - bgc[1] * (1 - f)) / f));
        d[p + 2] = Math.max(0, Math.min(255, (d[p + 2] - bgc[2] * (1 - f)) / f));
      }
      d[p + 3] = Math.round(a);
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: canvas, failed: false, bg: bg.mu, thr: 0, warn: '' };
  }

  /* ---------- 涂抹式抠图（前景/背景笔刷 → GrabCut） ---------- */

  function stampDisk(arr, W, H, cx, cy, R) {
    var x0 = Math.max(0, cx - R), x1 = Math.min(W - 1, cx + R);
    var y0 = Math.max(0, cy - R), y1 = Math.min(H - 1, cy + R);
    var r2 = R * R, x, y, dx, dy;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      dx = x - cx; dy = y - cy; if (dx * dx + dy * dy <= r2) arr[y * W + x] = 1;
    }
  }
  function stampLine(arr, W, H, x0, y0, x1, y1, R) {
    var dx = x1 - x0, dy = y1 - y0;
    var steps = Math.ceil(Math.sqrt(dx * dx + dy * dy));
    if (steps <= 0) { stampDisk(arr, W, H, x1, y1, R); return; }
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      stampDisk(arr, W, H, Math.round(x0 + dx * t), Math.round(y0 + dy * t), R);
    }
  }

  function collectIdx(mask, val) {
    var out = [], n = mask.length, i;
    for (i = 0; i < n; i++) if (mask[i] === val) out.push(i);
    return out;
  }

  /* 对角协方差 GMM（K=5），k-means 初始化 + 重估 */
  function fitGMM(d, W, H, mask, val, K) {
    K = K || 5;
    var idx = collectIdx(mask, val);
    var N = idx.length;
    if (N < 1) return { K: 0, mu: [], vari: [], w: [], logdet: [] };
    if (N < K) K = N;
    var m = [0, 0, 0], t, c, ch;
    for (t = 0; t < N; t++) { var p0 = idx[t] * 4; m[0] += d[p0]; m[1] += d[p0 + 1]; m[2] += d[p0 + 2]; }
    m[0] /= N; m[1] /= N; m[2] /= N;
    var centers = [m.slice()];
    for (c = 1; c < K; c++) {
      var best = null, bd = -1;
      for (var s2 = 0; s2 < 24; s2++) {
        var q = idx[(Math.random() * N) | 0], pp = q * 4;
        var cand = [d[pp], d[pp + 1], d[pp + 2]];
        var dd = 0;
        for (var cc = 0; cc < centers.length; cc++) {
          var dm = 0; for (ch = 0; ch < 3; ch++) { var v = cand[ch] - centers[cc][ch]; dm += v * v; }
          if (dm > bd) { bd = dm; best = cand; }
        }
      }
      centers.push(best || [0, 0, 0]);
    }
    var assign = new Int32Array(N), sum, sum2, cnt, it;
    for (it = 0; it < 3; it++) {
      sum = []; sum2 = []; cnt = [];
      for (c = 0; c < K; c++) { sum.push([0, 0, 0]); sum2.push([0, 0, 0]); cnt.push(0); }
      for (t = 0; t < N; t++) {
        var p2 = idx[t] * 4, px = d[p2], py = d[p2 + 1], pz = d[p2 + 2];
        var bestc = 0, bd2 = 1e18;
        for (c = 0; c < K; c++) {
          var dm2 = (px - centers[c][0]) * (px - centers[c][0]) + (py - centers[c][1]) * (py - centers[c][1]) + (pz - centers[c][2]) * (pz - centers[c][2]);
          if (dm2 < bd2) { bd2 = dm2; bestc = c; }
        }
        assign[t] = bestc;
        sum[bestc][0] += px; sum[bestc][1] += py; sum[bestc][2] += pz;
        sum2[bestc][0] += px * px; sum2[bestc][1] += py * py; sum2[bestc][2] += pz * pz;
        cnt[bestc]++;
      }
      for (c = 0; c < K; c++) if (cnt[c]) for (ch = 0; ch < 3; ch++) centers[c][ch] = sum[c][ch] / cnt[c];
    }
    var mu = [], vari = [], w = [], logdet = [];
    for (c = 0; c < K; c++) {
      if (cnt[c] < 2) { mu.push([0, 0, 0]); vari.push([1, 1, 1]); w.push(0); logdet.push(0); continue; }
      var mm = [0, 0, 0], vv = [1, 1, 1];
      for (ch = 0; ch < 3; ch++) {
        var mean = sum[c][ch] / cnt[c];
        mm[ch] = mean;
        vv[ch] = Math.max(4, sum2[c][ch] / cnt[c] - mean * mean);
      }
      mu.push(mm); vari.push(vv); w.push(cnt[c] / N);
      logdet.push(Math.log(vv[0] * vv[1] * vv[2] || 1) + 3 * Math.log(2 * Math.PI));
    }
    return { K: K, mu: mu, vari: vari, w: w, logdet: logdet };
  }

  function gmmScore(r, g, b, gmm) {
    var best = -1e30, c, ch;
    for (c = 0; c < gmm.K; c++) {
      if (gmm.w[c] <= 0) continue;
      var ll = Math.log(gmm.w[c]) - 0.5 * gmm.logdet[c];
      var ch0 = r - gmm.mu[c][0]; ll -= 0.5 * ch0 * ch0 / gmm.vari[c][0];
      var ch1 = g - gmm.mu[c][1]; ll -= 0.5 * ch1 * ch1 / gmm.vari[c][1];
      var ch2 = b - gmm.mu[c][2]; ll -= 0.5 * ch2 * ch2 / gmm.vari[c][2];
      if (ll > best) best = ll;
    }
    return best;
  }

  /* 智能涂抹抠图（剪映风格）：只需在主体上涂抹大概位置，自动锁定主体并去除其它一切
     - fg 笔刷：用户涂抹的衣服主体（唯一必要输入）
     - bg 笔刷（可选/高级）：仅当主体贴到图片边缘、自动背景判断不准时才需要
     - 背景种子默认取自图片边框（衣服通常居中、不贴边）
     - 抠完后锁定「用户涂抹所在的连通主体」，确保没有别的异物 */
  function smartCutout(srcCanvas, fgStrokes, opts) {
    opts = opts || {};
    var tolerance = typeof opts.tolerance === 'number' ? opts.tolerance : 0.5;
    var bgStrokes = opts.bgStrokes || [];
    var MAXW = 720;
    var scale = Math.min(1, MAXW / Math.max(srcCanvas.width, srcCanvas.height));
    var W = Math.max(1, Math.round(srcCanvas.width * scale));
    var H = Math.max(1, Math.round(srcCanvas.height * scale));
    var wc = document.createElement('canvas'); wc.width = W; wc.height = H;
    var wctx = wc.getContext('2d', { willReadFrequently: true });
    wctx.drawImage(srcCanvas, 0, 0, W, H);
    var img = wctx.getImageData(0, 0, W, H);
    var d = img.data, n = W * H;

    var fgSeed = new Uint8Array(n), bgSeed = new Uint8Array(n);
    var i, x, y;
    (fgStrokes || []).forEach(function (s) {
      var R = Math.max(2, Math.round(s.r * Math.max(W, H)));
      for (var k = 0; k < s.pts.length; k++) {
        var px = Math.round(s.pts[k].x * W), py = Math.round(s.pts[k].y * H);
        if (k > 0) { var px0 = Math.round(s.pts[k - 1].x * W), py0 = Math.round(s.pts[k - 1].y * H); stampLine(fgSeed, W, H, px0, py0, px, py, R); }
        else stampDisk(fgSeed, W, H, px, py, R);
      }
    });
    var fgN = 0; for (i = 0; i < n; i++) fgN += fgSeed[i];
    if (fgN < 20) return { canvas: srcCanvas, failed: true, reason: '请先用主体笔刷在衣服上涂抹大概位置（一两笔即可）' };

    /* 计算每个像素到最近前景笔刷的距离，作为空间先验：
       离用户涂抹越近，越偏向保留为前景。笔刷越少，这个先验越强。 */
    var distFg = new Float32Array(n).fill(1e9);
    var qd = new Int32Array(n);
    var head = 0, tail = 0;
    for (i = 0; i < n; i++) {
      if (fgSeed[i]) { distFg[i] = 0; qd[tail++] = i; }
    }
    while (head < tail) {
      var c = qd[head++];
      var cx = c % W, cy = (c / W) | 0;
      var nd = distFg[c] + 1;
      if (cx > 0 && distFg[c - 1] > nd) { distFg[c - 1] = nd; qd[tail++] = c - 1; }
      if (cx < W - 1 && distFg[c + 1] > nd) { distFg[c + 1] = nd; qd[tail++] = c + 1; }
      if (cy > 0 && distFg[c - W] > nd) { distFg[c - W] = nd; qd[tail++] = c - W; }
      if (cy < H - 1 && distFg[c + W] > nd) { distFg[c + W] = nd; qd[tail++] = c + W; }
    }
    var maxDist = 0; for (i = 0; i < n; i++) if (distFg[i] > maxDist) maxDist = distFg[i];
    var fgRatio = fgN / n;
    var spatialStrength = fgRatio < 0.003 ? 2.0 : (fgRatio < 0.01 ? 1.4 : (fgRatio < 0.025 ? 0.9 : 0.5));
    var sigma = Math.max(8, maxDist * 0.28);
    var spatialBias = new Float32Array(n);
    for (i = 0; i < n; i++) spatialBias[i] = spatialStrength * Math.exp(-distFg[i] / sigma);

    /* 背景种子：默认图片边框；若用户提供 bg 笔刷则合并 */
    var band = Math.max(2, Math.round(Math.min(W, H) * 0.03));
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { if (x < band || y < band || x >= W - band || y >= H - band) bgSeed[y * W + x] = 1; }
    bgStrokes.forEach(function (s) {
      var R = Math.max(2, Math.round(s.r * Math.max(W, H)));
      for (var k = 0; k < s.pts.length; k++) {
        var px = Math.round(s.pts[k].x * W), py = Math.round(s.pts[k].y * H);
        if (k > 0) { var px0 = Math.round(s.pts[k - 1].x * W), py0 = Math.round(s.pts[k - 1].y * H); stampLine(bgSeed, W, H, px0, py0, px, py, R); }
        else stampDisk(bgSeed, W, H, px, py, R);
      }
    });

    /* 背景/前景模型：用膨胀后的笔刷作为确定前景，覆盖未涂到的主体边缘；
       为避免笔刷边缘把背景色采进前景，再做一个 1 像素的腐蚀版本来训练。
       笔刷越少，膨胀越大，确保小范围涂抹也能覆盖整件衣服。 */
    var fgRatio = fgN / n;
    var dilateR = fgRatio < 0.005 ? 5 : (fgRatio < 0.015 ? 4 : (fgRatio < 0.03 ? 3 : 2));
    var fgD = morphMask(fgSeed, W, H, dilateR, 'max');
    var fgE = morphMask(fgSeed, W, H, 1, 'min');
    var bgE = morphMask(bgSeed, W, H, 1, 'min');
    var trimap = new Uint8Array(n);
    for (i = 0; i < n; i++) trimap[i] = fgD[i] ? 1 : (bgSeed[i] ? 0 : 2);
    var fgEc = 0, bgEc = 0;
    for (i = 0; i < n; i++) { fgEc += fgE[i]; bgEc += bgE[i]; }
    var fgModel = fgEc > 30 ? fgE : fgSeed;
    var bgModel = bgEc > 30 ? bgE : bgSeed;

    var tolBias = (tolerance - 0.5) * 0.6 + 0.25;
    var fgG = fitGMM(d, W, H, fgModel, 1, 5);
    var bgG = fitGMM(d, W, H, bgModel, 1, 5);
    var alpha = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var init;
      if (trimap[i] === 1) init = 255;
      else if (trimap[i] === 0) init = 0;
      else {
        p = i * 4;
        var fll = gmmScore(d[p], d[p + 1], d[p + 2], fgG);
        var bll = gmmScore(d[p], d[p + 1], d[p + 2], bgG);
        var sc = fll - bll + tolBias + spatialBias[i];
        init = 255 / (1 + Math.exp(-sc));
      }
      alpha[i] = init;
    }

    var p, it;
    for (it = 0; it < 6; it++) {
      fgG = fitGMM(d, W, H, alpha, 255, 5);
      bgG = fitGMM(d, W, H, alpha, 0, 5);
      for (i = 0; i < n; i++) {
        if (trimap[i] !== 2) continue;
        p = i * 4;
        var fll2 = gmmScore(d[p], d[p + 1], d[p + 2], fgG);
        var bll2 = gmmScore(d[p], d[p + 1], d[p + 2], bgG);
        alpha[i] = (fll2 + spatialBias[i] >= bll2) ? 255 : 0;
      }
    }

    /* 锁定：仅保留「与用户涂抹重叠」的连通主体，彻底去掉异物 */
    var label = new Int32Array(n).fill(-1);
    var areas = [];
    var q = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (alpha[i] < 128 || label[i] !== -1) continue;
      var id = areas.length, head = 0, tail = 0, cnt = 0;
      q[tail++] = i; label[i] = id;
      while (head < tail) {
        var c2 = q[head++]; cnt++;
        var x2 = c2 % W, y2 = (c2 / W) | 0;
        if (x2 > 0 && alpha[c2 - 1] >= 128 && label[c2 - 1] === -1) { label[c2 - 1] = id; q[tail++] = c2 - 1; }
        if (x2 < W - 1 && alpha[c2 + 1] >= 128 && label[c2 + 1] === -1) { label[c2 + 1] = id; q[tail++] = c2 + 1; }
        if (y2 > 0 && alpha[c2 - W] >= 128 && label[c2 - W] === -1) { label[c2 - W] = id; q[tail++] = c2 - W; }
        if (y2 < H - 1 && alpha[c2 + W] >= 128 && label[c2 + W] === -1) { label[c2 + W] = id; q[tail++] = c2 + W; }
      }
      areas.push(cnt);
    }
    var overlap = new Int32Array(areas.length);
    for (i = 0; i < n; i++) { if (fgSeed[i] && label[i] >= 0) overlap[label[i]]++; }
    var keepId = -1, keepN = -1;
    for (i = 0; i < areas.length; i++) {
      if (overlap[i] > 0 && areas[i] > keepN) { keepN = areas[i]; keepId = i; }
    }
    if (keepId < 0 && areas.length) { /* 兜底：取最大块 */
      for (i = 0; i < areas.length; i++) if (areas[i] > keepN) { keepN = areas[i]; keepId = i; }
    }
    for (i = 0; i < n; i++) { if (label[i] !== keepId) alpha[i] = 0; }

    /* 形态学闭运算：填补衣服内部因颜色接近背景而被误删的小洞 */
    var alphaBin = new Uint8Array(n);
    for (i = 0; i < n; i++) alphaBin[i] = alpha[i] >= 128 ? 1 : 0;
    var closed = morphMask(morphMask(alphaBin, W, H, 1, 'max'), W, H, 1, 'min');
    for (i = 0; i < n; i++) {
      if (!closed[i]) alpha[i] = 0;
      else if (alpha[i] < 128) alpha[i] = 160;
    }

    /* 二次精修：主体组件里可能混入了与背景同色的“灰边/灰柱”，
       用锁定后的最终模型再判一次，明显更像背景的像素剔除，避免带出异物/背景 */
    fgG = fitGMM(d, W, H, alpha, 255, 5);
    bgG = fitGMM(d, W, H, alpha, 0, 5);
    for (i = 0; i < n; i++) {
      if (alpha[i] < 128) continue;
      p = i * 4;
      var fScore = gmmScore(d[p], d[p + 1], d[p + 2], fgG);
      var bScore = gmmScore(d[p], d[p + 1], d[p + 2], bgG);
      if (bScore > fScore + 0.5) alpha[i] = 0;
    }

    /* 小连通块清理 + 软边羽化 */
    cleanComponents(alpha, W, H, 0.02);
    var soft = sharpenAlpha(boxBlur(alpha, W, H, 1), 132, 1.7);
    for (i = 0; i < n; i++) alpha[i] = soft[i];

    // 边缘 1-2px 轻微平滑，减少锯齿毛刺
    var edgeSmooth = boxBlur(alpha, W, H, 1);
    for (i = 0; i < n; i++) {
      var diff = Math.abs(edgeSmooth[i] - alpha[i]);
      if (diff > 8 && diff < 120) alpha[i] = alpha[i] * 0.55 + edgeSmooth[i] * 0.45;
    }

    var fc = 0; for (i = 0; i < n; i++) if (alpha[i] > 90) fc++;
    if (fc < 0.004 * n) return { canvas: srcCanvas, failed: true, reason: '没锁定到主体，请多涂抹一些衣服；若衣服贴边，展开「高级」标记背景' };

    var bm = [0, 0, 0], kk;
    for (kk = 0; kk < bgG.K; kk++) { bm[0] += bgG.mu[kk][0] * bgG.w[kk]; bm[1] += bgG.mu[kk][1] * bgG.w[kk]; bm[2] += bgG.mu[kk][2] * bgG.w[kk]; }

    var sw = srcCanvas.width, sh = srcCanvas.height;
    var tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    var tctx = tmp.getContext('2d');
    var ta = tctx.createImageData(W, H);
    for (i = 0; i < n; i++) { ta.data[i * 4] = ta.data[i * 4 + 1] = ta.data[i * 4 + 2] = Math.round(alpha[i]); ta.data[i * 4 + 3] = 255; }
    tctx.putImageData(ta, 0, 0);
    var up = document.createElement('canvas'); up.width = sw; up.height = sh;
    var uctx = up.getContext('2d'); uctx.imageSmoothingQuality = 'high';
    uctx.drawImage(tmp, 0, 0, sw, sh);
    var upA = uctx.getImageData(0, 0, sw, sh).data;

    var fimg = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh);
    var fd = fimg.data;
    for (i = 0; i < sw * sh; i++) {
      var a = upA[i * 4], pp = i * 4;
      if (a <= 0) { fd[pp + 3] = 0; continue; }
      if (a < 250) {
        var f = a / 255;
        fd[pp] = Math.max(0, Math.min(255, (fd[pp] - bm[0] * (1 - f)) / f));
        fd[pp + 1] = Math.max(0, Math.min(255, (fd[pp + 1] - bm[1] * (1 - f)) / f));
        fd[pp + 2] = Math.max(0, Math.min(255, (fd[pp + 2] - bm[2] * (1 - f)) / f));
      }
      fd[pp + 3] = Math.round(a);
    }
    srcCanvas.getContext('2d', { willReadFrequently: true }).putImageData(fimg, 0, 0);
    return { canvas: srcCanvas, failed: false, bg: bm, thr: 0, warn: '' };
  }

  /* ---------- 裁剪 + 特征提取 ---------- */

  function finalize(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var w = canvas.width, h = canvas.height;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;

    var minX = w, minY = h, maxX = -1, maxY = -1, fg = 0;
    var x, y, i;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          fg++;
        }
      }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; fg = w * h; }

    var bw = maxX - minX + 1, bh = maxY - minY + 1;
    var pad = Math.round(Math.max(bw, bh) * 0.02);
    var cx0 = Math.max(0, minX - pad), cy0 = Math.max(0, minY - pad);
    var cx1 = Math.min(w - 1, maxX + pad), cy1 = Math.min(h - 1, maxY + pad);
    var cw = cx1 - cx0 + 1, chh = cy1 - cy0 + 1;

    /* 几何特征（在原始 bbox 内统计） */
    var rowSpan = new Float32Array(bh);
    var rowCenter = new Float32Array(bh);
    for (y = 0; y < bh; y++) {
      var l = -1, r = -1, centerHit = 0, centerTotal = 0;
      var cLo = minX + bw * 0.40, cHi = minX + bw * 0.60;
      for (x = 0; x < bw; x++) {
        var px = minX + x;
        var on = d[((minY + y) * w + px) * 4 + 3] > 90;
        if (on) { if (l < 0) l = x; r = x; }
        if (px >= cLo && px <= cHi) { centerTotal++; if (on) centerHit++; }
      }
      rowSpan[y] = r >= l && l >= 0 ? (r - l + 1) / bw : 0;
      rowCenter[y] = centerTotal ? centerHit / centerTotal : 0;
    }
    function avgSpan(a, b) {
      var s = 0, c = 0;
      for (var k = Math.floor(bh * a); k < Math.floor(bh * b); k++) { if (rowSpan[k] > 0) { s += rowSpan[k]; c++; } }
      return c ? s / c : 0;
    }
    var legGapSum = 0, legRows = 0;
    for (y = Math.floor(bh * 0.58); y < Math.floor(bh * 0.96); y++) {
      if (rowSpan[y] > 0.25) { legGapSum += (1 - rowCenter[y]); legRows++; }
    }

    var feat = {
      aspect: bw / bh,
      fill: fg / (bw * bh),
      area: fg / (w * h),
      topWidth: avgSpan(0.05, 0.33),
      midWidth: avgSpan(0.34, 0.62),
      botWidth: avgSpan(0.63, 0.97),
      legGap: legRows ? legGapSum / legRows : 0
    };

    var out = document.createElement('canvas');
    out.width = cw; out.height = chh;
    out.getContext('2d').drawImage(canvas, cx0, cy0, cw, chh, 0, 0, cw, chh);

    var colors = global.CL.color.extractColors(out.getContext('2d').getImageData(0, 0, cw, chh), 4);

    return { canvas: out, feat: feat, colors: colors };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b); }, type || 'image/png', quality);
    });
  }

  function makeThumb(canvas) {
    var s = Math.min(1, THUMB_SIDE / Math.max(canvas.width, canvas.height));
    if (s >= 1) return canvas;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * s));
    c.height = Math.max(1, Math.round(canvas.height * s));
    var cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- 电商图自动检测：干净白底/纯色底产品区域 ----------
     很多电商图左边是模特街景、右边是纯色底产品平铺。若检测到这种
     干净面板，就自动裁剪到产品区域，后续本地抠图即可得到干净结果。 */

  function detectCleanPanel(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var w = canvas.width, h = canvas.height;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data, n = w * h;

    // 1. 量化颜色，找最可能的背景色
    var map = {}, key, i;
    for (i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      key = (Math.round(r / 8) * 8) + ',' + (Math.round(g / 8) * 8) + ',' + (Math.round(b / 8) * 8);
      map[key] = (map[key] || 0) + 1;
    }
    var bgKey = '', bgCnt = 0;
    for (key in map) { if (map[key] > bgCnt) { bgCnt = map[key]; bgKey = key; } }
    if (!bgKey || bgCnt < n * 0.10) return null;
    var bg = bgKey.split(',').map(Number);

    // 2. 判断每个像素是否是背景
    var isBg = new Uint8Array(n);
    var THR = 18;
    for (i = 0; i < n; i++) {
      var p = i * 4;
      var dr = d[p] - bg[0], dg = d[p + 1] - bg[1], db = d[p + 2] - bg[2];
      isBg[i] = (Math.sqrt(dr * dr + dg * dg + db * db) < THR) ? 1 : 0;
    }

    // 3. 找最大背景连通区域，且它必须接触某条边（说明是背景面板）
    function findLargestBgComponent() {
      var label = new Int32Array(n).fill(-1);
      var areas = [], ids = [];
      var q = new Int32Array(n);
      var x, y, k;
      for (k = 0; k < n; k++) {
        if (!isBg[k] || label[k] !== -1) continue;
        var id = areas.length, head = 0, tail = 0, cnt = 0, touchesEdge = false;
        q[tail++] = k; label[k] = id;
        while (head < tail) {
          var c = q[head++]; cnt++;
          var cx = c % w, cy = (c / w) | 0;
          if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchesEdge = true;
          if (cx > 0 && isBg[c - 1] && label[c - 1] === -1) { label[c - 1] = id; q[tail++] = c - 1; }
          if (cx < w - 1 && isBg[c + 1] && label[c + 1] === -1) { label[c + 1] = id; q[tail++] = c + 1; }
          if (cy > 0 && isBg[c - w] && label[c - w] === -1) { label[c - w] = id; q[tail++] = c - w; }
          if (cy < h - 1 && isBg[c + w] && label[c + w] === -1) { label[c + w] = id; q[tail++] = c + w; }
        }
        areas.push(cnt); ids.push({ id: id, touchesEdge: touchesEdge });
      }
      var best = null, bestCnt = 0;
      for (k = 0; k < areas.length; k++) {
        if (ids[k].touchesEdge && areas[k] > bestCnt) { bestCnt = areas[k]; best = ids[k].id; }
      }
      return best != null ? { label: label, id: best, bestCnt: bestCnt } : null;
    }
    var comp = findLargestBgComponent();
    if (!comp || comp.bestCnt < n * 0.10) return null;

    // 4. 计算背景面板自身的 bbox（不是前景 bbox）
    var label = comp.label;
    var minX = w, minY = h, maxX = -1, maxY = -1, x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var idx = y * w + x;
        if (label[idx] !== comp.id) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    var bw = maxX - minX + 1, bh = maxY - minY + 1, barea = bw * bh;
    if (bw / bh > 6 || bh / bw > 6) return null;

    // 5. 面板填充率要够高（裁剪后得是干净纯色底）
    var bgInBox = 0;
    for (y = minY; y <= maxY; y++) {
      for (x = minX; x <= maxX; x++) {
        if (label[y * w + x] === comp.id) bgInBox++;
      }
    }
    var fill = bgInBox / barea;
    if (fill < 0.55) return null;

    // 6. 面板几乎就是整图时没必要裁剪
    if (barea >= n * 0.82) return null;

    // 7. 裁剪到面板 bbox + 小边距
    var pad = Math.round(Math.max(bw, bh) * 0.01);
    var cx0 = Math.max(0, minX - pad), cy0 = Math.max(0, minY - pad);
    var cx1 = Math.min(w - 1, maxX + pad), cy1 = Math.min(h - 1, maxY + pad);
    var cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;

    var out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, cx0, cy0, cw, ch, 0, 0, cw, ch);
    return { canvas: out, reason: '已自动裁剪到干净产品区域' };
  }

  /* 只保留最大前景连通块，用于去掉电商图面板里的文字/小水印 */
  function keepLargestComponent(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var w = canvas.width, h = canvas.height, n = w * h;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var label = new Int32Array(n).fill(-1);
    var areas = [];
    var q = new Int32Array(n);
    var i, x, y;
    for (i = 0; i < n; i++) {
      if (d[i * 4 + 3] < 128 || label[i] !== -1) continue;
      var id = areas.length, head = 0, tail = 0, cnt = 0;
      q[tail++] = i; label[i] = id;
      while (head < tail) {
        var c = q[head++]; cnt++;
        var cx = c % w, cy = (c / w) | 0;
        if (cx > 0 && d[(c - 1) * 4 + 3] >= 128 && label[c - 1] === -1) { label[c - 1] = id; q[tail++] = c - 1; }
        if (cx < w - 1 && d[(c + 1) * 4 + 3] >= 128 && label[c + 1] === -1) { label[c + 1] = id; q[tail++] = c + 1; }
        if (cy > 0 && d[(c - w) * 4 + 3] >= 128 && label[c - w] === -1) { label[c - w] = id; q[tail++] = c - w; }
        if (cy < h - 1 && d[(c + w) * 4 + 3] >= 128 && label[c + w] === -1) { label[c + w] = id; q[tail++] = c + w; }
      }
      areas.push(cnt);
    }
    var maxId = -1, maxArea = 0;
    for (i = 0; i < areas.length; i++) { if (areas[i] > maxArea) { maxArea = areas[i]; maxId = i; } }
    if (maxArea < 50) return;
    for (i = 0; i < n; i++) { if (label[i] !== maxId) d[i * 4 + 3] = 0; }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- 云端抠图：remove.bg API（可选，需用户填写 API key） ---------- */

  function removeBgCutout(file, apiKey) {
    return new Promise(function (resolve, reject) {
      var objUrl = URL.createObjectURL(file);
      fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        body: (function () {
          var fd = new FormData();
          fd.append('image_file', file);
          fd.append('size', 'auto');
          return fd;
        })()
      }).then(function (r) {
        URL.revokeObjectURL(objUrl);
        if (!r.ok) return r.text().then(function (t) { throw new Error('remove.bg 错误 ' + r.status + ': ' + t); });
        return r.blob();
      }).then(function (blob) {
        return loadBitmap(blob);
      }).then(function (bmp) {
        resolve(drawToCanvas(bmp, MAX_SIDE));
      }).catch(function (e) {
        URL.revokeObjectURL(objUrl);
        reject(e);
      });
    });
  }

  /* ---------- 对外主入口 ---------- */

  /**
   * @param {File|Blob} file
   * @param {{tolerance?:number, keepOriginal?:boolean, region?:object, apiKey?:string}} opts
   *        region: {type:'smart', fg:[{r, pts:[{x,y}...]}], bg?:[{r, pts:[{x,y}...]}]}（坐标 0~1 比例，r 为笔刷半径占长边比例）
   *        apiKey: remove.bg API key
   * @returns {Promise<{blob, thumbBlob, width, height, feat, colors, note}>}
   */
  function prepareCanvas(file) {
    return loadBitmap(file).then(function (b) { return drawToCanvas(b, MAX_SIDE); });
  }

  function cutout(file, opts) {
    opts = opts || {};
    var tolerance = typeof opts.tolerance === 'number' ? opts.tolerance : 0.5;
    var note = '';

    var pipeline;
    if (opts.keepOriginal) {
      pipeline = prepareCanvas(file);
    } else if (opts.apiKey) {
      pipeline = removeBgCutout(file, opts.apiKey).catch(function (e) {
        note = 'remove.bg 失败（' + (e && e.message ? e.message : '网络受限') + '），已改用本地抠图';
        return prepareCanvas(file).then(function (c) { var r = localCutout(c, tolerance); return r.canvas; });
      });
    } else if (opts.region && opts.region.type === 'smart') {
      pipeline = prepareCanvas(file).then(function (c) {
        var r = smartCutout(c, opts.region.fg, { tolerance: tolerance, bgStrokes: opts.region.bg });
        if (r.failed) { var e = new Error(r.reason); e.regionFail = true; throw e; }
        return r.canvas;
      });
    } else {
      pipeline = prepareCanvas(file).then(function (c) {
        // 先尝试检测电商图的干净产品区域
        var panel = detectCleanPanel(c);
        var work = panel ? panel.canvas : c;
        if (panel) note = panel.reason;
        var r = localCutout(work, tolerance);
        if (panel && !r.failed) keepLargestComponent(r.canvas);
        if (r.failed) note = (note ? note + '；' : '') + r.reason + '，已保留原图';
        else if (r.warn) note = (note ? note + '；' : '') + r.warn;
        return r.canvas;
      });
    }

    return pipeline.then(function (canvas) {
      var res = finalize(canvas);
      return Promise.all([
        canvasToBlob(res.canvas, 'image/png'),
        canvasToBlob(makeThumb(res.canvas), 'image/png')
      ]).then(function (blobs) {
        return {
          blob: blobs[0],
          thumbBlob: blobs[1],
          width: res.canvas.width,
          height: res.canvas.height,
          feat: res.feat,
          colors: res.colors,
          note: note
        };
      });
    });
  }

  global.CL = global.CL || {};
  global.CL.segment = { cutout: cutout, loadBitmap: loadBitmap, canvasToBlob: canvasToBlob };
})(window);
