/* accept.js — the only route into an author account.
   The token arrives in the URL, is used twice, and is never stored anywhere. */
(function () {
  'use strict';
  var api = MAG.admin(window.MAG_ENDPOINT);
  var host = document.getElementById('state');
  var params = new URLSearchParams(location.search);
  var id = params.get('i') || '';
  var token = params.get('t') || '';

  var MESSAGES = {
    invalid_invitation: 'This link is not valid. Check that you copied all of it, or ask the editor who invited you to send another.',
    invitation_expired: 'This invitation has expired. Ask the editor who invited you to extend it.',
    invitation_revoked: 'This invitation has been withdrawn.',
    invitation_used: 'This invitation has already been used. Sign in instead.',
    too_many_attempts: 'Too many attempts on this link. Try again in an hour.',
    already_a_user: 'There is already an account for this email address. Sign in instead.',
    weak_password: 'Choose a longer password: at least 12 characters, with upper case, lower case and digits.',
    no_endpoint: 'This site is not finished configuring. Contact the editors.',
    offline: 'We could not reach the server. Check your connection and try again.'
  };
  function say(e) { return MESSAGES[e && e.code] || 'Something went wrong. Try again, or contact the editors.'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (!id || !token) { fail({ code: 'invalid_invitation' }); return; }

  api.call('getInvitation', { id: id, token: token }).then(show).catch(fail);

  function fail(e) {
    host.innerHTML = '<h1>Invitation</h1><div class="msg err">' + esc(say(e)) + '</div>' +
      '<p><a class="btn" href="./">Go to the homepage</a></p>';
  }

  function show(inv) {
    host.innerHTML =
      '<h1>You have been invited to write</h1>' +
      '<div class="panel"><dl>' +
      '<dt>Invited</dt><dd>' + esc(inv.name) + '</dd>' +
      (inv.institution ? '<dt>Institution</dt><dd>' + esc(inv.institution) + '</dd>' : '') +
      (inv.section ? '<dt>Section</dt><dd>' + esc(inv.section) + '</dd>' : '') +
      (inv.format ? '<dt>Format</dt><dd>' + esc(inv.format) + '</dd>' : '') +
      '<dt>Valid until</dt><dd>' + esc(String(inv.expires_at).slice(0, 10)) + '</dd>' +
      '</dl></div>' +
      (inv.message ? '<p>' + esc(inv.message) + '</p>' : '') +
      '<h2>Set up your account</h2>' +
      '<div class="field"><label for="f-name">Name as it should appear on your byline</label>' +
      '<input id="f-name" value="' + esc(inv.name) + '" autocomplete="name"></div>' +
      '<div class="field"><label for="f-inst">Institution</label>' +
      '<input id="f-inst" value="' + esc(inv.institution || '') + '" autocomplete="organization"></div>' +
      '<div class="field"><label for="f-pos">Position</label><input id="f-pos" autocomplete="organization-title"></div>' +
      '<div class="field"><label for="f-pw">Password — at least 12 characters, with upper case, lower case and digits</label>' +
      '<input id="f-pw" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="f-pw2">Repeat password</label>' +
      '<input id="f-pw2" type="password" autocomplete="new-password"></div>' +
      '<p><button class="btn btn--solid" id="go" type="button">Create my account</button></p>' +
      '<div id="msg"></div>';

    document.getElementById('go').addEventListener('click', submit);
  }

  function submit() {
    var btn = this;
    var msg = document.getElementById('msg');
    var pw = document.getElementById('f-pw').value;
    if (pw !== document.getElementById('f-pw2').value) {
      msg.innerHTML = '<div class="msg err">The two passwords do not match.</div>';
      return;
    }
    btn.disabled = true;
    api.call('acceptInvitation', {
      id: id, token: token, password: pw,
      name: document.getElementById('f-name').value.trim(),
      institution: document.getElementById('f-inst').value.trim(),
      position: document.getElementById('f-pos').value.trim()
    }).then(function (res) {
      host.innerHTML = '<h1>Your account is ready</h1>' +
        '<div class="msg">Sign in as ' + esc(res.email) + ' to start writing.</div>' +
        '<p><a class="btn btn--solid" href="author/">Open the author portal</a></p>';
      history.replaceState({}, '', location.pathname);   // strip the token from the URL
    }).catch(function (e) {
      msg.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>';
      btn.disabled = false;
    });
  }
})();
