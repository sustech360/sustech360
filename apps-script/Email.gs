/** Email.gs — every outgoing message goes through here so every outgoing
 *  message is logged. Templates live in the EmailTemplates sheet once the email
 *  centre is built (phase 7); until then the defaults below are used, and the
 *  substitution contract is already the one the spec defines.
 */
const Email = {

  DEFAULTS: {
    author_invitation: {
      subject: 'An invitation to write for {{magazine_name}}',
      body:
        'Dear {{author_name}},\n\n' +
        '{{invitation_message}}\n\n' +
        'We would like to invite you to contribute to {{magazine_name}} as an invited author, ' +
        'writing for our {{section}} section in the {{format}} format.\n\n' +
        'Accept the invitation here:\n{{accept_url}}\n\n' +
        'The link is personal to you and expires on {{expiry_date}}. If it lapses, ask us to send another.\n\n' +
        'Questions go to {{contact_email}}.\n\n' +
        '{{invited_by}}\n{{magazine_name}}'
    },
    invitation_revoked: {
      subject: 'Your invitation to {{magazine_name}} has been withdrawn',
      body: 'Dear {{author_name}},\n\nThe invitation we sent you has been withdrawn and the link no longer works.\n\n' +
            'If this is unexpected, reply to {{contact_email}}.\n\n{{magazine_name}}'
    },
    account_ready: {
      subject: 'Your author account is active',
      body: 'Dear {{author_name}},\n\nYour author account is ready. Sign in at {{portal_url}}.\n\n' +
            'Read the author guidelines before you start writing; they set out format, referencing and image permissions.\n\n{{magazine_name}}'
    },
    article_submitted: {
      subject: 'Received: {{article_title}}',
      body: 'Dear {{author_name}},\n\nWe have your submission "{{article_title}}" ({{article_id}}).\n\n' +
            'It goes to an editor first, then to review. You will hear from us when there is a decision or a request for revisions. ' +
            'You can follow its status in the author portal.\n\n{{magazine_name}}'
    },
    revision_requested: {
      subject: 'Revisions requested: {{article_title}}',
      body: 'Dear {{author_name}},\n\nThe editors have asked for revisions to "{{article_title}}" ({{article_id}}).\n\n' +
            'What they said:\n{{editor_note}}\n\n' +
            'Open the article in the portal to revise and resubmit: {{portal_url}}\n\n{{magazine_name}}'
    },
    article_rejected: {
      subject: 'Decision on {{article_title}}',
      body: 'Dear {{author_name}},\n\nAfter review we will not be publishing "{{article_title}}" ({{article_id}}).\n\n' +
            'The reasoning:\n{{editor_note}}\n\n' +
            'This decision is about fit and readiness, not about you as a contributor. ' +
            'We would welcome a different piece from you.\n\n{{magazine_name}}'
    },
    review_request: {
      subject: 'Review requested: {{article_title}}',
      body: 'Dear {{reviewer_name}},\n\nWe would like your review of "{{article_title}}" ({{article_id}}), due {{due_date}}.\n\n' +
            'Open it here: {{admin_url}}\n\n' +
            'If you have a conflict of interest, tell us instead of reviewing.\n\n{{magazine_name}}'
    },
    article_published: {
      subject: 'Published: {{article_title}}',
      body: 'Dear {{author_name}},\n\n"{{article_title}}" is live as of {{publication_date}}.\n\n' +
            '{{article_url}}\n\nThank you for writing for us.\n\n{{magazine_name}}'
    },
    emergency_access: {
      subject: 'Emergency access granted to {{subject_name}}',
      body: '{{granted_by}} granted {{subject_name}} the {{permission}} permission for {{hours}} hours.\n\n' +
            'Reason given:\n{{reason}}\n\n' +
            'It expires by itself. To end it sooner, open the delegation screen: {{admin_url}}\n\n{{magazine_name}}'
    },
    newsletter_confirm: {
      subject: 'Confirm your subscription to {{magazine_name}}',
      body: 'Someone — we hope you — asked for the {{magazine_name}} newsletter at this address.\n\n' +
            'Confirm it here and we will start sending:\n{{confirm_link}}\n\n' +
            'If it was not you, ignore this. Nothing happens without that click, and we will not write again.\n\n' +
            '{{magazine_name}}'
    },
    submission_alert: {
      subject: 'New submission: {{article_title}}',
      body: '{{author_name}} submitted "{{article_title}}" ({{article_id}}) to {{section}}.\n\nReview queue: {{admin_url}}'
    }
  },

  /** Renders a template. Unknown variables become empty strings rather than
   *  leaking "{{...}}" into a reader's inbox. */
  /* ---------------- who it comes from ----------------
     Apps Script sends as the account that deployed the engine, and no amount
     of configuration changes that. What can be set is the name a reader sees
     and the address their reply goes to — which is what actually matters:
     a review query should reach the editors, an invoice query should not.

     Identities are named so a template can say "this comes from the editors"
     without repeating an address in twelve places. */

  DEFAULT_IDENTITIES: {
    editorial: { label: 'Editorial', name: '', reply_to: '' },
    reviews:   { label: 'Peer review', name: '', reply_to: '' },
    authors:   { label: 'Author relations', name: '', reply_to: '' },
    newsletter:{ label: 'Newsletter', name: '', reply_to: '' },
    billing:   { label: 'Accounts', name: '', reply_to: '' },
    security:  { label: 'Security', name: '', reply_to: '' }
  },

  /** Which identity each message goes out under, unless a template says
   *  otherwise. Changing one of these changes a dozen messages at once. */
  DEFAULT_IDENTITY_FOR: {
    author_invitation: 'authors', invitation_revoked: 'authors', account_ready: 'authors',
    article_submitted: 'editorial', submission_alert: 'editorial',
    revision_requested: 'editorial', article_rejected: 'editorial', article_published: 'editorial',
    review_request: 'reviews',
    newsletter_confirm: 'newsletter', newsletter: 'newsletter',
    emergency_access: 'security'
  },

  /** What each template may use. The editor shows this beside the box, because
   *  a variable nobody knows about is a variable nobody uses. */
  VARIABLES: {
    author_invitation: ['author_name', 'invited_by', 'section', 'format', 'message', 'accept_link', 'expires'],
    invitation_revoked: ['author_name', 'reason'],
    account_ready: ['author_name', 'portal_url'],
    article_submitted: ['author_name', 'article_title', 'article_id'],
    submission_alert: ['author_name', 'article_title', 'article_id', 'admin_url'],
    revision_requested: ['author_name', 'article_title', 'article_id', 'editor_note', 'portal_url'],
    article_rejected: ['author_name', 'article_title', 'article_id', 'editor_note'],
    review_request: ['reviewer_name', 'article_title', 'article_id', 'due_date', 'admin_url'],
    article_published: ['author_name', 'article_title', 'article_url', 'publication_date'],
    newsletter_confirm: ['confirm_link'],
    emergency_access: ['user_name', 'permission', 'hours', 'reason']
  },

  identities: function () {
    const row = Db.findOne('Settings', { key: 'email.identities' });
    let saved = {};
    if (row) { try { saved = JSON.parse(row.value); } catch (e) {} }
    const out = {};
    Object.keys(this.DEFAULT_IDENTITIES).forEach(key => {
      out[key] = Object.assign({}, this.DEFAULT_IDENTITIES[key], saved[key] || {});
      if (!out[key].name) out[key].name = this.brand_();
      if (!out[key].reply_to) out[key].reply_to = CFG.get('BOOTSTRAP_EMAIL', '');
    });
    return out;
  },

  identityFor_: function (key) {
    const row = Db.findOne('EmailTemplates', { key: key, status: 'PUBLISHED' });
    const named = (row && row.identity) || this.DEFAULT_IDENTITY_FOR[key] || 'editorial';
    const all = this.identities();
    return all[named] || all.editorial;
  },

  render: function (key, vars) {
    const row = Db.findOne('EmailTemplates', { key: key, status: 'PUBLISHED' });
    let t = this.DEFAULTS[key] || { subject: key, body: '' };
    if (row && row.body_ref) {
      try { t = { subject: row.subject, body: DriveApp.getFileById(row.body_ref).getBlob().getDataAsString() }; }
      catch (e) { console.error('template ' + key + ' unreadable, using default'); }
    }
    const base = {
      magazine_name: this.brand_(),
      contact_email: CFG.get('BOOTSTRAP_EMAIL', ''),
      portal_url: CFG.get('SITE_URL', '') + 'author/',
      admin_url: CFG.get('SITE_URL', '') + 'admin/',
      unsubscribe_link: ''
    };
    const all = Object.assign(base, vars || {});
    const fill = s => String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (all[k] == null ? '' : String(all[k])));
    return { subject: fill(t.subject), body: fill(t.body) };
  },

  send: function (to, key, vars, session) {
    const msg = this.render(key, vars);
    const who = this.identityFor_(key);
    let status = 'SENT', error = '';
    try {
      const envelope = { to: to, subject: msg.subject, body: msg.body, name: who.name || this.brand_() };
      // The reply address is the one setting that decides whether an answer
      // reaches a person or an unread mailbox.
      if (who.reply_to) envelope.replyTo = who.reply_to;
      MailApp.sendEmail(envelope);
    } catch (e) {
      status = 'FAILED';
      error = e.message;
      console.error('email ' + key + ' to ' + to + ' failed: ' + e.message);
    }
    Db.insert('EmailLogs', {
      id: Db.newId('EML'), to: to, template: key, subject: msg.subject,
      status: status, error: error, sent_at: new Date().toISOString(),
      sent_by: session ? session.user.id : 'SYSTEM'
    });
    return status === 'SENT';
  },

  /** Sends an already-composed message. The newsletter needs this because its
   *  body is written in the composer rather than stored as a template — but it
   *  still goes through the same log, so "what did we send and to whom" has one
   *  answer. Returns whether it went, never throws: one bad address must not
   *  stop a send halfway through a list. */
  sendRaw: function (to, subject, body, kind, session) {
    const who = this.identityFor_(kind || 'newsletter');
    let status = 'SENT', error = '';
    try {
      const envelope = { to: to, subject: subject, body: body, name: who.name || this.brand_() };
      if (who.reply_to) envelope.replyTo = who.reply_to;
      MailApp.sendEmail(envelope);
    } catch (e) {
      status = 'FAILED';
      error = e.message;
    }
    Db.insert('EmailLogs', {
      id: Db.newId('EML'), to: to, template: kind || 'raw', subject: subject,
      status: status, error: error, sent_at: new Date().toISOString(),
      sent_by: session ? session.user.id : 'SYSTEM'
    });
    return status === 'SENT';
  },

  brand_: function () {
    const s = Db.findOne('Settings', { key: 'brand.name' });
    return (s && s.value) || 'Magazine';
  }
};

/** EmailCentre — managing the templates, rather than sending with them.
 *
 *  Every message the platform sends is editable here: the words, the subject,
 *  and which identity it goes out under. A template that has never been edited
 *  falls back to the built-in text, so nothing is ever blank and a bad edit can
 *  be undone by resetting it.
 */
const EmailCentre = {

  /** Every message the platform can send, whether or not it has been edited. */
  list: function (session) {
    Perms.require(session, 'MANAGE');
    const identities = Email.identities();
    return Object.keys(Email.DEFAULTS).sort().map(key => {
      const row = Db.findOne('EmailTemplates', { key: key, status: 'PUBLISHED' });
      const named = (row && row.identity) || Email.DEFAULT_IDENTITY_FOR[key] || 'editorial';
      return {
        key: key,
        subject: (row && row.subject) || Email.DEFAULTS[key].subject,
        customised: !!row,
        identity: named,
        identity_label: (identities[named] || {}).label || named,
        updated_at: (row && row.updated_at) || '',
        updated_by: (row && row.updated_by) || '',
        variables: Email.VARIABLES[key] || []
      };
    });
  },

  get: function (session, p) {
    Perms.require(session, 'MANAGE');
    const key = String(p.key || '');
    if (!Email.DEFAULTS[key]) throw new ApiFail('unknown_template', key);
    const row = Db.findOne('EmailTemplates', { key: key, status: 'PUBLISHED' });
    let body = Email.DEFAULTS[key].body;
    if (row && row.body_ref) {
      try { body = DriveApp.getFileById(row.body_ref).getBlob().getDataAsString(); } catch (e) {}
    }
    return {
      key: key,
      subject: (row && row.subject) || Email.DEFAULTS[key].subject,
      body: body,
      identity: (row && row.identity) || Email.DEFAULT_IDENTITY_FOR[key] || 'editorial',
      customised: !!row,
      variables: Email.VARIABLES[key] || [],
      default_subject: Email.DEFAULTS[key].subject,
      default_body: Email.DEFAULTS[key].body
    };
  },

  save: function (session, p) {
    Perms.require(session, 'MANAGE');
    const key = String(p.key || '');
    if (!Email.DEFAULTS[key]) throw new ApiFail('unknown_template', key);
    const subject = String(p.subject || '').trim();
    const body = String(p.body || '').trim();
    if (subject.length < 3) throw new ApiFail('subject_required');
    if (body.length < 20) throw new ApiFail('body_too_short', 'a message needs more than a line');

    // A variable that does not exist renders as nothing, so the reader gets a
    // sentence with a hole in it. Better to refuse the save.
    const known = (Email.VARIABLES[key] || []).concat(
      ['magazine_name', 'contact_email', 'portal_url', 'admin_url', 'unsubscribe_link', 'subscriber_name']);
    const used = (subject + ' ' + body).match(/\{\{(\w+)\}\}/g) || [];
    const unknown = used.map(v => v.replace(/[{}]/g, '')).filter(v => known.indexOf(v) === -1);
    if (unknown.length) {
      throw new ApiFail('unknown_variable', unknown.join(', ') + ' — available: ' + known.join(', '));
    }
    const identity = String(p.identity || Email.DEFAULT_IDENTITY_FOR[key] || 'editorial');
    if (!Email.identities()[identity]) throw new ApiFail('unknown_identity', identity);

    const existing = Db.findOne('EmailTemplates', { key: key, status: 'PUBLISHED' });
    const folder = this.folder_();
    let ref = existing && existing.body_ref;
    if (ref) {
      try { DriveApp.getFileById(ref).setContent(body); } catch (e) { ref = null; }
    }
    if (!ref) {
      const file = folder.createFile(key + '.txt', body, 'text/plain');
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      ref = file.getId();
    }

    if (existing) {
      Db.update('EmailTemplates', { id: existing.id }, {
        subject: subject, body_ref: ref, identity: identity,
        version: Number(existing.version || 1) + 1,
        updated_at: new Date().toISOString(), updated_by: session.user.id
      });
    } else {
      Db.insert('EmailTemplates', {
        id: Db.newId('TPL'), key: key, subject: subject, body_ref: ref, identity: identity,
        version: 1, status: 'PUBLISHED', updated_at: new Date().toISOString(),
        updated_by: session.user.id
      });
    }
    Audit.log(session, 'EMAIL_TEMPLATE_SAVED', 'email', key,
      { next: identity, meta: { subject: subject } });
    return { ok: true, key: key };
  },

  /** Back to the built-in wording. The edited version is not kept — the point
   *  of reset is to stop wondering what the current text is. */
  reset: function (session, p) {
    Perms.require(session, 'MANAGE');
    const key = String(p.key || '');
    const row = Db.findOne('EmailTemplates', { key: key, status: 'PUBLISHED' });
    if (!row) throw new ApiFail('not_customised');
    Db.update('EmailTemplates', { id: row.id }, { status: 'ARCHIVED' });
    Audit.log(session, 'EMAIL_TEMPLATE_RESET', 'email', key, { prev: String(row.version) });
    return { ok: true };
  },

  /** What a real message would look like, with plausible values in it. */
  preview: function (session, p) {
    Perms.require(session, 'MANAGE');
    const key = String(p.key || '');
    if (!Email.DEFAULTS[key]) throw new ApiFail('unknown_template', key);
    const sample = {
      author_name: 'R. Menon', reviewer_name: 'A. Reviewer', user_name: 'A. Editor',
      invited_by: session.user.name, section: 'Energy storage', format: 'Research Highlight',
      message: 'We would like a piece on sodium-ion anodes.',
      accept_link: CFG.get('SITE_URL', '') + 'accept.html?i=INV-EXAMPLE&t=example',
      expires: '14 days', article_title: 'Hard carbon and the sodium-ion ceiling',
      article_id: 'MAG-2026-000124',
      article_url: CFG.get('SITE_URL', '') + 'article.html?a=hard-carbon',
      publication_date: new Date().toISOString().slice(0, 10),
      editor_note: 'Add a figure for first-cycle efficiency.',
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      reason: 'Covering a correction out of hours.', permission: 'ARCHIVE', hours: '4',
      confirm_link: CFG.get('SITE_URL', '') + 'newsletter.html?action=confirm&id=X&t=Y',
      subscriber_name: 'there', unsubscribe_link: CFG.get('SITE_URL', '') + 'newsletter.html?action=unsubscribe'
    };
    // Preview whatever is in the editor, not only what is saved.
    if (p.subject || p.body) {
      const fill = s => String(s || '').replace(/\{\{(\w+)\}\}/g, (m, k) =>
        (sample[k] == null ? (k === 'magazine_name' ? Email.brand_() : '') : sample[k]));
      const who = Email.identities()[p.identity] || Email.identityFor_(key);
      return { subject: fill(p.subject), body: fill(p.body), from: who.name, reply_to: who.reply_to };
    }
    const msg = Email.render(key, sample);
    const who = Email.identityFor_(key);
    return { subject: msg.subject, body: msg.body, from: who.name, reply_to: who.reply_to };
  },

  /** Sends the real thing to the person asking, and nobody else. */
  sendTest: function (session, p) {
    Perms.require(session, 'MANAGE');
    const preview = this.preview(session, p);
    const sent = Email.sendRaw(session.user.email, '[test] ' + preview.subject,
      preview.body, 'template_test', session);
    Audit.log(session, 'EMAIL_TEST_SENT', 'email', String(p.key || ''), { meta: { to: session.user.email } });
    return { ok: sent, sent_to: session.user.email };
  },

  saveIdentities: function (session, p) {
    Perms.require(session, 'MANAGE');
    const current = Email.identities();
    const next = {};
    Object.keys(current).forEach(key => {
      const given = (p.identities || {})[key] || {};
      const name = String(given.name === undefined ? current[key].name : given.name).trim();
      const reply = String(given.reply_to === undefined ? current[key].reply_to : given.reply_to).trim();
      if (reply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reply)) {
        throw new ApiFail('bad_email', key + ': ' + reply);
      }
      next[key] = { label: current[key].label, name: name.slice(0, 80), reply_to: reply };
    });
    const value = JSON.stringify(next);
    const row = Db.findOne('Settings', { key: 'email.identities' });
    if (row) Db.update('Settings', { key: 'email.identities' }, { value: value, updated_by: session.user.id });
    else Db.insert('Settings', { key: 'email.identities', value: value, scope: 'editorial', updated_by: session.user.id });
    Audit.log(session, 'EMAIL_IDENTITIES_SAVED', 'email', '', { meta: { count: Object.keys(next).length } });
    return { ok: true, identities: next };
  },

  /** What actually went out. The answer to "did they get it?" */
  log: function (session, p) {
    Perms.require(session, 'MANAGE');
    const limit = Math.min(Number((p && p.limit) || 60), 300);
    return Db.all('EmailLogs')
      .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
      .slice(0, limit)
      .map(l => ({
        to: l.to, template: l.template, subject: l.subject, status: l.status,
        error: l.error || '', sent_at: l.sent_at
      }));
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('email-templates');
    return it.hasNext() ? it.next() : root.createFolder('email-templates');
  }
};
