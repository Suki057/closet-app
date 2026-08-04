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
    queue: [], idx: 0, file: null, result: null, cat: 'top', tol: 0.5, keep: false, seq: 0,
    nameEdited: false, catPicked: false, previewUrl: null, selImgUrl: null, imgReady: false,
    strokes: [], drawing: false, cur: null, brush: 'fg', brushR: 0.06, sel: null
  };

  function resetImport() {
    imp.queue = []; imp.idx = 0; imp.file = null; imp.result = null; imp.seq++;
    imp.strokes = []; imp.drawing = false; imp.cur = null; imp.imgReady = false; imp.sel = null;
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
    imp.nameEdited = false; imp.catPicked = false;
    imp.tol = 0.5; imp.keep = false; imp.result = null;
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

  function process() {
    var seq = ++imp.seq;
    $('cutout-loading').hidden = false;
    CL.segment.cutout(imp.file, { tolerance: imp.tol, apiKey: settings.apiKey, keepOriginal: imp.keep, region: imp.sel || undefined })
      .then(function (res) {
        if (seq !== imp.seq) return;
        imp.result = res;
        if (imp.previewUrl) URL.revokeObjectURL(imp.previewUrl);
        imp.previewUrl = URL.createObjectURL(res.blob);
        $('cutout-img').src = imp.previewUrl;
        $('cutout-loading').hidden = true;

        var activeView = document.querySelector('.tab.is-active') && document.querySelector('.tab.is-active').dataset.view;
        if (activeView === 'beauty') {
          if (!imp.catPicked) imp.cat = 'beauty-makeup';
        } else {
          var g = CL.catalog.guess(res.feat);
          if (!imp.catPicked) imp.cat = g.category;
        }
        $('auto-tag').textContent = imp.catPicked ? '' :
          '自动识别 · ' + (g.confidence > 0.66 ? '较有把握' : '不太确定，请确认');
        CL.wardrobe.renderCatPicker($('cat-picker'), imp.cat, function (c) {
          imp.cat = c; imp.catPicked = true;
          $('auto-tag').textContent = '';
          if (!imp.nameEdited) $('item-name').value = autoName();
        });
        renderSwatches();
        if (!imp.nameEdited) $('item-name').value = autoName();
        if (res.note) ui.toast(res.note, 3200);
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
        return CL.store.addItem({
          name: $('item-name').value.trim() || autoName(),
          category: imp.cat,
          location: loc,
          img: urls[0] || urls[1],          // dataURL 字符串（主图，稳定存储）
          imgFull: urls[0] || urls[1],      // dataURL 字符串（大图）
          width: res.width,
          height: res.height,
          color: res.colors[0] ? res.colors[0].hex : '#C9C2B8',
          colors: res.colors.map(function (c) { return c.hex; }),
          tags: tags
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
    $('btn-do-cut').addEventListener('click', doCut);
    $('btn-use-all').addEventListener('click', useAll);
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
      CL.home.init();
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
