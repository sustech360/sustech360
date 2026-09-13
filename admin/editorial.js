/* editorial.js — the queue, the article desk, the reviewer's desk.
 *
 * Registered into the control centre through ADMIN_EXTRA_VIEWS. Like the rest
 * of admin.js this file renders; it decides nothing. Which buttons appear comes
 * from `available`, which the backend computes from the caller's permissions,
 * and pressing one still goes through the same checks.
 */
window.ADMIN_EXTRA_VIEWS = function (ctx) {
  var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain, el = ctx.el;

  var LABELS = {
    SUBMITTED: 'Submitted', RESUBMITTED: 'Resubmitted', EDITOR_CHECK: 'Editor check',
    UNDER_REVIEW: 'Under review', REVISION_REQUIRED: 'Revisions requested',
    VERIFIED: 'Verified', READY_FOR_PUBLICATION: 'Ready for publication',
    APPROVED: 'Approved', SCHEDULED: 'Scheduled', PUBLISHED: 'Published',
    ARCHIVED: 'Archived', REJECTED: 'Not accepted', DRAFT: 'Draft'
  };
  var ACTION_WORDS = {
    EDITOR_CHECK: 'Take it on', UNDER_REVIEW: 'Send to review',
    REVISION_REQUIRED: 'Request revisions', REJECTED: 'Decline',
    VERIFIED: 'Mark verified', READY_FOR_PUBLICATION: 'Ready to publish',
    APPROVED: 'Approve for publication', ARCHIVED: 'Archive'
  };
  var label = function (s) { return LABELS[s] || s; };

  function queue(v) {
    api.call('editorialQueue').then(function (rows) {
      if (!rows.length) {
        v.innerHTML = '<h2>Queue</h2><div class="card"><p>Nothing is waiting. Submissions appear here the moment an author sends one.</p></div>';
        return;
      }
      v.innerHTML = '<h2>Queue</h2><div class="card"><table><thead><tr>' +
        '<th>Article</th><th>State</th><th>Author</th><th>Reviews</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          var done = r.reviews.filter(function (x) { return x.status === 'COMPLETED'; }).length;
          return '<tr><td>' + esc(r.title) + '<br><span class="hint">' + esc(r.id) + ' · ' +
            esc(r.category) + ' · v' + r.version + (r.public_version ? ' (live: v' + r.public_version + ')' : '') + '</span></td>' +
            '<td>' + esc(label(r.version_status)) + '</td><td>' + esc(r.author) + '</td>' +
            '<td>' + (r.reviews.length ? done + ' of ' + r.reviews.length : '—') + '</td>' +
            '<td><button class="ghost" data-open="' + esc(r.id) + '">Open</button></td></tr>';
        }).join('') + '</tbody></table></div>';
      v.querySelectorAll('[data-open]').forEach(function (b) {
        b.addEventListener('click', function () { ctx.render('desk', b.getAttribute('data-open')); });
      });
    }).catch(function (e) { v.innerHTML = '<h2>Queue</h2>'; message(v, explain(e), 'err'); });
  }

  function desk(v, articleId) {
    Promise.all([
      api.call('openArticle', { article_id: articleId }),
      api.call('reviewCandidates', { article_id: articleId }).catch(function () { return []; })
    ]).then(function (r) {
      var d = r[0], candidates = r[1];
      var a = d.article, fields = d.content.fields || {};

      v.innerHTML =
        '<h2>' + esc(a.title) + '</h2>' +
        '<div class="card"><p class="hint">' + esc(a.id) + ' · ' + esc(a.category) + ' · ' + esc(a.format) +
        ' · working v' + a.working_version + (a.public_version ? ' · live v' + a.public_version : '') +
        ' · ' + esc(label(d.version_status)) + '</p>' +
        (d.author ? '<p>' + esc(d.author.name) + (d.author.institution ? ', ' + esc(d.author.institution) : '') + '</p>' : '') +
        (d.notes ? '<p class="hint">Last note: ' + esc(d.notes) + '</p>' : '') +
        '<div class="rowbtns" id="moves"></div><div id="movemsg"></div></div>' +

        '<div class="card"><h2>Text</h2>' +
        Object.keys(fields).map(function (k) {
          return '<h3 class="hint">' + esc(k) + '</h3><p>' + esc(fields[k]).replace(/\n/g, '<br>') + '</p>';
        }).join('') + '</div>' +

        (d.media && d.media.length ? '<div class="card"><h2>Figures</h2><table><tbody>' +
          d.media.map(function (m) {
            return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.caption || '') +
              '<br><span class="hint">' + esc(m.credit || 'no credit') + ' · ' + esc(m.licence || 'no licence') + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' : '') +

        '<div class="card"><h2>Reviews</h2>' +
        (d.reviews.length ? '<table><thead><tr><th>Reviewer</th><th>State</th><th>Decision</th><th>Comments</th></tr></thead><tbody>' +
          d.reviews.map(function (x) {
            return '<tr><td>' + esc(x.reviewer) + '<br><span class="hint">v' + x.version + '</span></td>' +
              '<td>' + esc(x.status) + '</td><td>' + esc(x.decision || '—') + '</td>' +
              '<td>' + esc(x.comments || '').replace(/\n/g, '<br>') + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="hint">No reviewer has been asked yet.</p>') +
        (candidates.length ? '<label for="rev">Ask a reviewer</label><select id="rev">' +
          candidates.map(function (c) {
            return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.institution ? ' — ' + esc(c.institution) : '') + '</option>';
          }).join('') + '</select><div class="rowbtns"><button class="act" id="assign">Send the request</button></div>' : '') +
        '<div id="revmsg"></div></div>' +

        '<div class="card"><h2>Version history</h2><table><tbody>' +
        d.history.map(function (h) {
          return '<tr><td>v' + h.version + '</td><td>' + esc(label(h.status)) + '</td>' +
            '<td class="hint">' + esc(String(h.created_at).slice(0, 10)) + ' ' + esc(h.notes || '') + '</td>' +
            '<td>' + (h.status === 'ARCHIVED' || h.status === 'PUBLISHED'
              ? '<button class="ghost" data-rollback="' + h.version + '">Put back on the site</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';

      var moves = document.getElementById('moves');
      d.available.forEach(function (m) {
        var b = el('button', { class: m.to === 'REJECTED' ? 'danger' : 'act', type: 'button',
                               text: ACTION_WORDS[m.to] || label(m.to) });
        b.addEventListener('click', function () { doMove(m, a); });
        moves.appendChild(b);
      });

      if (d.version_status === 'APPROVED') {
        var pub = el('button', { class: 'act', type: 'button', text: 'Publish now' });
        pub.addEventListener('click', function () {
          if (!confirm('Publish "' + a.title + '" to the live site?')) return;
          api.call('publishArticle', { article_id: a.id })
            .then(function (res) { message(document.getElementById('movemsg'), 'Live as version ' + res.version + '.', 'ok'); setTimeout(function () { ctx.render('desk', a.id); }, 900); })
            .catch(function (e) { message(document.getElementById('movemsg'), explain(e), 'err'); });
        });
        moves.appendChild(pub);

        var sched = el('button', { class: 'ghost', type: 'button', text: 'Schedule' });
        sched.addEventListener('click', function () {
          var when = prompt('Publish at (YYYY-MM-DD HH:MM, your local time):');
          if (!when) return;
          api.call('schedulePublication', { article_id: a.id, when: new Date(when.replace(' ', 'T')).toISOString() })
            .then(function (res) { message(document.getElementById('movemsg'), 'Scheduled for ' + res.scheduled_for.slice(0, 16).replace('T', ' ') + '.', 'ok'); })
            .catch(function (e) { message(document.getElementById('movemsg'), explain(e), 'err'); });
        });
        moves.appendChild(sched);
      }

      var assign = document.getElementById('assign');
      if (assign) {
        assign.addEventListener('click', function () {
          api.call('assignReviewer', { article_id: a.id, reviewer_id: document.getElementById('rev').value })
            .then(function () { ctx.render('desk', a.id); })
            .catch(function (e) { message(document.getElementById('revmsg'), explain(e), 'err'); });
        });
      }

      v.querySelectorAll('[data-rollback]').forEach(function (b) {
        b.addEventListener('click', function () {
          var reason = prompt('Why is this version going back on the site?');
          if (!reason) return;
          api.call('rollbackArticle', { article_id: a.id, version: Number(b.getAttribute('data-rollback')), reason: reason })
            .then(function () { ctx.render('desk', a.id); })
            .catch(function (e) { alert(explain(e)); });
        });
      });

      function doMove(m, a) {
        var reason = '';
        if (m.needs_reason) {
          reason = prompt(m.to === 'REVISION_REQUIRED'
            ? 'What does the author need to change?'
            : 'Reason (the author will see this):') || '';
          if (!reason) return;
        }
        if (m.to === 'APPROVED' && !confirm('Approve "' + a.title + '" for publication?')) return;
        api.call('moveArticle', { article_id: a.id, to: m.to, reason: reason })
          .then(function () { ctx.render('desk', a.id); })
          .catch(function (e) { message(document.getElementById('movemsg'), explain(e), 'err'); });
      }
    }).catch(function (e) { v.innerHTML = '<h2>Article</h2>'; message(v, explain(e), 'err'); });
  }

  function reviews(v) {
    api.call('myReviews').then(function (rows) {
      if (!rows.length) {
        v.innerHTML = '<h2>Your reviews</h2><div class="card"><p>Nothing is waiting for you.</p></div>';
        return;
      }
      v.innerHTML = '<h2>Your reviews</h2><div class="card"><table><thead><tr>' +
        '<th>Article</th><th>Due</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.title) + '<br><span class="hint">' + esc(r.category) + ' · v' + r.version + '</span></td>' +
            '<td>' + esc(String(r.due_at).slice(0, 10)) + '</td>' +
            '<td><button class="ghost" data-review="' + esc(r.id) + '">Open</button></td></tr>';
        }).join('') + '</tbody></table></div>';
      v.querySelectorAll('[data-review]').forEach(function (b) {
        b.addEventListener('click', function () { ctx.render('review', b.getAttribute('data-review')); });
      });
    }).catch(function (e) { v.innerHTML = '<h2>Your reviews</h2>'; message(v, explain(e), 'err'); });
  }

  function review(v, reviewId) {
    api.call('openReview', { review_id: reviewId }).then(function (d) {
      var vals = d.content.fields || {};
      v.innerHTML = '<h2>' + esc(d.article.title) + '</h2>' +
        '<div class="card"><p class="hint">' + esc(d.article.category) + ' · ' + esc(d.article.format) +
        ' · due ' + esc(String(d.review.due_at).slice(0, 10)) + '</p>' +
        d.fields.map(function (f) {
          return vals[f.field] ? '<h3>' + esc(f.label) + '</h3><p>' + esc(vals[f.field]).replace(/\n/g, '<br>') + '</p>' : '';
        }).join('') + '</div>' +
        '<div class="card"><h2>Your decision</h2>' +
        '<label for="dec">Recommendation</label><select id="dec">' +
        '<option value="ACCEPT">Accept as it stands</option>' +
        '<option value="MINOR_REVISION">Accept with minor revisions</option>' +
        '<option value="MAJOR_REVISION">Major revisions needed</option>' +
        '<option value="REJECT">Decline</option></select>' +
        '<label for="com">Comments for the editors and the author</label>' +
        '<textarea id="com" rows="8" style="width:100%"></textarea>' +
        '<p class="hint">Be specific enough to act on. A decision without reasoning is refused.</p>' +
        '<div class="rowbtns"><button class="act" id="send">Send the review</button></div><div id="rmsg"></div></div>';
      document.getElementById('send').addEventListener('click', function () {
        api.call('submitReview', {
          review_id: reviewId,
          decision: document.getElementById('dec').value,
          comments: document.getElementById('com').value
        }).then(function () { ctx.render('reviews'); })
          .catch(function (e) { message(document.getElementById('rmsg'), explain(e), 'err'); });
      });
    }).catch(function (e) { v.innerHTML = '<h2>Review</h2>'; message(v, explain(e), 'err'); });
  }

  return { queue: queue, desk: desk, reviews: reviews, review: review };
};
