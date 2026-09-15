/* admin.js — control centre client.
 *
 * What this file is NOT: a security boundary. Hiding a button here stops
 * nothing. Every action below is re-authorised by the backend, and the views
 * simply render whatever the backend allows.
 */
(function () {
  'use strict';
  var api = MAG.admin(window.MAG_ENDPOINT);
  var me = null;

  var $ = function (id) { return document.getElementById(id); };

  /* A dropped connection is not a sign-out. The old build cleared the token on
     any failed request, so a single hiccup — an Apps Script cold start, a train
     tunnel — meant signing in again and losing what you were doing. */
  var network = api.call.bind(api);
  function send(action, payload) {
    return network(action, payload).then(function (data) {
      touchToken();
      return data;
    }, function (e) {
      if (e && e.code === 'unauthenticated') {
        endSession('Your session ended. Sign in again.');
      }
      throw e;
    });
  }

  /* ---- answering before the engine does ----
   *
   * Batching made the studio cost less. It did not make it feel quick: every
   * screen still waited on a round trip to Apps Script, which can take a second
   * or two to wake up.
   *
   * So a screen you have already opened paints immediately from what it showed
   * last time, and the fresh answer arrives quietly behind it — if anything
   * actually changed, the screen redraws. A screen you have not opened is
   * usually already in hand too, because the four things most people click
   * first are fetched in one batch the moment you sign in.
   *
   * Only reads are cached, and only in memory: nothing about users, invoices or
   * subscribers is written to disk, and closing the tab forgets all of it.
   * Anything that changes something clears the lot, because working out which
   * screens a save affects is exactly the kind of cleverness that shows someone
   * stale numbers a month later.
   */

  var READS = {
    adDelivery: 1, adsBundle: 1, auditLog: 1, billing: 1, configurationVersions: 1,
    editorialQueue: 1, emailIdentities: 1, emailLog: 1, emailTemplates: 1,
    getEmailTemplate: 1, getGuideline: 1, getIssue: 1, getEmailCampaign: 1,
    listCampaigns: 1, listEmailCampaigns: 1, listGrants: 1, listGuidelines: 1,
    listIssues: 1, listRoles: 1, listUsers: 1, listBackups: 1, listInvitations: 1,
    liveArticles: 1, me: 1, myReviews: 1, newsletterOverview: 1, openArticle: 1,
    openReview: 1, payloadBudget: 1, performanceReport: 1, previewConfiguration: 1,
    reviewCandidates: 1, articleReviews: 1, rulebook: 1, siteConfiguration: 1,
    socialQueue: 1, studioDashboard: 1, guidelineKinds: 1
  };

  var CACHE = {};
  var INFLIGHT = {};
  var servedFromCache = false;      // did this render pass use anything stored?
  var refreshes = [];               // background revalidations from this pass
  var quiet = false;                // a redraw does not start another round

  function cacheKey(action, payload) {
    return action + '|' + JSON.stringify(payload || {});
  }

  api.call = function (action, payload) {
    if (!READS[action]) {
      // Something changed. Everything held is now suspect.
      CACHE = {};
      return send(action, payload);
    }
    var key = cacheKey(action, payload);

    // The same question asked twice in one breath is asked once.
    if (INFLIGHT[key]) return INFLIGHT[key];

    if (Object.prototype.hasOwnProperty.call(CACHE, key)) {
      servedFromCache = true;
      if (!quiet) {
        refreshes.push(send(action, payload).then(function (data) {
          var moved = JSON.stringify(data) !== JSON.stringify(CACHE[key]);
          CACHE[key] = data;
          return moved;
        }, function () { return false; }));     // a failed refresh keeps the old view
      }
      return Promise.resolve(CACHE[key]);
    }

    var request = send(action, payload).then(function (data) {
      CACHE[key] = data;
      delete INFLIGHT[key];
      return data;
    }, function (e) {
      delete INFLIGHT[key];
      throw e;
    });
    INFLIGHT[key] = request;
    return request;
  };

  /** Fetches what the next click probably needs. One batch, one execution, and
   *  it warms the engine at the same time so the first real click is not the
   *  one that pays for the cold start. */
  function prefetch(actions) {
    actions.forEach(function (a) {
      var key = cacheKey(a, {});
      if (!Object.prototype.hasOwnProperty.call(CACHE, key) && !INFLIGHT[key]) {
        api.call(a, {}).catch(function () {});
      }
    });
  }

  /** What each screen asks for first, so hovering a menu item is enough to
   *  have the answer ready by the time it is clicked. */
  var NEEDS = {
    dashboard: ['studioDashboard'],
    queue: ['editorialQueue'],
    reviews: ['myReviews'],
    published: ['liveArticles'],
    issues: ['listIssues'],
    users: ['listUsers', 'listRoles'],
    roles: ['listRoles'],
    audit: ['auditLog'],
    guidelines: ['listGuidelines'],
    rulebook: ['rulebook'],
    menus: ['siteConfiguration'],
    homepage: ['siteConfiguration'],
    sections: ['siteConfiguration'],
    appearance: ['siteConfiguration'],
    publish: ['previewConfiguration', 'configurationVersions'],
    delegation: ['listGrants', 'listUsers'],
    advertising: ['adsBundle', 'adDelivery'],
    billing: ['billing'],
    newsletter: ['newsletterOverview', 'listEmailCampaigns'],
    emails: ['emailTemplates', 'emailIdentities', 'emailLog'],
    social: ['socialQueue'],
    performance: ['performanceReport', 'payloadBudget']
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); };

  /* ---- session ----
     A refresh, a second tab, or coming back after lunch should not mean typing
     a password again. The session is kept for three hours of inactivity and
     every request you make extends it, so an afternoon of work never times out
     underneath you. Signing out ends it immediately, in every tab.

     It lives in localStorage rather than sessionStorage, which is the deliberate
     trade: it survives a closed tab, so on a shared machine sign out rather
     than just closing the window. */

  var SESSION_KEY = 's360.session';
  var IDLE_LIMIT = 3 * 60 * 60 * 1000;

  function saveToken(t) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: t, until: Date.now() + IDLE_LIMIT }));
    } catch (e) {}
  }

  function loadToken() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        // Carry over anyone signed in under the previous build.
        var legacy = sessionStorage.getItem('mag.token');
        if (legacy) { saveToken(legacy); sessionStorage.removeItem('mag.token'); return legacy; }
        return null;
      }
      var rec = JSON.parse(raw);
      if (!rec || !rec.token) return null;
      if (Date.now() > rec.until) { clearToken(); return null; }
      return rec.token;
    } catch (e) { return null; }
  }

  function touchToken() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      var rec = JSON.parse(raw);
      rec.until = Date.now() + IDLE_LIMIT;
      localStorage.setItem(SESSION_KEY, JSON.stringify(rec));
    } catch (e) {}
  }

  function clearToken() {
    try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('mag.token'); } catch (e) {}
  }

  /** Back to the sign-in screen, with a reason. Used when the session really
   *  has ended — never because one request failed. */
  function endSession(note) {
    clearToken();
    api.setToken(null);
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    if (note) message($('loginmsg'), note, 'err');
  }

  function message(host, text, kind) {
    host.innerHTML = '<div class="msg ' + (kind || 'ok') + '">' + esc(text) + '</div>';
  }

  var ERRORS = {
    invalid_credentials: 'That email and password do not match.',
    locked: 'Too many attempts. Wait a few minutes and try again.',
    mfa_required: 'Enter the six-digit code from your authenticator app.',
    bad_code: 'That code did not match. Codes change every 30 seconds — try the current one.',
    not_started: 'Start the setup first.',
    not_enabled: 'Two-step sign in is not on for this account.',
    account_disabled: 'This account is suspended. Contact the supervisor admin.',
    unauthenticated: 'Your session ended. Sign in again.',
    forbidden: 'Your role does not allow that.',
    reason_required: 'A reason is required for this action.',
    expiry_required: 'Temporary access needs an end date.',
    weak_password: 'Choose a longer password with upper case, lower case and digits.',
    bad_social_url: 'A social link must start with https://',
    wrong_platform: 'That link points at a different site than the box expects.',
    unknown_platform: 'That is not one of the platforms this site supports.',
    no_endpoint: 'The API endpoint is not configured. Set it in admin/config.js.',
    offline: 'The backend did not respond. Check the deployment URL and your connection.',
    already_a_user: 'That email address already has an account.',
    already_invited: 'There is already a pending invitation for that address. Resend or revoke it.',
    bad_email: 'That does not look like an email address.',
    name_required: 'Give the invitee a name.',
    not_pending: 'That invitation is no longer pending.',
    already_accepted: 'That invitation was accepted. Suspend the account instead.',
    not_found: 'That record no longer exists.'
  };
  function explain(e) {
    var base = ERRORS[e && e.code] || 'That did not work.';
    return e && e.detail && e.code === 'forbidden' ? base + ' (' + e.detail + ')' : base;
  }

  /* ---- login ---- */

  function submitSignIn() {
    var btn = $('signin');
    btn.disabled = true;
    api.call('login', {
      email: $('email').value.trim(),
      password: $('password').value,
      mfa_code: $('mfa').value.trim()
    }).then(function (res) {
      api.setToken(res.token);
      saveToken(res.token);
      me = res;
      $('password').value = '';
      start(res.must_change_password);
    }).catch(function (e) {
      // The code box appears the moment the engine says it needs one, and not
      // before: most people never have one to type.
      if (e && e.code === 'mfa_required') {
        $('mfarow').classList.remove('hidden');
        $('mfa').focus();
        message($('loginmsg'), 'Enter the six-digit code from your authenticator app.', 'ok');
      } else {
        message($('loginmsg'), explain(e), 'err');
      }
    }).then(function () { btn.disabled = false; });
  }

  $('signin').addEventListener('click', submitSignIn);

  // Enter submits, from any of the three boxes.
  ['email', 'password', 'mfa'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitSignIn(); }
    });
  });

  $('signout').addEventListener('click', function () {
    CACHE = {};
    INFLIGHT = {};
    api.call('logout').catch(function () {}).then(function () {
      clearToken(); location.reload();
    });
  });

  function start(forcePassword) {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    buildNav();
    $('who').innerHTML = '<strong>' + esc(me.user.name) + '</strong><span>' +
      esc(me.user.role_id.replace(/_/g, ' ').toLowerCase()) + '</span>';

    // The title is also the way home, as it is in most tools.
    var home = document.querySelector('.sidebar__title');
    if (home && !home.dataset.wired) {
      home.dataset.wired = '1';
      home.style.cursor = 'pointer';
      home.addEventListener('click', function () { render('dashboard'); closeNav(); });
    }
    api.call('health').then(function (h) { $('env').textContent = h.env; }).catch(function () {});

    // The four things most people open first, in one batch. It also wakes the
    // engine, so the first real click is not the one that waits for it.
    prefetch(['studioDashboard', 'editorialQueue', 'siteConfiguration', 'liveArticles']);
    render(forcePassword ? 'account' : 'dashboard');
    if (forcePassword) {
      message($('view').querySelector('#accountmsg') || $('view'),
        'Change your temporary password before doing anything else.', 'err');
    }
  }

  /* ---- navigation ----
     Twenty-two screens in one flat list is a directory, not a tool. They are
     grouped by the job you came to do, and a search box jumps straight to one:
     Ctrl+K, type three letters, Enter. */

  var NAV = [
    ['Overview', [
      ['dashboard', 'Dashboard']
    ]],
    ['Editorial', [
      ['queue', 'Queue'],
      ['reviews', 'Your reviews'],
      ['published', 'Published pages'],
      ['issues', 'Magazine issues']
    ]],
    ['People', [
      ['invitations', 'Author invitations'],
      ['users', 'Users'],
      ['roles', 'Roles'],
      ['delegation', 'Delegated access']
    ]],
    ['Standards', [
      ['guidelines', 'Guidelines'],
      ['rulebook', 'Formats and rules']
    ]],
    ['The site', [
      ['menus', 'Navigation'],
      ['homepage', 'Homepage'],
      ['sections', 'Sections and flags'],
      ['appearance', 'Brand and social'],
      ['publish', 'Publish']
    ]],
    ['Audience and income', [
      ['newsletter', 'Newsletter'],
      ['emails', 'Email templates'],
      ['social', 'Social queue'],
      ['advertising', 'Advertising'],
      ['billing', 'Billing']
    ]],
    ['Operations', [
      ['performance', 'Performance'],
      ['audit', 'Audit log'],
      ['account', 'Account']
    ]]
  ];

  // Screens reached from inside another screen rather than from the menu.
  var SUBTITLES = {
    dashboard: 'Dashboard', desk: 'Article', review: 'Review',
    guideline: 'Guideline', campaign: 'Newsletter campaign', issue: 'Magazine issue',
    emailtemplate: 'Email template', correction: 'Correct a published page'
  };

  function titleOf(name) {
    var found = SUBTITLES[name];
    NAV.forEach(function (group) {
      group[1].forEach(function (item) { if (item[0] === name) found = item[1]; });
    });
    return found || name;
  }

  function buildNav() {
    var host = $('nav');
    host.innerHTML = '';
    NAV.forEach(function (group) {
      var box = el('div', { class: 'navgroup' });
      box.appendChild(el('div', { class: 'navgroup__label', text: group[0] }));
      group[1].forEach(function (item) {
        var b = el('button', { type: 'button', 'data-view': item[0], text: item[1] });
        b.addEventListener('click', function () { render(item[0]); closeNav(); });
        // Reaching for a menu item is enough warning to go and get it.
        var warm = function () { prefetch(NEEDS[item[0]] || []); };
        b.addEventListener('mouseenter', warm);
        b.addEventListener('focus', warm);
        b.addEventListener('touchstart', warm, { passive: true });
        box.appendChild(b);
      });
      host.appendChild(box);
    });
  }

  function markActive(name) {
    document.querySelectorAll('#nav button').forEach(function (b) {
      var on = b.getAttribute('data-view') === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  /** A number beside a screen that is waiting for someone. */
  function badge(view, count) {
    var b = document.querySelector('#nav button[data-view="' + view + '"]');
    if (!b) return;
    var old = b.querySelector('.count');
    if (old) old.remove();
    if (count > 0) b.appendChild(el('span', { class: 'count', text: String(count) }));
  }

  function filterNav(term) {
    term = String(term || '').trim().toLowerCase();
    var any = false;
    document.querySelectorAll('#nav .navgroup').forEach(function (group) {
      var shown = 0;
      group.querySelectorAll('button').forEach(function (b) {
        var match = !term || b.textContent.toLowerCase().indexOf(term) !== -1;
        b.style.display = match ? '' : 'none';
        if (match) { shown++; any = true; }
      });
      group.style.display = shown ? '' : 'none';
    });
    var empty = $('nav').querySelector('.navempty');
    if (!any && !empty) {
      $('nav').appendChild(el('div', { class: 'navempty', text: 'Nothing matches “' + term + '”' }));
    } else if (any && empty) { empty.remove(); }
  }

  function openNav() { $('app').classList.add('nav-open'); $('scrim').hidden = false; }
  function closeNav() { $('app').classList.remove('nav-open'); $('scrim').hidden = true; }

  $('navopen').addEventListener('click', openNav);
  $('navclose').addEventListener('click', closeNav);
  $('scrim').addEventListener('click', closeNav);

  $('navsearch').addEventListener('input', function () { filterNav(this.value); });
  $('navsearch').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { this.value = ''; filterNav(''); this.blur(); }
    if (e.key === 'Enter') {
      var first = document.querySelector('#nav button:not([style*="none"])');
      if (first) { first.click(); this.value = ''; filterNav(''); }
    }
  });

  addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openNav();
      $('navsearch').focus();
      $('navsearch').select();
    }
  });

  /* ---- views ---- */

  var showing = null;

  function render(name, arg, redraw) {
    var v = $('view');
    showing = name;
    servedFromCache = false;
    refreshes = [];

    $('viewtitle').textContent = titleOf(name);
    markActive(name);

    // A screen that has been open before paints from what it showed last time,
    // so there is nothing to look at while the engine wakes up. Only a screen
    // with nothing behind it shows a placeholder.
    var scroll = redraw ? (window.scrollY || 0) : 0;
    v.innerHTML = '<p class="hint">Loading…</p>';
    if (!redraw) { try { window.scrollTo(0, 0); } catch (e) {} }

    (VIEWS[name] || VIEWS.dashboard)(v, arg);

    if (redraw) {
      setTimeout(function () { try { window.scrollTo(0, scroll); } catch (e) {} }, 0);
      return;
    }

    // Whatever was served from store is now being checked behind the screen.
    setTimeout(function () {
      if (!refreshes.length) return;
      var pending = refreshes.slice();
      busy(true);
      Promise.all(pending).then(function (moved) {
        busy(false);
        if (showing !== name) return;                 // they have moved on
        if (!moved.some(Boolean)) return;             // nothing actually changed
        quiet = true;
        render(name, arg, true);
        quiet = false;
      });
    }, 0);
  }

  /** A quiet mark in the corner while something is being checked. Never a
   *  spinner over the screen: the screen is readable, and it is almost always
   *  already right. */
  function busy(on) {
    var bar = $('viewtitle');
    if (!bar) return;
    bar.classList.toggle('is-checking', !!on);
  }

  /** A minimal element helper for view files that build nodes rather than
   *  strings (anything with an event handler on it). */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  var VIEWS = {
    /** The dashboard answers one question: what is waiting for me?
     *
     *  Each figure is fetched separately and allowed to fail — a reviewer has
     *  no business reading the billing ledger, and a screen that breaks because
     *  one permission is missing is a screen nobody trusts. Whatever the person
     *  is entitled to see appears; the rest is quietly absent. */
    dashboard: function (v) {
      v.innerHTML = '<p class="hint">Gathering what needs you…</p>';

      // One request, one Apps Script execution, one pass over each table.
      // Seven separate calls meant seven of each, every time the tool opened.
      api.call('studioDashboard').then(function (d) {
        var queue = d.queue, reviews = d.reviews === null ? null : { length: d.reviews };
        var pending = d.pending === null ? null : { pending: d.pending };
        var ads = d.ads === null ? null : { creatives: new Array(d.ads).fill({ status: 'PENDING' }) };
        var news = d.newsletter, backups = d.backups ? [d.backups] : (d.backups === null ? null : []);
        var perf = null;
        var tiles = [];

        function tile(n, label, note, view, tone) {
          tiles.push({ n: n, label: label, note: note, view: view, tone: tone });
        }

        if (queue) {
          var submitted = queue.filter(function (a) {
            return ['SUBMITTED', 'RESUBMITTED'].indexOf(a.version_status) !== -1;
          }).length;
          var approving = queue.filter(function (a) { return a.version_status === 'READY_FOR_PUBLICATION'; }).length;
          tile(submitted, 'waiting to be taken on', submitted ? 'Authors are waiting for a first response' : 'Nothing new submitted', 'queue', submitted ? 'waiting' : 'clear');
          if (approving) tile(approving, 'ready to publish', 'Approval is the supervisor admin’s step', 'queue', 'urgent');
          badge('queue', submitted + approving);
        }
        if (reviews) {
          tile(reviews.length, 'reviews assigned to you', reviews.length ? 'Due dates are on the screen' : 'None outstanding', 'reviews', reviews.length ? 'waiting' : 'clear');
          badge('reviews', reviews.length);
        }
        if (pending) {
          tile(pending.pending, 'unpublished changes', pending.pending ? 'Readers still see the last published version' : 'The live site matches your working copy', 'publish', pending.pending ? 'waiting' : 'clear');
          badge('publish', pending.pending);
        }
        if (ads) {
          var waiting = ads.creatives.filter(function (c) { return c.status === 'PENDING'; }).length;
          if (waiting) { tile(waiting, 'advertisements to approve', 'Someone other than the uploader must approve', 'advertising', 'waiting'); }
          badge('advertising', waiting);
        }
        if (news) tile(news.confirmed, 'newsletter subscribers', news.pending + ' still to confirm', 'newsletter', 'clear');
        if (perf && perf.problems) {
          tile(perf.problems.length, 'performance problems', perf.problems.length ? 'Pages rated poor with enough samples' : 'Nothing rated poor', 'performance', perf.problems.length ? 'waiting' : 'clear');
        }

        var html = '';
        var urgent = tiles.filter(function (t) { return t.tone !== 'clear' && t.n > 0; });
        if (!urgent.length) {
          html += '<div class="allclear"><strong>Nothing is waiting.</strong> ' +
                  'Everything submitted has been dealt with and the live site matches your working copy.</div>';
        }

        html += '<div class="tiles">' + tiles.map(function (t, i) {
          return '<button class="tile is-' + t.tone + '" data-go="' + esc(t.view) + '" type="button">' +
            '<span class="tile__n">' + t.n + '</span>' +
            '<span class="tile__label">' + esc(t.label) + '</span>' +
            '<span class="tile__note">' + esc(t.note) + '</span></button>';
        }).join('') + '</div>';

        html += '<div class="card"><h2>Start something</h2><div class="shortcuts">' +
          '<button class="ghost" data-go="invitations">Invite an author</button>' +
          '<button class="ghost" data-go="newsletter">Write the newsletter</button>' +
          '<button class="ghost" data-go="issues">Build an issue</button>' +
          '<button class="ghost" data-go="appearance">Edit the brand</button>' +
          '<button class="ghost" data-go="publish">Publish the configuration</button>' +
          '</div></div>';

        var last = backups && backups.length ? backups[0] : null;
        html += '<div class="card"><h2>Housekeeping</h2><table><tbody>' +
          '<tr><td>Signed in as</td><td>' + esc(me.user.name) + ' — ' +
            esc(me.user.role_id.replace(/_/g, " ").toLowerCase()) + '</td></tr>' +
          (last ? '<tr><td>Last backup</td><td>' + esc(String(last.created_at).slice(0, 16).replace("T", " ")) +
            (last.verified_at ? ' — verified' : ' — <strong>not verified</strong>') + '</td></tr>'
                : '<tr><td>Last backup</td><td class="hint">No backup on record</td></tr>') +
          '<tr><td>Your permissions</td><td>' +
            me.permissions.map(function (p) { return "<code>" + esc(p.permission) + "</code>"; }).join(" ") +
          '</td></tr></tbody></table></div>';

        v.innerHTML = html;
        v.querySelectorAll('[data-go]').forEach(function (b) {
          b.addEventListener('click', function () { render(b.getAttribute('data-go')); });
        });
      });
    },

    users: function (v) {
      Promise.all([api.call('listUsers'), api.call('listRoles')]).then(function (r) {
        var users = r[0], roles = r[1];
        var rows = users.map(function (u) {
          return '<tr><td>' + esc(u.name) + '<br><span class="hint">' + esc(u.email) + '</span></td>' +
            '<td>' + esc(u.role_id) + '</td><td>' + esc(u.status) + '</td>' +
            '<td><button class="ghost" data-suspend="' + esc(u.id) + '">Suspend</button></td></tr>';
        }).join('');
        v.innerHTML = '<h2>Users</h2><div class="card"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' +
          rows + '</tbody></table></div>' +
          '<div class="card"><h2>Invite a user</h2>' +
          '<label>Name</label><input id="n-name">' +
          '<label>Email</label><input id="n-email" type="email">' +
          '<label>Institution</label><input id="n-inst">' +
          '<label>Role</label><select id="n-role">' +
          roles.filter(function (x) { return x.id !== 'SUPERVISOR_ADMIN'; })
               .map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') +
          '</select>' +
          '<p class="hint">The supervisor admin role is not offered here and cannot be assigned through the API.</p>' +
          '<div class="rowbtns"><button class="act" id="invite">Send invitation</button></div><div id="umsg"></div></div>';

        $('invite').addEventListener('click', function () {
          api.call('inviteUser', {
            name: $('n-name').value.trim(), email: $('n-email').value.trim(),
            institution: $('n-inst').value.trim(), role_id: $('n-role').value
          }).then(function () { message($('umsg'), 'Invitation sent.', 'ok'); VIEWS.users(v); })
            .catch(function (e) { message($('umsg'), explain(e), 'err'); });
        });

        v.querySelectorAll('[data-suspend]').forEach(function (b) {
          b.addEventListener('click', function () {
            var reason = prompt('Reason for suspending this account:');
            if (!reason) return;
            api.call('suspendUser', { user_id: b.getAttribute('data-suspend'), reason: reason })
              .then(function () { VIEWS.users(v); })
              .catch(function (e) { alert(explain(e)); });
          });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Users</h2>'; message(v, explain(e), 'err'); });
    },

    roles: function (v) {
      api.call('listRoles').then(function (roles) {
        v.innerHTML = '<h2>Roles</h2><div class="card"><table><thead><tr><th>Role</th><th>Permissions</th></tr></thead><tbody>' +
          roles.map(function (r) {
            return '<tr><td>' + esc(r.name) + (r.system ? ' <span class="hint">system</span>' : '') +
              '<br><span class="hint">' + esc(r.description) + '</span></td><td>' +
              r.permissions.map(function (p) { return '<code>' + esc(p.permission) + '</code>'; }).join(' ') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="hint">FINAL_PUBLISH cannot be added to any role and cannot be delegated. The backend refuses it.</p>';
      }).catch(function (e) { v.innerHTML = '<h2>Roles</h2>'; message(v, explain(e), 'err'); });
    },

    audit: function (v) {
      api.call('auditLog', { limit: 150 }).then(function (logs) {
        v.innerHTML = '<h2>Audit log</h2><div class="card"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Object</th></tr></thead><tbody>' +
          logs.map(function (l) {
            return '<tr><td>' + esc(String(l.ts).replace('T', ' ').slice(0, 19)) + '</td><td>' + esc(l.user_email) +
              '</td><td><code>' + esc(l.action) + '</code></td><td>' + esc(l.object_type) + ' ' + esc(l.object_id) +
              (l.reason ? '<br><span class="hint">' + esc(l.reason) + '</span>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }).catch(function (e) { v.innerHTML = '<h2>Audit log</h2>'; message(v, explain(e), 'err'); });
    },

    // The publish view now lives in siteadmin.js, which adds the file-by-file
    // preview and the version history. It registers under the same name.

    invitations: function (v) {
      Promise.all([api.call('listInvitations', {}), api.call('getCategories')]).then(function (r) {
        var invites = r[0], cats = (r[1].categories || []);
        v.innerHTML = '<h2>Author invitations</h2>' +
          '<div class="card"><table><thead><tr><th>Invitee</th><th>Section</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>' +
          (invites.length ? invites.map(function (i) {
            var actions = i.status === 'PENDING'
              ? '<button class="ghost" data-resend="' + esc(i.id) + '">Resend</button> ' +
                '<button class="ghost" data-extend="' + esc(i.id) + '">Extend</button> ' +
                '<button class="danger" data-revoke="' + esc(i.id) + '">Revoke</button>'
              : (i.status === 'EXPIRED' ? '<button class="ghost" data-extend="' + esc(i.id) + '">Reopen</button>' : '');
            return '<tr><td>' + esc(i.name) + '<br><span class="hint">' + esc(i.email) + '</span></td>' +
              '<td>' + esc(i.section || '-') + '</td><td>' + esc(i.status) + '</td>' +
              '<td>' + esc(String(i.expires_at).slice(0, 10)) + '</td><td>' + actions + '</td></tr>';
          }).join('') : '<tr><td colspan="5" class="hint">No invitations yet.</td></tr>') +
          '</tbody></table></div>' +

          '<div class="card"><h2>Invite an author</h2>' +
          '<label>Name</label><input id="i-name">' +
          '<label>Email</label><input id="i-email" type="email">' +
          '<label>Institution</label><input id="i-inst">' +
          '<label>Country</label><input id="i-country">' +
          '<label>Expertise</label><input id="i-exp" placeholder="sodium-ion cathodes, hard carbon anodes">' +
          '<label>Section</label><select id="i-section">' +
          cats.map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
          '<label>Personal message</label><input id="i-msg" placeholder="Why you are inviting this person">' +
          '<label>Valid for (days)</label><input id="i-days" type="number" value="14" min="1" max="60">' +
          '<p class="hint">The invitee receives a single-use link. Resending issues a new link and kills the old one — nobody, including us, can recover the original token.</p>' +
          '<div class="rowbtns"><button class="act" id="i-send">Send invitation</button></div><div id="imsg"></div></div>';

        $('i-send').addEventListener('click', function () {
          var btn = this; btn.disabled = true;
          api.call('createInvitation', {
            name: $('i-name').value.trim(), email: $('i-email').value.trim(),
            institution: $('i-inst').value.trim(), country: $('i-country').value.trim(),
            expertise: $('i-exp').value.trim(), section: $('i-section').value,
            message: $('i-msg').value.trim(), expiry_days: Number($('i-days').value || 14)
          }).then(function () { VIEWS.invitations(v); })
            .catch(function (e) { message($('imsg'), explain(e), 'err'); btn.disabled = false; });
        });

        function act(attr, action, build) {
          v.querySelectorAll('[' + attr + ']').forEach(function (b) {
            b.addEventListener('click', function () {
              var extra = build ? build() : {};
              if (extra === null) return;
              extra.invitation_id = b.getAttribute(attr);
              api.call(action, extra).then(function () { VIEWS.invitations(v); })
                .catch(function (e) { alert(explain(e)); });
            });
          });
        }
        act('data-resend', 'resendInvitation');
        act('data-extend', 'extendInvitation', function () {
          var d = prompt('Extend by how many days?', '14');
          return d ? { days: Number(d) } : null;
        });
        act('data-revoke', 'revokeInvitation', function () {
          var r = prompt('Reason for revoking:');
          return r ? { reason: r, notify: confirm('Tell the invitee by email?') } : null;
        });
      }).catch(function (e) { v.innerHTML = '<h2>Author invitations</h2>'; message(v, explain(e), 'err'); });
    },

    account: function (v) {
      v.innerHTML = '<div class="card">' +
        '<label>Current password</label><input id="p-cur" type="password" autocomplete="current-password">' +
        '<label>New password</label><input id="p-new" type="password" autocomplete="new-password">' +
        '<p class="hint">At least 12 characters, with upper case, lower case and digits.</p>' +
        '<div class="rowbtns"><button class="act" id="p-save">Change password</button>' +
        '<button class="danger" id="p-all">Sign out all devices</button></div><div id="accountmsg"></div></div>' +
        '<div class="card" id="mfacard"><h2>Two-step sign in</h2><p class="hint">Loading…</p></div>';
      mfaCard();
      $('p-save').addEventListener('click', function () {
        api.call('changePassword', { current: $('p-cur').value, next: $('p-new').value })
          .then(function () { message($('accountmsg'), 'Password changed. Sign in again.', 'ok');
            setTimeout(function () { clearToken(); location.reload(); }, 1500); })
          .catch(function (e) { message($('accountmsg'), explain(e), 'err'); });
      });
      $('p-all').addEventListener('click', function () {
        if (!confirm('End every signed-in session, including this one?')) return;
        api.call('logoutEverywhere').then(function () { clearToken(); location.reload(); })
          .catch(function (e) { message($('accountmsg'), explain(e), 'err'); });
      });
    }
  };

  /** Turning two-step sign in on, and off again. The code box on the sign-in
   *  page appears only for people who have done this. */
  function mfaCard() {
    var card = $('mfacard');
    api.call('mfaState').then(function (state) {
      if (state.enabled) {
        card.innerHTML = '<h2>Two-step sign in</h2>' +
          '<p><strong>On.</strong> Signing in asks for a code from your authenticator app as well as your password.</p>' +
          '<label for="mfa-off">Code from your app</label>' +
          '<input id="mfa-off" inputmode="numeric" maxlength="6" placeholder="6 digits">' +
          '<div class="rowbtns"><button class="danger" id="mfa-disable">Turn it off</button></div>' +
          '<div id="mfamsg"></div>';
        $('mfa-disable').addEventListener('click', function () {
          api.call('disableMfa', { code: $('mfa-off').value.trim() })
            .then(function () { mfaCard(); })
            .catch(function (e) { message($('mfamsg'), explain(e), 'err'); });
        });
        return;
      }
      card.innerHTML = '<h2>Two-step sign in</h2>' +
        '<p>Off. A password alone opens this account. Two-step sign in asks for a six-digit ' +
        'code from your phone as well — worth the twenty seconds it takes to set up, ' +
        'particularly for the supervisor admin.</p>' +
        '<div class="rowbtns"><button class="act" id="mfa-start">Set it up</button></div>' +
        '<div id="mfamsg"></div>';
      $('mfa-start').addEventListener('click', function () {
        api.call('beginMfa').then(function (setup) {
          card.innerHTML = '<h2>Two-step sign in</h2>' +
            '<p><strong>1.</strong> In your authenticator app — Google Authenticator, Authy, 1Password — ' +
            'add an account by typing this key:</p>' +
            '<p><code style="font-size:1rem;letter-spacing:.08em">' + esc(setup.secret) + '</code></p>' +
            '<p class="hint">Write it somewhere safe as well. Lose the phone without it and only the ' +
            'supervisor admin can let you back in.</p>' +
            '<p><strong>2.</strong> Type the six digits it shows:</p>' +
            '<label for="mfa-code">Code</label>' +
            '<input id="mfa-code" inputmode="numeric" maxlength="6" placeholder="6 digits">' +
            '<div class="rowbtns"><button class="act" id="mfa-confirm">Turn it on</button>' +
            '<button class="ghost" id="mfa-cancel">Not now</button></div><div id="mfamsg"></div>';
          $('mfa-confirm').addEventListener('click', function () {
            api.call('enableMfa', { code: $('mfa-code').value.trim() })
              .then(function () { mfaCard(); })
              .catch(function (e) { message($('mfamsg'), explain(e), 'err'); });
          });
          $('mfa-cancel').addEventListener('click', mfaCard);
        }).catch(function (e) { message($('mfamsg'), explain(e), 'err'); });
      });
    }).catch(function (e) { card.innerHTML = '<h2>Two-step sign in</h2>'; message(card, explain(e), 'err'); });
  }

  if (window.ADMIN_EXTRA_VIEWS) {
    Object.assign(VIEWS, window.ADMIN_EXTRA_VIEWS({
      api: api, esc: esc, el: el, message: message, explain: explain,
      render: render, me: function () { return me; }
    }));
  }

  /* ---- resume an existing session ---- */

  /* Sign out in one tab, and the others follow. */
  addEventListener('storage', function (e) {
    if (e.key === SESSION_KEY && !e.newValue && !$('app').classList.contains('hidden')) {
      endSession('Signed out in another tab.');
    }
  });

  /* Three hours of doing nothing ends it, checked once a minute rather than
     only on the next click. */
  setInterval(function () {
    if ($('app').classList.contains('hidden')) return;
    if (!loadToken()) endSession('Signed out after three hours of inactivity.');
  }, 60000);

  var token = loadToken();
  if (token) {
    api.setToken(token);
    api.call('me').then(function (res) {
      me = res;
      start(false);
    }).catch(function (e) {
      // Only an answer from the server ends the session. Anything else — no
      // network, a cold engine, a bad gateway — leaves it alone and says so.
      if (e && e.code === 'unauthenticated') return;
      message($('loginmsg'),
        'Could not reach the engine just now. Your session is still valid — reload in a moment.', 'err');
    });
  }
})();
