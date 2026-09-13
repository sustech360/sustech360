/** Roles.gs — custom roles and their permissions. */
const Roles = {
  list: function (session) {
    Perms.require(session, 'VIEW');
    return Db.all('Roles').map(r => ({
      id: r.id, name: r.name, description: r.description, system: r.system === true || r.system === 'TRUE',
      permissions: Db.find('RolePermissions', { role_id: r.id }).map(p => ({ permission: p.permission, scope: p.scope }))
    }));
  },

  create: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const id = String(payload.id || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!id) throw new ApiFail('bad_role_id');
    if (id === SUPERVISOR_ROLE) throw new ApiFail('forbidden', 'reserved role id');
    if (Db.findOne('Roles', { id: id })) throw new ApiFail('already_exists');
    Db.insert('Roles', { id: id, name: payload.name || id, description: payload.description || '', system: false });
    Audit.log(session, 'ROLE_CREATED', 'role', id, {});
    return { ok: true, id: id };
  },

  setPermissions: function (session, payload) {
    Perms.require(session, 'MANAGE');
    const roleId = String(payload.role_id);
    if (roleId === SUPERVISOR_ROLE) {
      Audit.log(session, 'SUPERVISOR_ROLE_EDIT_BLOCKED', 'role', roleId, {});
      throw new ApiFail('forbidden', 'supervisor admin permissions are fixed');
    }
    const role = Db.findOne('Roles', { id: roleId });
    if (!role) throw new ApiFail('not_found');

    const wanted = (payload.permissions || []).filter(p => PERMISSIONS.indexOf(p.permission) !== -1);
    // Invariant 2: FINAL_PUBLISH never reaches a non-supervisor role.
    if (wanted.some(p => SUPERVISOR_ONLY.indexOf(p.permission) !== -1)) {
      Audit.log(session, 'FINAL_PUBLISH_ASSIGN_BLOCKED', 'role', roleId, {});
      throw new ApiFail('forbidden', 'FINAL_PUBLISH belongs to the supervisor admin alone');
    }

    const existing = Db.find('RolePermissions', { role_id: roleId });
    existing.forEach(rp => {
      if (!wanted.some(w => w.permission === rp.permission && String(w.scope || '*') === String(rp.scope))) {
        Db.update('RolePermissions', { id: rp.id }, { permission: rp.permission + ':REMOVED', scope: '' });
      }
    });
    wanted.forEach(w => {
      if (!Db.findOne('RolePermissions', { role_id: roleId, permission: w.permission, scope: w.scope || '*' })) {
        Db.insert('RolePermissions', { role_id: roleId, permission: w.permission, scope: w.scope || '*' });
      }
    });
    Audit.log(session, 'ROLE_PERMISSIONS_CHANGED', 'role', roleId,
      { prev: JSON.stringify(existing.map(e => e.permission)), next: JSON.stringify(wanted.map(w => w.permission)) });
    return { ok: true };
  }
};
