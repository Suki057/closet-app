/* 业务数据层：单品与搭配的增删改查 + 对象 URL 缓存 + 变更广播 */
(function (global) {
  'use strict';

  var db = global.CL.db;
  var items = [];
  var looks = [];
  var listeners = { items: [], looks: [], trash: [] };
  var TRASH_TTL = 7 * 24 * 3600 * 1000; // 回收站保留 7 天

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function hydrate(it) {
    if (it.blob && !it.url) it.url = URL.createObjectURL(it.blob);
    if (it.thumbBlob && !it.thumbUrl) it.thumbUrl = URL.createObjectURL(it.thumbBlob);
    if (!it.thumbUrl) it.thumbUrl = it.url;
    return it;
  }

  function release(it) {
    if (it.url) { URL.revokeObjectURL(it.url); it.url = null; }
    if (it.thumbUrl && it.thumbUrl !== it.url) { URL.revokeObjectURL(it.thumbUrl); it.thumbUrl = null; }
  }

  function persistable(it) {
    var o = {};
    Object.keys(it).forEach(function (k) {
      if (k === 'url' || k === 'thumbUrl' || k === 'coverUrl') return;
      o[k] = it[k];
    });
    return o;
  }

  function emit(kind) {
    listeners[kind].forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  }

  function liveItems() { return items.filter(function (i) { return !i.deletedAt; }); }

  var store = {
    on: function (kind, fn) { listeners[kind].push(fn); },

    init: function () {
      return Promise.all([db.all('items'), db.all('looks')]).then(function (res) {
        items = (res[0] || []).map(hydrate).sort(function (a, b) { return b.createdAt - a.createdAt; });
        looks = (res[1] || []).map(function (l) {
          if (l.coverBlob && !l.coverUrl) l.coverUrl = URL.createObjectURL(l.coverBlob);
          return l;
        }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        emit('items'); emit('looks');
      });
    },

    /* ---- items ---- */
    items: function () { return liveItems(); },
    itemsOf: function (cat, sub) {
      var list = liveItems();
      if (!cat || cat === 'all') {
        return sub ? list.filter(function (i) { return i.sub === sub; }) : list;
      }
      list = list.filter(function (i) { return i.category === cat; });
      if (sub) list = list.filter(function (i) { return i.sub === sub; });
      return list;
    },
    getItem: function (id) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === id) return items[i].deletedAt ? null : items[i];
      }
      return null;
    },
    countBy: function () {
      var m = { all: 0 };
      items.forEach(function (i) {
        if (i.deletedAt) return;
        m.all++;
        m[i.category] = (m[i.category] || 0) + 1;
      });
      return m;
    },
    trashedItems: function () {
      return items.filter(function (i) { return i.deletedAt; })
        .sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    },
    countBySub: function (cat) {
      var m = {};
      items.forEach(function (i) {
        if (i.deletedAt) return;
        if (cat && i.category !== cat) return;
        var k = i.sub || '__none';
        m[k] = (m[k] || 0) + 1;
      });
      return m;
    },

    addItem: function (data) {
      var it = hydrate({
        id: uid('it'),
        name: data.name || '未命名',
        category: data.category || 'top',
        sub: data.sub || null,
        location: data.location || null,
        blob: data.blob,
        thumbBlob: data.thumbBlob,
        width: data.width, height: data.height,
        color: data.color || '#C9C2B8',
        colors: data.colors || [],
        tags: data.tags || [],
        favorite: false,
        createdAt: Date.now()
      });
      items.unshift(it);
      emit('items');
      return db.put('items', persistable(it)).then(function () { return it; });
    },

    updateItem: function (id, patch) {
      var it = store.getItem(id);
      if (!it) return Promise.resolve(null);
      Object.keys(patch).forEach(function (k) { it[k] = patch[k]; });
      emit('items');
      return db.put('items', persistable(it)).then(function () { return it; });
    },

    deleteItem: function (id) {
      var it = items.find(function (i) { return i.id === id; });
      if (!it) return Promise.resolve();
      it.deletedAt = Date.now();
      emit('items'); emit('trash');
      return db.put('items', persistable(it)).then(function () {
        emit('items'); emit('trash');
        return it;
      });
    },

    restoreItem: function (id) {
      var it = items.find(function (i) { return i.id === id; });
      if (!it) return Promise.resolve();
      it.deletedAt = null;
      emit('items'); emit('trash');
      return db.put('items', persistable(it)).then(function () {
        emit('items'); emit('trash');
        return it;
      });
    },

    purgeItem: function (id) {
      var idx = items.findIndex(function (i) { return i.id === id; });
      if (idx < 0) return Promise.resolve();
      release(items[idx]);
      items.splice(idx, 1);
      emit('items'); emit('trash');
      return db.remove('items', id).then(function () {
        emit('items'); emit('trash');
      });
    },

    purgeExpired: function () {
      var now = Date.now();
      var expired = items.filter(function (i) { return i.deletedAt && (now - i.deletedAt) > TRASH_TTL; });
      if (!expired.length) return Promise.resolve();
      expired.forEach(function (it) {
        var idx = items.indexOf(it);
        if (idx >= 0) { release(it); items.splice(idx, 1); }
        db.remove('items', it.id);
      });
      emit('items'); emit('trash');
      return Promise.resolve();
    },

    /* ---- looks ---- */
    looks: function () { return looks; },
    getLook: function (id) {
      for (var i = 0; i < looks.length; i++) if (looks[i].id === id) return looks[i];
      return null;
    },

    addLook: function (data) {
      var lk = {
        id: uid('lk'),
        name: data.name || '未命名搭配',
        layers: data.layers || [],
        coverBlob: data.coverBlob,
        createdAt: Date.now()
      };
      if (lk.coverBlob) lk.coverUrl = URL.createObjectURL(lk.coverBlob);
      looks.unshift(lk);
      emit('looks');
      var o = {};
      Object.keys(lk).forEach(function (k) { if (k !== 'coverUrl') o[k] = lk[k]; });
      return db.put('looks', o).then(function () { return lk; });
    },

    deleteLook: function (id) {
      var idx = looks.findIndex(function (l) { return l.id === id; });
      if (idx < 0) return Promise.resolve();
      if (looks[idx].coverUrl) URL.revokeObjectURL(looks[idx].coverUrl);
      looks.splice(idx, 1);
      emit('looks');
      return db.remove('looks', id);
    },

    wipe: function () {
      items.forEach(release);
      looks.forEach(function (l) { if (l.coverUrl) URL.revokeObjectURL(l.coverUrl); });
      items = []; looks = [];
      emit('items'); emit('looks');
      return db.clearAll();
    }
  };

  global.CL = global.CL || {};
  global.CL.store = store;
  global.CL.uid = uid;
})(window);
