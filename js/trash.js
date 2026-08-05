/* 回收站视图：单品 + 分类 两类回收数据，分别支持恢复 / 永久删除 / 清空 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var TRASH_TTL = 7 * 24 * 3600 * 1000;
  var el = {};
  var tab = 'items';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function icon(path) {
    return '<svg viewBox="0 0 24 24" class="ico"><path d="' + (path || '') + '"/></svg>';
  }

  function daysLeft(it) {
    var left = it.deletedAt + TRASH_TTL - Date.now();
    return left <= 0 ? 0 : Math.ceil(left / (24 * 3600 * 1000));
  }

  /* ---------- 单品回收 ---------- */

  function renderItems() {
    var list = CL.store.trashedItems();
    if (!list.length) { el.grid.innerHTML = ''; return; }
    el.grid.innerHTML = list.map(function (i) {
      var d = daysLeft(i);
      var leftTxt = d > 0 ? ('剩余 ' + d + ' 天') : '即将永久清除';
      return '<article class="card trash-card" data-id="' + i.id + '">' +
        '<div class="card-shot" data-name="' + esc(i.name) + '"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" decoding="async" onerror="this.closest(\'.card-shot\').classList.add(\'no-img\')"></div>' +
        '<div class="trash-body">' +
          '<span class="trash-left">' + leftTxt + '</span>' +
          '<div class="trash-actions">' +
            '<button class="mini-btn text restore" data-act="restore">恢复</button>' +
            '<button class="mini-btn text danger" data-act="purge">永久删除</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* ---------- 分类回收 ---------- */

  function renderCats() {
    var list = CL.store.trashedCategories();
    if (!list.length) { el.catsGrid.innerHTML = ''; return; }
    el.catsGrid.innerHTML = list.map(function (entry) {
      var def = entry.def || { name: entry.id, icon: '' };
      var n = (entry.items || []).length;
      var first = entry.items && entry.items[0];
      var thumb = first ? (first.imgFull || first.img) : '';
      var d = daysLeft(entry);
      var leftTxt = d > 0 ? ('剩余 ' + d + ' 天') : '即将永久清除';
      return '<article class="card cat-trash-card" data-id="' + esc(entry.id) + '">' +
        '<div class="card-shot" data-name="' + esc(def.name) + '">' +
          (thumb
            ? '<img src="' + thumb + '" alt="' + esc(def.name) + '" decoding="async" onerror="this.closest(\'.card-shot\').classList.add(\'no-img\')">'
            : '<span class="cat-trash-ico">' + icon(def.icon) + '</span>') +
          '<span class="cat-trash-badge">' + n + ' 件</span>' +
        '</div>' +
        '<div class="trash-body">' +
          '<span class="trash-cat-name">' + icon(def.icon) + esc(def.name) + '</span>' +
          '<span class="trash-left">' + leftTxt + '</span>' +
          '<div class="trash-actions">' +
            '<button class="mini-btn text restore" data-act="restore-cat">恢复</button>' +
            '<button class="mini-btn text danger" data-act="purge-cat">永久删除</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* ---------- 空状态 / 清空按钮 ---------- */

  function renderEmpty() {
    var emptyItems = CL.store.trashedItems().length === 0;
    var emptyCats = CL.store.trashedCategories().length === 0;
    el.empty.hidden = !(emptyItems && emptyCats);
    var curEmpty = (tab === 'items') ? emptyItems : emptyCats;
    el.clearBtn.hidden = curEmpty;
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('.trash-tab').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.trash === t);
    });
    render();
  }

  function render() {
    if (tab === 'items') { el.grid.hidden = false; el.catsGrid.hidden = true; renderItems(); }
    else { el.grid.hidden = true; el.catsGrid.hidden = false; renderCats(); }
    renderEmpty();
  }

  function init() {
    el.grid = $('trash-grid');
    el.catsGrid = $('trash-cats-grid');
    el.empty = $('trash-empty');
    el.clearBtn = $('trash-clear');

    el.grid.addEventListener('click', function (e) {
      var card = e.target.closest('.trash-card');
      if (!card) return;
      var id = card.dataset.id;
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'restore') {
        CL.store.restoreItem(id).then(function () { CL.ui.toast('已恢复到衣橱'); });
      } else if (act.dataset.act === 'purge') {
        CL.store.purgeItem(id).then(function () { CL.ui.toast('已永久删除'); });
      }
    });

    el.catsGrid.addEventListener('click', function (e) {
      var card = e.target.closest('.cat-trash-card');
      if (!card) return;
      var id = card.dataset.id;
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'restore-cat') {
        var entry = CL.store.trashedCategory(id);
        if (entry && entry.def) CL.catalog.restoreCategory(entry.def);
        CL.store.restoreCategoryItems(id).then(function () {
          CL.ui.toast('已恢复分类「' + (entry && entry.def ? entry.def.name : '') + '」及其单品');
        });
      } else if (act.dataset.act === 'purge-cat') {
        CL.store.purgeCategory(id).then(function () { CL.ui.toast('已永久删除该分类'); });
      }
    });

    if (el.clearBtn) el.clearBtn.addEventListener('click', function () {
      if (tab === 'items') {
        var list = CL.store.trashedItems();
        Promise.all(list.map(function (i) { return CL.store.purgeItem(i.id); })).then(function () {
          CL.ui.toast('回收站单品已清空');
        });
      } else {
        var cats = CL.store.trashedCategories();
        Promise.all(cats.map(function (e) { return CL.store.purgeCategory(e.id); })).then(function () {
          CL.ui.toast('回收站分类已清空');
        });
      }
    });

    var tabs = $('trash-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.trash-tab');
      if (b) setTab(b.dataset.trash);
    });

    CL.store.on('trash', render);
    CL.store.on('items', render);
    render();
  }

  CL.trash = { init: init, render: render };
})(window);
