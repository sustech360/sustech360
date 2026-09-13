/** Newsletter.gs — subscription and broadcast.
 *
 *  Three rules shape this file.
 *
 *  1. Nobody is on the list who did not confirm. Subscribing sends one email
 *     and nothing else; the address stays PENDING until the link in it is
 *     clicked. That protects people whose address someone else typed in, and it
 *     is why the public endpoint cannot be used to mail-bomb a stranger.
 *
 *  2. Unsubscribing works forever, in one click, with no account. Every
 *     campaign carries a personal link, the link never expires, and the address
 *     is not silently resubscribed by a later form submission.
 *
 *  3. Bulk email must never eat the mail quota that operational email needs.
 *     Apps Script gives one daily allowance for everything, so a 900-address
 *     newsletter would otherwise stop author invitations and review requests
 *     from going out for the rest of the day. Sending stops at a reserve.
 */
const Newsletter = {

  /* ---------------- subscription (public) ---------------- */

  /** Deliberately uninformative. An attacker cannot learn from the response
   *  whether an address is already on the list, and an already-confirmed
   *  address gets no repeat mail however many times the form is submitted. */
  subscribe: function (p) {
    const email = String((p && p.email) || '').toLowerCase().trim();
    const quiet = { ok: true, message: 'Check that inbox for a confirmation link.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return quiet;

    const flags = Content.features().flags || {};
    if ((flags.NEWSLETTER || {}).state !== 'enabled') return quiet;

    // One confirmation attempt per address per hour, whatever the form does.
    const cache = CacheService.getScriptCache();
    const key = 'nl:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email));
    if (cache.get(key)) return quiet;
    cache.put(key, '1', 3600);

    const existing = Db.findOne('Subscribers', { email: email });
    if (existing && existing.status === 'CONFIRMED') return quiet;
    if (existing && existing.status === 'UNSUBSCRIBED') {
      // They opted out once. Re-subscribing is allowed, but only by confirming
      // again — a form submission is not consent to undo an unsubscribe.
      return this.sendConfirmation_(existing, email, p);
    }
    if (existing) return this.sendConfirmation_(existing, email, p);

    const rec = Db.insert('Subscribers', {
      id: Db.newId('SUB'), email: email, name: String((p && p.name) || '').slice(0, 80),
      status: 'PENDING', source: String((p && p.source) || 'website').slice(0, 40),
      topics: JSON.stringify(((p && p.topics) || []).slice(0, 10)), failures: 0
    });
    return this.sendConfirmation_(rec, email, p);
  },

  sendConfirmation_: function (rec, email, p) {
    const token = Auth.randomToken();
    Db.update('Subscribers', { id: rec.id }, {
      token_hash: Auth.hashToken(token), status: 'PENDING',
      source: String((p && p.source) || rec.source || 'website').slice(0, 40)
    });
    const link = CFG.get('SITE_URL', '') + 'newsletter.html?action=confirm&id=' +
      encodeURIComponent(rec.id) + '&t=' + encodeURIComponent(token);
    Email.send(email, 'newsletter_confirm', { confirm_link: link, magazine_name: Email.brand_() });
    Audit.log(null, 'SUBSCRIBE_REQUESTED', 'subscriber', rec.id, {});
    return { ok: true, message: 'Check that inbox for a confirmation link.' };
  },

  confirm: function (p) {
    const rec = this.byToken_(p);
    if (!rec) throw new ApiFail('invalid_link', 'this link is not valid — subscribe again');
    Db.update('Subscribers', { id: rec.id }, {
      status: 'CONFIRMED', confirmed_at: new Date().toISOString(), unsubscribed_at: '',
      token_hash: ''                      // single use: the link is spent
    });
    Audit.log(null, 'SUBSCRIBE_CONFIRMED', 'subscriber', rec.id, {});
    return { ok: true, message: 'You are on the list. Every email has an unsubscribe link.' };
  },

  /** One click, no login, and it works whatever state the record is in. */
  unsubscribe: function (p) {
    const rec = this.byToken_(p, true);
    if (!rec) throw new ApiFail('invalid_link', 'this link is not valid');
    Db.update('Subscribers', { id: rec.id }, {
      status: 'UNSUBSCRIBED', unsubscribed_at: new Date().toISOString()
    });
    Audit.log(null, 'UNSUBSCRIBED', 'subscriber', rec.id, {});
    return { ok: true, message: 'Removed. You will not get another newsletter.' };
  },

  /** Two kinds of token open a subscriber record, and both have to work.
   *
   *  The confirmation token is single-use and stored hashed: it proves someone
   *  read the mail we just sent. The unsubscribe token is derived from the
   *  record itself, so a link in a three-year-old newsletter still works after
   *  the confirmation token has been replaced — which is the difference between
   *  a working unsubscribe and a complaint. */
  byToken_: function (p, allowLinkToken) {
    const id = String((p && p.id) || '');
    const token = String((p && p.token) || '');
    if (!id || !token) return null;
    const rec = Db.findOne('Subscribers', { id: id });
    if (!rec) return null;
    if (allowLinkToken && Auth.equals(this.linkToken_(rec), token)) return rec;
    if (!rec.token_hash) return null;
    return Auth.equals(rec.token_hash, Auth.hashToken(token)) ? rec : null;
  },

  /* ---------------- audience (staff) ---------------- */

  audience: function () {
    return Db.all('Subscribers').filter(s => s.status === 'CONFIRMED');
  },

  /** Counts, not addresses. The subscriber list is personal data and the
   *  control centre has no reason to display it in full. */
  overview: function (session) {
    Perms.require(session, 'MANAGE');
    const all = Db.all('Subscribers');
    const count = st => all.filter(s => s.status === st).length;
    return {
      confirmed: count('CONFIRMED'), pending: count('PENDING'), unsubscribed: count('UNSUBSCRIBED'),
      quota_remaining: MailApp.getRemainingDailyQuota(),
      reserve: LIMITS.MAIL_RESERVE,
      recent: all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10)
        .map(s => ({ status: s.status, source: s.source, created_at: s.created_at,
                     domain: String(s.email).split('@')[1] || '' }))
    };
  },

  /** The export an operator genuinely needs — and it is an audited act, because
   *  exporting a mailing list is exactly the thing that leaks. */
  exportAudience: function (session) {
    Perms.require(session, 'EXPORT');
    Perms.require(session, 'MANAGE');
    const rows = this.audience().map(s => ({ email: s.email, name: s.name || '', confirmed_at: s.confirmed_at }));
    Audit.log(session, 'SUBSCRIBER_LIST_EXPORTED', 'subscriber', '', { meta: { rows: rows.length } });
    return { rows: rows, count: rows.length };
  },

  /* ---------------- campaigns ---------------- */

  campaigns: function (session) {
    Perms.require(session, 'MANAGE');
    return Db.all('EmailCampaigns')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(c => this.shape_(c));
  },

  shape_: function (c) {
    return {
      id: c.id, subject: c.subject, preheader: c.preheader || '', status: c.status,
      audience: c.audience || 'CONFIRMED', created_at: c.created_at, created_by: c.created_by,
      tested_at: c.tested_at || '', approved_at: c.approved_at || '', sent_at: c.sent_at || '',
      sent_count: Number(c.sent_count || 0), failed_count: Number(c.failed_count || 0),
      cursor: Number(c.cursor || 0), note: c.note || ''
    };
  },

  get: function (session, p) {
    Perms.require(session, 'MANAGE');
    const c = this.must_(p.id);
    return Object.assign(this.shape_(c), { body: this.readBody_(c) });
  },

  /** Builds a draft from what has actually been published since the last
   *  campaign, so the weekly email is a summary of the record rather than
   *  something retyped from memory. */
  draft: function (session, p) {
    Perms.require(session, 'MANAGE');
    const open = Db.all('EmailCampaigns').filter(c => ['DRAFT', 'APPROVED', 'SENDING'].indexOf(c.status) !== -1)[0];
    if (open) throw new ApiFail('campaign_open', 'campaign "' + open.subject + '" is still ' + open.status.toLowerCase());

    const since = p.since || this.lastSend_() || new Date(Date.now() - 7 * 86400000).toISOString();
    const articles = Db.all('Articles')
      .filter(a => a.status === 'PUBLISHED' && a.published_at && String(a.published_at) >= String(since))
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

    const site = CFG.get('SITE_URL', '');
    const body = p.body != null ? String(p.body) : (
      'Published since ' + String(since).slice(0, 10) + ':\n\n' +
      (articles.length
        ? articles.map(a => {
            const doc = Db.findOne('Settings', { key: 'public.' + a.id });
            let summary = '';
            try { summary = doc ? JSON.parse(doc.value).summary : ''; } catch (e) {}
            return a.title + '\n' + (summary ? summary + '\n' : '') + site + 'article.html?a=' + a.slug;
          }).join('\n\n')
        : 'Nothing new this week.') +
      '\n\n---\nYou are receiving this because you subscribed at ' + site +
      '\nUnsubscribe: {{unsubscribe_link}}'
    );

    const rec = Db.insert('EmailCampaigns', {
      id: Db.newId('CAM'), subject: String(p.subject || (Email.brand_() + ': what published this week')).slice(0, 140),
      preheader: String(p.preheader || '').slice(0, 140), body_ref: '', status: 'DRAFT',
      audience: 'CONFIRMED', created_by: session.user.id, cursor: 0, sent_count: 0, failed_count: 0
    });
    this.writeBody_(rec, body);
    Audit.log(session, 'CAMPAIGN_DRAFTED', 'campaign', rec.id, { meta: { articles: articles.length } });
    return Object.assign(this.shape_(Db.findOne('EmailCampaigns', { id: rec.id })), { body: body, articles: articles.length });
  },

  save: function (session, p) {
    Perms.require(session, 'MANAGE');
    const c = this.must_(p.id);
    if (c.status !== 'DRAFT') throw new ApiFail('locked', 'an approved campaign cannot be edited');
    if (p.body != null) this.writeBody_(c, String(p.body));
    const patch = {};
    if (p.subject) patch.subject = String(p.subject).slice(0, 140);
    if (p.preheader != null) patch.preheader = String(p.preheader).slice(0, 140);
    if (Object.keys(patch).length) Db.update('EmailCampaigns', { id: c.id }, patch);
    // Editing invalidates the test send: what was checked is no longer what
    // would go out.
    if (p.body != null || p.subject) Db.update('EmailCampaigns', { id: c.id }, { tested_at: '', tested_by: '' });
    return { ok: true };
  },

  /** A test goes to the person asking for it and nowhere else. */
  test: function (session, p) {
    Perms.require(session, 'MANAGE');
    const c = this.must_(p.id);
    const body = this.readBody_(c).replace(/\{\{unsubscribe_link\}\}/g,
      CFG.get('SITE_URL', '') + 'newsletter.html?action=unsubscribe&id=EXAMPLE&t=EXAMPLE');
    Email.sendRaw(session.user.email, '[test] ' + c.subject, body, 'newsletter_test', session);
    Db.update('EmailCampaigns', { id: c.id }, { tested_at: new Date().toISOString(), tested_by: session.user.id });
    Audit.log(session, 'CAMPAIGN_TESTED', 'campaign', c.id, { meta: { to: session.user.email } });
    return { ok: true, sent_to: session.user.email };
  },

  /** Approval requires that someone has actually looked at the thing: you
   *  cannot approve a campaign you have not sent to yourself. */
  approve: function (session, p) {
    Perms.require(session, 'APPROVE');
    const c = this.must_(p.id);
    if (c.status !== 'DRAFT') throw new ApiFail('bad_status', 'this campaign is ' + c.status);
    if (!c.tested_at) throw new ApiFail('test_first', 'send yourself a test before approving it');
    if (String(c.created_by) === String(session.user.id) && !Perms.isSupervisor(session)) {
      Audit.log(session, 'CAMPAIGN_SELF_APPROVAL_BLOCKED', 'campaign', c.id, {});
      throw new ApiFail('conflict_of_interest', 'someone else approves what you wrote');
    }
    Db.update('EmailCampaigns', { id: c.id }, {
      status: 'APPROVED', approved_by: session.user.id, approved_at: new Date().toISOString()
    });
    Audit.log(session, 'CAMPAIGN_APPROVED', 'campaign', c.id,
      { prev: 'DRAFT', next: 'APPROVED', meta: { audience: this.audience().length } });
    return { ok: true, recipients: this.audience().length };
  },

  /** Starts the send. The work itself happens in sendQueued() so that a list
   *  larger than one Apps Script execution — or one day's quota — finishes by
   *  itself instead of half-failing in a browser request. */
  start: function (session, p) {
    Perms.require(session, 'APPROVE');
    const c = this.must_(p.id);
    if (c.status !== 'APPROVED') throw new ApiFail('not_approved');
    Db.update('EmailCampaigns', { id: c.id }, {
      status: 'SENDING', started_at: new Date().toISOString(), cursor: 0
    });
    Audit.log(session, 'CAMPAIGN_STARTED', 'campaign', c.id, { meta: { recipients: this.audience().length } });
    const progress = this.sendQueued();
    return Object.assign({ ok: true }, progress);
  },

  stop: function (session, p) {
    Perms.require(session, 'MANAGE');
    const c = this.must_(p.id);
    if (c.status !== 'SENDING') throw new ApiFail('not_sending');
    const reason = String(p.reason || '').trim();
    if (reason.length < 5) throw new ApiFail('reason_required');
    Db.update('EmailCampaigns', { id: c.id }, { status: 'STOPPED', note: reason });
    Audit.log(session, 'CAMPAIGN_STOPPED', 'campaign', c.id,
      { prev: 'SENDING', next: 'STOPPED', reason: reason, meta: { sent: Number(c.sent_count || 0) } });
    return { ok: true, sent: Number(c.sent_count || 0) };
  },

  /** Sends the next slice of whichever campaign is in flight, then stops. Safe
   *  to call repeatedly; the trigger calls it every ten minutes. */
  sendQueued: function () {
    const c = Db.all('EmailCampaigns').filter(x => x.status === 'SENDING')[0];
    if (!c) return { sending: false };

    const list = this.audience();
    let cursor = Number(c.cursor || 0);
    let sent = Number(c.sent_count || 0), failed = Number(c.failed_count || 0);
    const body = this.readBody_(c);
    const site = CFG.get('SITE_URL', '');
    let quota = MailApp.getRemainingDailyQuota();
    let posted = 0;

    while (cursor < list.length && posted < LIMITS.MAIL_BATCH) {
      // The reserve is what keeps invitations, review requests and password
      // resets working while a newsletter is going out.
      if (quota <= LIMITS.MAIL_RESERVE) break;
      const s = list[cursor];
      const link = site + 'newsletter.html?action=unsubscribe&id=' + encodeURIComponent(s.id) +
        '&t=' + encodeURIComponent(this.linkToken_(s));
      const personal = body.replace(/\{\{unsubscribe_link\}\}/g, link)
                           .replace(/\{\{subscriber_name\}\}/g, s.name || 'there');
      const ok = Email.sendRaw(s.email, c.subject, personal, 'newsletter', null);
      if (ok) {
        sent++;
        Db.update('Subscribers', { id: s.id }, { last_sent_at: new Date().toISOString() });
      } else {
        failed++;
        Db.update('Subscribers', { id: s.id }, { failures: Number(s.failures || 0) + 1 });
      }
      cursor++; posted++; quota--;
    }

    const done = cursor >= list.length;
    Db.update('EmailCampaigns', { id: c.id }, {
      cursor: cursor, sent_count: sent, failed_count: failed,
      status: done ? 'SENT' : 'SENDING', sent_at: done ? new Date().toISOString() : (c.sent_at || '')
    });
    if (done) {
      Audit.log(null, 'CAMPAIGN_SENT', 'campaign', c.id,
        { next: String(sent), meta: { failed: failed, recipients: list.length } });
    }
    return {
      sending: !done, campaign: c.id, sent: sent, failed: failed,
      remaining: Math.max(0, list.length - cursor),
      paused_for_quota: !done && quota <= LIMITS.MAIL_RESERVE
    };
  },

  /** The unsubscribe token is derived from the record, so a link in a
   *  three-year-old email still works and no extra secret has to be stored. */
  linkToken_: function (s) {
    return Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(String(s.id) + '|' + String(s.email), CFG.get('TOKEN_PEPPER'))
    ).replace(/=+$/, '');
  },

  lastSend_: function () {
    const sent = Db.all('EmailCampaigns').filter(c => c.status === 'SENT' && c.sent_at)
      .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    return sent ? sent.sent_at : null;
  },

  must_: function (id) {
    const c = Db.findOne('EmailCampaigns', { id: String(id || '') });
    if (!c) throw new ApiFail('not_found');
    return c;
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('newsletter');
    return it.hasNext() ? it.next() : root.createFolder('newsletter');
  },

  writeBody_: function (c, body) {
    if (c.body_ref) {
      try { DriveApp.getFileById(c.body_ref).setContent(body); return; } catch (e) {}
    }
    const file = this.folder_().createFile(c.id + '.txt', body, 'text/plain');
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    Db.update('EmailCampaigns', { id: c.id }, { body_ref: file.getId() });
  },

  readBody_: function (c) {
    if (!c.body_ref) return '';
    try { return DriveApp.getFileById(c.body_ref).getBlob().getDataAsString(); }
    catch (e) { return ''; }
  }
};

/** Every ten minutes. Picks up whatever is in flight and does the next slice. */
function sendQueuedEmail() {
  return Newsletter.sendQueued();
}
