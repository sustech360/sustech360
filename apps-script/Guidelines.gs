/** Guidelines.gs — the Editorial Guidelines Centre.
 *
 *  A guideline is a versioned document, not a setting. Editing one never
 *  changes what authors are currently reading: the edit opens a new private
 *  version that walks the same chain an article does —
 *
 *      DRAFT → PREVIEW → VERIFIED → APPROVED → PUBLISHED
 *
 *  — and the version that is live stays live until a supervisor admin publishes
 *  its replacement. Superseded versions are archived, never deleted, and any of
 *  them can be reopened as a new draft.
 */

const GUIDELINE_KINDS = [
  { kind: 'AUTHOR', name: 'Author guidelines', public: true },
  { kind: 'SUBMISSION', name: 'Submission guidelines', public: true },
  { kind: 'REVIEW', name: 'Review policy', public: true },
  { kind: 'ETHICS', name: 'Ethics and conflict of interest', public: true },
  { kind: 'MEDIA', name: 'Figures and image permissions', public: true },
  { kind: 'CORRECTIONS', name: 'Corrections policy', public: true },
  { kind: 'ADVERTISING', name: 'Advertising and sponsorship', public: true },
  { kind: 'INTERNAL', name: 'Internal editorial notes', public: false }
];

const GUIDELINE_TRANSITIONS = [
  { from: 'DRAFT',     to: 'PREVIEW',   perm: 'MANAGE' },
  { from: 'PREVIEW',   to: 'DRAFT',     perm: 'MANAGE' },
  { from: 'PREVIEW',   to: 'VERIFIED',  perm: 'APPROVE' },
  { from: 'VERIFIED',  to: 'PREVIEW',   perm: 'APPROVE',        reason: true },
  { from: 'VERIFIED',  to: 'APPROVED',  perm: 'FINAL_PUBLISH' },
  { from: 'DRAFT',     to: 'DISCARDED', perm: 'MANAGE',         reason: true },
  { from: 'PREVIEW',   to: 'DISCARDED', perm: 'MANAGE',         reason: true },
  { from: 'VERIFIED',  to: 'DISCARDED', perm: 'APPROVE',        reason: true }
];

const OPEN_GUIDELINE_STATES = ['DRAFT', 'PREVIEW', 'VERIFIED', 'APPROVED'];

const Guidelines = {

  /* ---------------- reading ---------------- */

  kinds: function () { return GUIDELINE_KINDS.slice(); },

  list: function (session) {
    Perms.require(session, 'VIEW');
    return GUIDELINE_KINDS.map(k => {
      const versions = Db.find('Guidelines', { kind: k.kind })
        .sort((a, b) => this.compare_(b.version, a.version));
      return {
        kind: k.kind, name: k.name, is_public: k.public,
        live: this.shape_(versions.filter(v => v.status === 'PUBLISHED')[0]),
        working: this.shape_(versions.filter(v => OPEN_GUIDELINE_STATES.indexOf(v.status) !== -1)[0]),
        history: versions.map(v => this.shape_(v))
      };
    });
  },

  get: function (session, p) {
    Perms.require(session, 'VIEW');
    const g = this.must_(p.id);
    // Private until published — but "private" has to include the people who
    // review and approve it, or verification would mean approving text you were
    // not allowed to read.
    if (g.status !== 'PUBLISHED') Perms.require(session, 'REVIEW');
    return Object.assign(this.shape_(g), { body: this.readBody_(g) });
  },

  /* ---------------- writing ---------------- */

  /** Opens the next version of a guideline. The current published text is the
   *  starting point, so editing is editing, not retyping. */
  createDraft: function (session, p) {
    Perms.require(session, 'MANAGE');
    const kind = String(p.kind || '');
    if (!GUIDELINE_KINDS.some(k => k.kind === kind)) throw new ApiFail('unknown_kind');
    const open = Db.find('Guidelines', { kind: kind })
      .filter(g => OPEN_GUIDELINE_STATES.indexOf(g.status) !== -1)[0];
    if (open) throw new ApiFail('version_open', 'version ' + open.version + ' is already in progress');

    const live = this.live_(kind);
    const version = this.nextVersion_(kind, p.major === true);
    const body = String(p.body != null ? p.body : (live ? this.readBody_(live) : this.starter_(kind)));
    const rec = Db.insert('Guidelines', {
      id: Db.newId('GDL'), kind: kind, version: version,
      title: p.title || (live ? live.title : this.name_(kind) + ' v' + version),
      body_ref: '', status: 'DRAFT', created_by: session.user.id, notes: p.notes || ''
    });
    this.writeBody_(rec, body);
    Audit.log(session, 'GUIDELINE_DRAFTED', 'guideline', rec.id,
      { prev: live ? live.version : '', next: version, meta: { kind: kind } });
    return this.shape_(Db.findOne('Guidelines', { id: rec.id }));
  },

  save: function (session, p) {
    Perms.require(session, 'MANAGE');
    const g = this.must_(p.id);
    if (['DRAFT', 'PREVIEW'].indexOf(g.status) === -1) {
      throw new ApiFail('locked', 'this version is past editing; send it back to draft first');
    }
    if (p.body != null) this.writeBody_(g, String(p.body));
    const patch = {};
    if (p.title) patch.title = String(p.title).slice(0, 160);
    if (p.notes != null) patch.notes = String(p.notes).slice(0, 500);
    if (Object.keys(patch).length) Db.update('Guidelines', { id: g.id }, patch);
    return { ok: true, saved_at: new Date().toISOString() };
  },

  move: function (session, p) {
    // Entry gate first, then the edge's own permission. MANAGE would be wrong
    // here: a senior editor holds APPROVE without MANAGE, and verification is
    // exactly their job.
    Perms.require(session, 'REVIEW');
    const g = this.must_(p.id);
    const to = String(p.to || '');
    const edge = GUIDELINE_TRANSITIONS.filter(e => e.from === g.status && e.to === to)[0];
    if (!edge) throw new ApiFail('illegal_transition', g.status + ' cannot become ' + to);
    Perms.require(session, edge.perm);
    const reason = String(p.reason || '').trim();
    if (edge.reason && reason.length < 10) throw new ApiFail('reason_required');

    const patch = { status: to };
    if (to === 'APPROVED') { patch.approved_by = session.user.id; patch.approved_at = new Date().toISOString(); }
    if (reason) patch.notes = reason;
    Db.update('Guidelines', { id: g.id }, patch);
    Audit.log(session, 'GUIDELINE_TRANSITION', 'guideline', g.id,
      { prev: g.status, next: to, reason: reason, meta: { kind: g.kind, version: g.version } });
    return { ok: true, status: to };
  },

  /** Supervisor admin only, like every other publication on this platform. */
  publish: function (session, p) {
    Perms.requireSupervisor(session);
    const g = this.must_(p.id);
    if (g.status !== 'APPROVED') throw new ApiFail('not_approved', 'version ' + g.version + ' is ' + g.status);

    const previous = this.live_(g.kind);
    if (previous) {
      Db.update('Guidelines', { id: previous.id }, { status: 'ARCHIVED' });
    }
    Db.update('Guidelines', { id: g.id }, { status: 'PUBLISHED', published_at: new Date().toISOString() });

    const files = Publish.guidelines(session);
    this.notifyAuthors_(session, g);
    Audit.log(session, 'GUIDELINE_PUBLISHED', 'guideline', g.id, {
      prev: previous ? previous.version : '', next: g.version,
      meta: { kind: g.kind, files: files.length }
    });
    return { ok: true, version: g.version, files: files };
  },

  /** Recovery: an archived version reopens as a new draft. The old row is never
   *  reanimated, so the history stays a history. */
  restore: function (session, p) {
    Perms.require(session, 'MANAGE');
    const old = this.must_(p.id);
    if (['ARCHIVED', 'DISCARDED'].indexOf(old.status) === -1) {
      throw new ApiFail('not_restorable', 'only an archived or discarded version can be reopened');
    }
    const draft = this.createDraft(session, {
      kind: old.kind, body: this.readBody_(old), title: old.title,
      notes: 'Reopened from version ' + old.version
    });
    Audit.log(session, 'GUIDELINE_RESTORED', 'guideline', draft.id,
      { prev: old.version, next: draft.version, meta: { kind: old.kind } });
    return draft;
  },

  /* ---------------- what the public and the portal read ---------------- */

  publicBundle: function () {
    const docs = [];
    GUIDELINE_KINDS.filter(k => k.public).forEach(k => {
      const live = this.live_(k.kind);
      if (!live) return;
      docs.push({
        kind: k.kind, name: k.name, title: live.title, version: live.version,
        published_at: live.published_at || live.approved_at || '',
        body: this.readBody_(live)
      });
    });
    return { version: 1, generated_at: new Date().toISOString(), documents: docs };
  },

  /** The author portal reads this: whatever is live, plus nothing that is not. */
  forAuthors: function () {
    return this.publicBundle().documents.filter(d => ['AUTHOR', 'SUBMISSION', 'MEDIA', 'ETHICS'].indexOf(d.kind) !== -1);
  },

  /* ---------------- internals ---------------- */

  must_: function (id) {
    const g = Db.findOne('Guidelines', { id: String(id || '') });
    if (!g) throw new ApiFail('not_found');
    return g;
  },

  live_: function (kind) {
    return Db.find('Guidelines', { kind: kind, status: 'PUBLISHED' })
      .sort((a, b) => this.compare_(b.version, a.version))[0] || null;
  },

  name_: function (kind) {
    const k = GUIDELINE_KINDS.filter(x => x.kind === kind)[0];
    return k ? k.name : kind;
  },

  compare_: function (a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    return (pa[0] - pb[0]) || ((pa[1] || 0) - (pb[1] || 0));
  },

  nextVersion_: function (kind, major) {
    const all = Db.find('Guidelines', { kind: kind });
    if (!all.length) return '1.0';
    const top = all.sort((a, b) => this.compare_(b.version, a.version))[0].version;
    const parts = String(top).split('.').map(Number);
    return major ? (parts[0] + 1) + '.0' : parts[0] + '.' + ((parts[1] || 0) + 1);
  },

  shape_: function (g) {
    if (!g) return null;
    return {
      id: g.id, kind: g.kind, version: g.version, title: g.title, status: g.status,
      created_by: g.created_by, created_at: g.created_at, approved_by: g.approved_by || '',
      approved_at: g.approved_at || '', published_at: g.published_at || '', notes: g.notes || ''
    };
  },

  /* Bodies live in Drive for the same reason article bodies do: a policy
     document outgrows a spreadsheet cell, and quickly. */
  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('guidelines');
    return it.hasNext() ? it.next() : root.createFolder('guidelines');
  },

  writeBody_: function (g, body) {
    if (g.body_ref) {
      try { DriveApp.getFileById(g.body_ref).setContent(body); return g.body_ref; } catch (e) {}
    }
    const file = this.folder_().createFile(g.kind + '-v' + g.version + '.txt', body, 'text/plain');
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    Db.update('Guidelines', { id: g.id }, { body_ref: file.getId() });
    return file.getId();
  },

  readBody_: function (g) {
    if (!g || !g.body_ref) return this.starter_(g ? g.kind : '');
    try { return DriveApp.getFileById(g.body_ref).getBlob().getDataAsString(); }
    catch (e) { return ''; }
  },

  notifyAuthors_: function (session, g) {
    if (['AUTHOR', 'SUBMISSION', 'MEDIA', 'ETHICS'].indexOf(g.kind) === -1) return;
    Db.all('Users').filter(u => u.role_id === 'AUTHOR' && Auth.isUsable(u)).forEach(u => {
      Notifications.push(u.id, 'guidelines', this.name_(g.kind) + ' updated to v' + g.version,
        g.notes || 'Read the current version before your next submission.', 'guidelines');
    });
  },

  starter_: function (kind) {
    if (kind === 'AUTHOR') return DEFAULT_GUIDELINES_;
    return this.name_(kind) + '\n\nThis document has not been written yet.';
  }
};
