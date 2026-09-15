/* home.js — renders the homepage entirely from data/homepage.json.
   Adding, reordering or pausing a section is a backend change, not a code change. */
(function () {
  'use strict';
  var API = MAG.public, el = Site.el;
  var host = document.getElementById('sections');

  /* An article appears once on this page. The lead story used to show again at
     the top of Latest, and again under its own section — three times in one
     screen, which reads as a thin magazine rather than a considered one. */
  var used = {};

  Site.ready.then(function () {
    return API.getHomepage();
  }).then(function (cfg) {
    var sections = (cfg.sections || [])
      .filter(function (s) { return s.active && inSchedule(s); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    // Sections resolve in order so each one knows what the ones above it used.
    return sections.reduce(function (chain, section) {
      return chain.then(function () { return place(section); });
    }, Promise.resolve());
  }).then(function () {
    if (!host.querySelector('.card, .lead h1')) {
      host.appendChild(el('div', { class: 'section' }, [
        el('p', { class: 'empty', text: 'Nothing has been published yet. The first article will appear here.' })
      ]));
    }
    Site.mountAds();
  }).catch(function () {
    Site.fail(host, 'The homepage could not load. Check your connection and reload.');
  });

  /** Builds one section and adds it — unless it has nothing to show, in which
   *  case it is left out entirely. A heading above an apology is worse than no
   *  heading. */
  function place(section) {
    if (section.type === 'ad') {
      host.appendChild(el('div', { class: 'adslot', 'data-ad': section.placement }));
      return Promise.resolve();
    }
    if (section.type === 'newsletter') {
      host.appendChild(newsletter(section));
      return Promise.resolve();
    }
    return resolve(section).then(function (items) {
      var fresh = items.filter(function (a) { return a && !used[a.slug]; });
      if (!fresh.length) return;
      if (section.count) fresh = fresh.slice(0, section.count);
      fresh.forEach(function (a) { used[a.slug] = true; });

      if (section.type === 'hero') { host.appendChild(hero(fresh[0])); return; }

      var wrap = el('section', { class: 'section' });
      wrap.appendChild(heading(section));
      var body = el('div', { class: section.layout === 'grid' ? 'grid' : 'rows' });
      fresh.forEach(function (a) { body.appendChild(Site.card(a, { summary: section.layout !== 'grid' })); });
      wrap.appendChild(body);
      host.appendChild(wrap);
    });
  }

  /** A section heading that leads somewhere. "Energy storage" on the front page
     should be the way into energy storage, not a label. */
  function heading(section) {
    var head = el('div', { class: 'section__head' });
    head.appendChild(el('h2', { text: section.title || '' }));
    var src = String(section.source || '');
    var target = null;
    if (src.indexOf('category:') === 0) target = 'category.html?c=' + src.slice(9);
    else if (src.indexOf('topic:') === 0) target = 'category.html?t=' + src.slice(6);
    if (target) {
      head.appendChild(el('a', { class: 'section__more', href: MAG.join(target), text: 'All of it' }));
    }
    return head;
  }

  function inSchedule(s) {
    var now = Date.now();
    if (s.starts && new Date(s.starts) > now) return false;
    if (s.ends && new Date(s.ends) < now) return false;
    return true;
  }

  function resolve(s) {
    var src = s.source || 'latest';
    if (src === 'manual') {
      // Chosen by hand, so look through the whole archive rather than the
      // recent thirty the bundle carries.
      return API.getArticleIndex({ full: true }).then(function (ix) {
        return (s.items || []).map(function (slug) {
          return (ix.articles || []).filter(function (a) { return a.slug === slug; })[0];
        }).filter(Boolean);
      });
    }
    // Over-fetch a little: some of what comes back will already be on the page,
    // and a section that asked for four should still show four.
    var room = (s.count || 6) + 4;
    if (src.indexOf('category:') === 0) return API.listArticles({ category: src.slice(9), count: room });
    if (src.indexOf('topic:') === 0)    return API.listArticles({ topic: src.slice(6), count: room });
    if (src.indexOf('format:') === 0)   return API.listArticles({ format: src.slice(7), count: room });
    return API.listArticles({ count: room });
  }

  function hero(a) {
    var href = MAG.join('article.html?a=' + encodeURIComponent(a.slug));
    var section = a.category_name || String(a.category || '').replace(/-/g, ' ');
    var meta = el('div', { class: 'meta' });
    if (a.authors && a.authors[0]) {
      meta.appendChild(el('span', { class: 'by', text: a.authors[0].name + (a.authors[0].institution ? ', ' + a.authors[0].institution : '') }));
    }
    meta.appendChild(el('span', { text: Site.fmtDate(a.published_at) }));
    if (a.reading_minutes) meta.appendChild(el('span', { text: a.reading_minutes + ' min read' }));
    return el('div', { class: 'lead' }, [
      section ? el('a', {
        class: 'kicker',
        href: MAG.join('category.html?c=' + encodeURIComponent(a.category || '')),
        text: section
      }) : null,
      el('h1', {}, [el('a', { href: href, text: a.title })]),
      el('p', { class: 'standfirst', text: a.subtitle || a.summary || '' }),
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
