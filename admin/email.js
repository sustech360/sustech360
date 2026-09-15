/* email.js — the Email Centre.
 *
 * Every message this platform sends, in one place: the words, the subject, who
 * it comes from and where a reply goes. A template nobody has edited shows the
 * built-in wording, so the list is never half empty and nothing has to be
 * written before the platform can be used.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    var WHEN = {
      author_invitation: 'When you invite an author',
      invitation_revoked: 'When an invitation is withdrawn',
      account_ready: 'When an author accepts and their account opens',
      article_submitted: 'To the author, confirming a submission arrived',
      submission_alert: 'To the editors, that something is waiting',
      revision_requested: 'When an editor asks for changes',
      article_rejected: 'When an article is not accepted',
      review_request: 'When a reviewer is asked to read something',
      article_published: 'When an article goes live',
      newsletter_confirm: 'When a reader asks for the newsletter',
      emergency_access: 'When emergency access is granted'
    };

    views.emails = function (v) {
      Promise.all([api.call('emailTemplates'), api.call('emailIdentities'), api.call('emailLog', { limit: 25 })])
        .then(function (r) {
          var templates = r[0], identities = r[1], log = r[2];

          v.innerHTML =
            '<div class="card"><h2>Who these messages come from</h2>' +
            '<p class="hint">Everything is sent by the Google account that runs the engine — that cannot change. ' +
            'What you set here is the name a reader sees and the address their reply reaches, which is the part that matters.</p>' +
            '<table><thead><tr><th>Kind</th><th>Shown as</th><th>Replies go to</th></tr></thead><tbody>' +
            Object.keys(identities).map(function (key) {
              var i = identities[key];
              return '<tr><td><strong>' + esc(i.label) + '</strong><span class="hint">' + esc(key) + '</span></td>' +
                '<td><input data-ident-name="' + esc(key) + '" value="' + esc(i.name) + '"></td>' +
                '<td><input data-ident-reply="' + esc(key) + '" value="' + esc(i.reply_to) + '" type="email"></td></tr>';
            }).join('') + '</tbody></table>' +
            '<div class="rowbtns"><button class="act" id="saveident">Save who sends what</button></div></div>' +

            '<div class="card"><h2>Messages</h2>' +
            '<table><thead><tr><th>Message</th><th>Sent</th><th>From</th><th>State</th><th></th></tr></thead><tbody>' +
            templates.map(function (t) {
              return '<tr><td><strong>' + esc(t.subject) + '</strong>' +
                '<span class="hint">' + esc(WHEN[t.key] || t.key) + '</span></td>' +
                '<td class="hint">' + esc(t.key) + '</td>' +
                '<td>' + esc(t.identity_label) + '</td>' +
                '<td>' + (t.customised ? 'Edited' : '<span class="hint">Built in</span>') + '</td>' +
                '<td><button class="ghost" data-edit="' + esc(t.key) + '">Edit</button></td></tr>';
            }).join('') + '</tbody></table></div>' +

            '<div class="card"><h2>Recently sent</h2>' +
            (log.length ? '<table><thead><tr><th>When</th><th>To</th><th>Message</th><th></th></tr></thead><tbody>' +
              log.map(function (l) {
                return '<tr><td class="hint">' + esc(String(l.sent_at).slice(0, 16).replace('T', ' ')) + '</td>' +
                  '<td>' + esc(l.to) + '</td><td>' + esc(l.subject) + '</td>' +
                  '<td>' + (l.status === 'SENT' ? 'sent' : '<strong>' + esc(l.status) + '</strong> ' + esc(l.error)) + '</td></tr>';
              }).join('') + '</tbody></table>'
             : '<p class="hint">Nothing sent yet.</p>') + '</div><div id="emsg"></div>';

          document.getElementById('saveident').addEventListener('click', function () {
            var payload = {};
            v.querySelectorAll('[data-ident-name]').forEach(function (i) {
              var key = i.getAttribute('data-ident-name');
              payload[key] = payload[key] || {};
              payload[key].name = i.value;
            });
            v.querySelectorAll('[data-ident-reply]').forEach(function (i) {
              var key = i.getAttribute('data-ident-reply');
              payload[key] = payload[key] || {};
              payload[key].reply_to = i.value;
            });
            api.call('saveEmailIdentities', { identities: payload })
              .then(function () { message(document.getElementById('emsg'), 'Saved. It applies to the next message sent.', 'ok'); })
              .catch(function (e) { message(document.getElementById('emsg'), explain(e), 'err'); });
          });

          v.querySelectorAll('[data-edit]').forEach(function (b) {
            b.addEventListener('click', function () { ctx.render('emailtemplate', b.getAttribute('data-edit')); });
          });
        }).catch(function (e) { v.innerHTML = ''; message(v, explain(e), 'err'); });
    };

    views.emailtemplate = function (v, key) {
      Promise.all([api.call('getEmailTemplate', { key: key }), api.call('emailIdentities')])
        .then(function (r) {
          var t = r[0], identities = r[1];

          v.innerHTML =
            '<div class="card"><h2>' + esc(WHEN[t.key] || t.key) + '</h2>' +
            '<label for="t-subject">Subject</label>' +
            '<input id="t-subject" value="' + esc(t.subject) + '">' +
            '<label for="t-body">Message</label>' +
            '<textarea id="t-body" rows="16">' + esc(t.body) + '</textarea>' +
            '<label for="t-identity">Sent as</label>' +
            '<select id="t-identity">' + Object.keys(identities).map(function (k) {
              return '<option value="' + esc(k) + '"' + (k === t.identity ? ' selected' : '') + '>' +
                esc(identities[k].label) + ' — replies to ' + esc(identities[k].reply_to || 'nobody') + '</option>';
            }).join('') + '</select>' +

            '<h3>What you can drop into the text</h3>' +
            '<p class="shortcuts">' + t.variables.concat(['magazine_name', 'contact_email'])
              .map(function (x) { return '<button class="ghost" data-var="' + esc(x) + '">{{' + esc(x) + '}}</button>'; })
              .join(' ') + '</p>' +
            '<p class="hint">Click one to insert it. A name the platform does not recognise is refused when you save, ' +
            'rather than arriving in someone\'s inbox as a gap in a sentence.</p>' +

            '<div class="rowbtns">' +
            '<button class="act" id="t-save">Save</button>' +
            '<button class="ghost" id="t-preview">Preview</button>' +
            '<button class="ghost" id="t-test">Send me a test</button>' +
            (t.customised ? '<button class="danger" id="t-reset">Back to the built-in wording</button>' : '') +
            '<button class="ghost" id="t-back">All messages</button>' +
            '</div><div id="tmsg"></div></div>' +
            '<div id="preview"></div>';

          var subject = function () { return document.getElementById('t-subject').value; };
          var body = function () { return document.getElementById('t-body').value; };
          var identity = function () { return document.getElementById('t-identity').value; };

          v.querySelectorAll('[data-var]').forEach(function (b) {
            b.addEventListener('click', function () {
              var box = document.getElementById('t-body');
              var at = box.selectionStart || box.value.length;
              var token = '{{' + b.getAttribute('data-var') + '}}';
              box.value = box.value.slice(0, at) + token + box.value.slice(at);
              box.focus();
              box.selectionStart = box.selectionEnd = at + token.length;
            });
          });

          document.getElementById('t-save').addEventListener('click', function () {
            api.call('saveEmailTemplate', { key: key, subject: subject(), body: body(), identity: identity() })
              .then(function () { message(document.getElementById('tmsg'), 'Saved. The next one sent uses this.', 'ok'); })
              .catch(function (e) { message(document.getElementById('tmsg'), explain(e), 'err'); });
          });

          document.getElementById('t-preview').addEventListener('click', function () {
            api.call('previewEmailTemplate', { key: key, subject: subject(), body: body(), identity: identity() })
              .then(function (p) {
                document.getElementById('preview').innerHTML =
                  '<div class="card"><h2>How it reads</h2>' +
                  '<table><tbody>' +
                  '<tr><td>From</td><td>' + esc(p.from) + '</td></tr>' +
                  '<tr><td>Replies to</td><td>' + esc(p.reply_to || '—') + '</td></tr>' +
                  '<tr><td>Subject</td><td><strong>' + esc(p.subject) + '</strong></td></tr>' +
                  '</tbody></table>' +
                  '<div style="white-space:pre-wrap;margin-top:1rem">' + esc(p.body) + '</div></div>';
              })
              .catch(function (e) { message(document.getElementById('tmsg'), explain(e), 'err'); });
          });

          document.getElementById('t-test').addEventListener('click', function () {
            api.call('sendTestEmail', { key: key, subject: subject(), body: body(), identity: identity() })
              .then(function (res) { message(document.getElementById('tmsg'), 'Sent to ' + res.sent_to + '.', 'ok'); })
              .catch(function (e) { message(document.getElementById('tmsg'), explain(e), 'err'); });
          });

          var reset = document.getElementById('t-reset');
          if (reset) {
            reset.addEventListener('click', function () {
              if (!confirm('Discard your wording and go back to the built-in text?')) return;
              api.call('resetEmailTemplate', { key: key })
                .then(function () { ctx.render('emailtemplate', key); })
                .catch(function (e) { message(document.getElementById('tmsg'), explain(e), 'err'); });
            });
          }
          document.getElementById('t-back').addEventListener('click', function () { ctx.render('emails'); });
        }).catch(function (e) { v.innerHTML = ''; message(v, explain(e), 'err'); });
    };

    return views;
  };
})();
