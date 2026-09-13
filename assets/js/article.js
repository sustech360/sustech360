/* article.js — renders one published article from its static JSON.
   Only the public version is ever fetched; drafts have no file on disk. */
(function () {
  'use strict';
  var API = MAG.public, el = Site.el;
  var slug = new URLSearchParams(location.search).get('a') || '';
  var head = document.getElementById('head');
  var body = document.getElementById('body');

  Site.ready.then(function () { return API.getArticle(slug); })
    .then(function (a) { render(a); return related(a); })
    .catch(function (e) {
      head.innerHTML = '';
      head.appendChild(el('h1', { text: e && e.code === 'not_found' ? 'That article is not here' : 'This page could not load' }));
      head.appendChild(el('p', { class: 'empty', text: e && e.code === 'not_found'
        ? 'It may have been moved or never published. Search the archive or start from the homepage.'
        : 'Check your connection and reload.' }));
    });

  function render(a) {
    document.title = (a.seo && a.seo.title) || a.title;
    setMeta('description', (a.seo && a.seo.description) || a.summary);
    setProp('og:title', a.title);
    setProp('og:description', a.summary);
    setProp('og:type', 'article');
    if (a.seo && a.seo.canonical) {
      var link = document.querySelector('link[rel=canonical]') || document.head.appendChild(el('link', { rel: 'canonical' }));
      link.setAttribute('href', a.seo.canonical);
    }
    structuredData(a);

    head.innerHTML = '';
    head.appendChild(el('a', { class: 'kicker', href: MAG.join('category.html?c=' + encodeURIComponent(a.category)), text: a.category_name || a.category }));
    head.appendChild(el('h1', { text: a.title }));
    if (a.subtitle) head.appendChild(el('p', { class: 'standfirst', text: a.subtitle }));

    var meta = el('div', { class: 'meta' });
    (a.authors || []).forEach(function (au) {
      meta.appendChild(el('span', { class: 'by', text: au.name + (au.institution ? ', ' + au.institution : '') }));
    });
    meta.appendChild(el('span', { text: Site.fmtDate(a.published_at) }));
    if (a.updated_at) meta.appendChild(el('span', { text: 'Updated ' + Site.fmtDate(a.updated_at) }));
    if (a.reading_minutes) meta.appendChild(el('span', { text: a.reading_minutes + ' min read' }));
    if (a.level) meta.appendChild(el('span', { class: 'level', text: levelLabel(a.level) }));
    head.appendChild(meta);
    if (a.sponsored) head.appendChild(el('p', { class: 'notice', text: 'Sponsored content. Produced with commercial support and reviewed to the same standards.' }));

    body.innerHTML = '';
    if (a.summary) body.appendChild(el('p', { class: 'standfirst', text: a.summary }));
    (a.blocks || []).forEach(function (b, i) { var n = block(b, i); if (n) body.appendChild(n); });

    buildToc();
    progress();
    controls();
    Site.mountAds();
  }

  function block(b, i) {
    switch (b.type) {
      case 'h2': return el('h2', { id: 's' + i, text: b.text });
      case 'h3': return el('h3', { id: 's' + i, text: b.text });
      case 'p':  return el('p', { text: b.text });
      case 'quote': return el('blockquote', { text: b.text });
      case 'list': return el(b.ordered ? 'ol' : 'ul', {}, (b.items || []).map(function (t) { return el('li', { text: t }); }));
      case 'figure': {
        var media = b.src
          ? el('img', { src: b.src, alt: b.alt || b.caption || '', loading: 'lazy', decoding: 'async' })
          : el('div', { class: 'figph', role: 'img', 'aria-label': b.caption || 'Figure' });
        return el('figure', {}, [media, b.caption ? el('figcaption', { text: b.caption }) : null]);
      }
      case 'table': return table(b);
      case 'equation': return el('p', { class: 'eq', text: b.tex || b.text });
      case 'references': return el('div', {}, [
        el('h2', { id: 'refs', text: 'References' }),
        el('ol', { class: 'refs' }, (b.items || []).map(function (t) { return el('li', { text: t }); }))
      ]);
      case 'ad': return el('div', { class: 'adslot', 'data-ad': b.placement || 'ARTICLE_MIDDLE' });
      default: return null;
    }
  }

  function table(b) {
    var t = el('table');
    if (b.head) t.appendChild(el('thead', {}, [el('tr', {}, b.head.map(function (c) { return el('th', { text: c }); }))]));
    t.appendChild(el('tbody', {}, (b.rows || []).map(function (r) {
      return el('tr', {}, r.map(function (c) { return el('td', { text: c }); }));
    })));
    return t;
  }

  function levelLabel(l) {
    return { discover: 'Discover', understand: 'Understand', research: 'Research' }[l] || l;
  }

  function buildToc() {
    var host = document.getElementById('toc');
    var heads = body.querySelectorAll('h2');
    if (!host || heads.length < 2) return;
    var ul = el('ul');
    heads.forEach(function (h) {
      if (!h.id) h.id = 'h-' + Math.random().toString(36).slice(2, 8);
      ul.appendChild(el('li', {}, [el('a', { href: '#' + h.id, text: h.textContent })]));
    });
    host.appendChild(el('h2', { class: 'toc__title', text: 'In this article' }));
    host.appendChild(ul);
    if ('IntersectionObserver' in window) {
      var links = host.querySelectorAll('a');
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (l) {
            l.classList.toggle('is-active', l.getAttribute('href') === '#' + en.target.id);
          });
        });
      }, { rootMargin: '-10% 0px -80% 0px' });
      heads.forEach(function (h) { obs.observe(h); });
    }
  }

  function progress() {
    var bar = document.getElementById('progress');
    if (!bar) return;
    var tick = false;
    addEventListener('scroll', function () {
      if (tick) return;
      tick = true;
      requestAnimationFrame(function () {
        var top = body.offsetTop, h = body.offsetHeight - innerHeight;
        var p = h > 0 ? Math.min(1, Math.max(0, (scrollY - top) / h)) : 0;
        bar.style.width = (p * 100).toFixed(1) + '%';
        tick = false;
      });
    }, { passive: true });
  }

  function controls() {
    var host = document.getElementById('controls');
    if (!host) return;
    var p = Site.prefs.read();
    host.appendChild(row('Text', [
      btn('Smaller', function () { step(-0.0625); }),
      btn('Larger', function () { step(0.0625); })
    ]));
    host.appendChild(row('Theme', ['light', 'sepia', 'dark'].map(function (t) {
      return btn(t[0].toUpperCase() + t.slice(1), function () { Site.prefs.set('theme', t); });
    })));
    host.appendChild(row('Page', [
      btn('Print', function () { print(); }),
      btn('Save', save), btn('Share', share)
    ]));

    function step(d) {
      var cur = parseFloat(Site.prefs.read().size || 1.0625);
      Site.prefs.set('size', Math.min(1.5, Math.max(0.9375, cur + d)).toFixed(4));
    }
    function row(label, kids) {
      return el('div', { class: 'row' }, [el('label', { text: label })].concat(kids));
    }
    function btn(text, fn) {
      var b = el('button', { class: 'btn', type: 'button', text: text });
      b.addEventListener('click', fn);
      return b;
    }
    function save() {
      var saved = JSON.parse(localStorage.getItem('mag.saved') || '[]');
      if (saved.indexOf(slug) === -1) saved.push(slug);
      localStorage.setItem('mag.saved', JSON.stringify(saved));
    }
    function share() {
      if (navigator.share) navigator.share({ title: document.title, url: location.href }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(location.href);
    }
    void p;
  }

  function related(a) {
    var host = document.getElementById('related');
    if (!host) return;
    return API.listArticles({ category: a.category, count: 4, exclude: a.slug }).then(function (list) {
      if (!list.length) return;
      host.appendChild(el('div', { class: 'section__head' }, [el('h2', { text: 'Related' })]));
      var rows = el('div', { class: 'rows' });
      list.forEach(function (x) { rows.appendChild(Site.card(x, { summary: false })); });
      host.appendChild(rows);
    });
  }

  function setMeta(name, content) {
    if (!content) return;
    var m = document.querySelector('meta[name="' + name + '"]') || document.head.appendChild(el('meta', { name: name }));
    m.setAttribute('content', content);
  }
  function setProp(prop, content) {
    if (!content) return;
    var m = document.querySelector('meta[property="' + prop + '"]') || document.head.appendChild(el('meta', { property: prop }));
    m.setAttribute('content', content);
  }
  function structuredData(a) {
    var data = {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: a.title, description: a.summary, datePublished: a.published_at,
      dateModified: a.updated_at || a.published_at,
      author: (a.authors || []).map(function (x) {
        return { '@type': 'Person', name: x.name, affiliation: x.institution || undefined };
      })
    };
    var s = el('script', { type: 'application/ld+json' });
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }
})();
