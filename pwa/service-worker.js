/* Offline shell.
 *
 * The cache name carries the build number, and the build number comes from
 * build.js, which the publishing engine rewrites on every publish. Imported
 * scripts are part of a service worker's update check, so publishing is what
 * retires every stale shell — rather than readers keeping last month's
 * JavaScript until their browser decides to look.
 */
self.BUILD = 'dev';
try { importScripts('build.js'); } catch (e) { /* first deploy, before any publish */ }

var CACHE = 'mag-shell-' + self.BUILD;
var SCOPE = new URL('./', self.registration.scope).pathname.replace(/pwa\/$/, '');
var SHELL = ['index.html', 'article.html', 'category.html', 'search.html', 'issues.html', '404.html',
             'assets/css/main.css', 'assets/js/api.js', 'assets/js/site.js', 'assets/js/ads.js',
             'assets/js/home.js', 'assets/js/article.js', 'assets/js/listing.js',
             'data/bootstrap.json'].map(function (p) { return SCOPE + p; });

self.addEventListener('install', function (e) {
  // A missing file must not abort the whole install: one renamed asset should
  // not leave a reader with no offline shell at all.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (url) {
      return c.add(url).catch(function () { return null; });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // The control centre and the author portal are never cached. They are tools
  // used by signed-in staff who are online by definition, and a stale tool is
  // worse than a slow one: you change a setting, the interface does not show it,
  // and there is nothing on screen to explain why. Straight to the network.
  if (/\/(admin|author)\//.test(req.url)) return;

  // Content: network first, so a correction is never masked by a stale cache.
  if (/\/data\//.test(req.url)) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); }));
    return;
  }

  // Shell: cache first, refreshed in the background.
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return hit || caches.match(SCOPE + '404.html'); });
    return hit || net;
  }));
});
