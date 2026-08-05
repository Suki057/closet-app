/* 衣橱 · Closet — Service Worker：应用壳缓存，支持离线打开与「添加到主屏幕」 */
var CACHE = 'closet-v44';
var PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'assets/princess_poster.jpg'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(PRECACHE).catch(function () { /* 预缓存失败不影响安装 */ });
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil((function () {
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); });
  })());
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域（Google Fonts 等）不缓存

  // 页面导航：网络优先，失败回退缓存的首页（离线可开）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        var cp = r.clone();
        caches.open(CACHE).then(function (c) { c.put('index.html', cp); });
        return r;
      }).catch(function () { return caches.match('index.html'); })
    );
    return;
  }

  // 静态资源：缓存优先，后台静默更新
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        fetch(req).then(function (r) {
          if (r && r.ok) caches.open(CACHE).then(function (c) { c.put(req, r.clone()); });
        }).catch(function () {});
        return cached;
      }
      return fetch(req).then(function (r) {
        if (r && r.ok && /\.(css|js|png|svg|webp|woff2?|json)$/.test(url.pathname)) {
          var cp = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); });
        }
        return r;
      }).catch(function () { return cached; });
    })
  );
});
