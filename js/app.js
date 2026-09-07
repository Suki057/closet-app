/* 应用外壳：路由、导入流程、设置、通用 UI */
(function (global) {
  'use strict';

  var CL = global.CL;
  function $(id) { return document.getElementById(id); }

  /* 把 Blob 转成 dataURL 字符串，存入 IndexedDB 比直接存 Blob 更稳（iOS/微信不会丢图） */
  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob) return resolve(null);
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  /* 把任意图源（dataURL 或 Blob）降级成真正的小缩略图 dataURL，避免卡片用全尺寸原图导致卡顿。
     maxW 目标最大宽（默认 480px），quality JPEG 压缩质量。失败返回 null。 */
  function makeThumb(src, maxW, quality) {
    maxW = maxW || 480; quality = (quality == null) ? 0.72 : quality;
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      var url = (typeof src === 'string') ? src : URL.createObjectURL(src);
      var done = false;
      img.onload = function () {
        if (done) return; done = true;
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { if (url !== src) URL.revokeObjectURL(url); return resolve(null); }
          var scale = Math.min(1, maxW / w);
          var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = tw; canvas.height = th;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, tw, th);
          var out = canvas.toDataURL('image/jpeg', quality);
          if (url !== src) URL.revokeObjectURL(url);
          resolve(out);
        } catch (e) { if (url !== src) URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = function () { if (!done) { done = true; if (url !== src) URL.revokeObjectURL(url); resolve(null); } };
      img.src = url;
    });
  }
  CL.makeThumb = makeThumb;

  /* ---------------- 通用 UI ---------------- */

  var toastTimer = null;
  var ui = {
    toast: function (msg, ms) {
      var t = $('toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2200);
    },
    openModal: function (id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; },
    closeModal: function (id) {
      $(id).hidden = true;
      document.body.style.overflow = '';
      if (id === 'import-modal') resetImport();
    },
    download: function (blob, filename) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }
  };
  CL.ui = ui;

  /* ---------------- 分类顺序弹窗排序 ---------------- */
  function hx(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  // slot: 'top'（衣橱）/ 'beauty'（彩妆护肤）
  CL.openCategoryReorder = function (slot) {
    slot = slot === 'beauty' ? 'beauty' : 'top';
    var list = $('cat-reorder-list');
    if (!list) return;
    var ids = CL.catalog.CATEGORIES.filter(function (c) {
      var isBeauty = String(c.id).indexOf('beauty-') === 0;
      return slot === 'beauty' ? isBeauty : !isBeauty;
    }).map(function (c) { return c.id; });
    list.innerHTML = ids.map(function (id) {
      var c = CL.catalog.get(id);
      return '<div class="cat-reorder-item" data-cat="' + id + '">' +
        '<span class="reorder-handle" aria-hidden="true">⋮⋮</span>' +
        '<span class="reorder-name">' + hx(c ? c.name : id) + '</span>' +
      '</div>';
    }).join('');

    CL.ui.openModal('cat-reorder-modal');

    function onSave() {
      var newOrder = Array.prototype.slice.call(list.querySelectorAll('.cat-reorder-item'))
        .map(function (el) { return el.dataset.cat; });
      var other = CL.catalog.CATEGORIES.filter(function (c) {
        var isBeauty = String(c.id).indexOf('beauty-') === 0;
        var inThis = slot === 'beauty' ? isBeauty : !isBeauty;
        return !inThis;
      }).map(function (c) { return c.id; });
      var full = (slot === 'beauty') ? other.concat(newOrder) : newOrder.concat(other);
      CL.catalog.setCategoryOrder(full);
      CL.ui.closeModal('cat-reorder-modal');
      if (slot === 'beauty') CL.beauty.render(); else CL.wardrobe.render();
      CL.ui.toast('分类顺序已保存');
    }
    function onCancel() { CL.ui.closeModal('cat-reorder-modal'); }
    $('btn-cat-reorder-save').onclick = onSave;
    $('btn-cat-reorder-cancel').onclick = onCancel;

    setupReorderDrag(list);
  };

  function setupReorderDrag(list) {
    if (list._reorderBound) return;
    list._reorderBound = true;
    var drag = null;
    list.addEventListener('pointerdown', function (e) {
      var handle = e.target.closest('.reorder-handle');
      if (!handle) return; // 仅通过手柄拖动，避免与列表滚动冲突
      var item = handle.closest('.cat-reorder-item');
      if (!item) return;
      e.preventDefault();
      var rect = item.getBoundingClientRect();
      var clone = item.cloneNode(true);
      clone.classList.add('is-ghost');
      clone.style.width = rect.width + 'px';
      document.body.appendChild(clone);
      item.classList.add('is-dragging');
      drag = { item: item, clone: clone, offY: e.clientY - rect.top, left: rect.left, y: e.clientY, raf: null, dirty: false };

      function positionClone() {
        drag.clone.style.top = (drag.y - drag.offY) + 'px';
        drag.clone.style.left = drag.left + 'px';
      }
      // 计算目标插入位置并用 FLIP 让兄弟项平滑滑动，避免生硬跳变
      function reorder() {
        drag.raf = null;
        if (!drag.dirty) return;
        drag.dirty = false;
        var py = drag.y;
        var sibs = Array.prototype.slice.call(list.children).filter(function (c) { return c !== drag.item; });
        var target = null;
        for (var i = 0; i < sibs.length; i++) {
          var r = sibs[i].getBoundingClientRect();
          if (py < r.top + r.height / 2) { target = sibs[i]; break; }
        }
        var cur = Array.prototype.indexOf.call(list.children, drag.item);
        var tgt = target ? Array.prototype.indexOf.call(list.children, target) : list.children.length;
        if (tgt === cur || tgt === cur + 1) return; // 已在正确位置
        var first = {};
        Array.prototype.forEach.call(list.children, function (el) { first[el.dataset.cat] = el.getBoundingClientRect().top; });
        if (target) list.insertBefore(drag.item, target);
        else list.appendChild(drag.item);
        Array.prototype.forEach.call(list.children, function (el) {
          var last = el.getBoundingClientRect().top;
          var dy = (first[el.dataset.cat] != null ? first[el.dataset.cat] : last) - last;
          if (Math.abs(dy) > 0.5) {
            el.style.transition = 'none';
            el.style.transform = 'translateY(' + dy + 'px)';
            requestAnimationFrame(function () {
              el.style.transition = 'transform .18s ease';
              el.style.transform = '';
            });
          }
        });
      }
      function onMove(ev) {
        drag.y = ev.clientY;
        drag.dirty = true;
        positionClone();
        if (!drag.raf) drag.raf = requestAnimationFrame(reorder);
      }
      function onUp() {
        if (drag.raf) cancelAnimationFrame(drag.raf);
        if (drag.clone) drag.clone.remove();
        drag.item.classList.remove('is-dragging');
        // 清掉重排残留的内联 transform/transition，避免影响后续渲染
        Array.prototype.forEach.call(list.children, function (el) { el.style.transition = ''; el.style.transform = ''; });
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        drag = null;
      }
      positionClone();
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  /* ---------------- 分类改名弹窗（双击底部栏分类触发） ---------------- */
  CL.openCategoryRename = function (slot, catId) {
    slot = slot === 'beauty' ? 'beauty' : 'top';
    var c = CL.catalog.get(catId);
    if (!c) return;
    var input = $('cat-rename-input');
    input.value = c.name;
    CL.ui.openModal('cat-rename-modal');
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 60);
    $('btn-cat-rename-save').onclick = function () {
      var v = input.value.trim();
      if (v) CL.catalog.renameCategory(catId, v); // 按 id 改名，单品以 id 关联，自动同步显示新名称
      CL.ui.closeModal('cat-rename-modal');
      if (slot === 'beauty') CL.beauty.render(); else CL.wardrobe.render();
      CL.ui.toast('分类名称已更新');
    };
  };

  /* ---------------- 设置 ---------------- */

  var settings = {
    ai: localStorage.getItem('closet.ai') === '1',
    apiKey: localStorage.getItem('closet.apiKey') || '',
    mannequin: localStorage.getItem('closet.mannequin') !== '0'
  };

  function applySettings() {
    $('opt-ai-cutout').checked = settings.ai;
    $('opt-api-key').value = settings.apiKey;
    $('opt-mannequin').checked = settings.mannequin;
    CL.studio.setMannequin(settings.mannequin);
  }

  function refreshStat() {
    var s = CL.store;
    $('settings-stat').textContent = '共 ' + s.items().length + ' 件单品 · ' + s.looks().length + ' 套搭配 · 存储：' +
      (CL.db.isMemoryMode() ? '临时内存（当前环境无法持久化，建议用本地服务器打开）' : '浏览器本地');
  }

  /* ---------------- 路由 ---------------- */

  function go(view) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + view);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === view);
    });
    if (view === 'trash' && CL.trash) CL.trash.render();
    if (view === 'beauty' && CL.beauty) CL.beauty.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 导入流程 ---------------- */

  var imp = {
    queue: [], idx: 0, file: null, result: null, cat: 'top', sub: null, tol: 0.5, keep: false, seq: 0,
    nameEdited: false, catPicked: false, subPicked: false, previewUrl: null, selImgUrl: null, imgReady: false,
    strokes: [], drawing: false, cur: null, brush: 'fg', brushR: 0.06, sel: null, slot: null
  };

  function resetImport() {
    imp.queue = []; imp.idx = 0; imp.file = null; imp.result = null; imp.seq++; imp.slot = null;
    imp.strokes = []; imp.drawing = false; imp.cur = null; imp.imgReady = false; imp.sel = null;
    imp.cat = 'top'; imp.sub = null; imp.catPicked = false; imp.subPicked = false;
    if (imp.previewUrl) { URL.revokeObjectURL(imp.previewUrl); imp.previewUrl = null; }
    if (imp.selImgUrl) { URL.revokeObjectURL(imp.selImgUrl); imp.selImgUrl = null; }
  }

  function startImport(files) {
    var imgs = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
    if (!imgs.length) { ui.toast('请选择图片文件'); return; }
    imp.queue = imgs; imp.idx = 0;
    ui.openModal('import-modal');
    loadCurrent();
  }

  function loadCurrent() {
    if (imp.idx >= imp.queue.length) {
      var n = imp.queue.length;
      ui.closeModal('import-modal');
      if (n) ui.toast('导入完成');
      return;
    }
    imp.file = imp.queue[imp.idx];
    imp.nameEdited = false; imp.catPicked = false; imp.subPicked = false; imp.slot = null;
    imp.tol = 0.5; imp.keep = false; imp.result = null; imp.sub = null;
    imp.strokes = []; imp.drawing = false; imp.cur = null; imp.imgReady = false; imp.sel = null;
    imp.brush = 'fg'; imp.brushR = 0.06;
    $('tol-range').value = 50; $('keep-original').checked = false;
    $('item-tags').value = ''; $('brush-size').value = 6;
    setBrush('fg');
    updateTolLabel();
    $('import-counter').textContent = imp.queue.length > 1 ? (imp.idx + 1) + ' / ' + imp.queue.length : '';

    if (imp.selImgUrl) URL.revokeObjectURL(imp.selImgUrl);
    imp.selImgUrl = URL.createObjectURL(imp.file);
    var simg = $('select-img');
    simg.onload = function () {
      imp.imgReady = true;
      sizeOverlay();
      renderStrokes();
    };
    simg.src = imp.selImgUrl;
    showStep('select');
  }

  function defaultSelection() { /* 涂抹式选择，无需默认选区 */ }

  function showStep(step) {
    var isSelect = step === 'select';
    $('select-stage').hidden = !isSelect;
    $('import-body').hidden = isSelect;
    $('import-foot').hidden = isSelect;
    $('import-steps').querySelectorAll('.step').forEach(function (s) {
      s.classList.toggle('is-active', s.dataset.step === step);
    });
  }

  function selFrac(e) {
    var r = $('select-img').getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width;
    var y = (e.clientY - r.top) / r.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function sizeOverlay() {
    var simg = $('select-img');
    var r = simg.getBoundingClientRect();
    var cv = $('sel-canvas');
    cv.width = Math.max(1, Math.round(r.width));
    cv.height = Math.max(1, Math.round(r.height));
  }

  function setBrush(c) {
    imp.brush = c;
    $('brush-fg').classList.toggle('is-active', c === 'fg');
    $('brush-bg').classList.toggle('is-active', c === 'bg');
  }

  function renderStrokes() {
    var cv = $('sel-canvas');
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (var i = 0; i < imp.strokes.length; i++) drawStroke(ctx, cv, imp.strokes[i]);
  }
  function drawStroke(ctx, cv, s) {
    if (!s.pts.length) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c === 'fg' ? 'rgba(52,199,89,0.55)' : 'rgba(255,59,48,0.55)';
    ctx.lineWidth = Math.max(3, s.r * Math.max(cv.width, cv.height));
    ctx.beginPath();
    for (var k = 0; k < s.pts.length; k++) {
      var x = s.pts[k].x * cv.width, y = s.pts[k].y * cv.height;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    var last = s.pts[s.pts.length - 1];
    ctx.fillStyle = s.c === 'fg' ? 'rgba(52,199,89,0.95)' : 'rgba(255,59,48,0.95)';
    ctx.beginPath();
    ctx.arc(last.x * cv.width, last.y * cv.height, Math.max(2, ctx.lineWidth / 2), 0, 7);
    ctx.fill();
  }
  function drawSeg(ctx, cv, s) {
    if (s.pts.length < 2) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c === 'fg' ? 'rgba(52,199,89,0.55)' : 'rgba(255,59,48,0.55)';
    ctx.lineWidth = Math.max(3, s.r * Math.max(cv.width, cv.height));
    var a = s.pts[s.pts.length - 2], b = s.pts[s.pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(a.x * cv.width, a.y * cv.height);
    ctx.lineTo(b.x * cv.width, b.y * cv.height);
    ctx.stroke();
  }

  function onSelDown(e) {
    if (!imp.imgReady) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    var pt = selFrac(e);
    imp.cur = { c: imp.brush, r: imp.brushR, pts: [pt] };
    imp.strokes.push(imp.cur);
    imp.drawing = true;
    drawStroke($('sel-canvas').getContext('2d'), $('sel-canvas'), imp.cur);
  }
  function onSelMove(e) {
    if (!imp.drawing || !imp.cur) return;
    var pt = selFrac(e);
    var last = imp.cur.pts[imp.cur.pts.length - 1];
    if (Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y) > 0.003) {
      imp.cur.pts.push(pt);
      drawSeg($('sel-canvas').getContext('2d'), $('sel-canvas'), imp.cur);
    }
  }
  function onSelUp() {
    if (!imp.drawing) return;
    imp.drawing = false;
    imp.cur = null;
  }

  function undoStroke() {
    imp.strokes.pop();
    renderStrokes();
  }
  function clearStrokes() {
    imp.strokes = [];
    renderStrokes();
  }

  function doCut() {
    if (!imp.imgReady) return;
    var fg = imp.strokes.filter(function (s) { return s.c === 'fg' && s.pts.length; });
    if (!fg.length) { ui.toast('请先用主体笔刷在衣服上涂抹大概位置'); return; }
    var bg = imp.strokes.filter(function (s) { return s.c === 'bg' && s.pts.length; });
    imp.sel = {
      type: 'smart',
      fg: fg.map(function (s) { return { r: s.r, pts: s.pts.slice() }; }),
      bg: bg.map(function (s) { return { r: s.r, pts: s.pts.slice() }; })
    };
    showStep('cut');
    process();
  }

  function useAll() {
    imp.sel = null;
    showStep('cut');
    process();
  }

  function reselect() {
    showStep('select');
    sizeOverlay();
    renderStrokes();
  }

  function updateTolLabel() {
    var v = Number($('tol-range').value);
    $('tol-val').textContent = v < 34 ? '弱' : (v < 67 ? '中' : '强');
  }

  function autoName() {
    var c = (imp.result && imp.result.colors && imp.result.colors[0]) ? imp.result.colors[0].hex : '#C9C2B8';
    return CL.color.colorName(c) + CL.catalog.name(imp.cat);
  }

  function renderSwatches() {
    var cs = (imp.result && imp.result.colors) || [];
    $('swatches').innerHTML = cs.slice(0, 4).map(function (c) {
      return '<span class="swatch" style="background:' + c.hex + '" title="' + c.hex + '"></span>';
    }).join('') + (cs.length ? '<span class="swatch-name">' + CL.color.colorName(cs[0].hex) + '</span>' : '');
  }

  /* 当前所在板块：彩妆护肤 or 衣橱（决定单品归属，两个板块互不打乱） */
  function currentSlot() {
    var av = document.querySelector('.tab.is-active');
    return (av && av.dataset.view === 'beauty') ? 'beauty' : 'top';
  }

  function process() {
    var seq = ++imp.seq;
    imp.slot = currentSlot();
    $('cutout-loading').hidden = false;
    CL.segment.cutout(imp.file, { tolerance: imp.tol, apiKey: settings.apiKey, keepOriginal: imp.keep, region: imp.sel || undefined })
      .then(function (res) {
        if (seq !== imp.seq) return;
        imp.result = res;
        showStep('cut');
        renderResultUI();
      })
      .catch(function (e) {
        if (seq !== imp.seq) return;
        $('cutout-loading').hidden = true;
        console.error(e);
        if (e && e.regionFail) {
          ui.toast(e.message + '，请重新涂抹主体', 3400);
          showStep('select');
          return;
        }
        ui.toast('处理失败：' + (e && e.message ? e.message : '未知错误'));
      });
  }

  /* 直接使用整张原图（不抠背景）：生成与抠图结果同构的 result，直接进入编辑保存步骤 */
  function useOriginal() {
    if (!imp.selImgUrl) return;
    imp.slot = currentSlot();
    var img = new Image();
    img.onload = function () {
      imp.result = {
        blob: imp.file,
        thumbBlob: imp.file,
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
        colors: [],
        feat: null
      };
      showStep('cut');
      renderResultUI();
    };
    img.onerror = function () { ui.toast('图片读取失败，请重试'); };
    img.src = imp.selImgUrl;
  }

  /* 抠图结果 / 直接使用 后，渲染「编辑保存」步骤：
     类目选择器按当前板块筛选；名称默认空白；保存按钮文案随板块变化 */
  function renderResultUI() {
    var res = imp.result;
    if (imp.previewUrl) URL.revokeObjectURL(imp.previewUrl);
    imp.previewUrl = URL.createObjectURL(res.blob);
    $('cutout-img').src = imp.previewUrl;
    $('cutout-loading').hidden = true;

    var slot = imp.slot || currentSlot();
    var guessed = null;
    if (!imp.catPicked) {
      if (slot === 'beauty') {
        imp.cat = 'beauty-makeup';
      } else if (res.feat) {
        guessed = CL.catalog.guess(res.feat);
        imp.cat = guessed.category || 'top';
      } else {
        imp.cat = 'top';
      }
    }

    if (slot === 'beauty') {
      $('auto-tag').textContent = imp.catPicked ? '' : '已归入彩妆护肤';
    } else if (guessed) {
      $('auto-tag').textContent = imp.catPicked ? '' :
        (guessed.confidence > 0.66 ? '自动识别 · 较有把握' : '不太确定，请确认');
    } else {
      $('auto-tag').textContent = '';
    }

    CL.wardrobe.renderCatPicker($('cat-picker'), imp.cat, function (c) {
      imp.cat = c; imp.catPicked = true; imp.sub = null; imp.subPicked = false;
      $('auto-tag').textContent = '';
      CL.wardrobe.renderSubPicker($('sub-picker'), c, null, function (s) {
        imp.sub = s; imp.subPicked = true;
      });
    }, slot);
    CL.wardrobe.renderSubPicker($('sub-picker'), imp.cat, imp.sub, function (s) {
      imp.sub = s; imp.subPicked = true;
    });

    renderSwatches();
    $('item-name').value = '';   // 名称默认空白，需要重新输入
    $('btn-save-item').textContent = (slot === 'beauty') ? '存入彩妆护肤' : '存入衣橱';
    if (res.note) ui.toast(res.note, 3200);
  }

  function askLocation() {
    if (!imp.result) return;
    ui.openModal('loc-modal');
  }

  function doSave(loc) {
    if (!imp.result) return;
    ui.closeModal('loc-modal');
    var tags = $('item-tags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var res = imp.result;
    Promise.all([blobToDataURL(res.blob), blobToDataURL(res.thumbBlob || res.blob)])
      .then(function (urls) {
        var full = urls[0] || urls[1];   // 全尺寸原图（详情/搭配用）
        return makeThumb(full, 480, 0.72).then(function (thumb) {
          return CL.store.addItem({
            name: $('item-name').value.trim() || autoName(),
            category: imp.cat,
            sub: imp.sub,
            location: loc,
            img: thumb || full,          // 真缩略图（卡片网格用，体积大幅减小）
            imgFull: full,               // 全尺寸大图（详情/搭配用，画质不变）
            width: res.width,
            height: res.height,
            color: res.colors[0] ? res.colors[0].hex : '#C9C2B8',
            colors: res.colors.map(function (c) { return c.hex; }),
            tags: tags,
            thumbV: 1                     // 标记已生成真缩略图，避免被迁移重复处理
          });
        });
      })
      .then(function () {
        imp.idx++;
        refreshStat();
        loadCurrent();
      })
      .catch(function (e) {
        console.error(e);
        ui.toast('保存失败：' + (e && e.message ? e.message : '图片处理异常'));
      });
  }

  /* ---------------- 初始化 ---------------- */

  function bind() {
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) go(b.dataset.view);
    });

    $('btn-add').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length) startImport(e.target.files);
      e.target.value = '';
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="add"]')) { $('file-input').click(); return; }
      var g = e.target.closest('[data-goto]');
      if (g) { go(g.dataset.goto); return; }
      var c = e.target.closest('[data-close]');
      if (c) {
        var m = c.closest('.modal');
        if (m) ui.closeModal(m.id);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(function (m) { if (!m.hidden) ui.closeModal(m.id); });
      }
    });

    /* 导入面板控件 */
    $('tol-range').addEventListener('input', updateTolLabel);
    $('tol-range').addEventListener('change', function (e) {
      imp.tol = Number(e.target.value) / 100;
      if (!imp.keep) process();
    });
    $('keep-original').addEventListener('change', function (e) {
      imp.keep = e.target.checked;
      process();
    });
    $('item-name').addEventListener('input', function () { imp.nameEdited = true; });
    $('btn-save-item').addEventListener('click', askLocation);
    $('loc-home').addEventListener('click', function () { doSave('home'); });
    $('loc-residence').addEventListener('click', function () { doSave('residence'); });
    $('btn-skip').addEventListener('click', function () { imp.idx++; loadCurrent(); });

    /* 涂抹式选择交互 */
    $('sel-canvas').addEventListener('pointerdown', onSelDown);
    window.addEventListener('pointermove', onSelMove);
    window.addEventListener('pointerup', onSelUp);
    $('brush-fg').addEventListener('click', function () { setBrush('fg'); });
    $('brush-bg').addEventListener('click', function () { setBrush('bg'); });
    $('sel-adv').addEventListener('change', function (e) {
      $('brush-bg').hidden = !e.target.checked;
      if (!e.target.checked) { setBrush('fg'); }
    });
    $('brush-size').addEventListener('input', function (e) { imp.brushR = Number(e.target.value) / 100; });
    $('btn-undo-sel').addEventListener('click', undoStroke);
    $('btn-clear-sel').addEventListener('click', clearStrokes);
    $('btn-go-cut').addEventListener('click', function () {
      if (imp.strokes.some(function (s) { return s.c === 'fg' && s.pts.length; })) doCut();
      else useAll();
    });
    $('btn-use-direct').addEventListener('click', useOriginal);
    $('btn-reselect').addEventListener('click', reselect);
    window.addEventListener('resize', function () {
      if (!$('import-modal').hidden && !$('select-stage').hidden) { sizeOverlay(); renderStrokes(); }
    });

    /* 设置 */
    $('btn-settings').addEventListener('click', function () { refreshStat(); ui.openModal('settings-modal'); });
    $('opt-ai-cutout').addEventListener('change', function (e) {
      settings.ai = e.target.checked;
      localStorage.setItem('closet.ai', settings.ai ? '1' : '0');
      ui.toast(settings.ai ? '已开启云端 AI 抠图，下次导入生效' : '已关闭云端 AI 抠图');
    });
    $('opt-api-key').addEventListener('input', function (e) {
      settings.apiKey = e.target.value.trim();
      localStorage.setItem('closet.apiKey', settings.apiKey);
    });
    $('opt-mannequin').addEventListener('change', function (e) {
      settings.mannequin = e.target.checked;
      localStorage.setItem('closet.mannequin', settings.mannequin ? '1' : '0');
      CL.studio.setMannequin(settings.mannequin);
    });
    $('btn-wipe').addEventListener('click', function () {
      if (!confirm('将删除全部单品与搭配，且无法恢复。确定继续？')) return;
      CL.store.wipe().then(function () { refreshStat(); ui.toast('已清空'); });
    });

    /* 拖拽导入 */
    var dragDepth = 0;
    function hasFiles(e) {
      return e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], function (t) { return t === 'Files'; });
    }
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth++; $('drop-hint').hidden = false;
    });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $('drop-hint').hidden = true;
    });
    function hideDropHint() { dragDepth = 0; $('drop-hint').hidden = true; }

    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      hideDropHint();
      startImport(e.dataTransfer.files);
    });

    document.addEventListener('click', hideDropHint);
    window.addEventListener('blur', hideDropHint);
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      setTimeout(function () { if (!dragDepth) hideDropHint(); }, 120);
    });

    /* 粘贴导入 */
    window.addEventListener('paste', function (e) {
      if (!e.clipboardData) return;
      var files = Array.prototype.slice.call(e.clipboardData.files || []);
      if (files.length) startImport(files);
    });
  }

  function boot() {
    bind();
    CL.store.init().then(function () {
      CL.wardrobe.init();
      CL.studio.init();
      CL.looks.init();
      CL.beauty.init();
      CL.trash.init();
      applySettings();
      refreshStat();
      CL.store.on('items', refreshStat);
      CL.store.on('looks', refreshStat);
      // 回收站：启动时清理过期单品，并每小时复查一次
      CL.store.purgeExpired();
      setInterval(function () { CL.store.purgeExpired(); }, 60 * 60 * 1000);
      if (CL.db.isMemoryMode()) {
        ui.toast('当前环境无法持久化存储，数据仅保留在本次会话', 4000);
      }
    }).catch(function (e) {
      console.error(e);
      ui.toast('初始化失败：' + (e && e.message ? e.message : ''));
    });
  }

  CL.app = { go: go, startImport: startImport };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
