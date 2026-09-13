/* rulebook.js — Guidelines Centre and editorial rulebook views.
 *
 * Composes onto whatever view pack loaded before it, so admin.js needs no edit
 * when a phase adds screens.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    var STEP = {
      DRAFT: 'Draft', PREVIEW: 'In preview', VERIFIED: 'Verified',
      APPROVED: 'Approved', PUBLISHED: 'Live', ARCHIVED: 'Superseded', DISCARDED: 'Discarded'
    };
    var NEXT_WORD = {
      PREVIEW: 'Send to preview', DRAFT: 'Back to draft', VERIFIED: 'Verify',
      APPROVED: 'Approve', DISCARDED: 'Discard'
    };

    views.guidelines = function (v) {
      api.call('listGuidelines').then(function (kinds) {
        v.innerHTML = '<h2>Guidelines</h2>' +
          '<div class="card"><p class="hint">Editing a guideline opens a new version. What authors and readers see does not change until the supervisor admin publishes it.</p></div>' +
          kinds.map(function (k) {
            return '<div class="card"><h2>' + esc(k.name) + '</h2>' +
              '<p class="hint">' + (k.live ? 'Live: v' + esc(k.live.version) + ' since ' + esc(String(k.live.published_at).slice(0, 10)) : 'Never published') +
              (k.is_public ? '' : ' · internal only') + '</p>' +
              (k.working
                ? '<p>Version ' + esc(k.working.version) + ' in progress — ' + esc(STEP[k.working.status] || k.working.status) +
                  (k.working.notes ? '<br><span class="hint">' + esc(k.working.notes) + '</span>' : '') + '</p>' +
                  '<div class="rowbtns"><button class="act" data-edit="' + esc(k.working.id) + '">Open it</button></div>'
                : '<div class="rowbtns"><button class="ghost" data-new="' + esc(k.kind) + '">Start a new version</button>' +
                  '<button class="ghost" data-major="' + esc(k.kind) + '">Start a major rewrite</button></div>') +
              (k.history.length > 1 ? '<table><tbody>' + k.history.map(function (h) {
                return '<tr><td>v' + esc(h.version) + '</td><td>' + esc(STEP[h.status] || h.status) + '</td>' +
                  '<td class="hint">' + esc(String(h.created_at).slice(0, 10)) + '</td><td>' +
                  (h.status === 'ARCHIVED' || h.status === 'DISCARDED'
                    ? '<button class="ghost" data-restore="' + esc(h.id) + '">Reopen as a draft</button>' : '') + '</td></tr>';
              }).join('') + '</tbody></table>' : '') + '</div>';
          }).join('') + '<div id="gmsg"></div>';

        v.querySelectorAll('[data-new]').forEach(function (b) {
          b.addEventListener('click', function () { start(b.getAttribute('data-new'), false); });
        });
        v.querySelectorAll('[data-major]').forEach(function (b) {
          b.addEventListener('click', function () { start(b.getAttribute('data-major'), true); });
        });
        v.querySelectorAll('[data-edit]').forEach(function (b) {
          b.addEventListener('click', function () { ctx.render('guideline', b.getAttribute('data-edit')); });
        });
        v.querySelectorAll('[data-restore]').forEach(function (b) {
          b.addEventListener('click', function () {
            api.call('restoreGuideline', { id: b.getAttribute('data-restore') })
              .then(function (d) { ctx.render('guideline', d.id); })
              .catch(function (e) { message(document.getElementById('gmsg'), explain(e), 'err'); });
          });
        });

        function start(kind, major) {
          api.call('draftGuideline', { kind: kind, major: major })
            .then(function (d) { ctx.render('guideline', d.id); })
            .catch(function (e) { message(document.getElementById('gmsg'), explain(e), 'err'); });
        }
      }).catch(function (e) { v.innerHTML = '<h2>Guidelines</h2>'; message(v, explain(e), 'err'); });
    };

    views.guideline = function (v, id) {
      api.call('getGuideline', { id: id }).then(function (g) {
        var editable = g.status === 'DRAFT' || g.status === 'PREVIEW';
        v.innerHTML = '<h2>' + esc(g.title) + '</h2>' +
          '<div class="card"><p class="hint">' + esc(g.kind) + ' · version ' + esc(g.version) + ' · ' +
          esc(STEP[g.status] || g.status) + '</p>' +
          '<label for="gtitle">Title</label><input id="gtitle" value="' + esc(g.title) + '"' + (editable ? '' : ' disabled') + '>' +
          '<label for="gbody">Text</label>' +
          '<textarea id="gbody" rows="22" style="width:100%"' + (editable ? '' : ' disabled') + '>' + esc(g.body) + '</textarea>' +
          '<label for="gnote">Note for the record</label><input id="gnote" value="' + esc(g.notes) + '"' + (editable ? '' : ' disabled') + '>' +
          '<div class="rowbtns" id="gactions"></div><div id="gmsg2"></div></div>' +
          (g.status === 'PREVIEW' ? '<div class="card"><h2>Preview</h2><p class="hint">This is how it reads. Nothing is public yet.</p>' +
            '<div style="white-space:pre-wrap">' + esc(g.body) + '</div></div>' : '');

        var actions = document.getElementById('gactions');
        if (editable) actions.appendChild(button('act', 'Save', save));
        ['PREVIEW', 'DRAFT', 'VERIFIED', 'APPROVED', 'DISCARDED'].forEach(function (to) {
          if (to === g.status) return;
          actions.appendChild(button(to === 'DISCARDED' ? 'danger' : 'ghost', NEXT_WORD[to], function () { move(to); }));
        });
        if (g.status === 'APPROVED') {
          actions.appendChild(button('act', 'Publish to the site', function () {
            if (!confirm('Publish version ' + g.version + ' of the ' + g.kind.toLowerCase() + ' guidelines?')) return;
            api.call('publishGuideline', { id: id })
              .then(function () { ctx.render('guidelines'); })
              .catch(function (e) { message(document.getElementById('gmsg2'), explain(e), 'err'); });
          }));
        }
        actions.appendChild(button('ghost', 'Back', function () { ctx.render('guidelines'); }));

        function save() {
          api.call('saveGuideline', {
            id: id, title: document.getElementById('gtitle').value,
            body: document.getElementById('gbody').value, notes: document.getElementById('gnote').value
          }).then(function () { message(document.getElementById('gmsg2'), 'Saved. Nothing is public yet.', 'ok'); })
            .catch(function (e) { message(document.getElementById('gmsg2'), explain(e), 'err'); });
        }

        function move(to) {
          var reason = '';
          if (to === 'DISCARDED' || (to === 'PREVIEW' && g.status === 'VERIFIED')) {
            reason = prompt('Why? This goes on the record.') || '';
            if (!reason) return;
          }
          var send = editable
            ? api.call('saveGuideline', { id: id, title: document.getElementById('gtitle').value, body: document.getElementById('gbody').value })
            : Promise.resolve();
          send.then(function () { return api.call('moveGuideline', { id: id, to: to, reason: reason }); })
            .then(function () { ctx.render('guideline', id); })
            .catch(function (e) { message(document.getElementById('gmsg2'), explain(e), 'err'); });
        }
      }).catch(function (e) { v.innerHTML = '<h2>Guideline</h2>'; message(v, explain(e), 'err'); });
    };

    views.rulebook = function (v) {
      api.call('rulebook').then(function (r) {
        v.innerHTML = '<h2>Formats and rules</h2>' +
          '<div class="card"><p class="hint">These take effect in the author portal immediately. Nothing here is ever deleted — retiring a field keeps what was written in it.</p></div>' +
          r.formats.map(function (f) {
            return '<div class="card"><h2>' + esc(f.name) + '</h2>' +
              '<p class="hint">' + esc(f.slug) + ' · ' + esc(f.status) +
              (f.words && f.words.max ? ' · around ' + f.words.recommended + ', max ' + f.words.max + ' words' : '') + '</p>' +
              '<table><thead><tr><th>Field</th><th>Label</th><th>Required</th><th>State</th><th></th></tr></thead><tbody>' +
              f.fields.map(function (x) {
                return '<tr><td><code>' + esc(x.field) + '</code></td><td>' + esc(x.label) + '</td>' +
                  '<td>' + (x.required ? 'yes' : 'no') + '</td><td>' + esc(x.status) + '</td>' +
                  '<td><button class="ghost" data-toggle="' + esc(f.slug) + '|' + esc(x.field) + '|' + esc(x.label) +
                  '|' + (x.required ? '1' : '0') + '|' + esc(x.status) + '">' +
                  (x.status === 'ACTIVE' ? 'Retire' : 'Restore') + '</button></td></tr>';
              }).join('') + '</tbody></table>' +
              '<div class="rowbtns"><button class="ghost" data-addfield="' + esc(f.slug) + '">Add a field</button></div></div>';
          }).join('') +

          '<div class="card"><h2>Submission checklist</h2><table><tbody>' +
          r.checklist.map(function (c) {
            return '<tr><td>' + esc(c.item) + '</td><td>' + (c.required ? 'required' : 'optional') + '</td>' +
              '<td>' + esc(c.status) + '</td><td><button class="ghost" data-chk="' + esc(c.id) + '|' + esc(c.status) +
              '">' + (c.status === 'ACTIVE' ? 'Retire' : 'Restore') + '</button></td></tr>';
          }).join('') + '</tbody></table>' +
          '<label for="newchk">Add an item</label><input id="newchk" placeholder="Something the author can confirm">' +
          '<div class="rowbtns"><button class="act" id="addchk">Add</button></div></div>' +

          '<div class="card"><h2>Writing rules</h2>' +
          '<label for="tmax">Longest title (characters)</label><input id="tmax" type="number" value="' + esc(r.rules.writing.title_max) + '">' +
          '<label for="smin">Shortest summary (words)</label><input id="smin" type="number" value="' + esc(r.rules.writing.summary_min_words) + '">' +
          '<label for="smax">Longest summary (words)</label><input id="smax" type="number" value="' + esc(r.rules.writing.summary_max_words) + '">' +
          '<label for="cite">Citation style</label><input id="cite" value="' + esc(r.rules.writing.citation_style) + '">' +
          '<div class="rowbtns"><button class="act" id="savewriting">Save writing rules</button></div></div>' +

          '<div class="card"><h2>Image rules</h2>' +
          '<label for="mime">Accepted types</label><input id="mime" value="' + esc(r.rules.media.mime.join(', ')) + '">' +
          '<label for="mbytes">Largest file (bytes)</label><input id="mbytes" type="number" value="' + esc(r.rules.media.max_bytes) + '">' +
          '<label for="mpx">Shortest edge (pixels)</label><input id="mpx" type="number" value="' + esc(r.rules.media.min_pixels) + '">' +
          '<label><input type="checkbox" id="mcap"' + (r.rules.media.caption_required ? ' checked' : '') + '> Caption required</label>' +
          '<div class="rowbtns"><button class="act" id="savemedia">Save image rules</button></div></div>' +
          '<div id="rmsg"></div>';

        v.querySelectorAll('[data-toggle]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = b.getAttribute('data-toggle').split('|');
            api.call('saveFormatField', {
              format: p[0], field: p[1], label: p[2], required: p[3] === '1',
              status: p[4] === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
            }).then(function () { views.rulebook(v); })
              .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
          });
        });

        v.querySelectorAll('[data-addfield]').forEach(function (b) {
          b.addEventListener('click', function () {
            var label = prompt('What is the section called? (e.g. Data availability)');
            if (!label) return;
            var key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            api.call('saveFormatField', {
              format: b.getAttribute('data-addfield'), field: key, label: label,
              required: confirm('Is it required?'), help: prompt('Guidance for the author (optional):') || ''
            }).then(function () { views.rulebook(v); })
              .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
          });
        });

        v.querySelectorAll('[data-chk]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = b.getAttribute('data-chk').split('|');
            api.call('saveChecklistItem', { id: p[0], status: p[1] === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
              .then(function () { views.rulebook(v); })
              .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
          });
        });

        document.getElementById('addchk').addEventListener('click', function () {
          api.call('saveChecklistItem', { item: document.getElementById('newchk').value, required: true })
            .then(function () { views.rulebook(v); })
            .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
        });

        document.getElementById('savewriting').addEventListener('click', function () {
          api.call('saveEditorialRules', { writing: {
            title_max: Number(document.getElementById('tmax').value),
            summary_min_words: Number(document.getElementById('smin').value),
            summary_max_words: Number(document.getElementById('smax').value),
            citation_style: document.getElementById('cite').value
          }}).then(function () { message(document.getElementById('rmsg'), 'Writing rules saved. They apply to the next submission.', 'ok'); })
            .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
        });

        document.getElementById('savemedia').addEventListener('click', function () {
          api.call('saveEditorialRules', { media: {
            mime: document.getElementById('mime').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
            max_bytes: Number(document.getElementById('mbytes').value),
            min_pixels: Number(document.getElementById('mpx').value),
            caption_required: document.getElementById('mcap').checked
          }}).then(function () { message(document.getElementById('rmsg'), 'Image rules saved. They apply to the next upload.', 'ok'); })
            .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Formats and rules</h2>'; message(v, explain(e), 'err'); });
    };

    function button(cls, text, fn) {
      var b = ctx.el('button', { class: cls, type: 'button', text: text });
      b.addEventListener('click', fn);
      return b;
    }

    return views;
  };
})();
