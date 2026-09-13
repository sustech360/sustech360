/* issues-admin.js — the issue composer.
 *
 * Assembling an issue is picking from what is already published, writing an
 * editorial, and reading the PDF before anyone approves it. The screen is built
 * in that order because that is the order the work happens in.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    var STATE = {
      DRAFT: 'Draft', PREVIEW: 'In preview', VERIFIED: 'Verified',
      APPROVED: 'Approved, not published', PUBLISHED: 'Published', DISCARDED: 'Discarded'
    };
    var WORD = {
      PREVIEW: 'Send to preview', DRAFT: 'Back to draft', VERIFIED: 'Verify',
      APPROVED: 'Approve', DISCARDED: 'Discard'
    };

    views.issues = function (v) {
      api.call('listIssues').then(function (issues) {
        v.innerHTML = '<h2>Magazine issues</h2>' +
          '<div class="card"><p class="hint">An issue collects articles that are already published. It cannot publish anything itself, and once it is out it does not change.</p></div>' +
          (issues.length ? '<div class="card"><table><thead><tr><th>Issue</th><th>When</th><th>Articles</th><th>State</th><th></th></tr></thead><tbody>' +
            issues.map(function (i) {
              return '<tr><td>' + esc(i.title) + '<br><span class="hint">Issue ' + i.number +
                (i.has_pdf ? ' · PDF built' : ' · no PDF yet') + '</span></td>' +
                '<td class="hint">' + esc([i.month, i.year].filter(Boolean).join(' ')) + '</td>' +
                '<td>' + i.article_count + '</td><td>' + esc(STATE[i.status] || i.status) + '</td>' +
                '<td><button class="ghost" data-open="' + esc(i.id) + '">Open</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '') +
          '<div class="card"><h2>Start an issue</h2>' +
          '<label for="inum">Number</label><input id="inum" type="number" value="' + ((issues[0] ? issues[0].number : 0) + 1) + '">' +
          '<label for="ititle">Title</label><input id="ititle" placeholder="Issue 2 — What the grid needs">' +
          '<label for="imonth">Month</label><input id="imonth" placeholder="October">' +
          '<label for="iyear">Year</label><input id="iyear" type="number" value="' + new Date().getFullYear() + '">' +
          '<div class="rowbtns"><button class="act" id="mk">Create</button></div></div><div id="imsg"></div>';

        v.querySelectorAll('[data-open]').forEach(function (b) {
          b.addEventListener('click', function () { ctx.render('issue', b.getAttribute('data-open')); });
        });
        document.getElementById('mk').addEventListener('click', function () {
          api.call('createIssue', {
            number: Number(document.getElementById('inum').value),
            title: document.getElementById('ititle').value,
            month: document.getElementById('imonth').value,
            year: Number(document.getElementById('iyear').value)
          }).then(function (i) { ctx.render('issue', i.id); })
            .catch(function (e) { message(document.getElementById('imsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Magazine issues</h2>'; message(v, explain(e), 'err'); });
    };

    views.issue = function (v, id) {
      api.call('getIssue', { id: id }).then(function (i) {
        var editable = i.status === 'DRAFT' || i.status === 'PREVIEW';
        var contents = i.contents || {};

        v.innerHTML = '<h2>' + esc(i.title) + '</h2>' +
          '<div class="card"><p class="hint">Issue ' + i.number + ' · ' + esc(STATE[i.status] || i.status) +
          ' · ' + i.article_count + ' articles' + (i.pdf_built_at ? ' · PDF built ' + esc(i.pdf_built_at.slice(0, 16).replace('T', ' ')) : ' · PDF not built') + '</p>' +
          '<label for="ttl">Title</label><input id="ttl" value="' + esc(i.title) + '"' + (editable ? '' : ' disabled') + '>' +
          '<label for="thm">Theme</label><input id="thm" value="' + esc(i.theme) + '"' + (editable ? '' : ' disabled') + '>' +
          '<label for="edi">Editorial</label><textarea id="edi" rows="10" style="width:100%"' + (editable ? '' : ' disabled') + '>' +
          esc(i.editorial || '') + '</textarea>' +
          '<div class="rowbtns" id="iactions"></div><div id="i2msg"></div></div>' +

          '<div class="card"><h2>Contents</h2>' +
          i.sections.map(function (s) {
            var items = contents[s.key] || [];
            return '<h3>' + esc(s.name) + '</h3>' +
              (items.length ? '<table><tbody>' + items.map(function (aid) {
                return '<tr><td>' + esc(aid) + '</td><td>' +
                  (editable ? '<button class="ghost" data-drop="' + esc(s.key) + '|' + esc(aid) + '">Remove</button>' : '') +
                  '</td></tr>';
              }).join('') + '</tbody></table>' : '<p class="hint">Nothing here yet.</p>');
          }).join('') + '</div>' +

          (editable ? '<div class="card"><h2>Add a published article</h2>' +
            '<label for="pick">Article</label><select id="pick">' +
            i.available.map(function (a) {
              return '<option value="' + esc(a.id) + '">' + esc(a.title) + ' (' + esc(a.category) + ')</option>';
            }).join('') + '</select>' +
            '<label for="sect">Section</label><select id="sect">' +
            i.sections.map(function (s) { return '<option value="' + esc(s.key) + '">' + esc(s.name) + '</option>'; }).join('') +
            '</select><div class="rowbtns"><button class="act" id="add">Add to the issue</button></div>' +
            '<p class="hint">Only published articles appear here. That is the rule, not an oversight.</p></div>' : '') +

          '<div class="card"><h2>PDF</h2>' +
          '<p class="hint">Build it and read it before approving. Publication rebuilds it from whatever was approved, so a stale build can never ship.</p>' +
          '<div class="rowbtns"><button class="ghost" id="pdf">Build the PDF</button></div></div>';

        var actions = document.getElementById('iactions');
        if (editable) actions.appendChild(button('act', 'Save', save));
        (i.moves || []).forEach(function (m) {
          actions.appendChild(button(m.to === 'DISCARDED' ? 'danger' : 'ghost', WORD[m.to] || m.to, function () { move(m); }));
        });
        if (i.status === 'APPROVED') {
          actions.appendChild(button('act', 'Publish the issue', function () {
            if (!confirm('Publish issue ' + i.number + '? The web edition and the PDF go live.')) return;
            api.call('publishIssue', { issue_id: id })
              .then(function (res) { message(document.getElementById('i2msg'), 'Published ' + res.files.length + ' files.', 'ok');
                setTimeout(function () { ctx.render('issue', id); }, 800); })
              .catch(function (e) { message(document.getElementById('i2msg'), explain(e), 'err'); });
          }));
        }
        actions.appendChild(button('ghost', 'Back', function () { ctx.render('issues'); }));

        document.getElementById('pdf').addEventListener('click', function () {
          api.call('buildIssuePdf', { id: id })
            .then(function (res) { message(document.getElementById('i2msg'),
              'Built, ' + Math.round(res.bytes / 1024) + ' KB. It is in the Drive issues folder.', 'ok'); })
            .catch(function (e) { message(document.getElementById('i2msg'), explain(e), 'err'); });
        });

        var add = document.getElementById('add');
        if (add) {
          add.addEventListener('click', function () {
            var section = document.getElementById('sect').value;
            var next = JSON.parse(JSON.stringify(contents));
            next[section] = (next[section] || []).concat([document.getElementById('pick').value]);
            api.call('saveIssue', { id: id, contents: next })
              .then(function () { ctx.render('issue', id); })
              .catch(function (e) { message(document.getElementById('i2msg'), explain(e), 'err'); });
          });
        }
        v.querySelectorAll('[data-drop]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = b.getAttribute('data-drop').split('|');
            var next = JSON.parse(JSON.stringify(contents));
            next[p[0]] = (next[p[0]] || []).filter(function (x) { return x !== p[1]; });
            api.call('saveIssue', { id: id, contents: next })
              .then(function () { ctx.render('issue', id); })
              .catch(function (e) { message(document.getElementById('i2msg'), explain(e), 'err'); });
          });
        });

        function save() {
          api.call('saveIssue', {
            id: id, title: document.getElementById('ttl').value,
            theme: document.getElementById('thm').value,
            editorial: document.getElementById('edi').value
          }).then(function () { message(document.getElementById('i2msg'), 'Saved. The PDF will be rebuilt when it is published.', 'ok'); })
            .catch(function (e) { message(document.getElementById('i2msg'), explain(e), 'err'); });
        }

        function move(m) {
          var reason = '';
          if (m.needs_reason) { reason = prompt('Why? This goes on the record.') || ''; if (!reason) return; }
          var first = editable ? save() : Promise.resolve();
          Promise.resolve(first)
            .then(function () { return api.call('moveIssue', { id: id, to: m.to, reason: reason }); })
            .then(function () { ctx.render('issue', id); })
            .catch(function (e) { message(document.getElementById('i2msg'), explain(e), 'err'); });
        }
      }).catch(function (e) { v.innerHTML = '<h2>Issue</h2>'; message(v, explain(e), 'err'); });
    };

    function button(cls, text, fn) {
      var b = ctx.el('button', { class: cls, type: 'button', text: text });
      b.addEventListener('click', fn);
      return b;
    }

    return views;
  };
})();
