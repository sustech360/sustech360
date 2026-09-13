/** Permissions.gs — server-side authorisation. The frontend's UI state is never
 *  trusted; every sensitive entry point calls require() here. */

const PERMISSIONS = ['VIEW','CREATE','EDIT','DELETE','REVIEW','APPROVE','PUBLISH_PREPARATION',
                     'ARCHIVE','EXPORT','MANAGE','INVITE_AUTHOR','FINAL_PUBLISH'];

/** Permissions that may only ever belong to the supervisor admin role. */
const SUPERVISOR_ONLY = ['FINAL_PUBLISH'];

const Perms = {
  effective: function (user) {
    const out = [];
    Db.find('RolePermissions', { role_id: user.role_id }).forEach(rp => {
      out.push({ permission: rp.permission, scope: rp.scope || '*' });
    });
    const now = Date.now();
    Db.find('UserGrants', { user_id: user.id }).forEach(g => {
      const starts = g.starts_at ? new Date(g.starts_at).getTime() : 0;
      const ends = g.expires_at ? new Date(g.expires_at).getTime() : Infinity;
      if (now >= starts && now < ends) out.push({ permission: g.permission, scope: g.scope || '*' });
    });
    return out;
  },

  /** A permission carries a scope: '*' means everywhere, anything else names a
   *  section. A check WITHOUT a scope is a platform-wide question — "may this
   *  person manage the site" — and only a '*' permission answers it yes.
   *
   *  The earlier reading treated a missing scope as "any scope will do", which
   *  turned every scoped delegation into a global one the moment it met one of
   *  the many unscoped checks in the control centre. */
  has: function (user, permission, scope) {
    if (SUPERVISOR_ONLY.indexOf(permission) !== -1 && user.role_id !== SUPERVISOR_ROLE) return false;
    return this.effective(user).some(p => {
      if (p.permission !== permission) return false;
      if (p.scope === '*') return true;
      return scope ? String(p.scope) === String(scope) : false;
    });
  },

  /** Throws unless the session holds the permission. Use at the top of every
   *  state-changing action. */
  require: function (session, permission, scope) {
    if (!session) throw new ApiFail('unauthenticated');
    if (!this.has(session.user, permission, scope)) {
      Audit.log(session, 'PERMISSION_DENIED', 'permission', permission, { scope: scope || '' });
      throw new ApiFail('forbidden', permission + (scope ? ' on ' + scope : ''));
    }
    return true;
  },

  isSupervisor: function (session) {
    return !!session && session.user.role_id === SUPERVISOR_ROLE;
  },

  requireSupervisor: function (session) {
    if (!this.isSupervisor(session)) {
      Audit.log(session, 'SUPERVISOR_REQUIRED_DENIED', 'permission', 'SUPERVISOR', {});
      throw new ApiFail('forbidden', 'supervisor admin only');
    }
    return true;
  }
};

/** Errors that are safe to return to a caller. Anything else becomes a generic
 *  server error so internals are not leaked. */
function ApiFail(code, detail) { this.code = code; this.detail = detail || ''; }
ApiFail.prototype = Object.create(Error.prototype);
