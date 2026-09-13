/* api.js — the single boundary between the frontend and any data source.
 *
 * Rules this file exists to enforce:
 *   1. No page ever fetches Google Sheets or Apps Script for public content.
 *      Public reads come from static JSON produced by the publishing engine.
 *   2. Every read goes through a named method (getMenus, getArticle, ...), never
 *      a raw URL. Swapping Sheets for Firebase/Supabase/Cloud SQL later means
 *      writing one new adapter here and changing nothing else.
 *   3. No credentials live in this file or anywhere else in the repo.
 */
(function (global) {
  'use strict';

  // Works whether the site is served from a domain root or a project subpath
  // such as https://user.github.io/magazine/.
  var BASE = (function () {
    var p = location.pathname;
    var i = p.lastIndexOf('/admin/');
    if (i !== -1) return p.slice(0, i + 1);
    return p.slice(0, p.lastIndexOf('/') + 1);
  })();

  function join(rel) { return BASE + rel.replace(/^\//, ''); }

  var memo = Object.create(null);

  function getJSON(rel) {
    if (memo[rel]) return memo[rel];
    memo[rel] = fetch(join(rel), { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new ApiError(r.status === 404 ? 'not_found' : 'unavailable', rel);
      return r.json();
    }).catch(function (e) {
      delete memo[rel];
      throw (e instanceof ApiError) ? e : new ApiError('offline', rel);
    });
    return memo[rel];
  }

  function ApiError(code, detail) {
    this.name = 'ApiError'; this.code = code; this.detail = detail;
    this.message = code + (detail ? ' (' + detail + ')' : '');
  }
  ApiError.prototype = Object.create(Error.prototype);

  /* ---------------- public source: static files, CDN cached ---------------- */

  /* The shell needs five files before it can render anything. Published as one
     bundle they cost one round trip instead of five, which on a slow connection
     matters far more than their size. The individual files stay published and
     stay the contract: if the bundle is missing or stale, everything here falls
     back to them and the site is merely slower. */
  var bundle = null;

  function fromBundle(key) {
    if (bundle === null) {
      bundle = getJSON('data/bootstrap.json').catch(function () { return false; });
    }
    return bundle.then(function (b) {
      if (b && b[key] !== undefined) return b[key];
      return null;
    });
  }

  function bundled(key, file) {
    return fromBundle(key).then(function (hit) {
      return hit !== null ? hit : getJSON(file);
    });
  }

  var StaticSource = {
    kind: 'static',
    getSettings:    function () { return bundled('settings', 'data/settings.json'); },
    getFeatures:    function () { return bundled('features', 'data/features.json'); },
    getMenus:       function () { return bundled('menus', 'data/menus.json'); },
    getHomepage:    function () { return bundled('homepage', 'data/homepage.json'); },
    getCategories:  function () { return bundled('categories', 'data/categories.json'); },
    getAds:         function () { return getJSON('data/ads.json'); },
    getSearchIndex: function () { return getJSON('data/search-index.json'); },
    /** The bundle carries the most recent thirty. Anything that needs the whole
     *  archive — a category page, an author page — asks for the full index. */
    getArticleIndex: function (opts) {
      if (opts && opts.full) return getJSON('data/index/articles.json');
      return fromBundle('articles').then(function (recent) {
        if (recent && recent.length) return { version: 1, articles: recent };
        return getJSON('data/index/articles.json');
      });
    },
    getArticle: function (slug) {
      if (!/^[a-z0-9-]{1,120}$/.test(slug || '')) return Promise.reject(new ApiError('bad_slug', slug));
      return getJSON('data/articles/' + slug + '.json');
    },
    listArticles: function (opts) {
      opts = opts || {};
      // A filtered list has to search the whole archive, not the recent slice.
      var needsFull = !!(opts.category || opts.topic || opts.format || opts.author);
      return this.getArticleIndex({ full: needsFull }).then(function (ix) {
        var list = (ix.articles || []).slice();
        if (opts.category) list = list.filter(function (a) { return a.category === opts.category; });
        if (opts.topic)    list = list.filter(function (a) { return (a.topics || []).indexOf(opts.topic) !== -1; });
        if (opts.format)   list = list.filter(function (a) { return a.format === opts.format; });
        if (opts.author)   list = list.filter(function (a) {
          return (a.authors || []).some(function (x) { return x.id === opts.author; });
        });
        list.sort(function (a, b) { return (b.published_at || '').localeCompare(a.published_at || ''); });
        if (opts.exclude) list = list.filter(function (a) { return a.slug !== opts.exclude; });
        return opts.count ? list.slice(0, opts.count) : list;
      });
    }
  };

  /* ---------------- authenticated source: Apps Script web app ----------------
   * Used only by /admin/ and the author portal. Every call is a POST whose body
   * is JSON sent as text/plain — Apps Script cannot answer a CORS preflight, and
   * text/plain avoids triggering one. The backend re-validates permissions on
   * every call; nothing here is a security control.
   */

  function AppsScriptSource(endpoint) {
    this.kind = 'appsscript';
    this.endpoint = endpoint;
    this.token = null;
  }

  AppsScriptSource.prototype.setToken = function (t) { this.token = t || null; };

  AppsScriptSource.prototype.call = function (action, payload) {
    if (!this.endpoint) return Promise.reject(new ApiError('no_endpoint', action));
    var body = JSON.stringify({ action: action, token: this.token, payload: payload || {} });
    return fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      credentials: 'omit'
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || res.ok !== true) {
        throw new ApiError((res && res.error) || 'request_failed', (res && res.detail) || action);
      }
      return res.data;
    }, function () { throw new ApiError('offline', action); });
  };

  // Named methods mirror the public source where the shapes overlap, so admin
  // previews can reuse the same rendering code as the live site.
  ['getSettings', 'getMenus', 'getHomepage', 'getCategories'].forEach(function (m) {
    AppsScriptSource.prototype[m] = function () { return this.call(m); };
  });
  AppsScriptSource.prototype.getArticle = function (id, version) {
    return this.call('getArticle', { article_id: id, version: version });
  };
  AppsScriptSource.prototype.listArticles = function () { return this.call('myArticles'); };

  global.MAG = {
    BASE: BASE,
    join: join,
    ApiError: ApiError,
    public: StaticSource,
    admin: function (endpoint) { return new AppsScriptSource(endpoint); }
  };
})(window);
