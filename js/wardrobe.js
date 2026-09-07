/* 衣橱视图：类目筛选、搜索、卡片网格、单品详情编辑 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var state = { cat: 'all', sub: null, q: '', favOnly: false, loc: null, editing: null, editingSub: null, manageMode: false, railDragged: false, menuItemId: null, suppressClick: false };
  var longPress = { timer: null, id: null, startX: 0, startY: 0, triggered: false };
  var lastTap = { t: 0, cat: null };      // 手动双击检测（首击会重渲染，原生 dblclick 不触发）
  var pendingDeleteCat = null;            // 待确认删除的分类 id

  var el = {};

  function $(id) { return document.getElementById(id); }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" class="ico"><path d="' + path + '"/></svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function renderCats() {
    // 在 wardrobe.js 内部自己计数，避免旧版 store.js 缓存中的 countBy() 不过滤 deletedAt
    var counts = { all: 0 };
    CL.store.items().forEach(function (i) {
      if (String(i.category).indexOf('beauty-') === 0) return; // 彩妆护肤在独立视图管理
      counts.all++;
      counts[i.category] = (counts[i.category] || 0) + 1;
    });
    var html = '<button class="chip ' + (state.cat === 'all' ? 'is-active' : '') + '" data-cat="all">' +
      icon(CL.catalog.ALL_ICON) + '全部<span class="n">' + (counts.all || 0) + '</span></button>';
    CL.catalog.CATEGORIES.forEach(function (c) {
      if (String(c.id).indexOf('beauty-') === 0) return;
      var active = (state.cat === c.id && !state.sub) ? ' is-active' : '';
      var managing = state.manageMode ? ' is-managing' : '';
      html += '<button class="chip' + active + managing + '" data-cat="' + c.id + '" title="' + (state.manageMode ? '长按删除，双击改名' : '双击修改名称，长按拖拽排序') + '">' +
        icon(c.icon) + '<span class="chip-name">' + esc(c.name) + '</span><span class="n">' + (counts[c.id] || 0) + '</span></button>';
    });
    el.cats.innerHTML = html;
    renderSubs();
  }

  function renderSubs() {
    if (!el.subs) return;
    var c = CL.catalog.get(state.cat);
    var subs = CL.catalog.subsOf(state.cat);
    if (state.cat === 'all' || !subs.length) { el.subs.hidden = true; el.subs.innerHTML = ''; return; }
    // 同样在 wardrobe.js 内部计数，绕开旧版 store.countBySub()
    var counts = {};
    CL.store.items().forEach(function (i) {
      if (i.category !== state.cat) return;
      var k = i.sub || '__none';
      counts[k] = (counts[k] || 0) + 1;
    });
    var html = '<button class="sub-chip ' + (!state.sub ? 'is-active' : '') + (state.manageMode ? ' is-managing' : '') + '" data-sub="">' +
      '全部' + (c ? esc(c.name) : '') + '</button>';
    subs.forEach(function (s) {
      var delBadge = state.manageMode ? '<span class="cat-del" data-act="del-sub" title="删除子分类">×</span>' : '';
      html += '<button class="sub-chip ' + (state.sub === s.id ? 'is-active' : '') + (state.manageMode ? ' is-managing' : '') + '" data-sub="' + s.id + '" title="' + (state.manageMode ? '点击 × 删除子分类' : '') + '">' +
        delBadge + '<span class="chip-name">' + esc(s.name) + '</span><span class="n">' + (counts[s.id] || 0) + '</span></button>';
    });
    el.subs.innerHTML = html;
    el.subs.hidden = false;
  }

  function filtered() {
    if (!state.loc) return []; // 未选择地点时衣橱网格为空
    var list = CL.store.itemsOf(state.cat, state.sub);
    list = list.filter(function (i) { return i.location === state.loc; });
    // 与彩妆护肤严格隔离：衣橱只显示非 beauty- 类目（全部视图下不会混入彩妆单品）
    list = list.filter(function (i) { return String(i.category).indexOf('beauty-') !== 0; });
    if (state.favOnly) list = list.filter(function (i) { return i.favorite; });
    var q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter(function (i) {
        var hay = [i.name, CL.catalog.name(i.category), CL.catalog.subName(i.category, i.sub), (i.tags || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    return list;
  }

  /* 仅刷新底部栏（分类/子类/地点），不碰图片网格——成本极低，用于分类增删改名排序 */
  function renderBar() {
    renderCats();
    renderSubs();
    renderPlaces();
  }

  var lastGridKey = '';
  /* 视口驱动：旧单品（未生成真缩略图）的卡片进入视口时才登记懒降级，避免一次性解码大图卡 UI */
  var thumbObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        var id = en.target.getAttribute('data-id');
        if (id) CL.store.requestThumb(id);
        thumbObserver.unobserve(en.target);
      }
    });
  }, { rootMargin: '300px' }) : null;
  function renderGrid() {
    if (!state.loc) {
      el.grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>请选择地点</h3><p>点击「家里」或「现居地」查看对应库存。</p></div>';
      lastGridKey = '__needloc';
      return;
    }
    var list = filtered();
    // 可见集合签名：若当前筛选下实际显示的单品集合没变，则不重绘图片网格，
    // 避免大图重新解码导致卡顿（删除/新增分类、改名、排序时尤其明显）
    var key = state.cat + '|' + state.sub + '|' + state.loc + '|' + state.favOnly + '|' + state.q + '|' + list.length +
      '#' + list.map(function (i) { return i.id; }).join(',');
    if (key === lastGridKey) return;
    lastGridKey = key;
    if (!list.length && CL.store.items().length > 0) {
      el.grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>没有匹配的单品</h3><p>换个类目或关键词试试。</p></div>';
      return;
    }
    el.grid.innerHTML = list.map(function (i) {
      var qty = (i.quantity && i.quantity > 0) ? i.quantity : 1;
      return       '<article class="card card-pure' + (i.favorite ? ' is-fav' : '') + '" data-id="' + i.id + '">' +
        '<div class="card-shot" data-name="' + esc(i.name) + '"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy" decoding="async" onerror="this.closest(\'.card-shot\').classList.add(\'no-img\')">' +
          (i.location ? '<span class="card-loc ' + (i.location === 'home' ? 'is-home' : 'is-res') + '">' + (i.location === 'home' ? '家' : '居') + '</span>' : '') +
          (qty > 1 ? '<span class="card-qty">×' + qty + '</span>' : '') +
        '</div>' +
        '<div class="card-name">' + esc(i.name) + '</div>' +
      '</article>';
    }).join('');
    // 给未降级（仍是全尺寸原图）的卡片登记懒缩略图：进入视口 + 浏览器空闲时才解码，不卡 UI
    if (thumbObserver) {
      thumbObserver.disconnect();
      el.grid.querySelectorAll('.card[data-id]').forEach(function (card) {
        var it = CL.store.getItem(card.getAttribute('data-id'));
        if (it && it.thumbV !== 1) thumbObserver.observe(card);
      });
    }
  }

  function render() {
    renderBar();
    renderGrid();
  }

  /* ---------- 详情弹窗 ---------- */

  function openDetail(id) {
    var it = CL.store.getItem(id);
    if (!it) return;
    state.editing = id;
    var dimg = $('detail-img');
    dimg.classList.remove('no-img');
    dimg.onerror = function () { dimg.classList.add('no-img'); };
    dimg.src = it.url;
    $('detail-name').value = it.name;
    $('detail-tags').value = (it.tags || []).join(', ');
    $('detail-qty').value = (it.quantity && it.quantity > 0) ? it.quantity : 1;
    state.editingCat = it.category;
    state.editingSub = it.sub || null;
    var slot = (String(it.category).indexOf('beauty-') === 0) ? 'beauty' : 'top';
    renderCatPicker($('detail-cat'), it.category, function (c) {
      state.editingCat = c;
      state.editingSub = null;
      renderSubPicker($('detail-sub'), c, null);
    }, slot);
    renderSubPicker($('detail-sub'), it.category, it.sub || null);
    CL.ui.openModal('item-modal');
  }

  function renderCatPicker(box, active, onPick, slot) {
    var cats = CL.catalog.CATEGORIES;
    // 按板块隔离：衣橱只列非 beauty- 类目，彩妆护肤只列 beauty- 类目
    if (slot === 'beauty') cats = cats.filter(function (c) { return String(c.id).indexOf('beauty-') === 0; });
    else if (slot === 'top') cats = cats.filter(function (c) { return String(c.id).indexOf('beauty-') !== 0; });
    box.innerHTML = cats.map(function (c) {
      return '<button class="cat-opt' + (c.id === active ? ' is-active' : '') + '" data-cat="' + c.id + '">' +
        icon(c.icon) + esc(c.name) + '</button>';
    }).join('');
    box.onclick = function (e) {
      var b = e.target.closest('.cat-opt');
      if (!b) return;
      box.querySelectorAll('.cat-opt').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      onPick(b.dataset.cat);
    };
  }

  function renderSubPicker(box, catId, activeSub, onPick) {
    var subs = CL.catalog.subsOf(catId);
    if (!subs.length) { box.innerHTML = '<span class="sub-empty">该类目暂无细分</span>'; return; }
    box.innerHTML = subs.map(function (s) {
      return '<button class="cat-opt sub-opt' + (s.id === activeSub ? ' is-active' : '') + '" data-sub="' + s.id + '">' + esc(s.name) + '</button>';
    }).join('');
    box.onclick = function (e) {
      var b = e.target.closest('.sub-opt');
      if (!b) return;
      box.querySelectorAll('.sub-opt').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      if (typeof onPick === 'function') onPick(b.dataset.sub);
      else state.editingSub = b.dataset.sub;
    };
  }

  function setCat(cat, sub) {
    state.cat = cat || 'all';
    state.sub = sub || null;
    render();
  }

  /* 分类改名改由弹窗（CL.openCategoryRename）处理，双击底部栏分类触发 */

  /* 弹出确认框：确认后单品归入「未分类」、分类被移除 */
  function confirmDeleteCategory(id) {
    if (id === 'uncategorized' || id === 'all') return; // 受保护，不可删除
    var c = CL.catalog.get(id);
    pendingDeleteCat = id;
    var nameEl = $('cat-del-name');
    var cntEl = $('cat-del-count');
    var n = CL.store.items().filter(function (i) { return i.category === id; }).length;
    if (nameEl) nameEl.textContent = c ? c.name : '该分类';
    if (cntEl) cntEl.textContent = String(n);
    CL.ui.openModal('cat-del-modal');
  }

  /* 删除分类（确认后调用）：先把该分类下全部单品归入「未分类」，再移除分类定义。
     单品数据不丢、不复制大图，因此任何设备上都一定能删得动；重载后分类不会复活。 */
  function deleteCategoryById(id) {
    if (id === 'uncategorized' || id === 'all') return;
    if (state.cat === id) state.cat = 'all';
    var c = CL.catalog.get(id);
    var name = (c && c.name) || id;
    var n = CL.store.items().filter(function (i) { return i.category === id; }).length;
    CL.store.moveItemsToCategory(id, 'uncategorized').then(function () {
      CL.catalog.deleteCategory(id);   // 写入删除标记并持久化（重载后不再复活）
      renderBar();
      CL.ui.toast('已删除分类「' + name + '」，' + n + ' 件单品已归入「未分类」');
    }).catch(function (e) {
      console.error(e);
      // 写库失败：不删除分类、不动单品，避免脏状态；给出清晰原因
      CL.ui.toast('删除未执行：' + (e && e.message ? e.message : '未知错误') + '，请重试');
    });
  }

  /* ---------- 长按菜单 ---------- */
  function startLongPress(e, id) {
    clearLongPress();
    longPress.id = id;
    longPress.startX = e.clientX;
    longPress.startY = e.clientY;
    longPress.triggered = false;
    longPress.timer = setTimeout(function () {
      longPress.triggered = true;
      openCardMenu(id);
    }, 450);
  }
  function clearLongPress() {
    if (longPress.timer) { clearTimeout(longPress.timer); longPress.timer = null; }
    longPress.id = null;
  }
  function openCardMenu(id) {
    var it = CL.store.getItem(id);
    if (!it) return;
    state.menuItemId = id;
    var moveBtn = $('card-menu-move');
    if (moveBtn) moveBtn.textContent = it.location === 'home' ? '移到现居地' : '移到家里';
    CL.ui.openModal('card-menu-modal');
    // 不再自动聚焦弹窗容器：手机端(long-press 手势刚结束)里程序化聚焦会"吃掉"用户第一次点击，
    // 表现为「点编辑要点两次」。菜单打开后由用户主动点按钮，首项不会被误读为已选中。
  }

  /* ---------- 地点板块：家里 / 现居地 ---------- */

  function renderPlaces() {
    if (!el.placeHome) return;
    var counts = { home: 0, residence: 0 };
    CL.store.items().forEach(function (i) {
      if (String(i.category).indexOf('beauty-') === 0) return; // 只统计衣橱自己的单品，不混入彩妆护肤
      if (i.location === 'home') counts.home++;
      else if (i.location === 'residence') counts.residence++;
    });
    el.placeHomeNote.textContent = counts.home ? (counts.home + ' 件单品') : '尚未填写';
    el.placeResNote.textContent = counts.residence ? (counts.residence + ' 件单品') : '尚未填写';
    el.placeHome.classList.toggle('is-active', state.loc === 'home');
    el.placeRes.classList.toggle('is-active', state.loc === 'residence');
  }

  function onPlaceClick(e) {
    var box = e.target.closest('.place-box[data-loc]');
    if (!box) return;
    var loc = box.dataset.loc;
    state.loc = state.loc === loc ? null : loc;
    state.cat = 'all';
    state.sub = null;
    render();
  }

  function init() {
    el.cats = $('wardrobe-cats');
    el.subs = $('wardrobe-subs');
    el.grid = $('wardrobe-grid');
    el.empty = $('wardrobe-empty');
    el.placeHome = $('place-home');
    el.placeRes = $('place-residence');
    el.placeHomeNote = $('place-home-note');
    el.placeResNote = $('place-residence-note');

    el.cats.addEventListener('click', function (e) {
      // 刚刚是横向拖动滚动，不当作点击（避免误触）
      if (state.railDragged) { state.railDragged = false; return; }
      // 编辑分类名时，点击输入框/确定按钮不触发筛选或删除
      if (e.target.closest('.chip.is-editing')) return;
      var b = e.target.closest('.chip');
      if (!b || b.id === 'btn-add-cat') return;
      var cat = b.dataset.cat;
      if (!cat) return;

      // 双击改名（管理/非管理均生效）。首击在非管理模式会触发上方重渲染、销毁原 chip，
      // 导致原生 dblclick 不会触发，故在此用计时器手动判定。
      // 「全部」不允许改名，跳过双击检测。
      var now = Date.now();
      if (cat !== 'all' && lastTap.cat === cat && now - lastTap.t < 350) {
        lastTap.t = 0; lastTap.cat = null;
        CL.openCategoryRename('top', cat);
        return;
      }
      lastTap = { t: now, cat: cat };

      // 管理模式下点击分类：不选中（再点一次「管理」可退出管理模式、恢复正常选择）
      if (state.manageMode) return;
      state.cat = cat;
      state.sub = null;
      state.loc = null;
      render();
    });

    if (el.placeHome) {
      el.placeHome.addEventListener('click', onPlaceClick);
      el.placeRes.addEventListener('click', onPlaceClick);
    }

    $('btn-manage-cat').addEventListener('click', function (e) {
      state.manageMode = !state.manageMode;
      e.currentTarget.classList.toggle('is-on', state.manageMode);
      render();
    });

    $('btn-add-cat').addEventListener('click', function () {
      var name = window.prompt('新增一级分类名称（如：外套、上衣）：');
      if (name && name.trim()) {
        CL.catalog.addCategory(name.trim());
        renderBar();
      }
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
        else renderBar();
        CL.ui.toast('已删除子分类' + (ids.length ? '，' + ids.length + ' 件单品已归入「全部' + CL.catalog.name(state.cat) + '」' : ''));
        return;
      }
      if (state.manageMode) return;
      var b = e.target.closest('.sub-chip');
      if (!b) return;
      state.sub = b.dataset.sub || null;
      render();
    });

    $('btn-cat-del-confirm').addEventListener('click', function () {
      CL.ui.closeModal('cat-del-modal');
      if (pendingDeleteCat) {
        var id = pendingDeleteCat;
        pendingDeleteCat = null;
        deleteCategoryById(id);
      }
    });
    $('btn-cat-del-cancel').addEventListener('click', function () {
      pendingDeleteCat = null;
      CL.ui.closeModal('cat-del-modal');
    });
    // 点遮罩 / ✕ 关闭确认框时也清空待删除标记，避免残留旧 id 被误删
    $('cat-del-modal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) pendingDeleteCat = null;
    });

    // 底部分类导航栏：横向滚动 + 长按拖拽排序
    (function setupBottomNav(rail) {
      if (!rail) return;
      var LONG_PRESS = 500;
      var MOVE_THRESHOLD = 10;
      var scroll = { isDown: false, startX: 0, scrollLeft: 0, vel: 0, raf: null, lastT: 0, lastSL: 0 };
      var sort = { active: false, timer: null, chip: null, id: null, order: [], startX: 0, startY: 0, pointerId: null, lpReorder: false };

      function decay() {
        if (Math.abs(scroll.vel) < 0.5) { scroll.raf = null; return; }
        rail.scrollLeft += scroll.vel;
        scroll.vel *= 0.92;
        scroll.raf = requestAnimationFrame(decay);
      }
      function clearLongPress() {
        if (sort.timer) { clearTimeout(sort.timer); sort.timer = null; }
      }
      function exitSort() {
        if (!sort.active) return;
        sort.active = false;
        rail.classList.remove('is-sorting');
        if (sort.chip) sort.chip.classList.remove('is-dragging');
        sort.chip = null; sort.id = null; sort.order = [];
      }
      function commitSort() {
        if (!sort.active || !sort.order.length) return;
        var ids = sort.order.map(function (c) { return c.id; });
        CL.catalog.setCategoryOrder(ids);
        exitSort();
        render();
        CL.ui.toast('分类顺序已保存');
      }
      function targetIndexAt(clientX) {
        var chips = Array.from(rail.querySelectorAll('.chip[data-cat]'));
        if (!chips.length) return -1;
        for (var i = 0; i < chips.length; i++) {
          var rect = chips[i].getBoundingClientRect();
          if (clientX < rect.left + rect.width / 2) return i;
        }
        return chips.length;
      }
      function reorder(id, beforeIdx) {
        var all = [{ id: 'all' }].concat(CL.catalog.CATEGORIES);
        var from = all.findIndex(function (c) { return c.id === id; });
        if (from < 0) return;
        var item = all.splice(from, 1)[0];
        // 计算在不含 dragged 的数组中的插入位置
        var idx = beforeIdx;
        if (from < beforeIdx) idx--;
        idx = Math.max(1, Math.min(idx, all.length)); // 0 是 "全部"，不允许插入到它前面
        all.splice(idx, 0, item);
        sort.order = all.slice(1);
        // 即时更新 DOM 顺序，避免全量重绘导致滚动位置跳动
        var chips = Array.from(rail.querySelectorAll('.chip[data-cat]'));
        var map = {};
        chips.forEach(function (ch) { map[ch.dataset.cat || 'all'] = ch; });
        all.forEach(function (c) {
          if (map[c.id]) rail.appendChild(map[c.id]);
        });
      }

      rail.addEventListener('pointerdown', function (e) {
        // 每次按下重置「本次是否发生过拖动」标记（用于拖动后抑制 click 误触）
        state.railDragged = false;
        sort.startX = e.clientX; sort.startY = e.clientY;

        // 总分类（全部）长按 → 弹窗内排序（两种模式通用）
        var chip = e.target.closest('.chip[data-cat]');
        if (chip && chip.dataset.cat === 'all') {
          clearLongPress();
          sort.lpReorder = true;
          sort.timer = setTimeout(function () {
            sort.lpReorder = false;
            CL.openCategoryReorder('top');
          }, LONG_PRESS);
          // 仍允许横向滚动
          scroll.isDown = true; scroll.startX = e.clientX; scroll.scrollLeft = rail.scrollLeft;
          scroll.vel = 0; scroll.lastT = Date.now(); scroll.lastSL = scroll.scrollLeft;
          rail.style.cursor = 'grabbing';
          if (scroll.raf) { cancelAnimationFrame(scroll.raf); scroll.raf = null; }
          return;
        }

        // 管理模式下：长按某个分类 → 弹出确认框
        if (state.manageMode) {
          var dChip = e.target.closest('.chip[data-cat]');
          if (dChip && dChip.dataset.cat !== 'all' && !dChip.classList.contains('is-editing')) {
            clearLongPress();
            sort.timer = setTimeout(function () {
              if (dChip.classList.contains('is-editing')) return; // 正在改名则不删
              confirmDeleteCategory(dChip.dataset.cat);
            }, 550);
          }
          // 管理模式同样允许横向滚动
          scroll.isDown = true; scroll.startX = e.clientX; scroll.scrollLeft = rail.scrollLeft;
          scroll.vel = 0; scroll.lastT = Date.now(); scroll.lastSL = scroll.scrollLeft;
          rail.style.cursor = 'grabbing';
          if (scroll.raf) { cancelAnimationFrame(scroll.raf); scroll.raf = null; }
          return;
        }

        // 非管理模式：长按进入拖拽排序
        var chip = e.target.closest('.chip[data-cat]');
        if (chip && chip.dataset.cat !== 'all') {
          sort.id = chip.dataset.cat; sort.chip = chip; sort.pointerId = e.pointerId;
          clearLongPress();
          sort.timer = setTimeout(function () {
            sort.active = true;
            sort.order = CL.catalog.CATEGORIES.slice();
            rail.classList.add('is-sorting');
            chip.classList.add('is-dragging');
            try { rail.setPointerCapture(e.pointerId); } catch (err) {}
            CL.ui.toast('拖动调整分类顺序', 1200);
          }, LONG_PRESS);
        }

        // 横向滚动检测（两种模式下都启用）
        scroll.isDown = true; scroll.startX = e.clientX; scroll.scrollLeft = rail.scrollLeft;
        scroll.vel = 0; scroll.lastT = Date.now(); scroll.lastSL = scroll.scrollLeft;
        rail.style.cursor = 'grabbing';
        if (scroll.raf) { cancelAnimationFrame(scroll.raf); scroll.raf = null; }
      });

      rail.addEventListener('pointermove', function (e) {
        if (sort.active) {
          // 拖拽排序中：边滚动边计算插入位置
          var railRect = rail.getBoundingClientRect();
          if (e.clientX < railRect.left + 40) rail.scrollLeft -= 6;
          else if (e.clientX > railRect.right - 40) rail.scrollLeft += 6;
          var idx = targetIndexAt(e.clientX);
          reorder(sort.id, idx);
          return;
        }
        if (sort.lpReorder) {
          // 「全部」长按照：仅明显滑动（>26px）才取消，避免手指抖动/系统 pointercancel 误清
          var ldx = e.clientX - sort.startX, ldy = e.clientY - sort.startY;
          if (Math.abs(ldx) > 26 || Math.abs(ldy) > 26) { clearLongPress(); sort.lpReorder = false; }
          else return; // 抖动态不滚动、不取消
        }
        if (!scroll.isDown) return;
        var dx = e.clientX - sort.startX;
        var dy = e.clientY - sort.startY;
        // 手指滑动则取消长按（删除 / 排序）
        if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
          clearLongPress();
          state.railDragged = true; // 拖动过，松手后抑制 click 误触
        }
        var sdx = scroll.startX - e.clientX;
        rail.scrollLeft = scroll.scrollLeft + sdx;
        var now = Date.now();
        scroll.vel = (rail.scrollLeft - scroll.lastSL) / (now - scroll.lastT || 1) * 16 || 0;
        scroll.lastSL = rail.scrollLeft; scroll.lastT = now;
      });

      rail.addEventListener('pointerup', function (e) {
        clearLongPress();
        if (sort.active) { commitSort(); return; }
        // 轨道滚动收尾
        scroll.isDown = false;
        try { rail.releasePointerCapture(e.pointerId); } catch (err) {}
        rail.style.cursor = '';
        if (scroll.raf) cancelAnimationFrame(scroll.raf);
        scroll.raf = requestAnimationFrame(decay);
      });
      rail.addEventListener('pointercancel', function (e) {
        if (sort.lpReorder) return; // 长按照期间系统取消指针，保留定时器让其触发弹窗
        clearLongPress();
        if (sort.active) exitSort();
        scroll.isDown = false; rail.style.cursor = '';
      });
      rail.addEventListener('pointerleave', function () {
        if (!sort.active) { scroll.isDown = false; rail.style.cursor = ''; }
      });
      // 移动端长按系统菜单（contextmenu）作为可靠触发：手指按住「全部」即弹出排序弹窗
      rail.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (sort.lpReorder) {
          clearLongPress();
          sort.lpReorder = false;
          CL.openCategoryReorder('top');
        }
      });
    })(el.cats);

    // 子分类 rail：仅横向滚动
    (function setupSubNav(rail) {
      if (!rail) return;
      var isDown = false, startX, scrollLeft, vel = 0, raf = null, lastT, lastSL;
      function decay() {
        if (Math.abs(vel) < 0.5) { raf = null; return; }
        rail.scrollLeft += vel; vel *= 0.92;
        raf = requestAnimationFrame(decay);
      }
      rail.addEventListener('pointerdown', function (e) {
        isDown = true; startX = e.clientX; scrollLeft = rail.scrollLeft; vel = 0; lastT = Date.now(); lastSL = scrollLeft;
        try { rail.setPointerCapture(e.pointerId); } catch (err) {}
        rail.style.cursor = 'grabbing';
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      });
      rail.addEventListener('pointermove', function (e) {
        if (!isDown) return;
        rail.scrollLeft = scrollLeft + (startX - e.clientX);
        var now = Date.now();
        vel = (rail.scrollLeft - lastSL) / (now - lastT || 1) * 16 || 0;
        lastSL = rail.scrollLeft; lastT = now;
      });
      rail.addEventListener('pointerup', function (e) {
        isDown = false;
        try { rail.releasePointerCapture(e.pointerId); } catch (err) {}
        rail.style.cursor = '';
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(decay);
      });
      rail.addEventListener('pointercancel', function () { isDown = false; rail.style.cursor = ''; });
      rail.addEventListener('pointerleave', function () { isDown = false; rail.style.cursor = ''; });
    })(el.subs);

    $('search-input').addEventListener('input', function (e) {
      state.q = e.target.value; render();
    });

    $('fav-filter').addEventListener('click', function (e) {
      state.favOnly = !state.favOnly;
      e.currentTarget.classList.toggle('is-on', state.favOnly);
      render();
    });

    /* 长按图片弹出操作菜单 */
    el.grid.addEventListener('pointerdown', function (e) {
      var shot = e.target.closest('.card-shot');
      var card = e.target.closest('.card');
      if (shot && card) {
        // 阻止 iOS 默认的长按文本选择/图片保存/链接菜单
        try { e.preventDefault(); } catch (err) {}
        startLongPress(e, card.dataset.id);
      } else clearLongPress();
    });
    el.grid.addEventListener('pointermove', function (e) {
      if (!longPress.timer) return;
      var dx = e.clientX - longPress.startX;
      var dy = e.clientY - longPress.startY;
      // 容差放大到 18px：手机上手指轻微抖动不应取消长按（否则会退化成点击→直接打开编辑页）
      if (Math.abs(dx) > 18 || Math.abs(dy) > 18) clearLongPress();
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
      // 菜单已打开时，任何落到网格上的杂散点击都忽略（防止长按松手后的幽灵点击穿透到卡片、误开编辑页）
      if (!$('card-menu-modal').hidden) { e.stopPropagation(); return; }
      var card = e.target.closest('.card');
      if (!card) return;
      var id = card.dataset.id;
      var act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'fav') {
          var it = CL.store.getItem(id);
          CL.store.updateItem(id, { favorite: !it.favorite });
        } else if (act.dataset.act === 'wear') {
          CL.studio.wear(id);
          CL.app.go('studio');
          CL.ui.toast('已加入搭配');
        } else if (act.dataset.act === 'trash') {
          CL.studio.takeOffItem(id);
          CL.store.deleteItem(id);
          CL.ui.toast('已移入回收站');
        }
        return;
      }
      openDetail(id);
    });

    /* 长按菜单按钮 */
    $('card-menu-modal').addEventListener('click', function (e) {
      var btn = e.target.closest('.card-menu-btn');
      if (!btn) return;
      var id = state.menuItemId;
      if (!id) return;
      var it = CL.store.getItem(id);
      var act = btn.dataset.act;
      CL.ui.closeModal('card-menu-modal');
      if (act === 'wear') {
        CL.studio.wear(id);
        CL.app.go('studio');
        CL.ui.toast('已加入搭配间');
      } else if (act === 'move') {
        var to = (it && it.location === 'home') ? 'residence' : 'home';
        CL.store.updateItem(id, { location: to }).then(function () {
          CL.ui.toast('已移到' + (to === 'home' ? '家里' : '现居地'));
        });
      } else if (act === 'trash') {
        CL.studio.takeOffItem(id);
        CL.store.deleteItem(id).then(function () {
          CL.ui.toast('已移入回收站（可在回收站恢复）');
        });
      }
    });

    $('btn-update-item').addEventListener('click', function () {
      var id = state.editing;
      if (!id) return;
      var tags = $('detail-tags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var qty = parseInt($('detail-qty').value, 10);
      if (!qty || qty < 1) qty = 1;
      var patch = {
        name: $('detail-name').value.trim() || '未命名',
        category: state.editingCat,
        sub: state.editingSub,
        tags: tags,
        quantity: qty
      };
      CL.ui.closeModal('item-modal');   // 立即关闭，不等 IndexedDB 写大图完成，避免点击保存后长时间无响应
      CL.ui.toast('已保存');
      CL.store.updateItem(id, patch);   // 后台写入；emit 触发的重绘在后台进行，不阻塞交互
    });

    $('btn-delete-item').addEventListener('click', function () {
      var id = state.editing;
      if (!id) return;
      CL.studio.takeOffItem(id);
      CL.ui.closeModal('item-modal');
      CL.store.deleteItem(id).then(function () {
        CL.ui.toast('已移入回收站（可在回收站恢复）');
      });
    });

    $('btn-wear-item').addEventListener('click', function () {
      if (!state.editing) return;
      CL.studio.wear(state.editing);
      CL.ui.closeModal('item-modal');
      CL.app.go('studio');
    });

    CL.store.on('items', render);
    render();
  }

  CL.wardrobe = { init: init, render: render, setCat: setCat, openItem: openDetail, renderCatPicker: renderCatPicker, renderSubPicker: renderSubPicker, icon: icon, esc: esc };
})(window);
