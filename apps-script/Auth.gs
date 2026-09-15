/** Auth.gs — passwords, sessions, MFA, lockout.
 *  A session token is a bearer credential: only its hash is stored, so a leaked
 *  spreadsheet cannot be used to impersonate anyone. */
const Auth = {

  randomToken: function () {
    // Apps Script exposes no CSPRNG. getUuid() is v4 (crypto-backed); two of
    // them plus a time salt, hashed, gives a token with adequate entropy.
    const raw = Utilities.getUuid() + Utilities.getUuid() + Date.now();
    return Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw)).replace(/=+$/, '');
  },

  hashPassword: function (password, salt) {
    let bytes = Utilities.newBlob(salt + '|' + password + '|' + CFG.get('PASSWORD_PEPPER')).getBytes();
    for (let i = 0; i < LIMITS.PBKDF_ITERATIONS; i++) {
      bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
    }
    return Utilities.base64Encode(bytes);
  },

  hashToken: function (token) {
    return Utilities.base64Encode(Utilities.computeHmacSha256Signature(token, CFG.get('TOKEN_PEPPER')));
  },

  equals: function (a, b) {
    a = String(a); b = String(b);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  },

  login: function (email, password, mfaCode, meta) {
    email = String(email || '').toLowerCase().trim();
    const user = Db.findOne('Users', { email: email });
    // Same response for unknown user and wrong password: no account enumeration.
    if (!user) { Utilities.sleep(400); throw new ApiFail('invalid_credentials'); }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new ApiFail('locked', 'try again later');
    }
    if (!this.isUsable(user)) throw new ApiFail('account_disabled');

    const ok = this.equals(user.password_hash, this.hashPassword(password, user.password_salt));
    if (!ok) {
      const fails = Number(user.failed_attempts || 0) + 1;
      const patch = { failed_attempts: fails };
      if (fails >= LIMITS.MAX_LOGIN_FAILURES) {
        patch.locked_until = new Date(Date.now() + LIMITS.LOCKOUT_MINUTES * 60000).toISOString();
        patch.failed_attempts = 0;
      }
      Db.update('Users', { id: user.id }, patch);
      Audit.log({ user: user }, 'LOGIN_FAILED', 'user', user.id, { meta: meta || {} });
      throw new ApiFail('invalid_credentials');
    }

    if (user.mfa_enabled === true || user.mfa_enabled === 'TRUE') {
      if (!this.verifyTotp(user.mfa_secret, mfaCode)) throw new ApiFail('mfa_required');
    }

    Db.update('Users', { id: user.id }, { failed_attempts: 0, locked_until: '' });

    const token = this.randomToken();
    Db.insert('Sessions', {
      id: Db.newId('SES'), token_hash: this.hashToken(token), user_id: user.id,
      epoch: user.session_epoch || 1,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + LIMITS.SESSION_HOURS * 3600000).toISOString(),
      ip: (meta && meta.ip) || '', user_agent: (meta && meta.ua) || ''
    });
    Audit.log({ user: user }, 'LOGIN', 'user', user.id, { meta: meta || {} });

    return {
      token: token,
      expires_at: new Date(Date.now() + LIMITS.SESSION_HOURS * 3600000).toISOString(),
      user: this.publicUser(user),
      must_change_password: user.status === 'PASSWORD_RESET_REQUIRED',
      permissions: Perms.effective(user)
    };
  },

  /** Resolves a bearer token to a session, or null. Never throws for a bad
   *  token — the router decides what to tell the caller. */
  session: function (token) {
    if (!token) return null;
    const rec = Db.findOne('Sessions', { token_hash: this.hashToken(token) });
    if (!rec || rec.revoked_at) return null;
    if (new Date(rec.expires_at) < new Date()) return null;
    const user = Db.findOne('Users', { id: rec.user_id });
    if (!Auth.isUsable(user)) return null;
    // "Log out all devices" bumps session_epoch, invalidating older sessions.
    if (Number(rec.epoch || 1) !== Number(user.session_epoch || 1)) return null;
    return { record: rec, user: user };
  },

  logout: function (session) {
    Db.update('Sessions', { id: session.record.id }, { revoked_at: new Date().toISOString() });
    Audit.log(session, 'LOGOUT', 'user', session.user.id, {});
  },

  logoutEverywhere: function (session) {
    Db.update('Users', { id: session.user.id }, { session_epoch: Number(session.user.session_epoch || 1) + 1 });
    Audit.log(session, 'LOGOUT_ALL_DEVICES', 'user', session.user.id, {});
  },

  changePassword: function (session, current, next) {
    if (!this.equals(session.user.password_hash, this.hashPassword(current, session.user.password_salt))) {
      throw new ApiFail('invalid_credentials');
    }
    this.assertPasswordStrength(next);
    const salt = this.randomToken().slice(0, 24);
    Db.update('Users', { id: session.user.id }, {
      password_salt: salt, password_hash: this.hashPassword(next, salt),
      status: session.user.status === 'PASSWORD_RESET_REQUIRED' ? 'ACTIVE' : session.user.status,
      session_epoch: Number(session.user.session_epoch || 1) + 1
    });
    Audit.log(session, 'PASSWORD_CHANGED', 'user', session.user.id, {});
    return { ok: true, reauthenticate: true };
  },

  assertPasswordStrength: function (pw) {
    pw = String(pw || '');
    if (pw.length < 12) throw new ApiFail('weak_password', 'use at least 12 characters');
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      throw new ApiFail('weak_password', 'mix upper case, lower case and digits');
    }
  },

  /** The single definition of a usable account. A user who has not yet chosen
   *  their own password can still sign in and work — that is the whole point of
   *  the temporary password — so only suspension and revocation disable them.
   *  Everything that asks "can this person be given work" asks here. */
  isUsable: function (u) {
    return !!u && ['SUSPENDED', 'REVOKED', 'DELETED'].indexOf(String(u.status)) === -1;
  },

  publicUser: function (u) {
    return { id: u.id, email: u.email, name: u.name, role_id: u.role_id, status: u.status,
             institution: u.institution || '', mfa_enabled: u.mfa_enabled === true || u.mfa_enabled === 'TRUE' };
  },

  /* ---- TOTP (RFC 6238, SHA-1, 6 digits, 30s step, +/-1 window) ---- */

  verifyTotp: function (secretBase32, code) {
    if (!secretBase32 || !code) return false;
    const key = this.base32Decode(secretBase32);
    const counter = Math.floor(Date.now() / 30000);
    for (let w = -1; w <= 1; w++) {
      if (this.equals(this.totpAt(key, counter + w), String(code).trim())) return true;
    }
    return false;
  },

  totpAt: function (key, counter) {
    const msg = [];
    for (let i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter = Math.floor(counter / 256); }
    const h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, msg, key);
    const off = h[h.length - 1] & 0x0f;
    const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) |
                ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
    return String(bin % 1000000).padStart(6, '0');
  },

  /* ---- enrolling in two-factor ----
     A secret is generated, shown once, and only becomes real when the person
     types back a code from it. Until that moment the account is untouched, so
     an abandoned setup leaves nothing half-enabled. */

  base32Encode: function (bytes) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0, out = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | (bytes[i] & 0xff);
      bits += 8;
      while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += A[(value << (5 - bits)) & 31];
    return out;
  },

  /** Begins enrolment: a fresh secret, stored but not yet in force. */
  beginMfa: function (session) {
    const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Date.now()).slice(0, 20);
    const secret = this.base32Encode(raw);
    Db.update('Users', { id: session.user.id }, { mfa_secret: secret, mfa_enabled: false });
    const label = encodeURIComponent('S360 Editorial Studio') + ':' + encodeURIComponent(session.user.email);
    Audit.log(session, 'MFA_ENROLMENT_STARTED', 'user', session.user.id, {});
    return {
      secret: secret,
      otpauth: 'otpauth://totp/' + label + '?secret=' + secret +
               '&issuer=' + encodeURIComponent('S360 Editorial Studio') + '&period=30&digits=6'
    };
  },

  /** Turns it on, but only once a code proves the app and the secret agree.
   *  Enabling on trust would lock the person out of their own account. */
  enableMfa: function (session, code) {
    const user = Db.findOne('Users', { id: session.user.id });
    if (!user || !user.mfa_secret) throw new ApiFail('not_started', 'start the setup first');
    if (!this.verifyTotp(user.mfa_secret, code)) throw new ApiFail('bad_code', 'that code did not match');
    Db.update('Users', { id: user.id }, { mfa_enabled: true });
    Audit.log(session, 'MFA_ENABLED', 'user', user.id, {});
    return { ok: true, enabled: true };
  },

  /** Turning it off needs a current code too: someone at a borrowed keyboard
   *  should not be able to remove it. */
  disableMfa: function (session, code) {
    const user = Db.findOne('Users', { id: session.user.id });
    if (!user || !(user.mfa_enabled === true || user.mfa_enabled === 'TRUE')) {
      throw new ApiFail('not_enabled');
    }
    if (!this.verifyTotp(user.mfa_secret, code)) throw new ApiFail('bad_code');
    Db.update('Users', { id: user.id }, { mfa_enabled: false, mfa_secret: '' });
    Audit.log(session, 'MFA_DISABLED', 'user', user.id, {});
    return { ok: true, enabled: false };
  },

  mfaState: function (session) {
    const user = Db.findOne('Users', { id: session.user.id });
    return {
      enabled: !!user && (user.mfa_enabled === true || user.mfa_enabled === 'TRUE'),
      started: !!(user && user.mfa_secret)
    };
  },

  base32Decode: function (s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    s = String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    let bits = 0, value = 0; const out = [];
    for (let i = 0; i < s.length; i++) {
      const idx = A.indexOf(s[i]);
      if (idx === -1) continue;
      value = (value << 5) | idx; bits += 5;
      if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
    }
    return out.map(b => (b > 127 ? b - 256 : b));  // Apps Script wants signed bytes
  }
};
