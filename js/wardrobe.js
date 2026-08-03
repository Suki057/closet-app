/* 衣橱视图：类目筛选、搜索、卡片网格、单品详情编辑 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var state = { cat: 'all', sub: null, q: '', favOnly: false, loc: null, editing: null, editingSub: null };

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
    var counts = CL.store.countBy();
    var total = CL.catalog.CATEGORIES.length;
    var html = '<button class="chip ' + (state.cat === 'all' ? 'is-active' : '') + '" data-cat="all">' +
      icon(CL.catalog.ALL_ICON) + '全部<span class="n">' + (counts.all || 0) + '</span></button>';
    CL.catalog.CATEGORIES.forEach(function (c, idx) {
      html += '<button class="chip ' + (state.cat === c.id && !state.sub ? 'is-active' : '') + '" data-cat="' + c.id + '" title="双击修改名称，长按拖拽排序">' +
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
    var counts = CL.store.countBySub(state.cat);
    var html = '<button class="sub-chip ' + (!state.sub ? 'is-active' : '') + '" data-sub="">全部' + (c ? esc(c.name) : '') + '</button>';
    subs.forEach(function (s) {
      html += '<button class="sub-chip ' + (state.sub === s.id ? 'is-active' : '') + '" data-sub="' + s.id + '">' +
        esc(s.name) + '<span class="n">' + (counts[s.id] || 0) + '</span></button>';
    });
    el.subs.innerHTML = html;
    el.subs.hidden = false;
  }

  function filtered() {
    var list = CL.store.itemsOf(state.cat, state.sub);
    if (state.loc) list = list.filter(function (i) { return i.location === state.loc; });
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

  function render() {
    renderCats();
    renderPlaces();
    var list = filtered();
    if (el.empty) el.empty.hidden = list.length > 0 || CL.store.items().length > 0;
    if (!list.length && CL.store.items().length > 0) {
      el.grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>没有匹配的单品</h3><p>换个类目或关键词试试。</p></div>';
      return;
    }
    el.grid.innerHTML = list.map(function (i) {
      return '<article class="card' + (i.favorite ? ' is-fav' : '') + '" data-id="' + i.id + '">' +
        '<div class="card-shot"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy">' +
          (i.location ? '<span class="card-loc ' + (i.location === 'home' ? 'is-home' : 'is-res') + '">' + (i.location === 'home' ? '家' : '居') + '</span>' : '') +
        '</div>' +
        '<div class="card-info">' +
          '<span class="card-dot" style="background:' + esc(i.color) + '"></span>' +
          '<span class="card-name">' + esc(i.name) + '</span>' +
          '<span class="card-cat">' + esc(CL.catalog.name(i.category)) +
            (i.sub ? ' · ' + esc(CL.catalog.subName(i.category, i.sub)) : '') + '</span>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="mini-btn' + (i.favorite ? ' on' : '') + '" data-act="fav" title="收藏">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M12 17.3l-5.4 3 1-6.1-4.4-4.3 6.1-.9L12 3.5l2.7 5.5 6.1.9-4.4 4.3 1 6.1z"/></svg></button>' +
          '<button class="mini-btn" data-act="wear" title="加入搭配">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg></button>' +
          '<button class="mini-btn" data-act="trash" title="移入回收站">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M6 7h12M9 7V5h6v2M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* ---------- 详情弹窗 ---------- */

  function openDetail(id) {
    var it = CL.store.getItem(id);
    if (!it) return;
    state.editing = id;
    $('detail-img').src = it.url;
    $('detail-name').value = it.name;
    $('detail-tags').value = (it.tags || []).join(', ');
    state.editingCat = it.category;
    state.editingSub = it.sub || null;
    renderCatPicker($('detail-cat'), it.category, function (c) {
      state.editingCat = c;
      state.editingSub = null;
      renderSubPicker($('detail-sub'), c, null);
    });
    renderSubPicker($('detail-sub'), it.category, it.sub || null);
    CL.ui.openModal('item-modal');
  }

  function renderCatPicker(box, active, onPick) {
    box.innerHTML = CL.catalog.CATEGORIES.map(function (c) {
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

  function renderSubPicker(box, catId, activeSub) {
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
      state.editingSub = b.dataset.sub;
    };
  }

  function setCat(cat, sub) {
    state.cat = cat || 'all';
    state.sub = sub || null;
    render();
  }

  /* ---------- 地点板块：家里 / 现居地 ---------- */

  function renderPlaces() {
    if (!el.placeHome) return;
    var counts = { home: 0, residence: 0 };
    CL.store.items().forEach(function (i) {
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
      var b = e.target.closest('.chip');
      if (!b || b.id === 'btn-add-cat') return;
      state.cat = b.dataset.cat;
      state.sub = null;
      state.loc = null;
      render();
    });

    if (el.placeHome) {
      el.placeHome.addEventListener('click', onPlaceClick);
      el.placeRes.addEventListener('click', onPlaceClick);
    }

    el.cats.addEventListener('dblclick', function (e) {
      if (e.target.closest('[data-move]')) return;
      var b = e.target.closest('.chip');
      if (!b || !b.dataset.cat || b.dataset.cat === 'all') return;
      var c = CL.catalog.get(b.dataset.cat);
      var name = window.prompt('修改分类名称：', c.name);
      if (name && name.trim()) {
        CL.catalog.renameCategory(c.id, name.trim());
        render();
      }
    });

    $('btn-add-cat').addEventListener('click', function () {
      var name = window.prompt('新增一级分类名称（如：外套、上衣）：');
      if (name && name.trim()) {
        CL.catalog.addCategory(name.trim());
        render();
      }
    });

    if (el.subs) el.subs.addEventListener('click', function (e) {
      var b = e.target.closest('.sub-chip');
      if (!b) return;
      state.sub = b.dataset.sub || null;
      render();
    });

    // 底部分类导航栏：横向滚动 + 长按拖拽排序
    (function setupBottomNav(rail) {
      if (!rail) return;
      var LONG_PRESS = 500;
      var MOVE_THRESHOLD = 10;
      var scroll = { isDown: false, startX: 0, scrollLeft: 0, vel: 0, raf: null, lastT: 0, lastSL: 0 };
      var sort = { active: false, timer: null, chip: null, id: null, order: [], startX: 0, startY: 0, pointerId: null };

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
        var chips = Array.from(rail.querySelectorAll('.chip'));
        var map = {};
        chips.forEach(function (ch) { map[ch.dataset.cat || 'all'] = ch; });
        all.forEach(function (c) {
          if (map[c.id]) rail.appendChild(map[c.id]);
        });
      }

      rail.addEventListener('pointerdown', function (e) {
        var chip = e.target.closest('.chip[data-cat]');
        if (chip && chip.dataset.cat !== 'all') {
          sort.startX = e.clientX; sort.startY = e.clientY;
          sort.id = chip.dataset.cat; sort.chip = chip; sort.pointerId = e.pointerId;
          clearLongPress();
          sort.timer = setTimeout(function () {
            // 进入排序模式
            sort.active = true;
            sort.order = CL.catalog.CATEGORIES.slice();
            rail.classList.add('is-sorting');
            chip.classList.add('is-dragging');
            try { rail.setPointerCapture(e.pointerId); } catch (err) {}
            CL.ui.toast('拖动调整分类顺序', 1200);
          }, LONG_PRESS);
        }
        // 同时启动横向滚动检测
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
        if (!scroll.isDown) return;
        var dx = e.clientX - sort.startX;
        var dy = e.clientY - sort.startY;
        if (sort.timer && (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD)) {
          clearLongPress(); // 手指滑动则取消长按
        }
        dx = scroll.startX - e.clientX;
        rail.scrollLeft = scroll.scrollLeft + dx;
        var now = Date.now();
        scroll.vel = (rail.scrollLeft - scroll.lastSL) / (now - scroll.lastT || 1) * 16 || 0;
        scroll.lastSL = rail.scrollLeft; scroll.lastT = now;
      });

      rail.addEventListener('pointerup', function (e) {
        clearLongPress();
        if (sort.active) {
          commitSort();
        } else {
          scroll.isDown = false;
          try { rail.releasePointerCapture(e.pointerId); } catch (err) {}
          rail.style.cursor = '';
          if (scroll.raf) cancelAnimationFrame(scroll.raf);
          scroll.raf = requestAnimationFrame(decay);
        }
      });
      rail.addEventListener('pointercancel', function (e) {
        clearLongPress();
        if (sort.active) exitSort();
        scroll.isDown = false; rail.style.cursor = '';
      });
      rail.addEventListener('pointerleave', function () {
        if (!sort.active) { scroll.isDown = false; rail.style.cursor = ''; }
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

    el.grid.addEventListener('click', function (e) {
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

    $('btn-update-item').addEventListener('click', function () {
      var id = state.editing;
      if (!id) return;
      var tags = $('detail-tags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      CL.store.updateItem(id, {
        name: $('detail-name').value.trim() || '未命名',
        category: state.editingCat,
        sub: state.editingSub,
        tags: tags
      }).then(function () {
        CL.ui.closeModal('item-modal');
        CL.ui.toast('已保存');
      });
    });

    $('btn-delete-item').addEventListener('click', function () {
      var id = state.editing;
      if (!id) return;
      if (!confirm('确定把这件单品移入回收站吗？\n7 天内可在「回收站」恢复。')) return;
      CL.studio.takeOffItem(id);
      CL.store.deleteItem(id).then(function () {
        CL.ui.closeModal('item-modal');
        CL.ui.toast('已移入回收站');
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

  CL.wardrobe = { init: init, render: render, setCat: setCat, openItem: openDetail, renderCatPicker: renderCatPicker, icon: icon, esc: esc };
})(window);
