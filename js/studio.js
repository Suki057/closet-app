/* 搭配间：左侧选品 + 右侧人台实时叠穿，类目与预览双向联动 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var el = {};
  var state = { cat: 'top', layers: [], sel: null, showMannequin: true };
  var drag = null;

  function $(id) { return document.getElementById(id); }
  var esc = function (s) { return CL.wardrobe.esc(s); };
  var icon = function (p) { return CL.wardrobe.icon(p); };

  /* ---------------- 穿脱逻辑 ---------------- */

  function slotOf(cat) { return CL.catalog.get(cat).slot; }

  function findLayerByItem(itemId) {
    return state.layers.find(function (l) { return l.itemId === itemId; }) || null;
  }

  function removeLayer(layerId) {
    state.layers = state.layers.filter(function (l) { return l.id !== layerId; });
    if (state.sel === layerId) state.sel = null;
  }

  function clearSlot(slot) {
    state.layers = state.layers.filter(function (l) {
      if (l.slot !== slot) return true;
      if (state.sel === l.id) state.sel = null;
      return false;
    });
  }

  /** 穿上 / 再次点击则脱下 */
  function wear(itemId) {
    var it = CL.store.getItem(itemId);
    if (!it) return;
    var exist = findLayerByItem(itemId);
    if (exist) { removeLayer(exist.id); renderAll(); return; }

    var cat = CL.catalog.get(it.category);
    var slot = cat.slot;

    if (!cat.multi) clearSlot(slot);
    // 连衣裙与下装互斥
    if (it.category === 'dress') clearSlot('bottom');
    if (slot === 'bottom') {
      state.layers = state.layers.filter(function (l) { return l.cat !== 'dress'; });
    }

    var a = cat.anchor;
    var offset = cat.multi ? state.layers.filter(function (l) { return l.slot === slot; }).length * 4 : 0;
    state.layers.push({
      id: CL.uid('ly'),
      itemId: itemId,
      cat: it.category,
      slot: slot,
      x: a.x, y: a.y + offset, w: a.w, z: cat.z
    });
    state.sel = null;
    renderAll();
  }

  function takeOffItem(itemId) {
    var l = findLayerByItem(itemId);
    if (l) { removeLayer(l.id); renderAll(); }
  }

  /* ---------------- 渲染 ---------------- */

  function renderCats() {
    var counts = CL.store.countBy();
    var wornCats = {};
    state.layers.forEach(function (l) { wornCats[l.cat] = true; });
    el.cats.innerHTML = CL.catalog.CATEGORIES.map(function (c) {
      return '<button class="chip' + (state.cat === c.id ? ' is-active' : '') +
        (wornCats[c.id] ? ' has-worn' : '') + '" data-cat="' + c.id + '">' +
        icon(c.icon) + esc(c.name) + '<span class="n">' + (counts[c.id] || 0) + '</span></button>';
    }).join('');
  }

  function renderPicker() {
    var list = CL.store.itemsOf(state.cat);
    var wornIds = {};
    state.layers.forEach(function (l) { wornIds[l.itemId] = true; });

    el.pickerEmpty.hidden = list.length > 0;
    el.count.textContent = list.length ? CL.catalog.name(state.cat) + ' · ' + list.length + ' 件' : '';
    var hasWornInCat = state.layers.some(function (l) { return l.cat === state.cat; });
    el.takeOff.hidden = !hasWornInCat;

    el.grid.innerHTML = list.map(function (i) {
      return '<button class="pick' + (wornIds[i.id] ? ' is-worn' : '') + '" data-id="' + i.id + '" title="' + esc(i.name) + '">' +
        '<img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy"></button>';
    }).join('');
  }

  function renderStage() {
    var sorted = state.layers.slice().sort(function (a, b) { return a.z - b.z; });
    el.layers.innerHTML = sorted.map(function (l) {
      var it = CL.store.getItem(l.itemId);
      if (!it) return '';
      return '<div class="layer' + (state.sel === l.id ? ' is-sel' : '') + '" data-ly="' + l.id + '" ' +
        'style="left:' + l.x + '%;top:' + l.y + '%;width:' + l.w + '%;z-index:' + l.z + '">' +
        '<img src="' + it.url + '" alt="' + esc(it.name) + '"></div>';
    }).join('');
    el.mannequin.classList.toggle('hide', !state.showMannequin);
    el.toolbar.hidden = !state.sel;
    renderGhost();
    renderWornStrip();
  }

  /** 当前类目为空位时，在人台上显示虚线占位，指明该类目会放在哪 */
  function renderGhost() {
    var c = CL.catalog.get(state.cat);
    var occupied = state.layers.some(function (l) { return l.cat === state.cat; });
    if (occupied) { el.ghost.hidden = true; return; }
    var a = c.anchor;
    el.ghost.hidden = false;
    el.ghost.style.left = a.x + '%';
    el.ghost.style.top = a.y + '%';
    el.ghost.style.width = a.w + '%';
    el.ghost.style.height = (a.w * 1.15) + '%';
    el.ghost.querySelector('span').textContent = c.name;
  }

  function renderWornStrip() {
    if (!state.layers.length) {
      el.worn.innerHTML = '<span class="hint">还没有穿上任何单品，点左边的单品试试</span>';
      return;
    }
    var sorted = state.layers.slice().sort(function (a, b) { return b.z - a.z; });
    el.worn.innerHTML = sorted.map(function (l) {
      var it = CL.store.getItem(l.itemId);
      if (!it) return '';
      return '<span class="worn-tag" data-ly="' + l.id + '"><img src="' + it.thumbUrl + '" alt="">' +
        esc(it.name) + '<button data-off="' + l.id + '" title="脱下">' +
        '<svg viewBox="0 0 24 24" class="ico" style="width:13px;height:13px"><path d="M18 6L6 18M6 6l12 12"/></svg></button></span>';
    }).join('');
  }

  function renderAll() { renderCats(); renderPicker(); renderStage(); }

  function flashLayerOfCat(cat) {
    var l = state.layers.find(function (x) { return x.cat === cat; });
    if (!l) return;
    var node = el.layers.querySelector('[data-ly="' + l.id + '"]');
    if (!node) return;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  /* ---------------- 拖拽与调整 ---------------- */

  function onPointerDown(e) {
    var node = e.target.closest('.layer');
    if (!node) { state.sel = null; renderStage(); return; }
    var id = node.dataset.ly;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l) return;
    state.sel = id;
    renderStage();
    var rect = el.stage.getBoundingClientRect();
    drag = { id: id, sx: e.clientX, sy: e.clientY, ox: l.x, oy: l.y, w: rect.width, h: rect.height, moved: false };
    el.stage.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!drag) return;
    var l = state.layers.find(function (x) { return x.id === drag.id; });
    if (!l) return;
    var dx = (e.clientX - drag.sx) / drag.w * 100;
    var dy = (e.clientY - drag.sy) / drag.h * 100;
    if (Math.abs(dx) + Math.abs(dy) > 0.4) drag.moved = true;
    l.x = Math.max(2, Math.min(98, drag.ox + dx));
    l.y = Math.max(-12, Math.min(96, drag.oy + dy));
    var node = el.layers.querySelector('[data-ly="' + l.id + '"]');
    if (node) { node.style.left = l.x + '%'; node.style.top = l.y + '%'; }
  }

  function onPointerUp(e) {
    if (drag) { try { el.stage.releasePointerCapture(e.pointerId); } catch (err) {} }
    drag = null;
  }

  function adjust(act) {
    var l = state.layers.find(function (x) { return x.id === state.sel; });
    if (!l) return;
    if (act === 'bigger') l.w = Math.min(140, l.w * 1.08);
    else if (act === 'smaller') l.w = Math.max(6, l.w / 1.08);
    else if (act === 'up') l.z = Math.min(99, l.z + 6);
    else if (act === 'down') l.z = Math.max(1, l.z - 6);
    else if (act === 'reset') {
      var a = CL.catalog.get(l.cat).anchor;
      l.x = a.x; l.y = a.y; l.w = a.w; l.z = CL.catalog.get(l.cat).z;
    } else if (act === 'remove') { removeLayer(l.id); }
    renderAll();
  }

  /* ---------------- 随机 / 清空 / 保存 ---------------- */

  function shuffle() {
    state.layers = [];
    state.sel = null;
    var pick = function (cat) {
      var list = CL.store.itemsOf(cat);
      return list.length ? list[Math.floor(Math.random() * list.length)] : null;
    };
    var chosen = [];
    var dresses = CL.store.itemsOf('dress');
    var useDress = dresses.length && Math.random() < 0.35;
    if (useDress) chosen.push(dresses[Math.floor(Math.random() * dresses.length)]);
    else {
      chosen.push(pick('top'));
      var bottoms = CL.store.itemsOf('pants').concat(CL.store.itemsOf('skirt'));
      if (bottoms.length) chosen.push(bottoms[Math.floor(Math.random() * bottoms.length)]);
    }
    chosen.push(pick('shoes'));
    if (Math.random() < 0.45) chosen.push(pick('outer'));
    if (Math.random() < 0.45) chosen.push(pick('bag'));
    if (Math.random() < 0.4) chosen.push(pick('acc'));

    chosen.filter(Boolean).forEach(function (it) {
      var c = CL.catalog.get(it.category), a = c.anchor;
      if (!state.layers.some(function (l) { return l.itemId === it.id; })) {
        state.layers.push({ id: CL.uid('ly'), itemId: it.id, cat: it.category, slot: c.slot, x: a.x, y: a.y, w: a.w, z: c.z });
      }
    });
    renderAll();
    if (!state.layers.length) CL.ui.toast('衣橱里还没有单品');
  }

  var MANNEQUIN = [
    'M130 100 Q190 88 250 100 L240 246 Q190 258 140 246 Z',
    'M140 244 Q190 256 240 244 L248 336 Q190 352 132 336 Z',
    'M133 104 L114 111 L98 300 Q97 310 106 312 Q115 314 117 304 Z',
    'M247 104 L266 111 L282 300 Q283 310 274 312 Q265 314 263 304 Z',
    'M148 332 L180 332 L177 566 Q177 576 167 576 Q157 576 156 566 Z',
    'M232 332 L200 332 L203 566 Q203 576 213 576 Q223 576 224 566 Z'
  ];

  function loadImg(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = rej;
      im.src = src;
    });
  }

  function composite(scale) {
    scale = scale || 2;
    var W = 380 * scale, H = 620 * scale;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');

    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(1, '#F1ECE4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (state.showMannequin) {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.fillStyle = '#E8E2DA';
      ctx.beginPath(); ctx.ellipse(190, 52, 28, 34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.rect(177, 80, 26, 22); ctx.fill();
      MANNEQUIN.forEach(function (d) { ctx.fill(new Path2D(d)); });
      ctx.restore();
    }

    var sorted = state.layers.slice().sort(function (a, b) { return a.z - b.z; });
    var jobs = sorted.map(function (l) {
      var it = CL.store.getItem(l.itemId);
      if (!it) return null;
      return loadImg(it.url).then(function (im) { return { im: im, l: l }; });
    }).filter(Boolean);

    return Promise.all(jobs).then(function (arr) {
      arr.forEach(function (o) {
        var dw = o.l.w / 100 * W;
        var dh = dw * (o.im.naturalHeight / o.im.naturalWidth);
        var dx = o.l.x / 100 * W - dw / 2;
        var dy = o.l.y / 100 * H;
        ctx.drawImage(o.im, dx, dy, dw, dh);
      });
      return c;
    });
  }

  function saveLook() {
    if (!state.layers.length) { CL.ui.toast('先搭一套再保存'); return; }
    composite(2).then(function (canvas) {
      return CL.segment.canvasToBlob(canvas, 'image/png');
    }).then(function (blob) {
      var d = new Date();
      var name = (d.getMonth() + 1) + '月' + d.getDate() + '日的搭配';
      return CL.store.addLook({
        name: name,
        layers: state.layers.map(function (l) {
          return { itemId: l.itemId, cat: l.cat, slot: l.slot, x: l.x, y: l.y, w: l.w, z: l.z };
        }),
        coverBlob: blob
      });
    }).then(function () {
      CL.ui.toast('已保存到搭配集');
      CL.app.go('looks');
    }).catch(function (e) {
      console.error(e);
      CL.ui.toast('保存失败：' + (e && e.message ? e.message : '未知错误'));
    });
  }

  function loadLook(look) {
    state.layers = (look.layers || []).filter(function (l) { return CL.store.getItem(l.itemId); })
      .map(function (l) { return Object.assign({ id: CL.uid('ly') }, l); });
    state.sel = null;
    renderAll();
  }

  function exportPng() {
    if (!state.layers.length) { CL.ui.toast('先搭一套'); return; }
    composite(3).then(function (canvas) {
      return CL.segment.canvasToBlob(canvas, 'image/png');
    }).then(function (blob) { CL.ui.download(blob, '搭配.png'); });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    el.cats = $('studio-cats');
    el.grid = $('picker-grid');
    el.pickerEmpty = $('picker-empty');
    el.count = $('picker-count');
    el.takeOff = $('btn-take-off');
    el.stage = $('stage');
    el.layers = $('layers');
    el.mannequin = $('mannequin');
    el.ghost = $('ghost-slot');
    el.toolbar = $('item-toolbar');
    el.worn = $('worn-strip');

    el.cats.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      renderCats(); renderPicker(); renderGhost();
      flashLayerOfCat(state.cat);
    });

    el.grid.addEventListener('click', function (e) {
      var b = e.target.closest('.pick');
      if (!b) return;
      wear(b.dataset.id);
    });

    el.takeOff.addEventListener('click', function () {
      state.layers = state.layers.filter(function (l) { return l.cat !== state.cat; });
      state.sel = null;
      renderAll();
    });

    el.worn.addEventListener('click', function (e) {
      var off = e.target.closest('[data-off]');
      if (off) { removeLayer(off.dataset.off); renderAll(); return; }
      var tag = e.target.closest('[data-ly]');
      if (tag) { state.sel = tag.dataset.ly; renderStage(); }
    });

    el.stage.addEventListener('pointerdown', onPointerDown);
    el.stage.addEventListener('pointermove', onPointerMove);
    el.stage.addEventListener('pointerup', onPointerUp);
    el.stage.addEventListener('pointercancel', onPointerUp);
    el.stage.addEventListener('wheel', function (e) {
      if (!state.sel) return;
      e.preventDefault();
      adjust(e.deltaY < 0 ? 'bigger' : 'smaller');
    }, { passive: false });

    el.toolbar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b) adjust(b.dataset.act);
    });

    $('btn-shuffle').addEventListener('click', shuffle);
    $('btn-clear').addEventListener('click', function () {
      state.layers = []; state.sel = null; renderAll();
    });
    $('btn-save-look').addEventListener('click', saveLook);

    CL.store.on('items', function () {
      state.layers = state.layers.filter(function (l) { return CL.store.getItem(l.itemId); });
      renderAll();
    });

    renderAll();
  }

  CL.studio = {
    init: init, wear: wear, takeOffItem: takeOffItem, loadLook: loadLook,
    exportPng: exportPng, render: renderAll,
    setMannequin: function (v) { state.showMannequin = v; renderStage(); },
    setCat: function (c) { state.cat = c; renderCats(); renderPicker(); renderGhost(); }
  };
})(window);
