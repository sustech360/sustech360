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
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); };

  /* ---- session: token in sessionStorage, gone when the tab closes ---- */

  function saveToken(t) { try { sessionStorage.setItem('mag.token', t); } catch (e) {} }
  function loadToken() { try { return sessionStorage.getItem('mag.token'); } catch (e) { return null; } }
  function clearToken() { try { sessionStorage.removeItem('mag.token'); } catch (e) {} }

  function message(host, text, kind) {
    host.innerHTML = '<div class="msg ' + (kind || 'ok') + '">' + esc(text) + '</div>';
  }

  var ERRORS = {
    invalid_credentials: 'That email and password do not match.',
    locked: 'Too many attempts. Wait a few minutes and try again.',
    mfa_required: 'Enter the six-digit code from your authenticator app.',
    account_disabled: 'This account is suspended. Contact the supervisor admin.',
    unauthenticated: 'Your session ended. Sign in again.',
    forbidden: 'Your role does not allow that.',
    reason_required: 'A reason is required for this action.',
    expiry_required: 'Temporary access needs an end date.',
    weak_password: 'Choose a longer password with upper case, lower case and digits.',
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

  $('signin').addEventListener('click', function () {
    var btn = this;
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
      message($('loginmsg'), explain(e), 'err');
    }).then(function () { btn.disabled = false; });
  });

  $('signout').addEventListener('click', function () {
    api.call('logout').catch(function () {}).then(function () {
      clearToken(); location.reload();
    });
  });

  function start(forcePassword) {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    api.call('health').then(function (h) { $('env').textContent = h.env; }).catch(function () {});
    render(forcePassword ? 'account' : 'dashboard');
    if (forcePassword) {
      message($('view').querySelector('#accountmsg') || $('view'),
        'Change your temporary password before doing anything else.', 'err');
    }
  }

  document.querySelectorAll('.rail nav button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.rail nav button').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      render(b.getAttribute('data-view'));
    });
  });

  /* ---- views ---- */

  function render(name, arg) {
    var v = $('view');
    v.innerHTML = '<h2>Loading</h2>';
    (VIEWS[name] || VIEWS.dashboard)(v, arg);
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
    dashboard: function (v) {
      v.innerHTML = '<h2>Dashboard</h2>' +
        '<div class="card"><p>Signed in as <strong>' + esc(me.user.name) + '</strong> (' + esc(me.user.role_id) + ').</p>' +
        '<p class="hint">The queue holds anything waiting on an editor. Your reviews holds anything waiting on you. ' +
        'Publication is the supervisor admin\'s step, and every version that has ever been on the site can be put back.</p></div>' +
        '<div class="card"><h2>Your permissions</h2><p>' +
        me.permissions.map(function (p) { return '<code>' + esc(p.permission) + '</code>'; }).join(' ') +
        '</p></div>';
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
      v.innerHTML = '<h2>Account</h2><div class="card">' +
        '<label>Current password</label><input id="p-cur" type="password" autocomplete="current-password">' +
        '<label>New password</label><input id="p-new" type="password" autocomplete="new-password">' +
        '<p class="hint">At least 12 characters, with upper case, lower case and digits.</p>' +
        '<div class="rowbtns"><button class="act" id="p-save">Change password</button>' +
        '<button class="danger" id="p-all">Sign out all devices</button></div><div id="accountmsg"></div></div>';
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

  if (window.ADMIN_EXTRA_VIEWS) {
    Object.assign(VIEWS, window.ADMIN_EXTRA_VIEWS({
      api: api, esc: esc, el: el, message: message, explain: explain,
      render: render, me: function () { return me; }
    }));
  }

  /* ---- resume an existing session ---- */

  var token = loadToken();
  if (token) {
    api.setToken(token);
    api.call('me').then(function (res) { me = res; start(false); })
      .catch(function () { clearToken(); });
  }
})();
