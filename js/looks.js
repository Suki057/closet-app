/* 搭配集：保存过的 Look 列表，可载入继续编辑或导出图片 */
(function (global) {
  'use strict';

  var CL = global.CL;
  var el = {};

  function $(id) { return document.getElementById(id); }

  function fmt(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function render() {
    var list = CL.store.looks();
    el.empty.hidden = list.length > 0;
    el.grid.innerHTML = list.map(function (l) {
      return '<article class="look" data-id="' + l.id + '">' +
        '<div class="look-shot"><img src="' + (l.coverUrl || '') + '" alt="' + CL.wardrobe.esc(l.name) + '"></div>' +
        '<div class="look-info"><span class="look-name">' + CL.wardrobe.esc(l.name) + '</span>' +
        '<span class="look-date">' + fmt(l.createdAt) + '</span></div>' +
        '<div class="look-actions">' +
          '<button class="mini-btn" data-act="download" title="下载图片">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg></button>' +
          '<button class="mini-btn" data-act="delete" title="删除">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function init() {
    el.grid = $('looks-grid');
    el.empty = $('looks-empty');

    // 双击「我的搭配」标题即可修改，修改后持久化
    var titleBox = document.querySelector('.looks-head-box');
    if (titleBox) {
      var KEY = 'closet.looksTitle';
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      if (saved) titleBox.textContent = saved;
      titleBox.setAttribute('title', '双击修改标题');

      titleBox.addEventListener('dblclick', function () {
        titleBox.setAttribute('contenteditable', 'true');
        titleBox.focus();
        var range = document.createRange();
        range.selectNodeContents(titleBox);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      titleBox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); titleBox.blur(); }
      });
      titleBox.addEventListener('blur', function () {
        titleBox.removeAttribute('contenteditable');
        var txt = titleBox.textContent.trim();
        if (!txt) { txt = '我的搭配'; titleBox.textContent = txt; }
        try { localStorage.setItem(KEY, txt); } catch (e) {}
      });
    }

    el.grid.addEventListener('click', function (e) {
      var card = e.target.closest('.look');
      if (!card) return;
      var lk = CL.store.getLook(card.dataset.id);
      if (!lk) return;
      var act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'download') {
          CL.ui.download(lk.coverBlob, lk.name + '.png');
        } else if (act.dataset.act === 'delete') {
          if (confirm('删除这套搭配？')) CL.store.deleteLook(lk.id);
        }
        return;
      }
      CL.studio.loadLook(lk);
      CL.app.go('studio');
      CL.ui.toast('已载入搭配间');
    });

    CL.store.on('looks', render);
    render();
  }

  CL.looks = { init: init, render: render };
})(window);
