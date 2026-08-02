/* 衣橱视图：类目筛选、搜索、卡片网格、单品详情编辑 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var state = { cat: 'all', sub: null, q: '', favOnly: false, editing: null, editingSub: null, sortMode: false };

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

  function sortArrows(idx, total) {
    if (!state.sortMode || total <= 1) return '';
    var up = idx > 0 ? '<span class="sort-arrow" data-move="up" title="前移">▲</span>' : '<span class="sort-arrow is-disabled">▲</span>';
    var down = idx < total - 1 ? '<span class="sort-arrow" data-move="down" title="后移">▼</span>' : '<span class="sort-arrow is-disabled">▼</span>';
    return '<span class="sort-arrows">' + up + down + '</span>';
  }

  function renderCats() {
    var counts = CL.store.countBy();
    var total = CL.catalog.CATEGORIES.length;
    var html = '<button class="chip ' + (state.cat === 'all' ? 'is-active' : '') + '" data-cat="all">' +
      icon(CL.catalog.ALL_ICON) + '全部<span class="n">' + (counts.all || 0) + '</span></button>';
    CL.catalog.CATEGORIES.forEach(function (c, idx) {
      html += '<button class="chip ' + (state.cat === c.id && !state.sub ? 'is-active' : '') + (state.sortMode ? ' is-sort' : '') + '" data-cat="' + c.id + '" title="双击修改名称">' +
        icon(c.icon) + '<span class="chip-name">' + esc(c.name) + '</span><span class="n">' + (counts[c.id] || 0) + '</span>' + sortArrows(idx, total) + '</button>';
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
    var list = filtered();
    el.empty.hidden = list.length > 0 || CL.store.items().length > 0;
    if (!list.length && CL.store.items().length > 0) {
      el.grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>没有匹配的单品</h3><p>换个类目或关键词试试。</p></div>';
      return;
    }
    el.grid.innerHTML = list.map(function (i) {
      return '<article class="card' + (i.favorite ? ' is-fav' : '') + '" data-id="' + i.id + '">' +
        '<div class="card-shot"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy"></div>' +
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

  function init() {
    el.cats = $('wardrobe-cats');
    el.subs = $('wardrobe-subs');
    el.grid = $('wardrobe-grid');
    el.empty = $('wardrobe-empty');

    function moveCategory(id, dir) {
      var cats = CL.catalog.CATEGORIES;
      var i = cats.findIndex(function (c) { return c.id === id; });
      if (i < 0) return;
      var j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= cats.length) return;
      var tmp = cats[i]; cats[i] = cats[j]; cats[j] = tmp;
      CL.catalog.setCategoryOrder(cats.map(function (c) { return c.id; }));
      render();
    }

    el.cats.addEventListener('click', function (e) {
      var arrow = e.target.closest('[data-move]');
      if (arrow) {
        e.stopPropagation();
        var b = e.target.closest('.chip[data-cat]');
        if (b) moveCategory(b.dataset.cat, arrow.dataset.move);
        return;
      }
      var b = e.target.closest('.chip');
      if (!b || b.id === 'btn-add-cat' || b.id === 'btn-sort-cat') return;
      state.cat = b.dataset.cat;
      state.sub = null;
      render();
    });

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

    $('btn-sort-cat').addEventListener('click', function (e) {
      state.sortMode = !state.sortMode;
      e.currentTarget.classList.toggle('is-on', state.sortMode);
      render();
    });

    if (el.subs) el.subs.addEventListener('click', function (e) {
      var b = e.target.closest('.sub-chip');
      if (!b) return;
      state.sub = b.dataset.sub || null;
      render();
    });

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
      if (!confirm('确定删除这件单品？')) return;
      CL.studio.takeOffItem(id);
      CL.store.deleteItem(id).then(function () {
        CL.ui.closeModal('item-modal');
        CL.ui.toast('已删除');
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
