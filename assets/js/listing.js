/* listing.js — category, topic and search pages. */
(function () {
  'use strict';
  var API = MAG.public, el = Site.el;
  var params = new URLSearchParams(location.search);
  var host = document.getElementById('results');
  var mode = document.body.getAttribute('data-page');

  Site.ready.then(function () { return mode === 'search' ? search() : category(); })
    .catch(function () { Site.fail(host, 'This page could not load. Check your connection and reload.'); });

  function category() {
    var slug = (params.get('c') || '').toLowerCase();
    var topic = (params.get('t') || '').toLowerCase();
    return Promise.all([API.getCategories(), API.listArticles(topic ? { topic: topic } : { category: slug })])
      .then(function (r) {
        var meta = (r[0].categories || []).filter(function (c) { return c.slug === slug; })[0]
                || (r[0].topics || []).filter(function (t) { return t.slug === topic; })[0];
        document.getElementById('title').textContent = meta ? meta.name : 'Not found';
        var d = document.getElementById('desc');
        if (meta && meta.description) d.textContent = meta.description;
        document.title = (meta ? meta.name : 'Not found') + ' — ' + document.title;
        paint(r[1], meta ? 'Nothing published in this section yet.' : 'That section does not exist.');
        Site.mountAds();
      });
  }

  function search() {
    var box = document.getElementById('q');
    box.value = params.get('q') || '';
    var run = debounce(function () {
      var q = box.value.trim();
      history.replaceState({}, '', location.pathname + (q ? '?q=' + encodeURIComponent(q) : ''));
      if (q.length < 2) { host.innerHTML = ''; Site.fail(host, 'Type at least two characters.'); return; }
      API.getSearchIndex().then(function (ix) {
        var hits = rank(ix.docs || [], q);
        paint(hits.map(toCard), 'No articles match “' + q + '”. Try a broader term.');
      });
    }, 120);
    box.addEventListener('input', run);
    document.getElementById('go').addEventListener('click', run);
    box.focus();
    if (box.value) run();
    return Promise.resolve();
  }

  // Small scorer over the prebuilt index: title hits weigh most, then keywords,
  // then the summary. Good enough for a few thousand documents in the browser.
  function rank(docs, q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return docs.map(function (d) {
      var t = (d.t || '').toLowerCase(), k = (d.k || '').toLowerCase(), s = (d.d || '').toLowerCase();
      var score = 0;
      terms.forEach(function (w) {
        if (t.indexOf(w) !== -1) score += 6;
        if (k.indexOf(w) !== -1) score += 3;
        if (s.indexOf(w) !== -1) score += 1;
      });
      return { d: d, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score || (b.d.p || '').localeCompare(a.d.p || ''); })
      .slice(0, 50).map(function (x) { return x.d; });
  }

  function toCard(d) {
    return { slug: d.s, title: d.t, summary: d.d, category_name: d.c, published_at: d.p, authors: [] };
  }

  function paint(items, emptyMsg) {
    host.innerHTML = '';
    if (!items.length) { Site.fail(host, emptyMsg); return; }
    var rows = el('div', { class: 'rows' });
    items.forEach(function (a) { rows.appendChild(Site.card(a)); });
    host.appendChild(rows);
  }

  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
})();
