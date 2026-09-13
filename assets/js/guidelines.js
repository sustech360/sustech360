/* guidelines.js — renders the published guideline documents. Each one carries
   its version and the date it took effect, because a policy without a date is
   not a policy anyone can rely on. */
(function () {
  'use strict';
  var el = Site.el, host = document.getElementById('docs'), toc = document.getElementById('toc');

  Site.ready
    .then(function () { return fetch(MAG.join('data/guidelines.json')).then(function (r) {
      if (!r.ok) throw new Error('missing');
      return r.json();
    }); })
    .then(render)
    .catch(function () {
      Site.fail(host, 'The guidelines are not published yet. Write to the editors and they will send you the current version.');
    });

  function render(file) {
    var docs = file.documents || [];
    if (!docs.length) {
      Site.fail(host, 'No guidelines have been published yet.');
      return;
    }
    var list = el('ul');
    docs.forEach(function (d) {
      var id = 'g-' + d.kind.toLowerCase();
      host.appendChild(el('h2', { id: id, text: d.name }));
      host.appendChild(el('p', { class: 'meta',
        text: 'Version ' + d.version + (d.published_at ? ', in effect since ' + Site.fmtDate(d.published_at) : '') }));
      String(d.body).split(/\n{2,}/).forEach(function (para) {
        var lines = para.split('\n');
        if (lines.length > 1 && lines[0].length < 60) {
          host.appendChild(el('h3', { text: lines[0] }));
          host.appendChild(el('p', { text: lines.slice(1).join(' ') }));
        } else {
          host.appendChild(el('p', { text: para }));
        }
      });
      list.appendChild(el('li', {}, [el('a', { href: '#' + id, text: d.name })]));
    });
    if (toc) {
      toc.appendChild(el('h2', { class: 'toc__title', text: 'Documents' }));
      toc.appendChild(list);
    }
  }
})();
