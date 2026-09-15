/* site.js — shell shared by every public page. Small on purpose: page-specific
   work lives in home.js / article.js / listing.js and only loads where needed. */
(function (global) {
  'use strict';
  var API = global.MAG.public;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---- theme + reader settings: local only, no backend request ---- */

  var Prefs = {
    read: function () {
      try { return JSON.parse(localStorage.getItem('mag.prefs') || '{}'); } catch (e) { return {}; }
    },
    write: function (p) {
      try { localStorage.setItem('mag.prefs', JSON.stringify(p)); } catch (e) {}
    },
    apply: function () {
      var p = this.read();
      if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
      if (p.size) document.documentElement.style.setProperty('--reader-size', p.size + 'rem');
      if (p.leading) document.documentElement.style.setProperty('--reader-leading', p.leading);
      return p;
    },
    set: function (k, v) { var p = this.read(); p[k] = v; this.write(p); this.apply(); }
  };

  /* ---- brand + navigation, both configured from the backend ---- */

  function applySettings(s) {
    var t = (s.appearance && s.appearance.tokens) || {};
    Object.keys(t).forEach(function (k) { document.documentElement.style.setProperty(k, t[k]); });
    var brand = s.brand || {};
    var name = brand.name || 'Magazine';
    var short = brand.short_name || name;
    document.querySelectorAll('[data-brand]').forEach(function (n) { n.textContent = short; });

    // A configured logo replaces the wordmark text. The alt text carries the
    // full title, so the masthead stays readable to a screen reader and to a
    // search engine even though the picture says the short name.
    var theme = document.documentElement.getAttribute('data-theme');
    var logo = (theme === 'dark' && brand.logo_dark) ? brand.logo_dark : brand.logo;
    if (logo) {
      document.querySelectorAll('.wordmark').forEach(function (mark) {
        mark.innerHTML = '';
        mark.appendChild(el('img', {
          src: MAG.join(logo), alt: name, class: 'wordmark__logo',
          width: '210', height: '36', decoding: 'async'
        }));
      });
    }
    if (brand.favicon) {
      var icon = document.querySelector('link[rel="icon"]') ||
                 document.head.appendChild(el('link', { rel: 'icon' }));
      icon.setAttribute('href', MAG.join(brand.favicon));
    }
    document.querySelectorAll('[data-contact]').forEach(function (n) {
      var email = (s.contact && s.contact.editorial) || '';
      if (!email) return;
      n.innerHTML = '';
      n.appendChild(el('a', { href: 'mailto:' + email, text: email }));
    });
    document.querySelectorAll('[data-tagline]').forEach(function (n) {
      n.textContent = (s.brand && s.brand.tagline) || '';
    });
    if (!document.title || document.title === 'Magazine') document.title = name;
    return s;
  }

  function renderNav(menus) {
    var host = document.querySelector('[data-nav]');
    if (!host) return;
    var items = (menus.primary || []).filter(function (m) { return m.status === 'ACTIVE'; });
    var top = items.filter(function (m) { return !m.parent; }).sort(byOrder);
    var ul = el('ul');
    top.forEach(function (m) {
      ul.appendChild(el('li', {}, [el('a', { href: global.MAG.join(m.url), text: m.name })]));
      items.filter(function (c) { return c.parent === m.id; }).sort(byOrder).forEach(function (c) {
        ul.appendChild(el('li', { class: 'sub' }, [el('a', { href: global.MAG.join(c.url), text: c.name })]));
      });
    });
    host.innerHTML = '';
    host.appendChild(ul);

    var foot = document.querySelector('[data-footer-nav]');
    if (foot) {
      var fl = el('ul');
      (menus.footer || []).filter(function (m) { return m.status === 'ACTIVE'; }).sort(byOrder)
        .forEach(function (m) { fl.appendChild(el('li', {}, [el('a', { href: global.MAG.join(m.url), text: m.name })])); });
      foot.innerHTML = '';
      foot.appendChild(fl);
    }
  }

  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }

  /* ---- social links ----
     Which of these appear, and where they point, is set in the control centre.
     They are written into the footer of every page from here, so no page has to
     carry markup for a link that may not exist.

     Text rather than logos: a publication's footer reads better as words, and a
     brand mark drawn from memory is worse than no mark at all. */

  var SOCIAL = [
    ['linkedin',    'LinkedIn'],
    ['x',           'X'],
    ['facebook',    'Facebook'],
    ['instagram',   'Instagram'],
    ['youtube',     'YouTube'],
    ['telegram',    'Telegram'],
    ['whatsapp',    'WhatsApp'],
    ['researchgate','ResearchGate'],
    ['email',       'Email'],
    ['rss',         'RSS']
  ];

  function renderSocial(settings) {
    var config = (settings && settings.social) || {};
    var host = document.querySelector('[data-social]') ||
               (function () {
                 var footer = document.querySelector('.footer .shell');
                 if (!footer) return null;
                 var box = el('div', { 'data-social': '' });
                 footer.insertBefore(box, footer.firstChild);
                 return box;
               })();
    if (!host) return;

    var links = SOCIAL.filter(function (pair) {
      var value = config[pair[0]];
      return value && String(value).trim();
    });
    if (!links.length) { host.remove(); return; }

    var list = el('ul', { class: 'social' });
    links.forEach(function (pair) {
      var value = String(config[pair[0]]).trim();
      var href = pair[0] === 'email'
        ? (value.indexOf('mailto:') === 0 ? value : 'mailto:' + value)
        : (pair[0] === 'rss' && value.indexOf('http') !== 0 ? MAG.join(value) : value);
      list.appendChild(el('li', {}, [
        el('a', {
          href: href,
          text: pair[1],
          rel: pair[0] === 'email' || pair[0] === 'rss' ? null : 'me noopener',
          target: pair[0] === 'email' ? null : '_blank',
          'aria-label': pair[1] === 'RSS' ? 'RSS feed' : pair[1] + ', opens in a new tab'
        })
      ]));
    });
    host.innerHTML = '';
    host.appendChild(el('h2', { class: 'social__title', text: 'Follow' }));
    host.appendChild(list);
  }

  /* ---- article cards ---- */

  function card(a, opts) {
    opts = opts || {};
    var href = global.MAG.join('article.html?a=' + encodeURIComponent(a.slug));
    var kids = [];
    if (a.category_name || a.category) {
      kids.push(el('span', { class: 'kicker', text: a.category_name || a.category.replace(/-/g, ' ') }));
    }
    kids.push(el('h3', {}, [el('a', { href: href, text: a.title })]));
    if (opts.summary !== false && a.summary) kids.push(el('p', { text: a.summary }));
    var meta = el('div', { class: 'meta' });
    if (a.authors && a.authors[0]) meta.appendChild(el('span', { class: 'by', text: a.authors[0].name }));
    meta.appendChild(el('span', { text: fmtDate(a.published_at) }));
    if (a.reading_minutes) meta.appendChild(el('span', { text: a.reading_minutes + ' min read' }));
    if (a.sponsored) meta.appendChild(el('span', { text: 'Sponsored' }));
    kids.push(meta);
    return el('article', { class: 'card' }, kids);
  }

  /* ---- advertising ----
     The decision of what to show lives in ads.js, which is pure and tested.
     This is only the rendering of that decision, plus the counting. */

  var counter = null;

  function fillAd(node, placement) {
    return Promise.all([API.getAds(), API.getFeatures(), API.getSettings()]).then(function (r) {
      var cfg = r[0], flags = r[1], settings = r[2];
      var choice = AdChain.resolve(cfg, placement, {
        advertisingEnabled: ((flags.flags || {}).ADVERTISING || {}).state === 'enabled',
        adsenseClient: (settings.ads && settings.ads.adsense_client) || '',
        adsenseSlots: (settings.ads && settings.ads.slots) || {},
        section: document.body.getAttribute('data-section') || '',
        device: matchMedia('(max-width: 700px)').matches ? 'mobile' : 'desktop',
        related: node.getAttribute('data-related-title')
          ? { title: node.getAttribute('data-related-title'), url: node.getAttribute('data-related-url') }
          : null
      });
      if (!choice) return;                       // collapse: the slot stays 0px
      if (placement.indexOf('RAIL_') === 0) {
        // Only now does the page become three columns. A rail with nothing to
        // show never reserves space, so an unsold site is not two grey gutters.
        var frame = node.closest('.frame');
        if (frame) {
          frame.classList.add('has-rails');
          frame.classList.add(placement === 'RAIL_LEFT' ? 'rail-left' : 'rail-right');
        }
      }
      if (!counter && global.MAG_ENDPOINT) counter = new AdChain.Counter(global.MAG_ENDPOINT);
      paint(node, choice);
    }).catch(function () { /* an ad must never break a page */ });
  }

  function paint(node, choice) {
    node.innerHTML = '';
    node.appendChild(el('div', { class: 'adslot__label', text: choice.label }));

    if (choice.kind === 'adsense') {
      // data-ad-format="auto" with full-width-responsive is what makes one unit
      // fit a phone, a tablet and a desktop. Without them the unit is a fixed
      // box that either overflows a narrow screen or wastes a wide one.
      node.appendChild(el('ins', {
        class: 'adsbygoogle',
        style: 'display:block',
        'data-ad-client': choice.client,
        'data-ad-slot': choice.slot,
        'data-ad-format': 'auto',
        'data-full-width-responsive': 'true'
      }));
      // The loader carries the client id, as Google's own snippet does.
      loadScript('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
                 encodeURIComponent(choice.client));
      try { (global.adsbygoogle = global.adsbygoogle || []).push({}); } catch (e) {}
      node.classList.add('is-filled');
      return;
    }

    if (choice.kind === 'related') {
      node.appendChild(el('p', {}, [el('a', { href: choice.article.url, text: choice.article.title })]));
      node.classList.add('is-filled');
      return;
    }

    var c = choice.creative;
    var img = el('img', { src: MAG.join(c.image), alt: c.alt || '', loading: 'lazy', decoding: 'async' });
    var link = el('a', { href: c.url, rel: 'nofollow sponsored noopener', target: '_blank' }, [img]);
    link.addEventListener('click', function () { if (counter) { counter.bump(c.id, 'click'); counter.flush(); } });
    node.appendChild(link);
    node.classList.add('is-filled');

    // An impression is counted when the slot is actually on screen, not when
    // the page happens to contain it.
    if (counter && 'IntersectionObserver' in global) {
      var seen = false;
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting || seen) return;
          seen = true;
          counter.bump(c.id, 'impression');
          obs.disconnect();
        });
      }, { threshold: 0.5 });
      obs.observe(node);
    } else if (counter) {
      counter.bump(c.id, 'impression');
    }
  }

  function loadScript(src) {
    if (document.querySelector('script[src="' + src + '"]')) return;
    var s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }

  /** True only where a rail can actually fit beside the text. Below this the
   *  rails are not fetched at all — no request, no markup, no empty column. */
  function railsFit() {
    return matchMedia('(min-width: 1200px)').matches;
  }

  function mountAds() {
    document.querySelectorAll('[data-ad]').forEach(function (n) {
      var placement = n.getAttribute('data-ad');
      if (placement.indexOf('RAIL_') === 0 && !railsFit()) return;
      fillAd(n, placement);
    });
    if (!mountAds.bound) {
      mountAds.bound = true;
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && counter) counter.flush();
      });
    }
  }

  function fail(host, message) {
    if (host) host.appendChild(el('p', { class: 'empty', text: message }));
  }

  /* ---- boot ---- */

  function boot() {
    Prefs.apply();
    var year = document.querySelector('[data-year]');
    if (year) year.textContent = new Date().getFullYear();

    var shell = Promise.all([API.getSettings(), API.getMenus()]).then(function (r) {
      applySettings(r[0]);
      renderNav(r[1]);
      renderSocial(r[0]);
      if (r[0].analytics && r[0].analytics.ga4_id) analytics(r[0].analytics.ga4_id);
      return r[0];
    });

    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.addEventListener('click', function () { Prefs.set('theme', b.getAttribute('data-theme-set')); });
    });

    if ('serviceWorker' in navigator) {
      addEventListener('load', function () {
        navigator.serviceWorker.register(global.MAG.join('pwa/service-worker.js')).catch(function () {});
      });
    }
    return shell;
  }

  function analytics(id) {
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id));
    global.dataLayer = global.dataLayer || [];
    function gtag() { global.dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', id, { anonymize_ip: true });
  }

  global.Site = {
    el: el, card: card, fmtDate: fmtDate, prefs: Prefs,
    mountAds: mountAds, fail: fail, ready: boot()
  };
})(window);
