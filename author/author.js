/* author.js — the author portal.
 *
 * The editor renders whichever fields the chosen format defines, so a new
 * format added in the control centre appears here with no deployment. Every
 * check in this file is a courtesy to the author: the backend re-runs all of
 * them at submission, and its answer is the one that counts.
 */
(function () {
  'use strict';
  var api = MAG.admin(window.MAG_ENDPOINT);
  var me = null, bundle = null, articles = [], current = null, dirty = false, timer = null;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function words(s) { return (String(s || '').match(/\S+/g) || []).length; }

  var ERRORS = {
    invalid_credentials: 'That email and password do not match.',
    locked: 'Too many attempts. Wait a few minutes.',
    mfa_required: 'Enter the six-digit code from your authenticator app.',
    account_disabled: 'This account is suspended. Contact the editors.',
    unauthenticated: 'Your session ended. Sign in again.',
    forbidden: 'Your account cannot do that.',
    not_found: 'That article is not available to you.',
    locked_version: 'This version is with the editors.',
    incomplete: 'The submission is not ready yet.',
    title_too_short: 'Give the article a working title of at least eight characters.',
    unknown_format: 'Choose a format.',
    revision_open: 'A revision is already open on this article.',
    credit_required: 'Every image needs a credit and a licence.',
    too_large: 'That image is too large. Keep it under 4 MB.',
    bad_type: 'Images must be JPEG, PNG, WebP or AVIF.',
    weak_password: 'Passwords need 12 characters, upper case, lower case and digits.',
    no_endpoint: 'The portal is not configured yet. Contact the editors.',
    offline: 'We could not reach the server. Check your connection.'
  };
  function say(e) {
    var base = ERRORS[e && e.code] || 'That did not work.';
    return e && e.detail && e.code !== 'incomplete' ? base + ' ' + e.detail : base;
  }
  function problems(e) {
    return (e.detail || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ---------------- session ---------------- */

  /* ---- session ----
     The same three-hour idle window the studio uses. An author writing a
     paragraph, going to find a reference and coming back should not lose the
     draft to a sign-in screen. */

  var SESSION_KEY = 's360.author';
  var IDLE_LIMIT = 3 * 60 * 60 * 1000;

  function keepToken(t) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: t, until: Date.now() + IDLE_LIMIT })); }
    catch (e) {}
  }
  function heldToken() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        var legacy = sessionStorage.getItem('mag.author.token');
        if (legacy) { keepToken(legacy); sessionStorage.removeItem('mag.author.token'); return legacy; }
        return null;
      }
      var rec = JSON.parse(raw);
      if (!rec || !rec.token || Date.now() > rec.until) { dropToken(); return null; }
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
  function dropToken() {
    try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('mag.author.token'); } catch (e) {}
  }

  /* A failed request is not a sign-out — least of all here, where the thing
     being lost is somebody's unsaved writing. */
  var callThrough = api.call.bind(api);
  api.call = function (action, payload) {
    return callThrough(action, payload).then(function (data) {
      touchToken();
      return data;
    }, function (e) {
      if (e && e.code === 'unauthenticated') dropToken();
      throw e;
    });
  };

  $('signin').addEventListener('click', function () {
    var btn = this; btn.disabled = true;
    api.call('login', { email: $('email').value.trim(), password: $('password').value, mfa_code: $('mfa').value.trim() })
      .then(function (res) {
        api.setToken(res.token);
        keepToken(res.token);
        $('password').value = '';
        me = res;
        start();
      })
      .catch(function (e) { $('loginmsg').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; })
      .then(function () { btn.disabled = false; });
  });

  $('signout').addEventListener('click', function () {
    api.call('logout').catch(function () {}).then(function () {
      dropToken();
      location.reload();
    });
  });

  addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  function start() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('who').textContent = me.user.name + ' · ' + me.user.email;
    api.call('editorialBundle').then(function (b) { bundle = b; render('dashboard'); })
      .catch(function (e) { $('view').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
    refreshBadge();
  }

  function refreshBadge() {
    api.call('notifications', { limit: 40 }).then(function (list) {
      var n = list.filter(function (x) { return !x.read; }).length;
      var b = $('nbadge');
      b.textContent = n;
      b.classList.toggle('hidden', n === 0);
    }).catch(function () {});
  }

  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (dirty && !confirm('You have unsaved changes. Leave the editor?')) return;
      dirty = false;
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('is-active'); });
      b.classList.add('is-active');
      render(b.getAttribute('data-view'));
    });
  });

  function render(name, arg) {
    clearInterval(timer);
    var v = $('view');
    v.innerHTML = '<p class="hint">Loading…</p>';
    (VIEWS[name] || VIEWS.dashboard)(v, arg);
  }

  /* ---------------- views ---------------- */

  var VIEWS = {

    dashboard: function (v) {
      api.call('myArticles').then(function (list) {
        articles = list;
        var by = function (s) { return list.filter(function (a) { return a.status === s; }).length; };
        v.innerHTML = '<h1>Welcome, ' + esc(me.user.name.split(' ')[0]) + '</h1>' +
          '<div class="panel"><div class="row">' +
          stat('Drafts', by('DRAFT')) + stat('With editors', by('SUBMITTED') + by('RESUBMITTED')) +
          stat('Needs revision', by('REVISION_REQUIRED')) + stat('Published', by('PUBLISHED')) +
          '</div></div>' +
          '<h2>Recent</h2>' + listHtml(list.slice(0, 5)) +
          '<p class="hint">You write and submit here. Publication is decided by the editors and the supervisor admin — no account in this portal can publish.</p>';
        wireList(v);
      }).catch(function (e) { v.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
    },

    articles: function (v) {
      api.call('myArticles').then(function (list) {
        articles = list;
        v.innerHTML = '<h1>My articles</h1>' + (list.length ? listHtml(list) :
          '<p class="hint">Nothing yet. Start with “New article”.</p>');
        wireList(v);
      }).catch(function (e) { v.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
    },

    'new': function (v) {
      v.innerHTML = '<h1>New article</h1>' +
        '<label for="n-title">Working title</label><input id="n-title" placeholder="What is this about?">' +
        '<div class="row">' +
        '<div><label for="n-format">Format</label><select id="n-format">' +
        bundle.formats.map(function (f) { return '<option value="' + esc(f.slug) + '">' + esc(f.name) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label for="n-cat">Category</label><select id="n-cat">' +
        bundle.categories.map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label for="n-level">Reading level</label><select id="n-level">' +
        bundle.levels.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.name) + '</option>'; }).join('') +
        '</select></div></div>' +
        '<p class="hint" id="n-desc"></p>' +
        '<div class="btnrow"><button class="act" id="n-go" type="button">Create draft</button></div><div id="n-msg"></div>';

      function describe() {
        var f = bundle.formats.filter(function (x) { return x.slug === $('n-format').value; })[0];
        var lvl = bundle.levels.filter(function (x) { return x.id === $('n-level').value; })[0];
        $('n-desc').textContent = f.description +
          (f.words && f.words.recommended ? ' Around ' + f.words.recommended + ' words, ' + f.words.max + ' maximum.' : '') +
          (lvl ? ' Written for: ' + lvl.help : '');
      }
      $('n-format').addEventListener('change', describe);
      $('n-level').addEventListener('change', describe);
      describe();

      $('n-go').addEventListener('click', function () {
        var btn = this; btn.disabled = true;
        api.call('createDraft', {
          title: $('n-title').value.trim(), format: $('n-format').value,
          category: $('n-cat').value, level: $('n-level').value
        }).then(function (a) { render('editor', a.id); })
          .catch(function (e) {
            $('n-msg').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>';
            btn.disabled = false;
          });
      });
    },

    editor: function (v, articleId) {
      api.call('getArticle', { article_id: articleId }).then(function (data) {
        current = data;
        var a = data.article;
        var format = bundle.formats.filter(function (f) { return f.slug === a.format; })[0] || { fields: [], words: {} };
        var editable = ['DRAFT', 'REVISION_REQUIRED'].indexOf(data.version_status) !== -1;

        v.innerHTML =
          '<div class="savebar"><span id="savestate">' +
            (editable ? 'Saved' : 'Read only — version ' + data.version + ' is ' + data.version_status.toLowerCase().replace('_', ' ')) +
          '</span><span id="wordcount"></span></div>' +
          '<h1>' + esc(a.title) + '</h1>' +
          '<p class="hint">' + esc(a.id) + ' · ' + esc(format.name || a.format) + ' · version ' + data.version +
            (a.public_version ? ' · published version ' + a.public_version : '') + '</p>' +
          (data.notes ? '<div class="msg"><strong>Editor’s note:</strong> ' + esc(data.notes) + '</div>' : '') +
          (a.status === 'PUBLISHED' && !editable ?
            '<div class="msg">This article is published. Editing it opens a new private version; the live article stays exactly as it is until an editor approves the change.' +
            '<div class="btnrow"><button class="act" id="revise" type="button">Start a revision</button></div></div>' : '') +
          '<label for="e-title">Title</label><input id="e-title" value="' + esc(a.title) + '"' + (editable ? '' : ' disabled') + '>' +
          format.fields.map(function (f) {
            var val = (data.content.fields || {})[f.field] || '';
            return '<label for="f-' + esc(f.field) + '">' + esc(f.label) + (f.required ? '' : ' <span class="hint">optional</span>') + '</label>' +
              (f.help ? '<p class="hint">' + esc(f.help) + '</p>' : '') +
              '<textarea id="f-' + esc(f.field) + '" data-field="' + esc(f.field) + '"' + (editable ? '' : ' disabled') + '>' + esc(val) + '</textarea>';
          }).join('') +
          '<h2>Figures</h2><div id="media"></div>' +
          (editable ? mediaForm() : '') +
          '<div class="btnrow">' +
          (editable ? '<button class="act" id="save" type="button">Save</button>' +
                      '<button class="ghost" id="submit" type="button">Submit for review</button>' : '') +
          (data.version_status === 'SUBMITTED' ? '<button class="ghost" id="withdraw" type="button">Withdraw submission</button>' : '') +
          '</div><div id="e-msg"></div>';

        paintMedia();
        countWords();

        if (editable) {
          v.querySelectorAll('textarea, #e-title').forEach(function (n) {
            n.addEventListener('input', function () {
              dirty = true;
              $('savestate').textContent = 'Unsaved changes';
              countWords();
            });
          });
          $('save').addEventListener('click', function () { save(true); });
          $('submit').addEventListener('click', openChecklist);
          timer = setInterval(function () { if (dirty) save(false); }, 20000);
          wireMediaForm();
        }
        if ($('revise')) {
          $('revise').addEventListener('click', function () {
            api.call('startRevision', { article_id: a.id, reason: prompt('What are you changing?') || '' })
              .then(function () { render('editor', a.id); })
              .catch(function (e) { $('e-msg').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
          });
        }
        if ($('withdraw')) {
          $('withdraw').addEventListener('click', function () {
            if (!confirm('Take this back from the editors?')) return;
            api.call('withdrawArticle', { article_id: a.id })
              .then(function () { render('editor', a.id); })
              .catch(function (e) { $('e-msg').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
          });
        }
      }).catch(function (e) { v.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
    },

    guidelines: function (v) {
      var g = bundle.guidelines || { version: '—', title: 'Author guidelines', body: '' };
      var rules = bundle.rules || { writing: {}, media: {} };
      var others = (bundle.documents || []).filter(function (d) { return d.kind !== 'AUTHOR'; });
      v.innerHTML = '<h1>' + esc(g.title) + '</h1><p class="hint">Version ' + esc(g.version) + '</p>' +
        '<div class="guidelines">' + esc(g.body) + '</div>' +
        others.map(function (d) {
          return '<h2>' + esc(d.name) + '</h2><p class="hint">Version ' + esc(d.version) + '</p>' +
            '<div class="guidelines">' + esc(d.body) + '</div>';
        }).join('') +
        '<h2>Submission checklist</h2><ul>' +
        bundle.checklist.map(function (c) { return '<li>' + esc(c.item) + '</li>'; }).join('') + '</ul>' +
        '<h2>The limits we check</h2><ul>' +
        '<li>Title: up to ' + esc(rules.writing.title_max || '—') + ' characters</li>' +
        '<li>Summary: ' + esc(rules.writing.summary_min_words || 0) + ' to ' + esc(rules.writing.summary_max_words || '—') + ' words</li>' +
        '<li>References: ' + esc(rules.writing.citation_style || '—') + '</li>' +
        '<li>Images: ' + esc((rules.media.mime || []).join(', ')) + ', up to ' +
        Math.round((rules.media.max_bytes || 0) / 100000) / 10 + ' MB, credit and licence required</li></ul>' +
        '<p class="hint">These are enforced when you submit, not just suggested here.</p>';
    },

    profile: function (v) {
      api.call('myProfile').then(function (p) {
        p = p || {};
        v.innerHTML = '<h1>Profile</h1>' +
          '<p class="hint">Your byline and the details readers see on published articles.</p>' +
          field('p-name', 'Display name', p.display_name) +
          '<div class="row">' + field('p-inst', 'Institution', p.institution) + field('p-pos', 'Position', p.position) + '</div>' +
          '<div class="row">' + field('p-country', 'Country', p.country) + field('p-orcid', 'ORCID', p.orcid, '0000-0000-0000-0000') + '</div>' +
          field('p-site', 'Website', p.website, 'https://') +
          field('p-int', 'Research interests', p.interests) +
          '<label for="p-bio">Short biography</label><textarea id="p-bio">' + esc(p.bio || '') + '</textarea>' +
          '<div class="check"><input type="checkbox" id="p-public"' + (p.public ? ' checked' : '') + '>' +
          '<label for="p-public">Show this profile publicly once I have a published article</label></div>' +
          '<div class="btnrow"><button class="act" id="p-save" type="button">Save profile</button></div><div id="p-msg"></div>';

        $('p-save').addEventListener('click', function () {
          api.call('saveProfile', {
            display_name: $('p-name').value.trim(), institution: $('p-inst').value.trim(),
            position: $('p-pos').value.trim(), country: $('p-country').value.trim(),
            orcid: $('p-orcid').value.trim(), website: $('p-site').value.trim(),
            interests: $('p-int').value.trim(), bio: $('p-bio').value.trim(),
            public: $('p-public').checked
          }).then(function () { $('p-msg').innerHTML = '<div class="msg">Profile saved.</div>'; })
            .catch(function (e) { $('p-msg').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
        });
      }).catch(function (e) { v.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
    },

    notifications: function (v) {
      api.call('notifications', { limit: 50 }).then(function (list) {
        v.innerHTML = '<h1>Notifications</h1>' +
          (list.length ? '<div class="btnrow"><button class="ghost" id="readall" type="button">Mark all read</button></div>' +
            list.map(function (n) {
              return '<div class="notif' + (n.read ? '' : ' unread') + '"><h3>' + esc(n.title) + '</h3>' +
                '<p class="hint">' + esc(n.body) + ' · ' + esc(String(n.created_at).slice(0, 10)) + '</p></div>';
            }).join('') : '<p class="hint">Nothing yet.</p>');
        if ($('readall')) {
          $('readall').addEventListener('click', function () {
            api.call('markAllNotificationsRead').then(function () { refreshBadge(); render('notifications'); });
          });
        }
      }).catch(function (e) { v.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; });
    }
  };

  /* ---------------- editor helpers ---------------- */

  function collect() {
    var fields = {};
    document.querySelectorAll('[data-field]').forEach(function (n) { fields[n.getAttribute('data-field')] = n.value; });
    return fields;
  }

  function countWords() {
    var f = collect(), total = 0;
    Object.keys(f).forEach(function (k) { total += words(f[k]); });
    var limits = (bundle.formats.filter(function (x) { return x.slug === current.article.format; })[0] || {}).words || {};
    var txt = total + ' words';
    if (limits.recommended) txt += ' · target ' + limits.recommended;
    if (limits.max && total > limits.max) txt += ' · over the ' + limits.max + ' limit';
    var el = $('wordcount');
    if (el) el.textContent = txt;
  }

  function save(explicit) {
    var state = $('savestate');
    if (state) state.textContent = 'Saving…';
    return api.call('saveDraft', {
      article_id: current.article.id, fields: collect(), title: $('e-title').value.trim()
    }).then(function (r) {
      dirty = false;
      if (state) state.textContent = 'Saved ' + new Date(r.saved_at).toLocaleTimeString();
      return r;
    }).catch(function (e) {
      if (state) state.textContent = 'Not saved';
      if (explicit) $('e-msg').innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>';
      throw e;
    });
  }

  function openChecklist() {
    save(true).then(function () {
      $('e-msg').innerHTML = '<div class="msg"><strong>Before you submit</strong>' +
        bundle.checklist.map(function (c) {
          return '<div class="check"><input type="checkbox" id="c-' + esc(c.id) + '" data-check="' + esc(c.id) + '">' +
            '<label for="c-' + esc(c.id) + '">' + esc(c.item) + '</label></div>';
        }).join('') +
        '<div class="btnrow"><button class="act" id="confirm" type="button">Submit for review</button>' +
        '<button class="ghost" id="cancel" type="button">Not yet</button></div></div>';
      $('cancel').addEventListener('click', function () { $('e-msg').innerHTML = ''; });
      $('confirm').addEventListener('click', function () {
        var answers = {};
        document.querySelectorAll('[data-check]').forEach(function (n) { answers[n.getAttribute('data-check')] = n.checked; });
        var btn = this; btn.disabled = true;
        api.call('submitArticle', { article_id: current.article.id, checklist: answers })
          .then(function (r) {
            $('e-msg').innerHTML = '<div class="msg">Submitted. Status is now ' + esc(r.status.toLowerCase()) +
              '. You will be notified when there is a decision.</div>';
            setTimeout(function () { render('articles'); }, 1400);
          })
          .catch(function (e) {
            var list = problems(e);
            $('e-msg').innerHTML = '<div class="msg err"><strong>' + esc(say(e)) + '</strong>' +
              (list.length ? '<ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
              '</div>';
            btn.disabled = false;
          });
      });
    }).catch(function () {});
  }

  /* ---------------- media ---------------- */

  function mediaForm() {
    return '<div class="panel"><div class="row">' +
      '<div><label for="m-file">Image file</label><input id="m-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></div>' +
      '<div><label for="m-credit">Credit</label><input id="m-credit" placeholder="Photograph: your name"></div>' +
      '<div><label for="m-licence">Licence</label><input id="m-licence" placeholder="CC BY 4.0, own work, permission held"></div>' +
      '</div><label for="m-caption">Caption</label><input id="m-caption">' +
      '<div class="btnrow"><button class="ghost" id="m-go" type="button">Upload figure</button></div>' +
      '<p class="hint">JPEG, PNG, WebP or AVIF, under 4 MB. An image without a credit and a licence cannot be published, so both are required here.</p></div>';
  }

  function wireMediaForm() {
    $('m-go').addEventListener('click', function () {
      var file = $('m-file').files[0];
      var msg = $('e-msg');
      if (!file) { msg.innerHTML = '<div class="msg err">Choose a file first.</div>'; return; }
      if (file.size > 4 * 1024 * 1024) { msg.innerHTML = '<div class="msg err">That image is over 4 MB.</div>'; return; }
      var btn = this; btn.disabled = true;
      var reader = new FileReader();
      reader.onload = function () {
        api.call('uploadMedia', {
          article_id: current.article.id, name: file.name, mime: file.type,
          data: String(reader.result).split(',')[1],
          credit: $('m-credit').value.trim(), licence: $('m-licence').value.trim(),
          caption: $('m-caption').value.trim()
        }).then(function (m) {
          current.media.push(m);
          paintMedia();
          $('m-file').value = ''; $('m-caption').value = '';
          msg.innerHTML = '<div class="msg">Figure uploaded.</div>';
        }).catch(function (e) { msg.innerHTML = '<div class="msg err">' + esc(say(e)) + '</div>'; })
          .then(function () { btn.disabled = false; });
      };
      reader.readAsDataURL(file);
    });
  }

  function paintMedia() {
    var host = $('media');
    if (!host) return;
    if (!current.media.length) { host.innerHTML = '<p class="hint">No figures yet.</p>'; return; }
    host.innerHTML = '<div class="list">' + current.media.map(function (m) {
      return '<div class="item"><div><h3>' + esc(m.name) + '</h3>' +
        '<p class="hint">' + esc(m.caption || 'No caption') + ' · ' + Math.round((m.bytes || 0) / 1024) + ' KB' +
        (m.credit ? ' · ' + esc(m.credit) : '') + '</p></div>' +
        '<button class="link" data-remove="' + esc(m.id) + '" type="button">Remove</button></div>';
    }).join('') + '</div>';
    host.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        api.call('removeMedia', { media_id: b.getAttribute('data-remove') }).then(function () {
          current.media = current.media.filter(function (m) { return m.id !== b.getAttribute('data-remove'); });
          paintMedia();
        });
      });
    });
  }

  /* ---------------- small pieces ---------------- */

  function stat(label, n) {
    return '<div><div style="font-size:1.6rem;font-family:var(--serif)">' + n + '</div><div class="hint">' + esc(label) + '</div></div>';
  }

  function field(id, label, value, placeholder) {
    return '<div><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" value="' + esc(value || '') + '"' +
      (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '></div>';
  }

  function listHtml(list) {
    return '<div class="list">' + list.map(function (a) {
      return '<div class="item"><div><h3>' + esc(a.title) + '</h3>' +
        '<p class="hint">' + esc(a.id) + ' · ' + esc(a.format) + ' · updated ' + esc(String(a.updated_at).slice(0, 10)) + '</p></div>' +
        '<div><span class="status" data-s="' + esc(a.status) + '">' + esc(a.status.replace(/_/g, ' ').toLowerCase()) + '</span> ' +
        '<button class="link" data-open="' + esc(a.id) + '" type="button">Open</button></div></div>';
    }).join('') + '</div>';
  }

  function wireList(v) {
    v.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { render('editor', b.getAttribute('data-open')); });
    });
  }

  /* ---------------- resume ---------------- */

  var token = heldToken();
  if (token) {
    api.setToken(token);
    api.call('me').then(function (res) { me = res; start(); })
      .catch(function (e) {
        if (e && e.code === 'unauthenticated') return;   // already dropped
        $('loginmsg').innerHTML =
          '<div class="msg err">Could not reach the engine just now. Your session is still valid — reload in a moment.</div>';
      });
  }
})();
