/** Notifications.gs — in-app messages. Deliberately dumb: a row, a read flag,
 *  and a link to somewhere in the portal. Email is a separate channel. */
const Notifications = {

  push: function (userId, kind, title, body, link) {
    if (!userId) return;
    try {
      Db.insert('Notifications', {
        id: Db.newId('NTF'), user_id: userId, kind: kind, title: title,
        body: body || '', link: link || '', read_at: ''
      });
    } catch (e) { console.error('notification failed: ' + e.message); }
  },

  list: function (session, p) {
    Perms.require(session, 'VIEW');
    const limit = Math.min(Number((p && p.limit) || 40), 100);
    return Db.find('Notifications', { user_id: session.user.id })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit)
      .map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link,
                   read: !!n.read_at, created_at: n.created_at }));
  },

  markRead: function (session, p) {
    Perms.require(session, 'VIEW');
    const n = Db.findOne('Notifications', { id: p.id, user_id: session.user.id });
    if (!n) throw new ApiFail('not_found');
    Db.update('Notifications', { id: n.id }, { read_at: new Date().toISOString() });
    return { ok: true };
  },

  markAllRead: function (session) {
    Perms.require(session, 'VIEW');
    const now = new Date().toISOString();
    Db.find('Notifications', { user_id: session.user.id })
      .filter(n => !n.read_at)
      .forEach(n => Db.update('Notifications', { id: n.id }, { read_at: now }));
    return { ok: true };
  }
};
