/* 回收站视图：列出已删除单品，支持恢复 / 永久删除 / 清空，展示剩余保留天数 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var TRASH_TTL = 7 * 24 * 3600 * 1000;
  var el = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function daysLeft(it) {
    var left = it.deletedAt + TRASH_TTL - Date.now();
    return left <= 0 ? 0 : Math.ceil(left / (24 * 3600 * 1000));
  }

  function render() {
    if (!el.grid) return;
    var list = CL.store.trashedItems();
    if (!list.length) {
      el.grid.innerHTML = '';
      el.empty.hidden = false;
      if (el.clearBtn) el.clearBtn.hidden = true;
      return;
    }
    el.empty.hidden = true;
    if (el.clearBtn) el.clearBtn.hidden = false;
    el.grid.innerHTML = list.map(function (i) {
      var d = daysLeft(i);
      var leftTxt = d > 0 ? ('剩余 ' + d + ' 天') : '即将永久清除';
      return '<article class="card trash-card" data-id="' + i.id + '">' +
        '<div class="card-shot"><img src="' + i.thumbUrl + '" alt="' + esc(i.name) + '" loading="lazy"></div>' +
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

  function init() {
    el.grid = $('trash-grid');
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

    if (el.clearBtn) el.clearBtn.addEventListener('click', function () {
      var list = CL.store.trashedItems();
      Promise.all(list.map(function (i) { return CL.store.purgeItem(i.id); })).then(function () {
        CL.ui.toast('回收站已清空');
      });
    });

    CL.store.on('trash', render);
    CL.store.on('items', render);
    render();
  }

  CL.trash = { init: init, render: render };
})(window);
