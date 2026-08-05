/* 彩妆护肤视图：独立分类、网格、搜索、长按删除 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var state = { cat: 'all', sub: null, q: '', loc: null, menuItemId: null, suppressClick: false };
  var el = {};
  var longPress = { timer: null, id: null, startX: 0, startY: 0, triggered: false };

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
      html += '<button class="chip ' + (state.cat === c.id && !state.sub ? 'is-active' : '') + '" data-cat="' + c.id + '">' +
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
    var html = '<button class="sub-chip ' + (!state.sub ? 'is-active' : '') + '" data-sub="">全部' + esc(c.name) + '</button>';
    subs.forEach(function (s) {
      html += '<button class="sub-chip ' + (state.sub === s.id ? 'is-active' : '') + '" data-sub="' + s.id + '">' +
        '<span class="chip-name">' + esc(s.name) + '</span><span class="n">' + (cnt[s.id] || 0) + '</span></button>';
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
      var b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      state.sub = null;
      render();
    });

    if (el.subs) el.subs.addEventListener('click', function (e) {
      var b = e.target.closest('.sub-chip');
      if (!b) return;
      state.sub = b.dataset.sub || null;
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

    // 底部导航横向滚动
    (function setupRail(rail) {
      if (!rail) return;
      var isDown = false, startX, scrollLeft, vel = 0, raf = null, lastT, lastSL;
      function decay() {
        if (Math.abs(vel) < 0.5) { raf = null; return; }
        rail.scrollLeft += vel; vel *= 0.92;
        raf = requestAnimationFrame(decay);
      }
      rail.addEventListener('pointerdown', function (e) {
        isDown = true; startX = e.clientX; scrollLeft = rail.scrollLeft; vel = 0; lastT = Date.now(); lastSL = scrollLeft;
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
      function end() {
        isDown = false; rail.style.cursor = '';
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(decay);
      }
      rail.addEventListener('pointerup', end);
      rail.addEventListener('pointercancel', end);
      rail.addEventListener('pointerleave', end);
    })(el.cats);

    CL.store.on('items', render);
    render();
  }

  function init() { bind(); }

  CL.beauty = { init: init, render: render };
})(window);
