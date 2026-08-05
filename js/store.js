/* 业务数据层：单品与搭配的增删改查 + 对象 URL 缓存 + 变更广播 */
(function (global) {
  'use strict';

  var db = global.CL.db;
  var items = [];
  var looks = [];
  var catTrash = []; // 分类级回收站：被删分类的定义快照 + 其下全部单品
  var listeners = { items: [], looks: [], trash: [] };
  var TRASH_TTL = 7 * 24 * 3600 * 1000; // 回收站保留 7 天

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function hydrate(it) {
    // 旧数据：以 Blob 存储，用对象 URL 渲染
    if (it.blob && !it.url) it.url = URL.createObjectURL(it.blob);
    if (it.thumbBlob && !it.thumbUrl) it.thumbUrl = URL.createObjectURL(it.thumbBlob);
    if (!it.thumbUrl && it.url) it.thumbUrl = it.url;
    // 新数据：以 dataURL 字符串存储，跨会话/跨浏览器 100% 稳定
    if (!it.url && it.imgFull) it.url = it.imgFull;
    if (!it.url && it.img) it.url = it.img; // 退化：无大图时用主图，保证有主图可显示
    if (it.img && !it.thumbUrl) it.thumbUrl = it.img;
    if (!it.thumbUrl) it.thumbUrl = it.url;
    return it;
  }

  function release(it) {
    if (it.url && it.url.indexOf('blob:') === 0) { URL.revokeObjectURL(it.url); it.url = null; }
    if (it.thumbUrl && it.thumbUrl.indexOf('blob:') === 0) { URL.revokeObjectURL(it.thumbUrl); it.thumbUrl = null; }
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

  /* 移除搭配中对指定单品 id 的引用（永久删除单品/分类时调用，避免悬空图层） */
  function cleanLooks(ids) {
    if (!ids || !ids.length) return;
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    var changed = [];
    looks.forEach(function (lk) {
      if (!lk.layers || !lk.layers.length) return;
      var before = lk.layers.length;
      lk.layers = lk.layers.filter(function (ly) { return !set[ly.itemId]; });
      if (lk.layers.length !== before) changed.push(lk);
    });
    changed.forEach(function (lk) {
      var o = {};
      Object.keys(lk).forEach(function (k) { if (k !== 'coverUrl') o[k] = lk[k]; });
      db.put('looks', o);
    });
  }

  function liveItems() { return items.filter(function (i) { return !i.deletedAt; }); }

  var store = {
    on: function (kind, fn) { listeners[kind].push(fn); },

    init: function () {
      return Promise.all([db.all('items'), db.all('looks'), db.all('catTrash')]).then(function (res) {
        items = (res[0] || []).map(hydrate).sort(function (a, b) { return b.createdAt - a.createdAt; });
        looks = (res[1] || []).map(function (l) {
          if (l.coverBlob && !l.coverUrl) l.coverUrl = URL.createObjectURL(l.coverBlob);
          return l;
        }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        catTrash = (res[2] || []).slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
        emit('items'); emit('looks'); emit('trash');
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
      // 仅返回「单品级」回收：归属某分类（trashedCat）的软删除单品归到分类回收站，不在此重复显示
      return items.filter(function (i) { return i.deletedAt && !i.trashedCat; })
        .sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    },
    /* 读软删除态的单品（供分类回收站缩略图用；普通 getItem 会过滤 deletedAt 返回 null） */
    getTrashedItem: function (id) {
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      return null;
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
        img: data.img || null,          // dataURL 字符串（主图）
        imgFull: data.imgFull || data.img || null, // dataURL 字符串（大图）
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

    /* 批量改多个单品：内存改 + 仅 emit 一次（仅重渲染一次）+ 单事务批量写入。
       用于"删除分类时把该分类下所有单品改归其他分类"等场景，避免 N 件触发 N 次全页重渲染。 */
    bulkPatch: function (ids, patch) {
      if (!ids || !ids.length) return Promise.resolve(0);
      var changed = [];
      ids.forEach(function (id) {
        var it = store.getItem(id);
        if (!it) return;
        Object.keys(patch).forEach(function (k) { it[k] = patch[k]; });
        changed.push(persistable(it));
      });
      if (changed.length) emit('items');
      return db.bulkPut('items', changed);
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
      // 单品级回收（未归属任何分类）过期：直接实体删除
      var expiredItems = items.filter(function (i) { return i.deletedAt && !i.trashedCat && (now - i.deletedAt) > TRASH_TTL; });
      expiredItems.forEach(function (it) {
        var idx = items.indexOf(it);
        if (idx >= 0) { release(it); items.splice(idx, 1); }
        db.remove('items', it.id);
      });
      // 分类级回收过期：整类永久删除（含其单品实体）
      var expiredCats = catTrash.filter(function (e) { return (now - (e.deletedAt || 0)) > TRASH_TTL; });
      var catPromises = expiredCats.map(function (e) { return store.purgeCategory(e.id); });
      if (expiredItems.length || expiredCats.length) { emit('items'); emit('trash'); }
      return catPromises.length ? Promise.all(catPromises) : Promise.resolve();
    },

    /* ---- 分类级回收站 ----
       删除某个分类时：把该分类下的全部单品标记为「软删除 + 归属该分类」（数据原样留在 items
       仓库，不复制大图），catTrash 只存【分类定义 + 单品 id 列表】（极小）。
       这样 catTrash 写入永不会因单品照片过大触发 IndexedDB 配额/体积上限而失败。
       恢复：把那些单品的软删除标记清掉即可（数据一直都在）；永久删除：真正删除单品实体。
       旧的快照式条目（含 items 数组）也兼容：restore/purge 会按 entry.itemIds || entry.items 兜底。 */
    trashedCategories: function () {
      return catTrash.slice();
    },

    trashedCategory: function (catId) {
      for (var i = 0; i < catTrash.length; i++) if (catTrash[i].id === catId) return catTrash[i];
      return null;
    },

    /* 把分类 id 指向的分类（含其下全部单品）移入回收站；返回 Promise<entry>。
       defOverride：调用方在移除分类定义前先抓取的 def，避免 catalog.get 回退到 top。
       关键顺序：先把 catTrash 条目（极小）与单品软删除标记落库；库写定后再改内存态。
       这样即便极端情况下写库失败，内存态与库保持一致，不会留下「删了一半」的脏状态。 */
    trashCategory: function (catId, defOverride) {
      var def = defOverride || (global.CL.catalog && global.CL.catalog.get(catId)) || null;
      if (!def || def.id !== catId) {
        def = { id: catId, name: catId, icon: null, slot: 'top', z: 30, anchor: { x: 50, y: 16, w: 50 }, subs: [] };
      }
      var live = items.filter(function (i) { return !i.deletedAt && i.category === catId; });
      var ids = live.map(function (it) { return it.id; });
      var entry = {
        id: catId,
        deletedAt: Date.now(),
        def: { id: def.id, name: def.name, icon: def.icon, slot: def.slot, z: def.z, anchor: def.anchor, subs: (def.subs || []).slice() },
        itemIds: ids
      };
      // 落库：catTrash（仅 def+id，极小）+ 单品软删除标记（仅改两个字段）。两者都不会因体积失败。
      var patch = live.map(function (it) {
        var p = persistable(it);
        p.deletedAt = Date.now();
        p.trashedCat = catId;
        return p;
      });
      return db.bulkPut('items', patch)
        .then(function () { return db.put('catTrash', entry); })
        .then(function () {
          // 库已落定：再改内存态并广播（内存与库保持一致）
          live.forEach(function (it) { it.deletedAt = Date.now(); it.trashedCat = catId; });
          catTrash.push(entry);
          emit('items'); emit('trash');
          return entry;
        });
    },

    /* 恢复：把快照 id 列表对应的单品软删除标记清掉（数据一直都在 items 仓库）；旧格式则从 entry.items 重建 */
    restoreCategoryItems: function (catId) {
      var idx = catTrash.findIndex(function (e) { return e.id === catId; });
      if (idx < 0) return Promise.resolve(null);
      var entry = catTrash[idx];
      var ids = (entry.itemIds && entry.itemIds.slice()) || ((entry.items || []).map(function (p) { return p.id; }));
      var restored = [];
      ids.forEach(function (id) {
        var it = items.find(function (i) { return i.id === id; });
        if (it) {
          it.deletedAt = null; it.trashedCat = null; restored.push(it);
        } else if (entry.items) {
          // 旧快照格式兼容：单品当时已移出 items，需从快照重建
          var p = entry.items.find(function (x) { return x.id === id; });
          if (p) { var r = hydrate(Object.assign({}, p)); r.deletedAt = null; items.unshift(r); restored.push(r); }
        }
      });
      catTrash.splice(idx, 1);
      emit('items'); emit('trash');
      return Promise.all(restored.map(function (it) { return db.put('items', persistable(it)); }))
        .then(function () { return db.remove('catTrash', catId); })
        .then(function () { return entry; });
    },

    /* 永久删除：真正删除单品实体并清理搭配引用 */
    purgeCategory: function (catId) {
      var idx = catTrash.findIndex(function (e) { return e.id === catId; });
      if (idx < 0) return Promise.resolve(null);
      var entry = catTrash[idx];
      var ids = (entry.itemIds && entry.itemIds.slice()) || ((entry.items || []).map(function (p) { return p.id; }));
      catTrash.splice(idx, 1);
      emit('trash');
      cleanLooks(ids);
      var removes = ids.map(function (id) {
        var it = items.find(function (i) { return i.id === id; });
        if (it) { release(it); items.splice(items.indexOf(it), 1); }
        return db.remove('items', id);
      });
      return Promise.all(removes)
        .then(function () { return db.remove('catTrash', catId); })
        .then(function () { return entry; });
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
