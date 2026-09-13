/** Db.gs — the only module that knows the database is a spreadsheet.
 *  Everything above it works with plain objects, so replacing this file with a
 *  Firestore or SQL implementation migrates the whole platform. */
const Db = (function () {
  const cache = {};

  /* Apps Script has a single script lock. Taking it twice in one execution —
     which is what happened when a sequence allocator held it and then called a
     write that takes it again — risks blocking until the timeout and failing
     the operation. The two places that did this were article ID and invoice
     number allocation: the two things on this platform that must never produce
     a duplicate or a gap.
     One helper, aware of its own depth, removes the whole class of problem and
     makes read-modify-write sequences atomic including the write. */
  let depth = 0;

  function withLock(fn) {
    if (depth > 0) {                       // already held by this execution
      depth++;
      try { return fn(); } finally { depth--; }
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    depth = 1;
    try { return fn(); } finally { depth = 0; lock.releaseLock(); }
  }

  function sheet(table) {
    if (!SCHEMA[table]) throw new Error('Unknown table: ' + table);
    const sh = CFG.book().getSheetByName(table);
    if (!sh) throw new Error('Missing sheet: ' + table + '. Run setup().');
    return sh;
  }

  function readAll(table) {
    if (cache[table]) return cache[table];
    const sh = sheet(table);
    const last = sh.getLastRow();
    const cols = SCHEMA[table];
    const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, cols.length).getValues();
    cache[table] = rows.map((r, i) => {
      const o = { _row: i + 2 };
      cols.forEach((c, j) => { o[c] = r[j]; });
      return o;
    });
    return cache[table];
  }

  function match(rec, where) {
    return Object.keys(where).every(k => String(rec[k]) === String(where[k]));
  }

  return {
    newId: function (prefix) {
      return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
    },
    all: function (table) { return readAll(table).filter(r => !r.deleted_at); },
    find: function (table, where) { return this.all(table).filter(r => match(r, where)); },
    findOne: function (table, where) { return this.find(table, where)[0] || null; },

    insert: function (table, obj) {
      const cols = SCHEMA[table];
      const now = new Date().toISOString();
      if (cols.indexOf('created_at') !== -1 && !obj.created_at) obj.created_at = now;
      if (cols.indexOf('updated_at') !== -1 && !obj.updated_at) obj.updated_at = now;
      if (cols.indexOf('id') !== -1 && !obj.id) obj.id = this.newId(table.slice(0, 3).toUpperCase());
      const row = cols.map(c => (obj[c] === undefined || obj[c] === null ? '' : serialize(obj[c])));
      withLock(() => sheet(table).appendRow(row));
      delete cache[table];
      return obj;
    },

    update: function (table, where, patch) {
      const cols = SCHEMA[table];
      const rec = this.findOne(table, where);
      if (!rec) return null;
      if (cols.indexOf('updated_at') !== -1) patch.updated_at = new Date().toISOString();
      withLock(() => {
        const sh = sheet(table);
        Object.keys(patch).forEach(k => {
          const idx = cols.indexOf(k);
          if (idx === -1) return;
          sh.getRange(rec._row, idx + 1).setValue(serialize(patch[k]));
        });
      });
      delete cache[table];
      return Object.assign({}, rec, patch);
    },

    /** Soft delete only. Nothing is ever removed from a sheet by the API. */
    softDelete: function (table, where) {
      if (SCHEMA[table].indexOf('deleted_at') === -1) throw new Error(table + ' does not support delete');
      return this.update(table, where, { deleted_at: new Date().toISOString() });
    },

    /** Replaces every row in a table. The one destructive primitive in this
     *  file, used only by Backup.restore, which guards it heavily. The header
     *  row is never touched: the schema is code, not data. */
    replaceAll: function (table, rows) {
      const cols = SCHEMA[table];
      if (!cols) throw new Error('Unknown table: ' + table);
      withLock(() => {
        const sh = sheet(table);
        const last = sh.getLastRow();
        if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
        if (rows.length) {
          const values = rows.map(r => cols.map(c => (r[c] === undefined || r[c] === null ? '' : serialize(r[c]))));
          sh.getRange(2, 1, values.length, cols.length).setValues(values);
        }
      });
      delete cache[table];
      return rows.length;
    },

    /** Runs fn holding the script lock, safely even if a caller already holds
     *  it. Use it around any read-modify-write that must be atomic. */
    withLock: withLock,

    flush: function () { Object.keys(cache).forEach(k => delete cache[k]); }
  };

  function serialize(v) {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }
})();

/** Values stored as JSON strings come back as strings; parse where expected. */
function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [p]; }
  catch (e) { return String(v).split(',').map(s => s.trim()).filter(Boolean); }
}
