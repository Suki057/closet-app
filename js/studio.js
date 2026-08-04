/* 搭配间：人台居中，点击人台弹出分类选品弹窗，支持跨类目多选后确认上身 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var el = {};
  var state = { cat: 'top', layers: [], sel: null, showMannequin: true };
  var picker = { view: 'cats', cat: null, selected: {}, selectedLooks: {} };
  var LOOKS_CAT = '__looks';
  var drag = null;
  var resize = null;
  var mayOpen = false;

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

  /** 非切换地穿上一件：用于弹窗批量确认 */
  function wearOne(itemId) {
    var it = CL.store.getItem(itemId);
    if (!it || findLayerByItem(itemId)) return;
    var cat = CL.catalog.get(it.category);
    var slot = cat.slot;
    if (!cat.multi) clearSlot(slot);
    if (it.category === 'dress') clearSlot('bottom');
    if (slot === 'bottom') state.layers = state.layers.filter(function (l) { return l.cat !== 'dress'; });
    var a = cat.anchor;
    var offset = cat.multi ? state.layers.filter(function (l) { return l.slot === slot; }).length * 4 : 0;
    state.layers.push({
      id: CL.uid('ly'), itemId: itemId, cat: it.category, slot: slot,
      x: a.x, y: a.y + offset, w: a.w, z: cat.z
    });
  }

  function wearLook(look) {
    if (!look || !look.layers) return;
    look.layers.forEach(function (l) {
      if (CL.store.getItem(l.itemId)) wearOne(l.itemId);
    });
  }

  /** 点已穿单品则脱下，未穿则穿上（旧入口/衣橱「加入搭配」） */
  function wear(itemId) {
    var exist = findLayerByItem(itemId);
    if (exist) removeLayer(exist.id); else wearOne(itemId);
    state.sel = null;
    renderAll();
  }

  function takeOffItem(itemId) {
    var l = findLayerByItem(itemId);
    if (l) { removeLayer(l.id); renderAll(); }
  }

  /* ---------------- 渲染 ---------------- */

  function renderStage() {
    var sorted = state.layers.slice().sort(function (a, b) { return a.z - b.z; });
    el.layers.innerHTML = sorted.map(function (l) {
      var it = CL.store.getItem(l.itemId);
      if (!it) return '';
      return '<div class="layer' + (state.sel === l.id ? ' is-sel' : '') + '" data-ly="' + l.id + '" ' +
        'style="left:' + l.x + '%;top:' + l.y + '%;width:' + l.w + '%;z-index:' + l.z + '">' +
        '<img src="' + it.url + '" alt="' + esc(it.name) + '">' +
        (state.sel === l.id ? '<span class="resize-handle" title="拖动调整大小">' +
          '<svg viewBox="0 0 24 24" class="ico">' +
          '<path d="M4 4 L20 20"/><path d="M20 20 H14"/><path d="M20 20 V14"/></svg></span>' : '') +
        '</div>';
    }).join('');
    el.mannequin.classList.toggle('hide', !state.showMannequin);
    el.toolbar.hidden = !state.sel;
    renderWornStrip();
  }

  function renderWornStrip() {
    if (!state.layers.length) {
      el.worn.innerHTML = '<span class="hint">点击人台方框，选择单品进行搭配</span>';
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

  function renderAll() { renderStage(); }

  /* ---------------- 分类弹窗 ---------------- */

  function openPicker() {
    picker.view = 'cats';
    picker.cat = null;
    picker.selected = {};
    picker.selectedLooks = {};
    renderPicker();
    CL.ui.openModal('studio-picker-modal');
  }

  function closePicker() {
    CL.ui.closeModal('studio-picker-modal');
  }

  function selectedCount() {
    return Object.keys(picker.selected).length + Object.keys(picker.selectedLooks).length;
  }

  function renderPicker() {
    el.pickerCats.hidden = picker.view !== 'cats';
    el.pickerItems.hidden = picker.view !== 'items';

    if (picker.view === 'cats') renderPickerCats();
    else renderPickerItems();

    updatePickerFoot();
  }

  function renderPickerCats() {
    var counts = CL.store.countBy();
    var html = CL.catalog.CATEGORIES.map(function (c) {
      if (String(c.id).indexOf('beauty-') === 0) return ''; // 彩妆护肤不参与穿搭
      var n = counts[c.id] || 0;
      return '<button class="studio-cat-card" data-cat="' + c.id + '"' + (n ? '' : ' disabled') + '>' +
        icon(c.icon) +
        '<span class="cat-title">' + esc(c.name) + '</span>' +
        '<span class="cat-count">' + n + ' 件</span>' +
        '</button>';
    }).join('');
    var looks = CL.store.looks();
    html += '<button class="studio-cat-card studio-cat-looks" data-cat="' + LOOKS_CAT + '"' + (looks.length ? '' : ' disabled') + '>' +
      icon('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z') +
      '<span class="cat-title">搭配集</span>' +
      '<span class="cat-count">' + looks.length + ' 套</span>' +
      '</button>';
    el.pickerCats.innerHTML = html;
  }

  function renderPickerItems() {
    var catId = picker.cat;
    if (catId === LOOKS_CAT) {
      var looks = CL.store.looks();
      el.pickerItemsGrid.innerHTML = looks.map(function (lk) {
        var isSel = !!picker.selectedLooks[lk.id];
        return '<button class="studio-pick studio-pick-look' + (isSel ? ' is-sel' : '') + '" data-look-id="' + lk.id + '" title="' + esc(lk.name) + '">' +
          '<img src="' + (lk.coverUrl || lk.thumbUrl || '') + '" alt="' + esc(lk.name) + '" loading="lazy">' +
          '<span class="pick-name">' + esc(lk.name) + '</span></button>';
      }).join('');
      if (!looks.length) {
        el.pickerItemsGrid.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px 0"><p>还没有保存的搭配</p>' +
          '<button class="btn btn-soft btn-sm" data-action="goto-looks" style="margin-top:10px">去搭配集</button></div>';
      }
      return;
    }
    var list = CL.store.itemsOf(catId);
    var wornIds = {};
    state.layers.forEach(function (l) { wornIds[l.itemId] = true; });
    el.pickerItemsGrid.innerHTML = list.map(function (i) {
      var isSel = !!picker.selected[i.id];
      return '<button class="studio-pick' + (isSel ? ' is-sel' : '') + (wornIds[i.id] ? ' is-worn' : '') + '" data-id="' + i.id + '" title="' + esc(i.name) + '">' +
        '<img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy"></button>';
    }).join('');
    if (!list.length) {
      el.pickerItemsGrid.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px 0"><p>这个类目还没有单品</p>' +
        '<button class="btn btn-soft btn-sm" data-action="add" style="margin-top:10px">去添加</button></div>';
    }
  }

  function updatePickerFoot() {
    if (picker.view === 'cats') {
      el.pickerHint.textContent = selectedCount() ? '已选 ' + selectedCount() + ' 件/套' : '点击分类进入选择';
      el.pickerConfirm.textContent = '确认搭配';
      el.pickerConfirm.disabled = selectedCount() === 0;
    } else if (picker.cat === LOOKS_CAT) {
      var n = Object.keys(picker.selectedLooks).length;
      el.pickerHint.textContent = '本类已选 ' + n + ' 套';
      el.pickerConfirm.textContent = '确认';
      el.pickerConfirm.disabled = false;
    } else {
      var n = Object.keys(picker.selected).filter(function (id) {
        var it = CL.store.getItem(id); return it && it.category === picker.cat;
      }).length;
      el.pickerHint.textContent = '本类已选 ' + n + ' 件';
      el.pickerConfirm.textContent = '确认';
      el.pickerConfirm.disabled = false;
    }
  }

  function onPickerCatClick(e) {
    var card = e.target.closest('.studio-cat-card');
    if (!card || card.disabled) return;
    picker.cat = card.dataset.cat;
    picker.view = 'items';
    renderPicker();
  }

  function onPickerItemClick(e) {
    var b = e.target.closest('.studio-pick');
    if (!b) return;
    if (b.dataset.lookId) {
      var lid = b.dataset.lookId;
      if (picker.selectedLooks[lid]) delete picker.selectedLooks[lid]; else picker.selectedLooks[lid] = true;
    } else {
      var id = b.dataset.id;
      if (picker.selected[id]) delete picker.selected[id]; else picker.selected[id] = true;
    }
    renderPickerItems();
    updatePickerFoot();
  }

  function onPickerConfirm() {
    if (picker.view === 'items') {
      picker.view = 'cats';
      renderPicker();
      return;
    }
    Object.keys(picker.selected).forEach(function (id) { wearOne(id); });
    Object.keys(picker.selectedLooks).forEach(function (id) {
      var look = CL.store.looks().find(function (l) { return l.id === id; });
      if (look) wearLook(look);
    });
    state.sel = null;
    renderAll();
    closePicker();
    if (selectedCount()) CL.ui.toast('已加入搭配');
  }

  /* ---------------- 拖拽与调整 ---------------- */

  function onPointerDown(e) {
    var handle = e.target.closest('.resize-handle');
    if (handle) {
      var hNode = handle.closest('.layer');
      var hid = hNode && hNode.dataset.ly;
      var hl = state.layers.find(function (x) { return x.id === hid; });
      if (hl) {
        state.sel = hid;
        var hr = el.stage.getBoundingClientRect();
        resize = { id: hid, sx: e.clientX, sw: hl.w, w: hr.width };
        try { el.stage.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    var node = e.target.closest('.layer');
    if (!node) {
      state.sel = null;
      renderStage();
      mayOpen = true;
      return;
    }
    mayOpen = false;
    var id = node.dataset.ly;
    var l = state.layers.find(function (x) { return x.id === id; });
    if (!l) return;
    state.sel = id;
    renderStage();
    var rect = el.stage.getBoundingClientRect();
    drag = { id: id, sx: e.clientX, sy: e.clientY, ox: l.x, oy: l.y, w: rect.width, h: rect.height, moved: false };
    try { el.stage.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onPointerMove(e) {
    if (resize) {
      var rl = state.layers.find(function (x) { return x.id === resize.id; });
      if (!rl) return;
      var ddx = (e.clientX - resize.sx) / resize.w * 100;
      var nw = Math.max(6, Math.min(140, resize.sw + ddx * 2));
      rl.w = nw;
      var rnode = el.layers.querySelector('[data-ly="' + rl.id + '"]');
      if (rnode) rnode.style.width = nw + '%';
      return;
    }
    if (drag) {
      var l = state.layers.find(function (x) { return x.id === drag.id; });
      if (!l) return;
      var dx = (e.clientX - drag.sx) / drag.w * 100;
      var dy = (e.clientY - drag.sy) / drag.h * 100;
      if (Math.abs(dx) + Math.abs(dy) > 0.4) drag.moved = true;
      mayOpen = false;
      l.x = Math.max(2, Math.min(98, drag.ox + dx));
      l.y = Math.max(-12, Math.min(96, drag.oy + dy));
      var node = el.layers.querySelector('[data-ly="' + l.id + '"]');
      if (node) { node.style.left = l.x + '%'; node.style.top = l.y + '%'; }
    } else if (mayOpen) {
      mayOpen = false;
    }
  }

  function onPointerUp(e) {
    if (resize) { try { el.stage.releasePointerCapture(e.pointerId); } catch (err) {} resize = null; return; }
    if (drag) { try { el.stage.releasePointerCapture(e.pointerId); } catch (err) {} }
    if (!drag && mayOpen) openPicker();
    drag = null; mayOpen = false;
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
      if (!state.layers.some(function (l) { return l.itemId === it.id; })) wearOne(it.id);
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
    el.stage = $('stage');
    el.layers = $('layers');
    el.mannequin = $('mannequin');
    el.toolbar = $('item-toolbar');
    el.worn = $('worn-strip');

    el.pickerModal = $('studio-picker-modal');
    el.pickerCats = $('studio-picker-cats');
    el.pickerItems = $('studio-picker-items');
    el.pickerItemsGrid = $('studio-picker-items-grid');
    el.pickerBack = $('studio-picker-back');
    el.pickerConfirm = $('studio-picker-confirm');
    el.pickerHint = $('studio-picker-hint');

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

    el.worn.addEventListener('click', function (e) {
      var off = e.target.closest('[data-off]');
      if (off) { removeLayer(off.dataset.off); renderAll(); return; }
      var tag = e.target.closest('[data-ly]');
      if (tag) { state.sel = tag.dataset.ly; renderStage(); }
    });

    $('btn-shuffle').addEventListener('click', shuffle);
    $('btn-clear').addEventListener('click', function () {
      state.layers = []; state.sel = null; renderAll();
    });
    $('btn-save-look').addEventListener('click', saveLook);

    el.pickerCats.addEventListener('click', onPickerCatClick);
    el.pickerItemsGrid.addEventListener('click', onPickerItemClick);
    el.pickerBack.addEventListener('click', function () {
      picker.view = 'cats';
      renderPicker();
    });
    el.pickerConfirm.addEventListener('click', onPickerConfirm);

    // 弹窗关闭按钮 / mask
    el.pickerModal.addEventListener('click', function (e) {
      var close = e.target.closest('[data-close]');
      if (close || e.target.classList.contains('modal-mask')) closePicker();
      // 弹窗内「去添加」触发文件选择
      var add = e.target.closest('[data-action="add"]');
      if (add) { closePicker(); var fi = $('file-input'); if (fi) fi.click(); }
      // 搭配集空状态跳转
      var gotoLooks = e.target.closest('[data-action="goto-looks"]');
      if (gotoLooks) { closePicker(); CL.app.go('looks'); }
    });

    CL.store.on('items', function () {
      state.layers = state.layers.filter(function (l) { return CL.store.getItem(l.itemId); });
      renderAll();
      if (!el.pickerModal.hidden) renderPicker();
    });

    renderAll();
  }

  CL.studio = {
    init: init, wear: wear, takeOffItem: takeOffItem, loadLook: loadLook,
    exportPng: exportPng, render: renderAll,
    setMannequin: function (v) { state.showMannequin = v; renderStage(); },
    setCat: function (c) { state.cat = c; }
  };
})(window);
