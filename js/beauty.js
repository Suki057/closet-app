/* 彩妆护肤视图：独立分类、网格、搜索、长按删除；分类「管理」模式（改名/删除/新增，同衣橱） */
(function (global) {
  'use strict';

  var CL = global.CL;
  var state = { cat: 'all', sub: null, q: '', loc: null, menuItemId: null, suppressClick: false, manageMode: false };
  var el = {};
  var longPress = { timer: null, id: null, startX: 0, startY: 0, triggered: false };
  var lastTap = { t: 0, cat: null };       // 手动双击检测（首击会重渲染，原生 dblclick 不触发）
  var pendingDeleteCat = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" class="ico"><path d="' + path + '"/></svg>';
  }

  function beautyCats() {
    return CL.catalog.CATEGORIES.filter(function (c) { return String(c.id).indexOf('beauty-') === 0; });
  }

  function counts() {
    var out = { all: 0 };
    CL.store.items().forEach(function (i) {
      if (String(i.category).indexOf('beauty-') !== 0) return;
      out.all++;
      out[i.category] = (out[i.category] || 0) + 1;
      if (i.sub) out[i.sub] = (out[i.sub] || 0) + 1;
    });
    return out;
  }

  function renderCats() {
    var cnt = counts();
    var html = '<button class="chip ' + (state.cat === 'all' ? 'is-active' : '') + '" data-cat="all">' +
      icon(CL.catalog.ALL_ICON) + '全部<span class="n">' + (cnt.all || 0) + '</span></button>';
    beautyCats().forEach(function (c) {
      var active = (state.cat === c.id && !state.sub) ? ' is-active' : '';
      var managing = state.manageMode ? ' is-managing' : '';
      html += '<button class="chip' + active + managing + '" data-cat="' + c.id + '" title="' + (state.manageMode ? '双击改名，长按删除' : '双击修改名称') + '">' +
        icon(c.icon) + '<span class="chip-name">' + esc(c.name) + '</span><span class="n">' + (cnt[c.id] || 0) + '</span></button>';
    });
    el.cats.innerHTML = html;
    renderSubs();
  }

  function renderSubs() {
    var c = CL.catalog.get(state.cat);
    var subs = CL.catalog.subsOf(state.cat);
    if (state.cat === 'all' || !subs.length || String(state.cat).indexOf('beauty-') !== 0) {
      el.subs.hidden = true; el.subs.innerHTML = ''; return;
    }
    var cnt = counts();
    var html = '<button class="sub-chip ' + (!state.sub ? 'is-active' : '') + (state.manageMode ? ' is-managing' : '') + '" data-sub="">全部' + esc(c.name) + '</button>';
    subs.forEach(function (s) {
      var delBadge = state.manageMode ? '<span class="cat-del" data-act="del-sub" title="删除子分类">×</span>' : '';
      html += '<button class="sub-chip ' + (state.sub === s.id ? 'is-active' : '') + (state.manageMode ? ' is-managing' : '') + '" data-sub="' + s.id + '" title="' + (state.manageMode ? '点击 × 删除子分类' : '') + '">' +
        delBadge + '<span class="chip-name">' + esc(s.name) + '</span><span class="n">' + (cnt[s.id] || 0) + '</span></button>';
    });
    el.subs.innerHTML = html;
    el.subs.hidden = false;
  }

  function filtered() {
    var list = CL.store.items().filter(function (i) {
      if (String(i.category).indexOf('beauty-') !== 0) return false;
      if (state.cat !== 'all') {
        if (i.category !== state.cat) return false;
        if (state.sub && i.sub !== state.sub) return false;
      }
      if (state.loc && i.location !== state.loc) return false;
      return true;
    });
    var q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter(function (i) {
        var hay = [i.name, CL.catalog.name(i.category), CL.catalog.subName(i.category, i.sub), (i.tags || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    return list;
  }

  function cardHtml(i) {
    return '<article class="card card-pure" data-id="' + i.id + '">' +
      '<div class="card-shot"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" onerror="this.parentElement.classList.add(\'no-img\')">' +
        (i.location ? '<span class="card-loc ' + (i.location === 'home' ? 'is-home' : 'is-res') + '">' + (i.location === 'home' ? '家' : '居') + '</span>' : '') +
      '</div>' +
      '<div class="card-name">' + esc(i.name) + '</div>' +
    '</article>';
  }

  function renderPlaces() {
    if (!el.placeHome) return;
    var counts = { home: 0, residence: 0 };
    CL.store.items().forEach(function (i) {
      if (String(i.category).indexOf('beauty-') !== 0) return;
      if (i.location === 'home') counts.home++;
      else if (i.location === 'residence') counts.residence++;
    });
    el.placeHomeNote.textContent = counts.home ? (counts.home + ' 件单品') : '尚未填写';
    el.placeResNote.textContent = counts.residence ? (counts.residence + ' 件单品') : '尚未填写';
    el.placeHome.classList.toggle('is-active', state.loc === 'home');
    el.placeRes.classList.toggle('is-active', state.loc === 'residence');
  }

  function render() {
    renderPlaces();
    renderCats();
    if (!state.loc) {
      el.grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>请选择地点</h3><p>点击「家里」或「现居地」查看对应库存。</p></div>';
      el.empty.hidden = true;
      return;
    }
    var list = filtered();
    el.grid.innerHTML = list.map(cardHtml).join('');
    el.empty.hidden = list.length > 0;
  }

  /* 内联改名：双击分类标题后，在底部栏直接编辑并确认 */
  function startRename(chip) {
    var id = chip.dataset.cat;
    if (!id || id === 'all') return;
    var c = CL.catalog.get(id);
    if (!c || chip.classList.contains('is-editing')) return;
    chip.classList.add('is-editing');
    var nameSpan = chip.querySelector('.chip-name');
    var input = document.createElement('input');
    input.className = 'chip-edit';
    input.value = c.name;
    input.setAttribute('aria-label', '修改分类名称');
    if (nameSpan) nameSpan.parentNode.replaceChild(input, nameSpan);
    var ok = document.createElement('span');
    ok.className = 'chip-ok';
    ok.dataset.act = 'rename-ok';
    ok.textContent = '确定';
    chip.appendChild(ok);

    var finished = false;
    function commit(save) {
      if (finished) return;
      finished = true;
      var v = input.value.trim();
      chip.classList.remove('is-editing');
      if (save && v) CL.catalog.renameCategory(id, v);
      renderCats(); // 仅刷新底部栏（分类名变化），网格不受影响
    }
    input.focus();
    try { input.select(); } catch (e) {}
    ok.addEventListener('click', function (e) { e.stopPropagation(); commit(true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', function () { commit(true); });
  }

  /* 弹出确认框：确认后单品归入「未分类」、分类被移除（单品数据不丢、不复制大图） */
  function confirmDeleteCategory(id) {
    if (id === 'uncategorized' || id === 'beauty-uncategorized' || id === 'all') return; // 受保护，不可删除
    var c = CL.catalog.get(id);
    pendingDeleteCat = id;
    var nameEl = $('beauty-cat-del-name');
    var cntEl = $('beauty-cat-del-count');
    var n = CL.store.items().filter(function (i) { return i.category === id; }).length;
    if (nameEl) nameEl.textContent = c ? c.name : '该分类';
    if (cntEl) cntEl.textContent = String(n);
    CL.ui.openModal('beauty-cat-del-modal');
  }

  /* 删除分类（确认后调用）：先把该分类下全部单品归入「未分类」，再移除分类定义 */
  function deleteCategoryById(id) {
    if (id === 'uncategorized' || id === 'beauty-uncategorized' || id === 'all') return;
    if (state.cat === id) { state.cat = 'all'; state.sub = null; }
    var c = CL.catalog.get(id);
    var name = (c && c.name) || id;
    var n = CL.store.items().filter(function (i) { return i.category === id; }).length;
    CL.store.moveItemsToCategory(id, 'beauty-uncategorized').then(function () {
      CL.catalog.deleteCategory(id);   // 写入删除标记并持久化（重载后不再复活）
      render();
      CL.ui.toast('已删除分类「' + name + '」，' + n + ' 件单品已归入「未分类」');
    }).catch(function (e) {
      console.error(e);
      CL.ui.toast('删除未执行：' + (e && e.message ? e.message : '未知错误') + '，请重试');
    });
  }

  function startLongPress(e, id) {
    clearLongPress();
    longPress.id = id;
    longPress.startX = e.clientX;
    longPress.startY = e.clientY;
    longPress.triggered = false;
    longPress.timer = setTimeout(function () {
      longPress.triggered = true;
      openMenu(id);
    }, 450);
  }
  function clearLongPress() {
    if (longPress.timer) { clearTimeout(longPress.timer); longPress.timer = null; }
    longPress.id = null;
  }
  function openMenu(id) {
    state.menuItemId = id;
    CL.ui.openModal('beauty-menu-modal');
    var card = $('beauty-menu-modal').querySelector('.modal-card');
    if (card) {
      card.setAttribute('tabindex', '-1');
      requestAnimationFrame(function () { try { card.focus(); } catch (e) {} });
    }
  }

  function bind() {
    el.cats = $('beauty-cats');
    el.subs = $('beauty-subs');
    el.grid = $('beauty-grid');
    el.empty = $('beauty-empty');
    el.placeHome = $('place-beauty-home');
    el.placeRes = $('place-beauty-residence');
    el.placeHomeNote = $('place-beauty-home-note');
    el.placeResNote = $('place-beauty-residence-note');

    el.cats.addEventListener('click', function (e) {
      // 刚刚是横向拖动滚动，不当作点击（避免误触）
      if (state.railDragged) { state.railDragged = false; return; }
      // 编辑分类名时，点击输入框/确定按钮不触发筛选或删除
      if (e.target.closest('.chip.is-editing')) return;
      var b = e.target.closest('.chip');
      if (!b || b.id === 'btn-add-beauty-cat') return;
      var cat = b.dataset.cat;
      if (!cat) return;

      // 双击改名（管理/非管理均生效）。「全部」不允许改名，跳过双击检测。
      var now = Date.now();
      if (cat !== 'all' && lastTap.cat === cat && now - lastTap.t < 350) {
        lastTap.t = 0; lastTap.cat = null;
        startRename(b);
        return;
      }
      lastTap = { t: now, cat: cat };

      // 管理模式下点击分类：不选中（再点一次「管理」可退出管理模式、恢复正常选择）
      if (state.manageMode) return;
      state.cat = cat;
      state.sub = null;
      render();
    });

    if (el.subs) el.subs.addEventListener('click', function (e) {
      var del = e.target.closest('.cat-del');
      if (del) {
        e.stopPropagation();
        var b = e.target.closest('.sub-chip');
        var subId = b && b.dataset.sub;
        if (!subId || !state.cat || state.cat === 'all') return;
        if (state.sub === subId) state.sub = null;
        var ids = CL.store.items().filter(function (it) { return it.category === state.cat && it.sub === subId; }).map(function (it) { return it.id; });
        CL.catalog.deleteSubCategory(state.cat, subId);
        if (ids.length) CL.store.bulkPatch(ids, { sub: null });
        else renderSubs();
        CL.ui.toast('已删除子分类' + (ids.length ? '，' + ids.length + ' 件单品已归入「全部' + CL.catalog.name(state.cat) + '」' : ''));
        return;
      }
      if (state.manageMode) return;
      var b2 = e.target.closest('.sub-chip');
      if (!b2) return;
      state.sub = b2.dataset.sub || null;
      render();
    });

    /* 地点板块：家里 / 现居地 */
    var placeWrap = el.placeHome && el.placeHome.closest('.wardrobe-places');
    if (placeWrap) placeWrap.addEventListener('click', function (e) {
      var box = e.target.closest('.place-box[data-loc]');
      if (!box) return;
      var loc = box.dataset.loc;
      state.loc = state.loc === loc ? null : loc;
      state.cat = 'all';
      state.sub = null;
      render();
    });

    $('beauty-search').addEventListener('input', function (e) {
      state.q = e.target.value; render();
    });

    /* 管理分类：新增 / 切换管理模式 */
    $('btn-manage-beauty-cat').addEventListener('click', function (e) {
      state.manageMode = !state.manageMode;
      e.currentTarget.classList.toggle('is-on', state.manageMode);
      render();
    });
    $('btn-add-beauty-cat').addEventListener('click', function () {
      var name = window.prompt('新增彩妆护肤分类名称（如：香水、美甲）：');
      if (name && name.trim()) {
        CL.catalog.addCategory(name.trim(), { beauty: true });
        render();
      }
    });

    /* 删除分类确认框 */
    $('btn-beauty-cat-del-confirm').addEventListener('click', function () {
      CL.ui.closeModal('beauty-cat-del-modal');
      if (pendingDeleteCat) {
        var id = pendingDeleteCat; pendingDeleteCat = null;
        deleteCategoryById(id);
      }
    });
    $('btn-beauty-cat-del-cancel').addEventListener('click', function () {
      pendingDeleteCat = null;
      CL.ui.closeModal('beauty-cat-del-modal');
    });
    // 点遮罩 / ✕ 关闭确认框时也清空待删除标记，避免残留旧 id 被误删
    $('beauty-cat-del-modal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) pendingDeleteCat = null;
    });

    /* 长按图片弹出操作菜单 */
    el.grid.addEventListener('pointerdown', function (e) {
      var shot = e.target.closest('.card-shot');
      var card = e.target.closest('.card');
      if (shot && card) {
        try { e.preventDefault(); } catch (err) {}
        startLongPress(e, card.dataset.id);
      } else clearLongPress();
    });
    el.grid.addEventListener('pointermove', function (e) {
      if (!longPress.timer) return;
      var dx = e.clientX - longPress.startX;
      var dy = e.clientY - longPress.startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearLongPress();
    });
    el.grid.addEventListener('pointerup', function () {
      var triggered = longPress.triggered;
      clearLongPress();
      if (triggered) {
        state.suppressClick = true;
        setTimeout(function () { state.suppressClick = false; }, 60);
      }
    });
    el.grid.addEventListener('pointercancel', clearLongPress);
    el.grid.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.card-shot')) e.preventDefault();
    });

    el.grid.addEventListener('click', function (e) {
      if (state.suppressClick) { e.stopPropagation(); return; }
      var card = e.target.closest('.card');
      if (!card) return;
      CL.wardrobe.openItem(card.dataset.id);
    });

    /* 长按菜单按钮 */
    $('beauty-menu-modal').addEventListener('click', function (e) {
      var btn = e.target.closest('.card-menu-btn');
      if (!btn) return;
      var id = state.menuItemId;
      if (!id) return;
      var act = btn.dataset.act;
      CL.ui.closeModal('beauty-menu-modal');
      if (act === 'edit') {
        CL.wardrobe.openItem(id);
      } else if (act === 'trash') {
        CL.store.deleteItem(id).then(function () {
          CL.ui.toast('已移入回收站（可在回收站恢复）');
        });
      }
    });

    // 底部导航：横向滚动 + 管理模式长按删除分类
    (function setupRail(rail) {
      if (!rail) return;
      var LONG_PRESS = 550;
      var MOVE_THRESHOLD = 10;
      var scroll = { isDown: false, startX: 0, scrollLeft: 0, vel: 0, raf: null, lastT: 0, lastSL: 0 };
      var sort = { timer: null, chip: null };

      function decay() {
        if (Math.abs(scroll.vel) < 0.5) { scroll.raf = null; return; }
        rail.scrollLeft += scroll.vel;
        scroll.vel *= 0.92;
        scroll.raf = requestAnimationFrame(decay);
      }
      function clearLongPress() {
        if (sort.timer) { clearTimeout(sort.timer); sort.timer = null; }
      }

      rail.addEventListener('pointerdown', function (e) {
        state.railDragged = false;
        // 管理模式下：长按某个分类 → 弹出确认框
        if (state.manageMode) {
          var dChip = e.target.closest('.chip[data-cat]');
          if (dChip && dChip.dataset.cat !== 'all' && !dChip.classList.contains('is-editing')) {
            clearLongPress();
            sort.timer = setTimeout(function () {
              if (dChip.classList.contains('is-editing')) return; // 正在改名则不删
              confirmDeleteCategory(dChip.dataset.cat);
            }, LONG_PRESS);
          }
        }
        // 横向滚动（两种模式都启用）
        scroll.isDown = true; scroll.startX = e.clientX; scroll.scrollLeft = rail.scrollLeft;
        scroll.vel = 0; scroll.lastT = Date.now(); scroll.lastSL = scroll.scrollLeft;
        rail.style.cursor = 'grabbing';
        if (scroll.raf) { cancelAnimationFrame(scroll.raf); scroll.raf = null; }
      });

      rail.addEventListener('pointermove', function (e) {
        if (!scroll.isDown) return;
        var dx = e.clientX - scroll.startX;
        var dy = e.clientY - scroll.startY;
        if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
          clearLongPress();
          state.railDragged = true; // 拖动过，松手后抑制 click 误触
        }
        rail.scrollLeft = scroll.scrollLeft + (e.clientX - scroll.startX);
        var now = Date.now();
        scroll.vel = (rail.scrollLeft - scroll.lastSL) / (now - scroll.lastT || 1) * 16 || 0;
        scroll.lastSL = rail.scrollLeft; scroll.lastT = now;
      });

      rail.addEventListener('pointerup', function () {
        clearLongPress();
        scroll.isDown = false; rail.style.cursor = '';
        if (scroll.raf) cancelAnimationFrame(scroll.raf);
        scroll.raf = requestAnimationFrame(decay);
      });
      rail.addEventListener('pointercancel', function () {
        clearLongPress();
        scroll.isDown = false; rail.style.cursor = '';
      });
      rail.addEventListener('pointerleave', function () {
        if (!sort.active) { scroll.isDown = false; rail.style.cursor = ''; }
      });
    })(el.cats);

    CL.store.on('items', render);
    render();
  }

  function init() { bind(); }

  CL.beauty = { init: init, render: render };
})(window);
