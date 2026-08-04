/* 本地存储层：IndexedDB（存 Blob），不可用时自动降级为内存存储 */
(function (global) {
  'use strict';

  var DB_NAME = 'closet-db';
  var DB_VER = 5;
  var STORES = ['items', 'looks'];

  var dbPromise = null;
  var memoryMode = false;
  var mem = { items: new Map(), looks: new Map() };

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          var s = db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('category', 'category', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('looks')) {
          db.createObjectStore('looks', { keyPath: 'id' }).createIndex('createdAt', 'createdAt', { unique: false });
        }
        // 清理旧版本遗留的回收站对象仓库（若存在）
        if (db.objectStoreNames.contains('trash')) {
          db.deleteObjectStore('trash');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    }).catch(function (err) {
      memoryMode = true;
      console.warn('[closet] IndexedDB 不可用，改用内存存储：', err && err.message);
      return null;
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return openDB().then(function (db) {
      if (!db) return null;
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  var api = {
    isMemoryMode: function () { return memoryMode; },

    ready: function () { return openDB().then(function () { return !memoryMode; }); },

    put: function (store, value) {
      return tx(store, 'readwrite').then(function (os) {
        if (!os) { mem[store].set(value.id, value); return value; }
        return wrap(os.put(value)).then(function () { return value; });
      });
    },

    /* 批量写入：同一事务内 put 多个对象，远快于多次独立 put（手机端尤其明显） */
    bulkPut: function (store, values) {
      if (!values || !values.length) return Promise.resolve(0);
      return openDB().then(function (db) {
        if (!db) {
          values.forEach(function (v) { mem[store].set(v.id, v); });
          return values.length;
        }
        return new Promise(function (resolve, reject) {
          var t = db.transaction(store, 'readwrite');
          var os = t.objectStore(store);
          t.oncomplete = function () { resolve(values.length); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error); };
          values.forEach(function (v) { os.put(v); });
        });
      });
    },

    get: function (store, id) {
      return tx(store, 'readonly').then(function (os) {
        if (!os) return mem[store].get(id) || null;
        return wrap(os.get(id));
      });
    },

    all: function (store) {
      return tx(store, 'readonly').then(function (os) {
        if (!os) return Array.from(mem[store].values());
        return wrap(os.getAll());
      });
    },

    remove: function (store, id) {
      return tx(store, 'readwrite').then(function (os) {
        if (!os) { mem[store].delete(id); return; }
        return wrap(os.delete(id));
      });
    },

    clearAll: function () {
      return Promise.all(STORES.map(function (s) {
        return tx(s, 'readwrite').then(function (os) {
          if (!os) { mem[s].clear(); return; }
          return wrap(os.clear());
        });
      }));
    }
  };

  global.CL = global.CL || {};
  global.CL.db = api;
})(window);
