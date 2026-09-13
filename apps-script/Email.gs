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
    let status = 'SENT', error = '';
    try {
      MailApp.sendEmail({ to: to, subject: msg.subject, body: msg.body, name: this.brand_() });
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
    let status = 'SENT', error = '';
    try {
      MailApp.sendEmail({ to: to, subject: subject, body: body, name: this.brand_() });
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
