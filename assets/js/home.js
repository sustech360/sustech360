/* home.js — renders the homepage entirely from data/homepage.json.
   Adding, reordering or pausing a section is a backend change, not a code change. */
(function () {
  'use strict';
  var API = MAG.public, el = Site.el;
  var host = document.getElementById('sections');

  Site.ready.then(function () {
    return Promise.all([API.getHomepage(), API.getArticleIndex()]);
  }).then(function (r) {
    var cfg = r[0];
    (cfg.sections || [])
      .filter(function (s) { return s.active && inSchedule(s); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .forEach(function (s) { host.appendChild(build(s)); });
    Site.mountAds();
  }).catch(function () {
    Site.fail(host, 'The homepage could not load. Check your connection and reload.');
  });

  function inSchedule(s) {
    var now = Date.now();
    if (s.starts && new Date(s.starts) > now) return false;
    if (s.ends && new Date(s.ends) < now) return false;
    return true;
  }

  function build(s) {
    if (s.type === 'ad') return el('div', { class: 'adslot', 'data-ad': s.placement });
    if (s.type === 'newsletter') return newsletter(s);
    var wrap = el('section', { class: s.type === 'hero' ? 'lead' : 'section' });
    if (s.title) wrap.appendChild(el('div', { class: 'section__head' }, [el('h2', { text: s.title })]));
    var body = el('div', { class: s.layout === 'grid' ? 'grid' : 'rows' });
    wrap.appendChild(body);
    resolve(s).then(function (items) {
      if (!items.length) { body.appendChild(el('p', { class: 'empty', text: 'Nothing published here yet.' })); return; }
      if (s.type === 'hero') { wrap.replaceChild(hero(items[0]), body); return; }
      items.forEach(function (a) { body.appendChild(Site.card(a, { summary: s.layout !== 'grid' })); });
    });
    return wrap;
  }

  function resolve(s) {
    var src = s.source || 'latest';
    if (src === 'manual') {
      return API.getArticleIndex().then(function (ix) {
        return (s.items || []).map(function (slug) {
          return (ix.articles || []).filter(function (a) { return a.slug === slug; })[0];
        }).filter(Boolean);
      });
    }
    if (src.indexOf('category:') === 0) return API.listArticles({ category: src.slice(9), count: s.count });
    if (src.indexOf('topic:') === 0)    return API.listArticles({ topic: src.slice(6), count: s.count });
    if (src.indexOf('format:') === 0)   return API.listArticles({ format: src.slice(7), count: s.count });
    return API.listArticles({ count: s.count || 6 });
  }

  function hero(a) {
    var href = MAG.join('article.html?a=' + encodeURIComponent(a.slug));
    var meta = el('div', { class: 'meta' });
    if (a.authors && a.authors[0]) {
      meta.appendChild(el('span', { class: 'by', text: a.authors[0].name + (a.authors[0].institution ? ', ' + a.authors[0].institution : '') }));
    }
    meta.appendChild(el('span', { text: Site.fmtDate(a.published_at) }));
    if (a.reading_minutes) meta.appendChild(el('span', { text: a.reading_minutes + ' min read' }));
    return el('div', {}, [
      el('h1', {}, [el('a', { href: href, text: a.title })]),
      a.subtitle ? el('p', { class: 'standfirst', text: a.subtitle }) : null,
      meta
    ]);
  }

  function newsletter(s) {
    var msg = el('p', { class: 'empty' });
    var input = el('input', { type: 'email', placeholder: 'you@institution.edu', 'aria-label': 'Email address', required: 'required' });
    var btn = el('button', { class: 'btn btn--solid', type: 'button', text: 'Subscribe' });
    btn.addEventListener('click', function () {
      if (!input.checkValidity()) { msg.textContent = 'Enter a valid email address.'; return; }
      btn.disabled = true;
      msg.textContent = 'Sending a confirmation…';
      MAG.admin(window.MAG_ENDPOINT).call('subscribe', { email: input.value.trim(), source: 'homepage' })
        .then(function (res) {
          // The same answer whatever the address turns out to be: the form must
          // not become a way of testing who is already subscribed.
          input.value = '';
          msg.textContent = res.message || 'Check that inbox for a confirmation link.';
        })
        .catch(function () {
          msg.textContent = 'That did not go through. Try again in a moment.';
        })
        .then(function () { btn.disabled = false; });
    });
    return el('section', { class: 'section' }, [
      el('div', { class: 'newsletter' }, [
        el('h2', { text: s.title || 'Newsletter' }),
        el('p', { text: 'One email a week: what published, what it means, and what to read next.' }),
        el('form', {}, [input, btn]), msg
      ])
    ]);
  }
})();
