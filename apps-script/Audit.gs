/** Audit.gs — append-only record of every sensitive action.
 *  Writes here must never be conditional on the caller's role. */
const Audit = {
  log: function (session, action, objectType, objectId, extra) {
    extra = extra || {};
    try {
      Db.insert('AuditLogs', {
        id: Db.newId('LOG'),
        ts: new Date().toISOString(),
        user_id: session ? session.user.id : '',
        user_email: session ? session.user.email : '',
        action: action,
        object_type: objectType || '',
        object_id: objectId || '',
        prev_version: extra.prev == null ? '' : extra.prev,
        new_version: extra.next == null ? '' : extra.next,
        scope: extra.scope || '',
        reason: extra.reason || '',
        meta: JSON.stringify(extra.meta || {})
      });
    } catch (e) {
      console.error('audit write failed: ' + e.message);  // never block the action
    }
  }
};
