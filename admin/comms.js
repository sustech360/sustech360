/* comms.js — the Email Centre and the social queue.
 *
 * The composer is built around one fact: you cannot unsend an email. So the
 * screen makes the sequence — write, test on yourself, get someone else to
 * approve, send — the only path through, and shows the audience size and the
 * remaining daily quota next to the button that starts it.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    var STATE = {
      DRAFT: 'Draft', APPROVED: 'Approved, not sent', SENDING: 'Sending',
      SENT: 'Sent', STOPPED: 'Stopped'
    };

    views.newsletter = function (v) {
      Promise.all([api.call('newsletterOverview'), api.call('listEmailCampaigns')]).then(function (r) {
        var o = r[0], campaigns = r[1];
        v.innerHTML = '<h2>Newsletter</h2>' +
          '<div class="card"><table><tbody>' +
          '<tr><td>Confirmed subscribers</td><td><strong>' + o.confirmed + '</strong></td></tr>' +
          '<tr><td>Waiting to confirm</td><td>' + o.pending + '</td></tr>' +
          '<tr><td>Unsubscribed</td><td>' + o.unsubscribed + '</td></tr>' +
          '<tr><td>Messages left in today\'s quota</td><td>' + o.quota_remaining +
          ' <span class="hint">(' + o.reserve + ' held back for invitations and password resets)</span></td></tr>' +
          '</tbody></table>' +
          '<p class="hint">Addresses are not shown here. Export them if you genuinely need them — the export is audited.</p>' +
          '<div class="rowbtns"><button class="ghost" id="exp">Export the list</button></div></div>' +

          '<div class="card"><h2>Campaigns</h2><table><thead><tr>' +
          '<th>Subject</th><th>State</th><th>Sent</th><th></th></tr></thead><tbody>' +
          campaigns.map(function (c) {
            return '<tr><td>' + esc(c.subject) + '<br><span class="hint">' +
              esc(String(c.created_at).slice(0, 10)) + (c.tested_at ? ' · tested' : ' · not tested') + '</span></td>' +
              '<td>' + esc(STATE[c.status] || c.status) + '</td>' +
              '<td>' + (c.sent_count || 0) + (c.failed_count ? ' (' + c.failed_count + ' failed)' : '') + '</td>' +
              '<td><button class="ghost" data-open="' + esc(c.id) + '">Open</button></td></tr>';
          }).join('') + '</tbody></table>' +
          '<label for="newsub">New campaign subject</label><input id="newsub" placeholder="The weekly brief — 14 September">' +
          '<div class="rowbtns"><button class="act" id="newcamp">Start a draft</button></div></div><div id="nmsg"></div>';

        document.getElementById('newcamp').addEventListener('click', function () {
          api.call('draftEmailCampaign', { subject: document.getElementById('newsub').value })
            .then(function (c) { ctx.render('campaign', c.id); })
            .catch(function (e) { message(document.getElementById('nmsg'), explain(e), 'err'); });
        });
        document.getElementById('exp').addEventListener('click', function () {
          if (!confirm('Export every confirmed address? This is recorded in the audit log.')) return;
          api.call('exportSubscribers').then(function (res) {
            var csv = 'email,name,confirmed_at\n' + res.rows.map(function (x) {
              return [x.email, x.name, x.confirmed_at].join(',');
            }).join('\n');
            message(document.getElementById('nmsg'), res.count + ' addresses exported below.', 'ok');
            var box = ctx.el('textarea', { rows: '8', style: 'width:100%' });
            box.value = csv;
            document.getElementById('nmsg').appendChild(box);
          }).catch(function (e) { message(document.getElementById('nmsg'), explain(e), 'err'); });
        });
        v.querySelectorAll('[data-open]').forEach(function (b) {
          b.addEventListener('click', function () { ctx.render('campaign', b.getAttribute('data-open')); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Newsletter</h2>'; message(v, explain(e), 'err'); });
    };

    views.campaign = function (v, id) {
      Promise.all([api.call('getEmailCampaign', { id: id }), api.call('newsletterOverview')]).then(function (r) {
        var c = r[0], o = r[1];
        var editable = c.status === 'DRAFT';
        v.innerHTML = '<h2>' + esc(c.subject) + '</h2>' +
          '<div class="card"><p class="hint">' + esc(STATE[c.status] || c.status) +
          ' · ' + o.confirmed + ' confirmed subscribers · ' + o.quota_remaining + ' messages left today</p>' +
          '<label for="csub">Subject</label><input id="csub" value="' + esc(c.subject) + '"' + (editable ? '' : ' disabled') + '>' +
          '<label for="cbody">Message</label><textarea id="cbody" rows="18" style="width:100%"' +
          (editable ? '' : ' disabled') + '>' + esc(c.body || '') + '</textarea>' +
          '<p class="hint">{{subscriber_name}} and {{unsubscribe_link}} are filled in per recipient. ' +
          'The unsubscribe link is not optional — leave it in.</p>' +
          '<div class="rowbtns" id="cactions"></div><div id="cmsg"></div></div>' +
          (c.status === 'SENDING' ? '<div class="card"><h2>In flight</h2><p>' + (c.sent_count || 0) +
            ' sent so far. The rest goes out automatically as quota allows.</p>' +
            '<div class="rowbtns"><button class="danger" id="stop">Stop the send</button></div></div>' : '');

        var actions = document.getElementById('cactions');
        if (editable) {
          actions.appendChild(button('act', 'Save', function () {
            api.call('saveEmailCampaign', {
              id: id, subject: document.getElementById('csub').value, body: document.getElementById('cbody').value
            }).then(function () { message(document.getElementById('cmsg'), 'Saved. Saving clears the test — send yourself another.', 'ok'); })
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          }));
          actions.appendChild(button('ghost', 'Send me a test', function () {
            api.call('saveEmailCampaign', {
              id: id, subject: document.getElementById('csub').value, body: document.getElementById('cbody').value
            }).then(function () { return api.call('testEmailCampaign', { id: id }); })
              .then(function (res) { message(document.getElementById('cmsg'), 'Test sent to ' + res.sent_to + '.', 'ok'); })
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          }));
          actions.appendChild(button('ghost', 'Approve', function () {
            api.call('approveEmailCampaign', { id: id })
              .then(function (res) { message(document.getElementById('cmsg'), 'Approved for ' + res.recipients + ' recipients.', 'ok');
                setTimeout(function () { ctx.render('campaign', id); }, 700); })
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          }));
        }
        if (c.status === 'APPROVED') {
          actions.appendChild(button('act', 'Send to ' + o.confirmed + ' subscribers', function () {
            if (!confirm('Send "' + c.subject + '" to ' + o.confirmed + ' people? This cannot be undone.')) return;
            api.call('startEmailCampaign', { id: id })
              .then(function (res) {
                message(document.getElementById('cmsg'),
                  res.sent + ' sent' + (res.remaining ? ', ' + res.remaining + ' queued for the next run.' : '.'), 'ok');
              })
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          }));
        }
        actions.appendChild(button('ghost', 'Back', function () { ctx.render('newsletter'); }));

        var stop = document.getElementById('stop');
        if (stop) {
          stop.addEventListener('click', function () {
            var reason = prompt('Why are you stopping it?');
            if (!reason) return;
            api.call('stopEmailCampaign', { id: id, reason: reason })
              .then(function () { ctx.render('campaign', id); })
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          });
        }
      }).catch(function (e) { v.innerHTML = '<h2>Campaign</h2>'; message(v, explain(e), 'err'); });
    };

    views.social = function (v) {
      api.call('socialQueue', {}).then(function (rows) {
        var queued = rows.filter(function (r) { return r.status === 'QUEUED'; });
        v.innerHTML = '<h2>Social queue</h2>' +
          '<div class="card"><p class="hint">Drafts are written when an article publishes. Nothing is posted automatically — this platform holds no social credentials. Copy the text, post it, then mark it done.</p></div>' +
          (queued.length ? queued.map(function (p) {
            return '<div class="card"><h2>' + esc(p.platform_name) + '</h2>' +
              '<textarea rows="5" style="width:100%" id="t-' + esc(p.id) + '">' + esc(p.text + '\n\n' + p.link) + '</textarea>' +
              '<div class="rowbtns">' +
              '<button class="ghost" data-copy="' + esc(p.id) + '">Copy</button>' +
              '<button class="act" data-done="' + esc(p.id) + '">Mark posted</button>' +
              '<button class="danger" data-drop="' + esc(p.id) + '">Discard</button></div></div>';
          }).join('') : '<div class="card"><p>Nothing waiting. Drafts appear here when an article goes live.</p></div>') +
          '<div class="card"><h2>Recently handled</h2><table><tbody>' +
          rows.filter(function (r) { return r.status !== 'QUEUED'; }).slice(0, 15).map(function (p) {
            return '<tr><td>' + esc(p.platform_name) + '</td><td class="hint">' + esc(p.text.slice(0, 60)) + '…</td>' +
              '<td>' + esc(p.status) + '</td></tr>';
          }).join('') + '</tbody></table></div><div id="smsg"></div>';

        v.querySelectorAll('[data-copy]').forEach(function (b) {
          b.addEventListener('click', function () {
            var box = document.getElementById('t-' + b.getAttribute('data-copy'));
            box.select();
            try { navigator.clipboard.writeText(box.value); } catch (e) { document.execCommand('copy'); }
            message(document.getElementById('smsg'), 'Copied.', 'ok');
          });
        });
        v.querySelectorAll('[data-done]').forEach(function (b) {
          b.addEventListener('click', function () {
            api.call('socialMarkPosted', { id: b.getAttribute('data-done'), url: prompt('Link to the post (optional):') || '' })
              .then(function () { views.social(v); })
              .catch(function (e) { message(document.getElementById('smsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-drop]').forEach(function (b) {
          b.addEventListener('click', function () {
            api.call('socialDiscard', { id: b.getAttribute('data-drop'), reason: prompt('Why?') || '' })
              .then(function () { views.social(v); })
              .catch(function (e) { message(document.getElementById('smsg'), explain(e), 'err'); });
          });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Social queue</h2>'; message(v, explain(e), 'err'); });
    };

    function button(cls, text, fn) {
      var b = ctx.el('button', { class: cls, type: 'button', text: text });
      b.addEventListener('click', fn);
      return b;
    }

    return views;
  };
})();
