/** Backup.gs — snapshots, verification, and a restore that is hard to do by
 *  accident.
 *
 *  Google Sheets keeps revision history, which is not a backup: it does not
 *  survive the file being deleted, the account being lost, or a script writing
 *  plausible rubbish into every row. This writes the whole database to a JSON
 *  file in Drive, records what it wrote, and can read it back.
 *
 *  Restore is the dangerous half, so it follows the sequence the specification
 *  asks for rather than offering a button: take a backup, verify it, and only
 *  then restore — with the supervisor admin typing the confirmation, and with
 *  production refusing unless the same snapshot has been verified first.
 */
const Backup = {

  KEEP: 21,                        // daily snapshots retained before pruning

  /** Snapshots every table. Safe to run from a trigger with no session. */
  run: function (session, p) {
    if (session) Perms.require(session, 'MANAGE');
    const kind = (p && p.kind) || (session ? 'MANUAL' : 'SCHEDULED');
    const snapshot = { env: CFG.env(), taken_at: new Date().toISOString(), tables: {}, counts: {} };

    Object.keys(SCHEMA).forEach(table => {
      const rows = Db.all(table).map(r => {
        const o = Object.assign({}, r);
        delete o._row;
        return o;
      });
      snapshot.tables[table] = rows;
      snapshot.counts[table] = rows.length;
    });

    const body = JSON.stringify(snapshot);
    const name = 'backup-' + CFG.env() + '-' + snapshot.taken_at.replace(/[:.]/g, '-') + '.json';
    const file = this.folder_().createFile(name, body, 'application/json');
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    const rec = Db.insert('Backups', {
      id: Db.newId('BAK'), kind: kind, location: file.getId(), size: body.length,
      created_by: session ? session.user.id : 'SYSTEM', created_at: snapshot.taken_at
    });
    Audit.log(session, 'BACKUP_CREATED', 'backup', rec.id,
      { meta: { kind: kind, bytes: body.length, tables: Object.keys(snapshot.counts).length } });
    this.prune_(session);
    return { ok: true, id: rec.id, bytes: body.length, counts: snapshot.counts };
  },

  list: function (session) {
    Perms.require(session, 'MANAGE');
    return Db.all('Backups')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(b => ({
        id: b.id, kind: b.kind, size: Number(b.size || 0), created_at: b.created_at,
        created_by: b.created_by, verified_at: b.verified_at || ''
      }));
  },

  /** Reads the file back and checks it against what was recorded. A backup
   *  nobody has ever read is a hope, not a backup. */
  verify: function (session, p) {
    Perms.require(session, 'MANAGE');
    const rec = this.must_(p.id);
    const problems = [];
    const notes = [];
    let snapshot = null;

    try {
      snapshot = JSON.parse(DriveApp.getFileById(rec.location).getBlob().getDataAsString());
    } catch (e) {
      problems.push('The file cannot be read or is not valid JSON');
    }

    if (snapshot) {
      if (snapshot.env !== CFG.env()) problems.push('Taken in ' + snapshot.env + ', not ' + CFG.env());
      Object.keys(SCHEMA).forEach(table => {
        if (!snapshot.tables[table]) problems.push('Missing table: ' + table);
      });
      // The tables without which the platform cannot be itself. Content tables
      // are deliberately not on this list: a site that has not published yet
      // must still be able to verify its first backup, and "no articles" is a
      // fact about a young magazine rather than a corrupt snapshot.
      ['Users', 'Roles', 'RolePermissions', 'Settings'].forEach(table => {
        const rows = (snapshot.tables || {})[table] || [];
        if (!rows.length) problems.push(table + ' is empty in this snapshot');
      });
      ['Articles', 'Versions'].forEach(table => {
        if (!((snapshot.tables || {})[table] || []).length) notes.push('No ' + table.toLowerCase() + ' in this snapshot');
      });
      const supervisors = ((snapshot.tables || {}).Users || [])
        .filter(u => u.role_id === SUPERVISOR_ROLE && u.status !== 'DELETED');
      if (!supervisors.length) problems.push('No supervisor admin in this snapshot — restoring it would lock everyone out');
    }

    if (!problems.length) {
      Db.update('Backups', { id: rec.id }, { verified_at: new Date().toISOString() });
    }
    Audit.log(session, problems.length ? 'BACKUP_VERIFY_FAILED' : 'BACKUP_VERIFIED', 'backup', rec.id,
      { meta: { problems: problems.length } });
    return {
      ok: !problems.length, id: rec.id, problems: problems, notes: notes,
      counts: snapshot ? snapshot.counts : {},
      taken_at: snapshot ? snapshot.taken_at : ''
    };
  },

  /** Puts a snapshot back. Supervisor admin only, verified first, confirmed in
   *  words, and refused outright in production unless the phrase names the
   *  environment — because the most likely restore is the wrong one. */
  restore: function (session, p) {
    Perms.requireSupervisor(session);
    const rec = this.must_(p.id);
    if (!rec.verified_at) {
      throw new ApiFail('verify_first', 'verify this snapshot before restoring it');
    }
    const expected = CFG.isProduction() ? 'RESTORE PRODUCTION' : 'RESTORE';
    if (String(p.confirm || '') !== expected) {
      throw new ApiFail('confirmation_required', 'type ' + expected + ' to proceed');
    }
    const reason = String(p.reason || '').trim();
    if (reason.length < 10) throw new ApiFail('reason_required');

    // The state being replaced is itself snapshotted first. A restore is the
    // moment you most want to be able to undo.
    const before = this.run(session, { kind: 'PRE_RESTORE' });

    const snapshot = JSON.parse(DriveApp.getFileById(rec.location).getBlob().getDataAsString());
    let written = 0;
    Object.keys(SCHEMA).forEach(table => {
      const rows = snapshot.tables[table];
      if (!rows) return;
      Db.replaceAll(table, rows);
      written += rows.length;
    });

    Audit.log(session, 'DATABASE_RESTORED', 'backup', rec.id, {
      prev: before.id, next: rec.id, reason: reason,
      meta: { env: CFG.env(), rows: written, taken_at: snapshot.taken_at }
    });
    return { ok: true, restored_from: rec.created_at, rows: written, safety_backup: before.id };
  },

  /** Download without going through Drive's interface. */
  download: function (session, p) {
    Perms.require(session, 'MANAGE');
    Perms.require(session, 'EXPORT');
    const rec = this.must_(p.id);
    const body = DriveApp.getFileById(rec.location).getBlob().getDataAsString();
    Audit.log(session, 'BACKUP_DOWNLOADED', 'backup', rec.id, { meta: { bytes: body.length } });
    return { id: rec.id, created_at: rec.created_at, content: body };
  },

  prune_: function (session) {
    const scheduled = Db.all('Backups')
      .filter(b => b.kind === 'SCHEDULED')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    scheduled.slice(this.KEEP).forEach(old => {
      try { DriveApp.getFileById(old.location).setTrashed(true); } catch (e) {}
      Db.update('Backups', { id: old.id }, { location: '', kind: 'PRUNED' });
      Audit.log(session, 'BACKUP_PRUNED', 'backup', old.id, {});
    });
  },

  must_: function (id) {
    const rec = Db.findOne('Backups', { id: String(id || '') });
    if (!rec) throw new ApiFail('not_found');
    if (!rec.location) throw new ApiFail('gone', 'this snapshot has been pruned');
    return rec;
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('backups');
    return it.hasNext() ? it.next() : root.createFolder('backups');
  }
};

/** Daily trigger. */
function dailyBackup() {
  return Backup.run(null, { kind: 'SCHEDULED' });
}
