/* published.js — what is on the site, and correcting it.
 *
 * Everyone editorial can see this list. Only the supervisor admin can change
 * anything on it, and only the filing and the description — not the text. That
 * distinction is the whole design: changing what an article SAYS is a revision
 * and goes back through an editor; changing how it is FILED is a correction and
 * does not.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    function isSupervisor() {
      var me = ctx.me();
      return me && me.user.role_id === 'SUPERVISOR_ADMIN';
    }

    views.published = function (v) {
      api.call('liveArticles', { limit: 150 }).then(function (rows) {
        if (!rows.length) {
          v.innerHTML = '<div class="card"><p>Nothing is published yet. Articles appear here the moment they go live.</p></div>';
          return;
        }
        v.innerHTML =
          '<div class="card"><p class="hint">' + rows.length + ' pages are live. ' +
          (isSupervisor()
            ? 'You can correct how each is filed and described. Changing the text itself is a revision, which starts in the queue.'
            : 'Corrections to a live page are the supervisor admin’s step. Ask them, or open a revision from the queue.') +
          '</p></div>' +

          '<div class="card"><table><thead><tr>' +
          '<th>Article</th><th>Section</th><th>Level</th><th>Version</th><th>Published</th><th></th></tr></thead><tbody>' +
          rows.map(function (a) {
            return '<tr><td><strong>' + esc(a.title) + '</strong>' +
              '<span class="hint">' + esc(a.author) + ' · ' + esc(a.id) +
              (a.sponsored ? ' · sponsored' : '') +
              (a.status === 'ARCHIVED' ? ' · archived' : '') + '</span></td>' +
              '<td>' + esc(a.category) + '</td><td>' + esc(a.level || '—') + '</td>' +
              '<td>v' + a.public_version +
              (a.working_version > a.public_version ? '<span class="hint">v' + a.working_version + ' in progress</span>' : '') + '</td>' +
              '<td class="hint">' + esc(String(a.published_at).slice(0, 10)) + '</td>' +
              '<td><a class="ghost" href="' + esc(a.url) + '" target="_blank" rel="noopener">View</a> ' +
              (isSupervisor() ? '<button class="ghost" data-fix="' + esc(a.id) + '">Correct</button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table></div>';

        v.querySelectorAll('[data-fix]').forEach(function (b) {
          b.addEventListener('click', function () {
            var row = rows.filter(function (a) { return a.id === b.getAttribute('data-fix'); })[0];
            ctx.render('correction', row);
          });
        });
      }).catch(function (e) { v.innerHTML = ''; message(v, explain(e), 'err'); });
    };

    views.correction = function (v, a) {
      if (!a) { ctx.render('published'); return; }
      api.call('siteConfiguration').catch(function () { return { categories: [] }; }).then(function (cfg) {
        var categories = (cfg.categories || []).filter(function (c) { return c.status === 'ACTIVE'; });

        v.innerHTML =
          '<div class="card"><h2>' + esc(a.title) + '</h2>' +
          '<p class="hint">' + esc(a.id) + ' · live as version ' + a.public_version +
          ' · <a href="' + esc(a.url) + '" target="_blank" rel="noopener">open the page</a></p>' +

          '<label for="c-title">Headline</label><input id="c-title" value="' + esc(a.title) + '">' +

          '<label for="c-category">Section</label><select id="c-category">' +
          categories.map(function (c) {
            return '<option value="' + esc(c.slug) + '"' + (c.slug === a.category ? ' selected' : '') + '>' +
              esc(c.name) + '</option>';
          }).join('') + '</select>' +

          '<label for="c-level">Reading level</label><select id="c-level">' +
          [['discover', 'Discover — a general reader'],
           ['understand', 'Understand — students and technical readers'],
           ['research', 'Research — specialists']].map(function (l) {
            return '<option value="' + l[0] + '"' + (l[0] === a.level ? ' selected' : '') + '>' + esc(l[1]) + '</option>';
          }).join('') + '</select>' +

          '<label for="c-topics">Topics <span class="hint">comma separated</span></label>' +
          '<input id="c-topics" value="' + esc((a.topics || []).join(', ')) + '">' +
          '<label for="c-tags">Tags</label>' +
          '<input id="c-tags" value="' + esc((a.tags || []).join(', ')) + '">' +

          '<label for="c-seotitle">Search engine headline <span class="hint">70 characters</span></label>' +
          '<input id="c-seotitle" value="' + esc(a.seo_title) + '" maxlength="70">' +
          '<label for="c-seodesc">Search engine description <span class="hint">what appears under the link</span></label>' +
          '<textarea id="c-seodesc" rows="3">' + esc(a.seo_description) + '</textarea>' +

          '<label><input type="checkbox" id="c-sponsored"' + (a.sponsored ? ' checked' : '') + '> ' +
          'Labelled as sponsored</label>' +

          '<label for="c-reason">What is being corrected <span class="hint">goes on the record</span></label>' +
          '<input id="c-reason" placeholder="Filed in the wrong section">' +

          '<div class="rowbtns">' +
          '<button class="act" id="c-save">Correct and republish</button>' +
          '<button class="ghost" id="c-back">Back</button></div>' +
          '<p class="hint">This republishes the page immediately. The text is untouched — to change what it says, ' +
          'open a revision from the queue and let an editor read it.</p>' +
          '<div id="cmsg"></div></div>';

        document.getElementById('c-back').addEventListener('click', function () { ctx.render('published'); });

        document.getElementById('c-save').addEventListener('click', function () {
          var list = function (id) {
            return document.getElementById(id).value.split(',')
              .map(function (x) { return x.trim(); }).filter(Boolean);
          };
          api.call('correctLiveArticle', {
            article_id: a.id,
            title: document.getElementById('c-title').value,
            category: document.getElementById('c-category').value,
            level: document.getElementById('c-level').value,
            topics: list('c-topics'),
            tags: list('c-tags'),
            seo_title: document.getElementById('c-seotitle').value,
            seo_description: document.getElementById('c-seodesc').value,
            sponsored: document.getElementById('c-sponsored').checked,
            reason: document.getElementById('c-reason').value
          }).then(function (res) {
            message(document.getElementById('cmsg'),
              'Corrected and republished — ' + res.files + ' files updated.', 'ok');
          }).catch(function (e) {
            message(document.getElementById('cmsg'), explain(e), 'err');
          });
        });
      });
    };

    return views;
  };
})();
