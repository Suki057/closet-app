/* 首页：欢迎区 + 概览统计 + 最近导入 + 空状态引导 */
(function (global) {
  'use strict';

  var CL = global.CL;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function render() {
    var items = CL.store.items();
    var looks = CL.store.looks();
    var counts = CL.store.countBy();
    var usedCats = CL.catalog.CATEGORIES.filter(function (c) { return (counts[c.id] || 0) > 0; }).length;

    $('stat-items').textContent = items.length;
    $('stat-looks').textContent = looks.length;
    $('stat-cats').textContent = usedCats;

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
    $('home-recent-section').hidden = empty;
  }

  function init() {
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
