/* 首页：欢迎区 + 概览统计 + 衣橱构成 + 最近导入 + 空状态引导 */
(function (global) {
  'use strict';

  var CL = global.CL;
  function $(id) { return document.getElementById(id); }
  function icon(path) {
    return '<svg viewBox="0 0 24 24" class="ico"><path d="' + path + '"/></svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function renderHeroArt() {
    var html = CL.catalog.CATEGORIES.map(function (c, idx) {
      return '<span class="hero-badge" style="--i:' + idx + '">' + icon(c.icon) + '</span>';
    }).join('');
    $('hero-art').innerHTML = html;
  }

  function render() {
    var items = CL.store.items();
    var looks = CL.store.looks();
    var counts = CL.store.countBy();
    var usedCats = CL.catalog.CATEGORIES.filter(function (c) { return (counts[c.id] || 0) > 0; }).length;

    $('stat-items').textContent = items.length;
    $('stat-looks').textContent = looks.length;
    $('stat-cats').textContent = usedCats;

    // 衣橱构成：每个大类一个区块，下方列出有数量的子类目
    $('home-cats').innerHTML = CL.catalog.CATEGORIES.map(function (c) {
      var total = counts[c.id] || 0;
      var subs = CL.catalog.subsOf(c.id);
      var subHtml = '';
      if (subs.length) {
        var subCounts = {};
        items.forEach(function (i) {
          if (i.category === c.id) { var k = i.sub || '__none'; subCounts[k] = (subCounts[k] || 0) + 1; }
        });
        var chips = subs.map(function (s) {
          var n = subCounts[s.id] || 0;
          if (!n) return '';
          return '<button class="home-sub" data-goto="wardrobe" data-cat="' + c.id + '" data-sub="' + s.id + '">' +
            esc(s.name) + '<span class="home-sub-n">' + n + '</span></button>';
        }).join('');
        subHtml = '<div class="home-subs">' + (chips || '<span class="home-sub-none">暂无细分单品</span>') + '</div>';
      }
      return '<div class="home-cat-block' + (total ? '' : ' is-zero') + '">' +
        '<button class="home-cat-head" data-goto="wardrobe" data-filter="' + c.id + '">' +
          icon(c.icon) +
          '<span class="home-cat-name">' + esc(c.name) + '</span>' +
          '<span class="home-cat-n">' + total + '</span>' +
        '</button>' + subHtml + '</div>';
    }).join('');

    // 最近导入：最多 8 件，复用衣橱卡片样式
    var recent = items.slice(0, 8);
    $('home-recent').innerHTML = recent.map(function (i) {
      return '<article class="card" data-id="' + i.id + '">' +
        '<div class="card-shot"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy"></div>' +
        '<div class="card-info">' +
          '<span class="card-dot" style="background:' + esc(i.color) + '"></span>' +
          '<span class="card-name">' + esc(i.name) + '</span>' +
          '<span class="card-cat">' + esc(CL.catalog.name(i.category)) + '</span>' +
        '</div></article>';
    }).join('');

    var empty = items.length === 0;
    $('home-empty').hidden = !empty;
    $('home-cat-section').hidden = empty;
    $('home-recent-section').hidden = empty;
  }

  function init() {
    renderHeroArt();

    $('home-cats').addEventListener('click', function (e) {
      // 点子类目 → 跳转衣橱并按子类目筛选
      var sub = e.target.closest('.home-sub');
      if (sub) { CL.wardrobe.setCat(sub.dataset.cat, sub.dataset.sub); CL.app.go('wardrobe'); return; }
      // 点大类 → 跳转衣橱并筛选到该类目
      var head = e.target.closest('.home-cat-head');
      if (!head) return;
      CL.wardrobe.setCat(head.dataset.filter);
      CL.app.go('wardrobe');
    });

    $('home-recent').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      CL.wardrobe.openItem(card.dataset.id);
    });

    CL.store.on('items', render);
    CL.store.on('looks', render);
    render();
  }

  global.CL = global.CL || {};
  global.CL.home = { init: init, render: render };
})(window);
