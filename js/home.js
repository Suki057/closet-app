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

    // 首页不再展示已添加的单品，维持「添加单品」引导板块
    $('home-recent-section').hidden = true;
    $('home-empty').hidden = false;
  }

  function init() {
    CL.store.on('items', render);
    CL.store.on('looks', render);
    render();
  }

  global.CL = global.CL || {};
  global.CL.home = { init: init, render: render };
})(window);
