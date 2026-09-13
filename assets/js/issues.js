/* issues.js — the list of issues, and one issue read on the web.
 *
 * A published issue is a snapshot: what these articles said when the issue came
 * out. The page says so, and links to each article's current version alongside,
 * because a reader deserves both the edition of record and the latest text. */
(function () {
  'use strict';
  var el = Site.el;
  var slug = new URLSearchParams(location.search).get('i');
  var lead = document.getElementById('lead');
  var body = document.getElementById('body');

  Site.ready.then(function () {
    return slug ? one(slug) : all();
  }).catch(function () {
    Site.fail(body, 'No issues have been published yet. Articles appear on the homepage as they go live.');
  });

  function fetchJSON(rel) {
    return fetch(MAG.join(rel)).then(function (r) {
      if (!r.ok) throw new Error('missing');
      return r.json();
    });
  }

  function all() {
    return fetchJSON('data/index/issues.json').then(function (file) {
      var issues = file.issues || [];
      if (!issues.length) { Site.fail(body, 'No issues have been published yet.'); return; }
      lead.appendChild(el('p', { class: 'standfirst',
        text: 'Each issue collects a month of work, with an editorial and a PDF edition.' }));
      var grid = el('div', { class: 'grid' });
      issues.forEach(function (i) {
        var card = el('article', { class: 'card' }, [
          el('span', { class: 'kicker', text: 'Issue ' + i.number }),
          el('h3', {}, [el('a', { href: MAG.join('issues.html?i=' + encodeURIComponent(i.slug)), text: i.title })]),
          i.theme ? el('p', { text: i.theme }) : null,
          el('div', { class: 'meta' }, [el('span', { text: [i.month, i.year].filter(Boolean).join(' ') })])
        ]);
        grid.appendChild(card);
      });
      body.appendChild(grid);
    });
  }

  function one(which) {
    return Promise.all([
      fetchJSON('data/issues/' + which.replace(/[^a-z0-9-]/gi, '') + '.json'),
      MAG.public.getSettings()
    ]).then(function (r) {
      var issue = r[0], settings = r[1], reading = settings.reading || {};
      document.title = issue.title;
      lead.innerHTML = '';
      lead.appendChild(el('span', { class: 'kicker', text: 'Issue ' + issue.number }));
      lead.appendChild(el('h1', { text: issue.title }));
      if (issue.theme) lead.appendChild(el('p', { class: 'standfirst', text: issue.theme }));
      var meta = el('div', { class: 'meta' }, [
        el('span', { text: [issue.month, issue.year].filter(Boolean).join(' ') }),
        el('span', { text: issue.article_count + ' articles' })
      ]);
      lead.appendChild(meta);

      // The PDF is offered only if the control centre allows it.
      if (issue.pdf && reading.allow_pdf_download !== false) {
        var actions = el('p', {}, [
          el('a', { class: 'btn', href: MAG.join(issue.pdf), download: '', text: 'Download the PDF edition' })
        ]);
        lead.appendChild(actions);
      }

      if (issue.editorial) {
        body.appendChild(el('h2', { text: 'Editorial' }));
        var ed = el('div', { class: 'article__body' });
        String(issue.editorial).split(/\n{2,}/).forEach(function (p) {
          ed.appendChild(el('p', { text: p }));
        });
        body.appendChild(ed);
      }

      (issue.sections || []).forEach(function (section) {
        var wrap = el('section', { class: 'section' });
        wrap.appendChild(el('div', { class: 'section__head' }, [el('h2', { text: section.name })]));
        var rows = el('div', { class: 'rows' });
        section.items.forEach(function (a) {
          rows.appendChild(el('article', { class: 'card' }, [
            el('h3', {}, [el('a', { href: MAG.join('article.html?a=' + encodeURIComponent(a.slug)), text: a.title })]),
            a.summary ? el('p', { text: a.summary }) : null,
            el('div', { class: 'meta' }, [
              el('span', { class: 'by', text: (a.authors[0] || {}).name || '' }),
              el('span', { text: a.reading_minutes + ' min read' }),
              el('span', { text: 'as published in this issue (v' + a.version + ')' })
            ])
          ]));
        });
        wrap.appendChild(rows);
        body.appendChild(wrap);
      });

      if (settings.reading && settings.reading.copy_notice) {
        body.appendChild(el('p', { class: 'notice', text: settings.reading.copy_notice }));
      }
    });
  }
})();
