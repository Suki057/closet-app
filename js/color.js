/* 主色提取 + 中文色名 */
(function (global) {
  'use strict';

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  /* 从带 alpha 的 ImageData 中提取主色（量化 + 计数） */
  function extractColors(imgData, topN) {
    var d = imgData.data, buckets = new Map();
    var step = Math.max(1, Math.floor(Math.sqrt(d.length / 4 / 24000)));
    for (var i = 0; i < d.length; i += 4 * step) {
      if (d[i + 3] < 200) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var key = (r >> 4 << 8) | (g >> 4 << 4) | (b >> 4);
      var cur = buckets.get(key);
      if (cur) { cur[0] += r; cur[1] += g; cur[2] += b; cur[3]++; }
      else buckets.set(key, [r, g, b, 1]);
    }
    var arr = Array.from(buckets.values()).sort(function (a, b) { return b[3] - a[3]; });
    var total = arr.reduce(function (s, x) { return s + x[3]; }, 0) || 1;
    var out = [];
    for (var j = 0; j < arr.length && out.length < (topN || 4); j++) {
      var c = arr[j];
      var hex = rgbToHex(c[0] / c[3], c[1] / c[3], c[2] / c[3]);
      // 与已选颜色差异太小则跳过
      var dup = out.some(function (o) { return hexDist(o.hex, hex) < 42; });
      if (dup) continue;
      out.push({ hex: hex, ratio: c[3] / total });
    }
    if (!out.length) out.push({ hex: '#C9C2B8', ratio: 1 });
    return out;
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexDist(a, b) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2));
  }

  var HUES = [
    [12, '红'], [22, '橘红'], [42, '橙'], [58, '黄'], [78, '黄绿'],
    [155, '绿'], [190, '青'], [250, '蓝'], [285, '紫'], [330, '粉'], [360, '红']
  ];

  function colorName(hex) {
    var rgb = hexToRgb(hex);
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0], s = hsl[1], l = hsl[2];

    if (s < 0.10) {
      if (l < 0.14) return '黑';
      if (l < 0.34) return '深灰';
      if (l < 0.62) return '灰';
      if (l < 0.86) return '浅灰';
      return '白';
    }
    if (s < 0.22 && l > 0.72) {
      if (h >= 20 && h <= 60) return '米白';
      return '浅灰';
    }
    // 棕/卡其/驼
    if (h >= 15 && h <= 48) {
      if (l < 0.28) return '深棕';
      if (l < 0.45) return s > 0.45 ? '棕' : '咖啡';
      if (l < 0.68) return s > 0.5 ? '橘' : '驼';
      return '杏';
    }
    var base = '彩';
    for (var i = 0; i < HUES.length; i++) {
      if (h <= HUES[i][0]) { base = HUES[i][1]; break; }
    }
    if (l < 0.26) return '深' + base;
    if (l > 0.78) return '浅' + base;
    if (s < 0.3) return '雾' + base;
    return base;
  }

  global.CL = global.CL || {};
  global.CL.color = {
    rgbToHex: rgbToHex, hexToRgb: hexToRgb, rgbToHsl: rgbToHsl,
    extractColors: extractColors, colorName: colorName, hexDist: hexDist
  };
})(window);
