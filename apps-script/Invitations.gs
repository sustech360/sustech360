/** Invitations.gs — the Author Invitation Centre.
 *
 *  The platform has no public author registration and never will: there is no
 *  action anywhere that creates an AUTHOR account except acceptInvitation, and
 *  that requires a token this module generated and emailed.
 *
 *  Only the hash of the token is stored. A leaked spreadsheet cannot be used to
 *  accept an invitation, and the plaintext token exists only in the email.
 */
const Invitations = {

  list: function (session, payload) {
    Perms.require(session, 'INVITE_AUTHOR');
    const status = payload && payload.status;
    return Db.all('AuthorInvitations')
      .filter(i => !status || i.status === status)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(i => this.publicShape_(i, true));
  },

  create: function (session, p) {
    Perms.require(session, 'INVITE_AUTHOR', p.section);
    const email = String(p.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiFail('bad_email');
    if (!p.name) throw new ApiFail('name_required');
    if (Db.findOne('Users', { email: email })) throw new ApiFail('already_a_user', 'that email already has an account');
    const open = Db.find('AuthorInvitations', { email: email, status: 'PENDING' });
    if (open.length) throw new ApiFail('already_invited', 'a pending invitation exists; resend or revoke it');

    const token = Auth.randomToken();
    const days = Number(p.expiry_days || LIMITS.INVITE_DAYS);
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const inv = Db.insert('AuthorInvitations', {
      id: Db.newId('INV'), token_hash: Auth.hashToken(token),
      name: p.name, email: email, institution: p.institution || '', country: p.country || '',
      expertise: p.expertise || '', section: p.section || '', format: p.format || '',
      message: p.message || '', invited_by: session.user.id,
      expires_at: expires, status: 'PENDING'
    });

    this.dispatch_(session, inv, token);
    Audit.log(session, 'AUTHOR_INVITED', 'invitation', inv.id,
      { scope: p.section || '', meta: { email: email, expires_at: expires } });
    return this.publicShape_(inv, true);
  },

  /** Resending rotates the token: the old link stops working. That is the
   *  correct behaviour for a bearer credential, and it is why the old token
   *  cannot be "recovered" — nobody, including us, has it. */
  resend: function (session, p) {
    Perms.require(session, 'INVITE_AUTHOR');
    const inv = this.mustFind_(p.invitation_id);
    if (inv.status !== 'PENDING') throw new ApiFail('not_pending');
    const token = Auth.randomToken();
    const updated = Db.update('AuthorInvitations', { id: inv.id }, { token_hash: Auth.hashToken(token) });
    this.dispatch_(session, updated, token);
    Audit.log(session, 'INVITATION_RESENT', 'invitation', inv.id, { meta: { email: inv.email } });
    return { ok: true };
  },

  revoke: function (session, p) {
    Perms.require(session, 'INVITE_AUTHOR');
    const inv = this.mustFind_(p.invitation_id);
    if (inv.status === 'ACCEPTED') throw new ApiFail('already_accepted', 'suspend the account instead');
    // Overwriting the hash makes the emailed link dead immediately, not just
    // marked dead.
    Db.update('AuthorInvitations', { id: inv.id }, {
      status: 'REVOKED', revoked_at: new Date().toISOString(), token_hash: 'REVOKED-' + Utilities.getUuid()
    });
    if (p.notify) Email.send(inv.email, 'invitation_revoked', { author_name: inv.name }, session);
    Audit.log(session, 'INVITATION_REVOKED', 'invitation', inv.id,
      { prev: inv.status, next: 'REVOKED', reason: p.reason || '' });
    return { ok: true };
  },

  extend: function (session, p) {
    Perms.require(session, 'INVITE_AUTHOR');
    const inv = this.mustFind_(p.invitation_id);
    if (inv.status !== 'PENDING' && inv.status !== 'EXPIRED') throw new ApiFail('not_extendable');
    const days = Math.min(Number(p.days || LIMITS.INVITE_DAYS), 60);
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    Db.update('AuthorInvitations', { id: inv.id }, { status: 'PENDING', expires_at: expires });
    Audit.log(session, 'INVITATION_EXTENDED', 'invitation', inv.id,
      { prev: inv.expires_at, next: expires, reason: p.reason || '' });
    return { ok: true, expires_at: expires };
  },

  /* ---------------- unauthenticated: the acceptance page ---------------- */

  /** Returns just enough to render the acceptance page. Never returns the
   *  invitation to anyone without the token, and throttles guessing. */
  lookup: function (id, token) {
    this.throttle_(id);
    const inv = Db.findOne('AuthorInvitations', { id: String(id || '') });
    if (!inv || !Auth.equals(inv.token_hash, Auth.hashToken(token || ''))) {
      Utilities.sleep(400);
      throw new ApiFail('invalid_invitation');
    }
    if (inv.status === 'REVOKED') throw new ApiFail('invitation_revoked');
    if (inv.status === 'ACCEPTED') throw new ApiFail('invitation_used');
    if (new Date(inv.expires_at) < new Date()) {
      if (inv.status !== 'EXPIRED') Db.update('AuthorInvitations', { id: inv.id }, { status: 'EXPIRED' });
      throw new ApiFail('invitation_expired');
    }
    return this.publicShape_(inv, false);
  },

  /** The one and only path to an author account. */
  accept: function (id, token, p) {
    const inv = this.lookup(id, token);          // re-validates everything
    const row = Db.findOne('AuthorInvitations', { id: inv.id });
    Auth.assertPasswordStrength(p.password);
    if (Db.findOne('Users', { email: row.email })) throw new ApiFail('already_a_user');

    const salt = Auth.randomToken().slice(0, 24);
    const user = Db.insert('Users', {
      id: Db.newId('USR'), email: row.email, name: p.name || row.name,
      password_hash: Auth.hashPassword(p.password, salt), password_salt: salt,
      role_id: 'AUTHOR', status: 'ACTIVE',
      institution: p.institution || row.institution || '', country: p.country || row.country || '',
      mfa_enabled: false, session_epoch: 1, failed_attempts: 0
    });
    Db.insert('Authors', {
      id: Db.newId('AUT'), user_id: user.id, display_name: user.name,
      institution: user.institution, country: user.country,
      position: p.position || '', bio: '', interests: row.expertise || '',
      orcid: '', website: '', photo: '', public: false
    });
    Db.update('AuthorInvitations', { id: row.id }, {
      status: 'ACCEPTED', accepted_at: new Date().toISOString(),
      token_hash: 'USED-' + Utilities.getUuid()      // single use, enforced by data
    });

    Email.send(user.email, 'account_ready', { author_name: user.name }, null);
    Notifications.push(user.id, 'welcome', 'Start here',
      'Read the author guidelines, then create your first draft.', 'guidelines');
    Audit.log({ user: user }, 'INVITATION_ACCEPTED', 'invitation', row.id,
      { next: 'ACCEPTED', meta: { user_id: user.id } });
    return { ok: true, email: user.email };
  },

  /* ---------------- internals ---------------- */

  dispatch_: function (session, inv, token) {
    const url = CFG.get('SITE_URL') + 'accept.html?i=' + encodeURIComponent(inv.id) + '&t=' + encodeURIComponent(token);
    const inviter = Db.findOne('Users', { id: inv.invited_by });
    Email.send(inv.email, 'author_invitation', {
      author_name: inv.name,
      invitation_message: inv.message || '',
      section: inv.section || 'general',
      format: inv.format || 'article',
      accept_url: url,
      expiry_date: String(inv.expires_at).slice(0, 10),
      invited_by: inviter ? inviter.name : 'The editors'
    }, session);
  },

  mustFind_: function (id) {
    const inv = Db.findOne('AuthorInvitations', { id: String(id || '') });
    if (!inv) throw new ApiFail('not_found');
    return inv;
  },

  throttle_: function (id) {
    const cache = CacheService.getScriptCache();
    const key = 'inv:' + String(id).slice(0, 40);
    const n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), 3600);
    if (n > LIMITS.INVITE_LOOKUP_ATTEMPTS) throw new ApiFail('too_many_attempts');
  },

  /** `full` is for the control centre; the acceptance page gets less. */
  publicShape_: function (i, full) {
    const base = {
      id: i.id, name: i.name, institution: i.institution, section: i.section,
      format: i.format, message: i.message, expires_at: i.expires_at
    };
    if (!full) return base;
    return Object.assign(base, {
      email: i.email, country: i.country, expertise: i.expertise,
      invited_by: i.invited_by, created_at: i.created_at, status: i.status,
      accepted_at: i.accepted_at || '', revoked_at: i.revoked_at || ''
    });
  }
};

/** Marks lapsed invitations EXPIRED. Attach to a daily time trigger; correctness
 *  does not depend on it, since lookup() checks the date on every attempt. */
function expireInvitations() {
  const now = new Date();
  let n = 0;
  Db.find('AuthorInvitations', { status: 'PENDING' }).forEach(i => {
    if (new Date(i.expires_at) < now) { Db.update('AuthorInvitations', { id: i.id }, { status: 'EXPIRED' }); n++; }
  });
  return n + ' invitations expired';
}
