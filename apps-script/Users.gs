/** Users.gs — user administration and the supervisor-admin invariants.
 *  These checks exist here, on the server, and nowhere else matters. */
const Users = {

  list: function (session) {
    Perms.require(session, 'MANAGE');
    return Db.all('Users').map(Auth.publicUser);
  },

  invite: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const roleId = String(payload.role_id || 'AUTHOR');
    this.assertRoleAssignable_(session, roleId);
    const email = String(payload.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiFail('bad_email');
    if (Db.findOne('Users', { email: email })) throw new ApiFail('already_exists');

    const temp = Auth.randomToken().slice(0, 16);
    const salt = Auth.randomToken().slice(0, 24);
    const user = Db.insert('Users', {
      id: Db.newId('USR'), email: email, name: payload.name || email,
      password_hash: Auth.hashPassword(temp, salt), password_salt: salt,
      role_id: roleId, status: 'PASSWORD_RESET_REQUIRED',
      institution: payload.institution || '', country: payload.country || '',
      mfa_enabled: false, session_epoch: 1, failed_attempts: 0
    });
    MailApp.sendEmail(email, 'Your account on ' + CFG.get('SITE_URL'),
      'An account has been created for you.\n\nTemporary password: ' + temp +
      '\n\nSign in at ' + CFG.get('SITE_URL') + 'admin/ and change it immediately.');
    Audit.log(session, 'USER_INVITED', 'user', user.id, { meta: { role: roleId } });
    return Auth.publicUser(user);
  },

  setRole: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const target = Db.findOne('Users', { id: payload.user_id });
    if (!target) throw new ApiFail('not_found');
    const newRole = String(payload.role_id);

    // Invariant 3: nobody can create or promote a supervisor admin.
    this.assertRoleAssignable_(session, newRole);
    // Invariant: a supervisor admin can only be modified by themselves.
    if (target.role_id === SUPERVISOR_ROLE && target.id !== session.user.id) {
      Audit.log(session, 'SUPERVISOR_MODIFY_BLOCKED', 'user', target.id, {});
      throw new ApiFail('forbidden', 'the supervisor admin cannot be modified by another account');
    }
    // Nobody changes their own role, supervisor included: no silent escalation.
    if (target.id === session.user.id) throw new ApiFail('forbidden', 'you cannot change your own role');

    Db.update('Users', { id: target.id }, { role_id: newRole });
    Audit.log(session, 'ROLE_CHANGED', 'user', target.id,
      { prev: target.role_id, next: newRole, reason: payload.reason || '' });
    return { ok: true };
  },

  suspend: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const target = Db.findOne('Users', { id: payload.user_id });
    if (!target) throw new ApiFail('not_found');
    if (target.role_id === SUPERVISOR_ROLE) {
      Audit.log(session, 'SUPERVISOR_LOCKOUT_BLOCKED', 'user', target.id, {});
      throw new ApiFail('forbidden', 'the supervisor admin cannot be suspended');
    }
    if (!payload.reason) throw new ApiFail('reason_required');
    Db.update('Users', { id: target.id }, {
      status: 'SUSPENDED', session_epoch: Number(target.session_epoch || 1) + 1
    });
    Audit.log(session, 'USER_SUSPENDED', 'user', target.id, { prev: target.status, next: 'SUSPENDED', reason: payload.reason });
    return { ok: true };
  },

  reactivate: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const target = Db.findOne('Users', { id: payload.user_id });
    if (!target) throw new ApiFail('not_found');
    Db.update('Users', { id: target.id }, { status: 'ACTIVE' });
    Audit.log(session, 'USER_REACTIVATED', 'user', target.id, { prev: target.status, next: 'ACTIVE' });
    return { ok: true };
  },

  /** Temporary delegation. Expiry is enforced at read time by Perms.effective,
   *  so a grant that lapses stops working without a cleanup job. */
  grant: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const permission = String(payload.permission);
    if (PERMISSIONS.indexOf(permission) === -1) throw new ApiFail('unknown_permission');
    if (SUPERVISOR_ONLY.indexOf(permission) !== -1) {
      Audit.log(session, 'FINAL_PUBLISH_GRANT_BLOCKED', 'user', payload.user_id, {});
      throw new ApiFail('forbidden', permission + ' cannot be delegated');
    }
    if (!payload.expires_at) throw new ApiFail('expiry_required');
    if (!payload.reason) throw new ApiFail('reason_required');
    const g = Db.insert('UserGrants', {
      id: Db.newId('GRT'), user_id: payload.user_id, permission: permission,
      scope: payload.scope || '*', starts_at: payload.starts_at || new Date().toISOString(),
      expires_at: payload.expires_at, reason: payload.reason, granted_by: session.user.id
    });
    Audit.log(session, 'PERMISSION_GRANTED', 'user', payload.user_id,
      { next: permission, scope: payload.scope || '*', reason: payload.reason, meta: { expires_at: payload.expires_at } });
    return { ok: true, id: g.id };
  },

  /** Everything currently delegated, with the ones that have lapsed marked as
   *  such rather than hidden: the record of who had what is the point. */
  listGrants: function (session) {
    Perms.require(session, 'MANAGE');
    const now = Date.now();
    return Db.all('UserGrants').map(g => {
      const u = Db.findOne('Users', { id: g.user_id });
      const ends = g.expires_at ? new Date(g.expires_at).getTime() : Infinity;
      const starts = g.starts_at ? new Date(g.starts_at).getTime() : 0;
      return {
        id: g.id, user_id: g.user_id, user: u ? u.name : g.user_id,
        permission: g.permission, scope: g.scope || '*',
        starts_at: g.starts_at, expires_at: g.expires_at, reason: g.reason,
        granted_by: g.granted_by,
        // Same boundary the permission check uses: an expiry is when access
        // ends, so a grant revoked "now" reads as inactive immediately.
        active: now >= starts && now < ends
      };
    }).sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
  },

  revokeGrant: function (session, p) {
    Perms.require(session, 'MANAGE');
    const g = Db.findOne('UserGrants', { id: String(p.grant_id || '') });
    if (!g) throw new ApiFail('not_found');
    // Expiry is evaluated on every permission check, so ending it now is simply
    // setting the end to now. There is no separate revoked flag to forget.
    Db.update('UserGrants', { id: g.id }, { expires_at: new Date().toISOString() });
    Audit.log(session, 'PERMISSION_REVOKED', 'user', g.user_id,
      { prev: g.permission, scope: g.scope || '*', reason: String(p.reason || '') });
    return { ok: true };
  },

  /** Emergency access: short, justified, loud. It cannot reach FINAL_PUBLISH
   *  any more than an ordinary grant can, and the supervisor admin is told. */
  emergencyAccess: function (session, p) {
    Perms.require(session, 'MANAGE');
    const reason = String(p.reason || '').trim();
    if (reason.length < 20) throw new ApiFail('reason_required', 'describe the incident, not just "urgent"');
    const hours = Math.min(Math.max(Number(p.hours || 0), 1), LIMITS.EMERGENCY_MAX_HOURS);
    if (!p.hours) throw new ApiFail('duration_required');
    const expires = new Date(Date.now() + hours * 3600000).toISOString();
    const res = this.grant(session, {
      user_id: p.user_id, permission: p.permission, scope: p.scope || '*',
      expires_at: expires, reason: 'EMERGENCY: ' + reason
    });
    const target = Db.findOne('Users', { id: p.user_id });
    Db.all('Users').filter(u => u.role_id === SUPERVISOR_ROLE && Auth.isUsable(u)).forEach(u => {
      Notifications.push(u.id, 'security', 'Emergency access granted',
        (target ? target.name : p.user_id) + ' holds ' + p.permission + ' for ' + hours + ' hours. ' + reason, 'delegation');
      Email.send(u.email, 'emergency_access', {
        author_name: u.name, subject_name: target ? target.name : p.user_id,
        permission: p.permission, hours: hours, reason: reason,
        granted_by: session.user.name, admin_url: CFG.get('SITE_URL', '') + 'admin/'
      }, session);
    });
    Audit.log(session, 'EMERGENCY_ACCESS_GRANTED', 'user', p.user_id,
      { next: p.permission, scope: p.scope || '*', reason: reason, meta: { hours: hours, expires_at: expires } });
    return Object.assign({}, res, { expires_at: expires, hours: hours });
  },

  assertRoleAssignable_: function (session, roleId) {
    if (!Db.findOne('Roles', { id: roleId })) throw new ApiFail('unknown_role');
    if (roleId === SUPERVISOR_ROLE) {
      Audit.log(session, 'SUPERVISOR_PROMOTION_BLOCKED', 'role', roleId, {});
      throw new ApiFail('forbidden', 'the supervisor admin role cannot be assigned through the API');
    }
  }
};
