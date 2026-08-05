/* 类目定义、图标、穿戴槽位与自动分类启发式 */
(function (global) {
  'use strict';

  var P = {
    top:  'M4.2 7.2 8.3 4.2 9.8 5.4a3.6 3.6 0 0 0 4.4 0l1.5-1.2 4.1 3-2.3 3.1-1.6-1.1v10.6H8.1V9.2L6.5 10.3z',
    outer:'M4.2 7.2 8.6 4.2h6.8l4.4 3-2.2 3.2-1.6-1.1v10.5H7.9V9.3L6.3 10.4zM12 4.6v15.2',
    dress:'M9 3h6l-.6 3.4L18.6 21H5.4L9.6 6.4z',
    pants:'M7.4 3h9.2l1.1 18h-4.3L12 10.6 10.6 21H6.3z M7.6 8h8.8',
    skirt:'M8.4 3h7.2l.5 3.2L20 20.4H4l3.9-14.2z',
    shoes:'M3 17.4h5.6l2.6 1.8h9.4a1.4 1.4 0 0 1 1.4 1.4v1.2H3z M3 17.4V12l3.2.6 2.4 4.8',
    bag:  'M4.6 8.2h14.8l1.1 12.4H3.5z M8.6 8.2V6.4a3.4 3.4 0 0 1 6.8 0v1.8',
    hat:  'M6.4 15.4C6.4 9.4 8.6 3.4 12 3.4s5.6 6 5.6 12 M2.5 16.2c0 2 4.2 3.4 9.5 3.4s9.5-1.4 9.5-3.4-4.2-3-9.5-3-9.5 1-9.5 3z',
    acc:  'M5.4 5.6c0 6.4 2.9 9.6 6.6 9.6s6.6-3.2 6.6-9.6 M12 15.2v2.2 M12 21.4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    all:  'M4 6.5h16 M4 12h16 M4 17.5h16',
    custom: 'M12 3l2.4 7.4H22l-6 4.4 2.3 7.2-6-4.4-6 4.4 2.3-7.2-6-4.4h7.6z',
    other: 'M5 5h14v14H5z'
  };

  /* z: 叠放层级；slot: 同槽位互斥；anchor: 人台上的默认位置（百分比）
     subs: 该类目下的二级子类目 */
  var CATEGORIES = [
    { id: 'outer', name: '外套', icon: P.outer, slot: 'outer', z: 40, anchor: { x: 50, y: 13, w: 62 },
      subs: [
        { id: 'outer-coat', name: '大衣' },
        { id: 'outer-jacket', name: '夹克' },
        { id: 'outer-wind', name: '风衣' },
        { id: 'outer-down', name: '羽绒服' },
        { id: 'outer-blazer', name: '西装' },
        { id: 'outer-cardigan', name: '开衫' }
      ] },
    { id: 'top', name: '上衣', icon: P.top, slot: 'top', z: 30, anchor: { x: 50, y: 16, w: 50 },
      subs: [
        { id: 'top-tee', name: 'T恤' },
        { id: 'top-shirt', name: '衬衫' },
        { id: 'top-hoodie', name: '卫衣' },
        { id: 'top-knit', name: '针织衫' },
        { id: 'top-tank', name: '背心' },
        { id: 'top-sweater', name: '毛衣' }
      ] },
    { id: 'dress', name: '连衣裙', icon: P.dress, slot: 'top', z: 28, anchor: { x: 50, y: 16, w: 52 },
      subs: [
        { id: 'dress-long', name: '长裙' },
        { id: 'dress-short', name: '短裙' },
        { id: 'dress-sling', name: '吊带裙' }
      ] },
    { id: 'pants', name: '裤子', icon: P.pants, slot: 'bottom', z: 20, anchor: { x: 50, y: 43, w: 36 },
      subs: [
        { id: 'pants-jeans', name: '牛仔裤' },
        { id: 'pants-casual', name: '休闲裤' },
        { id: 'pants-suit', name: '西裤' },
        { id: 'pants-short', name: '短裤' },
        { id: 'pants-wide', name: '阔腿裤' }
      ] },
    { id: 'skirt', name: '裙子', icon: P.skirt, slot: 'bottom', z: 20, anchor: { x: 50, y: 43, w: 44 },
      subs: [
        { id: 'skirt-half', name: '半身裙' },
        { id: 'skirt-a', name: 'A字裙' },
        { id: 'skirt-long', name: '长裙' }
      ] },
    { id: 'shoes', name: '鞋子', icon: P.shoes, slot: 'shoes', z: 12, anchor: { x: 50, y: 84, w: 30 },
      subs: [
        { id: 'shoes-sneaker', name: '运动鞋' },
        { id: 'shoes-heel', name: '高跟鞋' },
        { id: 'shoes-boot', name: '靴子' },
        { id: 'shoes-sandal', name: '凉鞋' },
        { id: 'shoes-flat', name: '平底鞋' }
      ] },
    { id: 'bag', name: '包包', icon: P.bag, slot: 'bag', z: 50, anchor: { x: 76, y: 45, w: 22 },
      subs: [
        { id: 'bag-tote', name: '手提包' },
        { id: 'bag-back', name: '双肩包' },
        { id: 'bag-cross', name: '斜挎包' },
        { id: 'bag-clutch', name: '手包' }
      ] },
    { id: 'hat', name: '帽子', icon: P.hat, slot: 'hat', z: 55, anchor: { x: 50, y: 1, w: 26 },
      subs: [
        { id: 'hat-cap', name: '棒球帽' },
        { id: 'hat-knit', name: '毛线帽' },
        { id: 'hat-fedora', name: '礼帽' },
        { id: 'hat-bucket', name: '渔夫帽' }
      ] },
    { id: 'acc', name: '首饰', icon: P.acc, slot: 'acc', z: 60, anchor: { x: 50, y: 11, w: 16 }, multi: true,
      subs: [
        { id: 'acc-necklace', name: '项链' },
        { id: 'acc-earring', name: '耳环' },
        { id: 'acc-bracelet', name: '手镯' },
        { id: 'acc-ring', name: '戒指' },
        { id: 'acc-watch', name: '手表' }
      ] },
    /* 未分类：删除其它分类时，其单品暂存于此（受保护，不可被删除，避免无限套娃） */
    { id: 'uncategorized', name: '未分类', icon: P.other, slot: 'top', z: 5, anchor: { x: 50, y: 16, w: 50 }, subs: [] },
    /* 彩妆护肤：独立分组，不在衣橱/搭配间显示 */
    { id: 'beauty-makeup', name: '彩妆', icon: P.custom, slot: 'acc', z: 60, anchor: { x: 50, y: 11, w: 16 }, multi: true,
      subs: [
        { id: 'beauty-makeup-lip', name: '口红' },
        { id: 'beauty-makeup-foundation', name: '粉底' },
        { id: 'beauty-makeup-eyeshadow', name: '眼影' },
        { id: 'beauty-makeup-eyebrow', name: '眉笔' },
        { id: 'beauty-makeup-blush', name: '腮红' },
        { id: 'beauty-makeup-highlighter', name: '高光' },
        { id: 'beauty-makeup-powder', name: '散粉' },
        { id: 'beauty-makeup-mascara', name: '睫毛膏' },
        { id: 'beauty-makeup-eyeliner', name: '眼线' }
      ] },
    { id: 'beauty-skincare', name: '护肤', icon: P.custom, slot: 'acc', z: 60, anchor: { x: 50, y: 11, w: 16 }, multi: true,
      subs: [
        { id: 'beauty-skincare-serum', name: '精华' },
        { id: 'beauty-skincare-cream', name: '面霜' },
        { id: 'beauty-skincare-toner', name: '水乳' },
        { id: 'beauty-skincare-sun', name: '防晒' },
        { id: 'beauty-skincare-mask', name: '面膜' },
        { id: 'beauty-skincare-cleanser', name: '洁面' },
        { id: 'beauty-skincare-eye', name: '眼霜' },
        { id: 'beauty-skincare-remover', name: '卸妆' }
      ] },
    { id: 'beauty-uncategorized', name: '未分类', icon: P.other, slot: 'acc', z: 5, anchor: { x: 50, y: 11, w: 16 }, multi: true, subs: [] }
  ];

  var MAP = {};
  CATEGORIES.forEach(function (c) { MAP[c.id] = c; });

/* 用户自定义类目与重命名持久化 */
var CUSTOM = { renames: {}, custom: [], order: [], deletedSubs: [], deletedDefaults: [] };
function loadCustom() {
  try {
    var raw = localStorage.getItem('CL.catalog.custom');
    if (raw) CUSTOM = JSON.parse(raw);
  } catch (e) {}
}
function saveCustom() {
  try { localStorage.setItem('CL.catalog.custom', JSON.stringify(CUSTOM)); } catch (e) {}
}
loadCustom();
// 防御性补齐：旧版本 / 部分写入的 localStorage 可能缺少某些数组字段，
// 后续代码若直接 .indexOf() 会抛 undefined 错误，导致分类删不掉、删除标记无法持久化。
CUSTOM.custom = CUSTOM.custom || [];
CUSTOM.order = CUSTOM.order || [];
CUSTOM.deletedSubs = CUSTOM.deletedSubs || [];
CUSTOM.deletedDefaults = CUSTOM.deletedDefaults || [];
CUSTOM.renames = CUSTOM.renames || {};

CATEGORIES.forEach(function (c) { if (CUSTOM.renames[c.id]) c.name = CUSTOM.renames[c.id]; });
CUSTOM.custom.forEach(function (c) { if (c && c.id && !MAP[c.id]) { CATEGORIES.push(c); MAP[c.id] = c; } });

/* 应用用户自定义排序 */
if (CUSTOM.order && CUSTOM.order.length) {
  var orderMap = {};
  CUSTOM.order.forEach(function (id, i) { orderMap[id] = i; });
  CATEGORIES.sort(function (a, b) {
    var ia = orderMap[a.id], ib = orderMap[b.id];
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}

  /* 移除已删除的内置分类：删除只改内存，重载时由硬编码列表重建，需此处按 deletedDefaults 过滤 */
  if (CUSTOM.deletedDefaults && CUSTOM.deletedDefaults.length) {
    CATEGORIES = CATEGORIES.filter(function (c) {
      if (CUSTOM.deletedDefaults.indexOf(c.id) >= 0) { delete MAP[c.id]; return false; }
      return true;
    });
  }

  function get(id) { return MAP[id] || MAP.top; }
  function name(id) { return (MAP[id] || {}).name || '其它'; }
  function subsOf(id) {
    var c = MAP[id];
    var arr = (c && c.subs) ? c.subs : [];
    var del = CUSTOM.deletedSubs || [];
    return arr.filter(function (s) {
      return del.indexOf(id + ':' + s.id) < 0;
    });
  }
  function subName(catId, subId) {
    if (!subId) return '';
    var subs = subsOf(catId);
    for (var i = 0; i < subs.length; i++) if (subs[i].id === subId) return subs[i].name;
    return subId;
  }

  function renameCategory(id, name) {
    var c = MAP[id];
    if (!c || !name) return false;
    c.name = name.trim();
    CUSTOM.renames[id] = c.name;
    saveCustom();
    return true;
  }

  function addCategory(name, opts) {
    opts = opts || {};
    name = String(name || '').trim();
    if (!name) return null;
    var id = (opts.beauty ? 'beauty-custom_' : 'custom_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var c;
    if (opts.beauty) {
      c = { id: id, name: name, icon: P.custom, slot: 'acc', z: 60, anchor: { x: 50, y: 11, w: 16 }, multi: true, subs: [] };
    } else {
      var ref = get('top');
      c = {
        id: id, name: name, icon: P.custom, slot: 'top', z: 30,
        anchor: { x: ref.anchor.x, y: ref.anchor.y, w: ref.anchor.w }, subs: []
      };
    }
    CATEGORIES.push(c); MAP[id] = c;
    CUSTOM.custom.push(c);
    CUSTOM.order.push(id);
    saveCustom();
    return c;
  }

  function deleteCategory(id) {
    var idx = CATEGORIES.findIndex(function (c) { return c.id === id; });
    if (idx < 0) return false;
    var c = CATEGORIES[idx];
    // 移除
    CATEGORIES.splice(idx, 1);
    delete MAP[id];
    // 防御性补齐：避免部分写入/旧数据导致 .indexOf() 崩溃
    CUSTOM.custom = CUSTOM.custom || [];
    CUSTOM.order = CUSTOM.order || [];
    CUSTOM.deletedDefaults = CUSTOM.deletedDefaults || [];
    CUSTOM.deletedSubs = CUSTOM.deletedSubs || [];
    // 清理 CUSTOM
    var ci = CUSTOM.custom.findIndex(function (x) { return x.id === id; });
    if (ci >= 0) {
      CUSTOM.custom.splice(ci, 1);            // 自定义分类：从自定义列表移除即不会再被重建
    } else if (CUSTOM.deletedDefaults.indexOf(id) < 0) {
      CUSTOM.deletedDefaults.push(id);        // 内置分类：记录删除，避免重载后被硬编码列表重新加回
    }
    var oi = CUSTOM.order.indexOf(id);
    if (oi >= 0) CUSTOM.order.splice(oi, 1);
    delete CUSTOM.renames[id];
    // 清理该分类下的子分类删除记录
    CUSTOM.deletedSubs = CUSTOM.deletedSubs.filter(function (key) { return key.indexOf(id + ':') !== 0; });
    saveCustom();
    return c;
  }

  function deleteSubCategory(catId, subId) {
    var c = MAP[catId];
    if (!c || !c.subs) return false;
    var idx = c.subs.findIndex(function (s) { return s.id === subId; });
    if (idx < 0) return false;
    c.subs.splice(idx, 1);
    CUSTOM.deletedSubs = CUSTOM.deletedSubs || [];
    var key = catId + ':' + subId;
    if (CUSTOM.deletedSubs.indexOf(key) < 0) CUSTOM.deletedSubs.push(key);
    saveCustom();
    return true;
  }

  function setCategoryOrder(ids) {
    if (!Array.isArray(ids) || !ids.length) return false;
    var orderMap = {};
    ids.forEach(function (id, i) { orderMap[id] = i; });
    CATEGORIES.sort(function (a, b) {
      var ia = orderMap[a.id], ib = orderMap[b.id];
      if (ia === undefined && ib === undefined) return 0;
      if (ia === undefined) return 1;
      if (ib === undefined) return -1;
      return ia - ib;
    });
    CUSTOM.order = ids.slice();
    saveCustom();
    return true;
  }

  /**
   * 根据抠图结果的几何特征推断类目。
   * feat: { aspect(宽/高), fill(前景占包围盒比例), area(占全图比例),
   *         topWidth, midWidth, botWidth (三段平均宽度，归一化到最大宽度),
   *         symmetry, holes(垂直方向中缝空洞比) }
   */
  function guess(feat) {
    var a = feat.aspect, fill = feat.fill;
    var top = feat.topWidth, mid = feat.midWidth, bot = feat.botWidth;
    var score = {};
    function add(id, v) { score[id] = (score[id] || 0) + v; }

    // 极扁 -> 鞋
    if (a > 1.25) { add('shoes', 3.2); add('bag', 0.6); add('acc', 0.4); }
    if (a > 0.95 && a <= 1.25) { add('shoes', 1.4); add('bag', 1.2); add('top', 0.8); }
    // 鞋：底面比鞋帮宽、轮廓不满
    if (a > 1.2 && bot > top * 1.4 && fill < 0.75) add('shoes', 1.5);
    // 包：轮廓饱满近似方形/梯形
    if (fill > 0.82 && a < 1.7 && a > 0.6) { add('bag', 2.2); add('shoes', -1.8); }

    // 宽高接近 1，且顶部有袖子外扩 -> 上衣
    if (a >= 0.72 && a <= 1.15) { add('top', 2.0); }
    if (a >= 0.55 && a < 0.72) { add('skirt', 0.9); add('top', 0.7); add('pants', 0.7); }

    // 细高 -> 裤子 / 连衣裙
    if (a < 0.55) { add('pants', 2.0); add('dress', 1.2); }
    if (a < 0.40) { add('pants', 1.2); add('acc', 0.5); }

    // 上宽下窄 -> 上衣(袖子)；上窄下宽 -> 裙子
    if (top > bot * 1.22) add('top', 1.1);
    // 偏长的上装（肩宽、下摆不散）-> 外套
    if (a >= 0.58 && a <= 0.88 && top > 0.82 && feat.legGap < 0.08) add('outer', 1.4);
    if (bot > top * 1.25) { add('skirt', 1.6); add('dress', 1.0); }
    if (Math.abs(top - bot) < 0.14 && a < 0.62) add('pants', 1.0);

    // 裤腿中缝：下半部分中间空洞明显
    if (feat.legGap > 0.16) { add('pants', 2.2); add('skirt', -1.4); }
    // 下摆实心 → 不是裤子
    if (feat.legGap < 0.07) { add('pants', -1.8); add('dress', 1.0); }
    if (feat.legGap < 0.05 && bot > 0.8 && a < 0.95) add('skirt', 1.0);

    // 很小的面积 + 镂空 -> 首饰
    if (feat.area < 0.055) { add('acc', 2.4); add('top', -1.2); }
    if (feat.area < 0.028) add('acc', 1.2);
    if (feat.area < 0.10 && a > 0.8 && a < 1.3) add('acc', 0.6);

    // 填充率低（镂空多）→ 首饰/包链
    if (fill < 0.33) add('acc', 0.8);
    // 填充率高、方正 → 包
    if (fill > 0.72 && a > 0.75 && a < 1.25 && feat.area > 0.12) add('bag', 1.1);

    var best = 'top', bv = -Infinity, second = 0;
    Object.keys(score).forEach(function (k) {
      if (score[k] > bv) { second = bv; bv = score[k]; best = k; }
      else if (score[k] > second) second = score[k];
    });
    var conf = bv <= 0 ? 0.3 : Math.max(0.3, Math.min(0.95, (bv - Math.max(0, second)) / 3 + 0.42));
    return { category: best, confidence: conf };
  }

  global.CL = global.CL || {};
  global.CL.catalog = {
    CATEGORIES: CATEGORIES, get: get, name: name, guess: guess,
    subsOf: subsOf, subName: subName,
    addCategory: addCategory, renameCategory: renameCategory,
    deleteCategory: deleteCategory,
    deleteSubCategory: deleteSubCategory,
    setCategoryOrder: setCategoryOrder,
    ids: function () { return CATEGORIES.map(function (c) { return c.id; }); },
    ALL_ICON: P.all
  };
})(window);
