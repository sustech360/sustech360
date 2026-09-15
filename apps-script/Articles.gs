/** Articles.gs — drafts, versions and submission.
 *
 *  Two rules hold everything else up:
 *
 *  1. An author may only ever move an article along the author-side edges of the
 *     workflow (DRAFT → SUBMITTED, REVISION_REQUIRED → RESUBMITTED, and back to
 *     DRAFT by withdrawing). Every other transition belongs to editors, review
 *     and the supervisor admin. AUTHOR_TRANSITIONS is the whole of what an
 *     author can do, and it is checked here, on the server.
 *
 *  2. Editing a published article never touches the published article. It opens
 *     a new private version. The public file changes only when phase 3's
 *     approval step commits it.
 */

const AUTHOR_TRANSITIONS = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['DRAFT'],                 // withdraw, while nobody has picked it up
  REVISION_REQUIRED: ['RESUBMITTED'],
  PUBLISHED: ['PUBLISHED']              // revisions are versions, not status moves
};

const Articles = {

  /* ---------------- reading ---------------- */

  mine: function (session) {
    Perms.require(session, 'CREATE');
    return Db.all('Articles')
      .filter(a => this.isOwner_(session, a))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map(a => this.summary_(a));
  },

  get: function (session, p) {
    const a = this.mustRead_(session, p.article_id);
    const version = Number(p.version || a.working_version || 1);
    const v = Db.findOne('Versions', { article_id: a.id, version: version });
    return {
      article: this.summary_(a),
      version: version,
      version_status: v ? v.status : 'DRAFT',
      notes: v ? v.notes : '',
      content: v && v.payload_ref ? this.readPayload_(v.payload_ref) : {},
      media: Db.find('Media', { article_id: a.id }).map(m => ({
        id: m.id, name: m.name, mime: m.mime, bytes: m.bytes,
        caption: m.caption, credit: m.credit, licence: m.licence
      })),
      history: Db.find('Versions', { article_id: a.id })
        .sort((x, y) => Number(y.version) - Number(x.version))
        .map(x => ({ version: Number(x.version), status: x.status, created_at: x.created_at, notes: x.notes }))
    };
  },

  /* ---------------- writing ---------------- */

  create: function (session, p) {
    Perms.require(session, 'CREATE');
    const format = Db.findOne('ArticleFormats', { slug: String(p.format || ''), status: 'ACTIVE' });
    if (!format) throw new ApiFail('unknown_format');
    const title = String(p.title || '').trim();
    if (title.length < 8) throw new ApiFail('title_too_short', 'give it a working title of at least 8 characters');

    const id = this.nextId_();
    const article = Db.insert('Articles', {
      id: id, slug: this.uniqueSlug_(title), title: title,
      category: p.category || '', topics: JSON.stringify(p.topics || []), tags: JSON.stringify(p.tags || []),
      level: p.level || 'understand', format: format.slug, status: 'DRAFT',
      public_version: 0, working_version: 1,
      primary_author: session.user.id, co_authors: JSON.stringify([]),
      created_by: session.user.id, sponsored: false
    });
    const ref = this.writePayload_(id, 1, { fields: {}, blocks: [] });
    Db.insert('Versions', {
      id: Db.newId('VER'), article_id: id, version: 1, payload_ref: ref,
      status: 'DRAFT', created_by: session.user.id, notes: ''
    });
    Audit.log(session, 'DRAFT_CREATED', 'article', id, { next: '1', scope: p.category || '' });
    return this.summary_(article);
  },

  /** Autosave and manual save both land here. Saving never changes status. */
  /** Takes everything the author has changed since the last sync and applies it
   *  in one go.
   *
   *  Two differences from save(), and both matter. It merges field by field
   *  rather than replacing the whole payload, so a second window editing a
   *  different section does not quietly wipe the first. And it reports what the
   *  server now holds, so the editor can reconcile rather than guess.
   *
   *  One execution, one read of the payload, one write to Drive, one row
   *  update, whatever the author did in between.
   */
  sync: function (session, p) {
    const a = this.mustOwn_(session, p.article_id);
    const v = this.workingVersion_(a);
    if (['DRAFT', 'REVISION_REQUIRED'].indexOf(v.status) === -1) {
      throw new ApiFail('locked', 'this version is with the editors; open a new revision to keep writing');
    }

    const changes = p.changes || {};
    const fields = changes.fields || {};
    const meta = changes.meta || {};
    if (!Object.keys(fields).length && !Object.keys(meta).length) {
      return { ok: true, saved_at: '', unchanged: true };
    }

    const held = v.payload_ref ? this.readPayload_(v.payload_ref) : { fields: {} };
    held.fields = held.fields || {};

    // Somebody else has written since this editor last heard from us. The
    // merge still happens — losing an author's paragraph to a race is worse
    // than an occasional surprise — but the answer says so.
    const moved = !!(p.base && held.updated_at && p.base !== held.updated_at);

    Object.keys(fields).forEach(key => {
      if (!/^[a-z0-9_]{2,40}$/.test(key)) throw new ApiFail('bad_field', key);
      held.fields[key] = String(fields[key] == null ? '' : fields[key]);
    });
    held.updated_at = new Date().toISOString();

    this.writePayload_(a.id, Number(v.version), held, v.payload_ref);

    const row = {};
    ['title', 'category', 'level'].forEach(k => { if (meta[k] != null) row[k] = meta[k]; });
    if (meta.topics) row.topics = JSON.stringify(meta.topics);
    if (meta.tags) row.tags = JSON.stringify(meta.tags);
    if (Object.keys(row).length) Db.update('Articles', { id: a.id }, row);

    return {
      ok: true,
      saved_at: held.updated_at,
      words: this.wordCount_(held),
      version: Number(v.version),
      merged_with_other_changes: moved,
      // What the server holds now, so a window that was behind can catch up
      // without the author retyping anything.
      fields: moved ? held.fields : undefined
    };
  },

  save: function (session, p) {
    const a = this.mustOwn_(session, p.article_id);
    const v = this.workingVersion_(a);
    if (['DRAFT', 'REVISION_REQUIRED'].indexOf(v.status) === -1) {
      throw new ApiFail('locked', 'this version is with the editors; open a new revision to keep writing');
    }
    const content = {
      fields: p.fields || {},
      blocks: p.blocks || [],
      updated_at: new Date().toISOString()
    };
    this.writePayload_(a.id, Number(v.version), content, v.payload_ref);

    const meta = {};
    ['title', 'category', 'level'].forEach(k => { if (p[k] != null) meta[k] = p[k]; });
    if (p.topics) meta.topics = JSON.stringify(p.topics);
    if (p.tags) meta.tags = JSON.stringify(p.tags);
    if (Object.keys(meta).length) Db.update('Articles', { id: a.id }, meta);
    return { ok: true, saved_at: content.updated_at, words: this.wordCount_(content) };
  },

  /** A published article is edited by opening the next version privately. */
  startRevision: function (session, p) {
    const a = this.mustOwn_(session, p.article_id);
    if (a.status !== 'PUBLISHED') throw new ApiFail('not_published', 'this article is already being edited');
    const open = Db.find('Versions', { article_id: a.id })
      .filter(v => ['DRAFT', 'REVISION_REQUIRED', 'SUBMITTED', 'RESUBMITTED'].indexOf(v.status) !== -1);
    if (open.length) throw new ApiFail('revision_open', 'version ' + open[0].version + ' is already in progress');

    // The next version number is one past the highest that has ever existed,
    // not one past the published one: a rejected version still owns its number
    // and its history, and reusing it would overwrite the record of a decision.
    const used = Db.find('Versions', { article_id: a.id }).map(v => Number(v.version));
    const next = Math.max.apply(null, used.concat([Number(a.public_version || 0)])) + 1;
    const current = Db.findOne('Versions', { article_id: a.id, version: a.public_version });
    const content = current && current.payload_ref ? this.readPayload_(current.payload_ref) : { fields: {}, blocks: [] };
    const ref = this.writePayload_(a.id, next, content);
    Db.insert('Versions', {
      id: Db.newId('VER'), article_id: a.id, version: next, payload_ref: ref,
      status: 'DRAFT', created_by: session.user.id, notes: p.reason || ''
    });
    Db.update('Articles', { id: a.id }, { working_version: next });
    Audit.log(session, 'REVISION_STARTED', 'article', a.id,
      { prev: String(a.public_version), next: String(next), reason: p.reason || '' });
    return { ok: true, version: next, public_version: Number(a.public_version) };
  },

  /* ---------------- submission ---------------- */

  /** The gate. Format fields, word count and checklist are all checked here,
   *  because the portal's version of these checks is a courtesy, not a control. */
  submit: function (session, p) {
    const a = this.mustOwn_(session, p.article_id);
    const v = this.workingVersion_(a);
    const from = v.status === 'REVISION_REQUIRED' ? 'REVISION_REQUIRED' : 'DRAFT';
    const to = from === 'REVISION_REQUIRED' ? 'RESUBMITTED' : 'SUBMITTED';
    this.assertAuthorTransition_(a.status === 'PUBLISHED' ? 'DRAFT' : (a.status || 'DRAFT'), to, from);

    const content = v.payload_ref ? this.readPayload_(v.payload_ref) : { fields: {} };
    const problems = this.validate_(a, content, p.checklist || {});
    if (problems.length) throw new ApiFail('incomplete', problems.join(' | '));

    const now = new Date().toISOString();
    Db.update('Versions', { id: v.id }, { status: to, notes: p.note || v.notes });
    if (a.status !== 'PUBLISHED') Db.update('Articles', { id: a.id }, { status: to });

    Db.insert('Settings', {
      key: 'checklist.' + a.id + '.v' + v.version,
      value: JSON.stringify({ answers: p.checklist || {}, at: now, by: session.user.id }),
      scope: 'submission', updated_by: session.user.id
    });

    this.alertEditors_(session, a);
    Email.send(session.user.email, 'article_submitted',
      { author_name: session.user.name, article_title: a.title, article_id: a.id }, session);
    Audit.log(session, 'ARTICLE_SUBMITTED', 'article', a.id,
      { prev: from, next: to, scope: a.category, meta: { version: v.version } });
    return { ok: true, status: to };
  },

  withdraw: function (session, p) {
    const a = this.mustOwn_(session, p.article_id);
    const v = this.workingVersion_(a);
    if (v.status !== 'SUBMITTED') throw new ApiFail('not_withdrawable', 'an editor has already started on it');
    Db.update('Versions', { id: v.id }, { status: 'DRAFT' });
    if (a.status === 'SUBMITTED') Db.update('Articles', { id: a.id }, { status: 'DRAFT' });
    Audit.log(session, 'SUBMISSION_WITHDRAWN', 'article', a.id, { prev: 'SUBMITTED', next: 'DRAFT' });
    return { ok: true, status: 'DRAFT' };
  },

  /* ---------------- validation ---------------- */

  validate_: function (article, content, checklist) {
    const out = [];
    const format = Db.findOne('ArticleFormats', { slug: article.format });
    if (!format) return ['The article format no longer exists. Choose another.'];

    Formats.fields(format.id).forEach(f => {
      const required = f.required === true || f.required === 'TRUE';
      const val = String((content.fields || {})[f.field] || '').trim();
      if (required && !val) out.push(f.label + ' is required');
    });

    if (!article.category) out.push('Choose a category');

    // Writing rules are configuration, not constants: whatever the Guidelines
    // Centre currently says is what the gate enforces.
    const rules = Formats.rules().writing;
    const title = String(article.title || '').trim();
    if (title.length < 8) out.push('The title is too short');
    if (rules.title_max && title.length > rules.title_max) {
      out.push('The title is over ' + rules.title_max + ' characters');
    }
    const summaryWords = this.count_(String((content.fields || {}).summary || ''));
    if (rules.summary_min_words && summaryWords && summaryWords < rules.summary_min_words) {
      out.push('The summary is under ' + rules.summary_min_words + ' words');
    }
    if (rules.summary_max_words && summaryWords > rules.summary_max_words) {
      out.push('The summary is over ' + rules.summary_max_words + ' words');
    }

    const limits = this.wordLimits_(article.format);
    const words = this.wordCount_(content);
    if (limits.max && words > limits.max) out.push('Too long: ' + words + ' words against a ' + limits.max + ' limit');
    if (limits.recommended && words < Math.round(limits.recommended * 0.5)) {
      out.push('Too short: ' + words + ' words, and this format expects around ' + limits.recommended);
    }

    Db.all('SubmissionChecklist').filter(c => c.status === 'ACTIVE').forEach(c => {
      const required = c.required === true || c.required === 'TRUE';
      if (required && checklist[c.id] !== true) out.push('Checklist: ' + c.item);
    });

    const media = Formats.rules().media;
    Db.find('Media', { article_id: article.id }).forEach(m => {
      if (media.credit_required && !m.credit) out.push('Image "' + m.name + '" needs a credit');
      if (media.licence_required && !m.licence) out.push('Image "' + m.name + '" needs a licence');
      if (media.caption_required && !m.caption) out.push('Image "' + m.name + '" needs a caption');
    });
    return out;
  },

  wordLimits_: function (formatSlug) {
    const s = Db.findOne('Settings', { key: 'formats.' + formatSlug + '.words' });
    if (!s) return {};
    try { return JSON.parse(s.value); } catch (e) { return {}; }
  },

  count_: function (s) { return (String(s || '').match(/\S+/g) || []).length; },

  wordCount_: function (content) {
    const text = Object.keys(content.fields || {}).map(k => content.fields[k]).join(' ') + ' ' +
      (content.blocks || []).map(b => b.text || '').join(' ');
    return (text.match(/\S+/g) || []).length;
  },

  /* ---------------- helpers ---------------- */

  isOwner_: function (session, a) {
    if (String(a.primary_author) === String(session.user.id)) return true;
    if (String(a.created_by) === String(session.user.id)) return true;
    return asList(a.co_authors).map(String).indexOf(String(session.user.id)) !== -1;
  },

  /** Ownership is the authorisation for author-side actions. An author reaching
   *  for another author's draft gets not_found, not a hint that it exists.
   *
   *  The editorial override is deliberately NOT the EDIT permission alone.
   *  Every author holds EDIT — it is what lets them edit their own work — so
   *  treating EDIT as an override would open every draft on the platform to
   *  every author. An editor is someone holding EDIT *and* REVIEW in the
   *  article's section, or APPROVE, or MANAGE. A reviewer holds REVIEW without
   *  EDIT and so can never write. */
  mustOwn_: function (session, id) {
    Perms.require(session, 'VIEW');
    const a = Db.findOne('Articles', { id: String(id || '') });
    if (!a) throw new ApiFail('not_found');
    if (this.isOwner_(session, a) || this.isEditor_(session, a)) return a;
    Audit.log(session, 'ARTICLE_ACCESS_DENIED', 'article', a.id, { scope: a.category });
    throw new ApiFail('not_found');
  },

  /** Read access is wider than write access, but not much: an assigned
   *  reviewer sees the article they were asked to review and nothing else. */
  mustRead_: function (session, id) {
    Perms.require(session, 'VIEW');
    const a = Db.findOne('Articles', { id: String(id || '') });
    if (!a) throw new ApiFail('not_found');
    if (this.isOwner_(session, a) || this.isEditor_(session, a) || this.isAssignedReviewer_(session, a)) return a;
    Audit.log(session, 'ARTICLE_ACCESS_DENIED', 'article', a.id, { scope: a.category });
    throw new ApiFail('not_found');
  },

  isEditor_: function (session, a) {
    const u = session.user, cat = a.category;
    if (Perms.has(u, 'MANAGE', cat) || Perms.has(u, 'APPROVE', cat)) return true;
    return Perms.has(u, 'EDIT', cat) && Perms.has(u, 'REVIEW', cat);
  },

  isAssignedReviewer_: function (session, a) {
    return Db.find('Reviews', { article_id: a.id, reviewer_id: session.user.id })
      .some(r => r.status !== 'CANCELLED');
  },

  workingVersion_: function (a) {
    const v = Db.findOne('Versions', { article_id: a.id, version: a.working_version });
    if (!v) throw new ApiFail('no_working_version');
    return v;
  },

  assertAuthorTransition_: function (status, to, from) {
    const allowed = AUTHOR_TRANSITIONS[from] || AUTHOR_TRANSITIONS[status] || [];
    if (allowed.indexOf(to) === -1) throw new ApiFail('forbidden', 'an author cannot move an article to ' + to);
  },

  /** Sequential per year. The whole read-modify-write runs under one lock, so
   *  two authors creating a draft in the same second cannot take the same
   *  number — and the write is inside the lock rather than after it. */
  nextId_: function () {
    return Db.withLock(() => {
      const year = new Date().getFullYear();
      const key = 'seq.article.' + year;
      const row = Db.findOne('Settings', { key: key });
      const n = (row ? Number(row.value) : 0) + 1;
      if (row) Db.update('Settings', { key: key }, { value: n });
      else Db.insert('Settings', { key: key, value: n, scope: 'system' });
      return 'MAG-' + year + '-' + String(n).padStart(6, '0');
    });
  },

  uniqueSlug_: function (title) {
    const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'article';
    let slug = base, n = 1;
    while (Db.findOne('Articles', { slug: slug })) { n++; slug = base + '-' + n; }
    return slug;
  },

  /* Bodies live in Drive, never in a cell: sheets cap a cell at 50,000
     characters and handle long text badly. The sheet holds the pointer. */
  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('versions');
    return it.hasNext() ? it.next() : root.createFolder('versions');
  },

  writePayload_: function (articleId, version, content, existingRef) {
    const json = JSON.stringify(content);
    if (existingRef) {
      try { DriveApp.getFileById(existingRef).setContent(json); return existingRef; }
      catch (e) { /* fall through and create a replacement */ }
    }
    const file = this.folder_().createFile(articleId + '-v' + version + '.json', json, 'application/json');
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    const ref = file.getId();
    const v = Db.findOne('Versions', { article_id: articleId, version: version });
    if (v && v.payload_ref !== ref) Db.update('Versions', { id: v.id }, { payload_ref: ref });
    return ref;
  },

  readPayload_: function (ref) {
    try { return JSON.parse(DriveApp.getFileById(ref).getBlob().getDataAsString()); }
    catch (e) { return { fields: {}, blocks: [], error: 'unreadable' }; }
  },

  summary_: function (a) {
    return {
      id: a.id, slug: a.slug, title: a.title, category: a.category,
      topics: asList(a.topics), tags: asList(a.tags), level: a.level, format: a.format,
      status: a.status, public_version: Number(a.public_version || 0),
      working_version: Number(a.working_version || 1),
      updated_at: a.updated_at, published_at: a.published_at || '', sponsored: a.sponsored === true
    };
  },

  alertEditors_: function (session, a) {
    const editors = Db.all('Users').filter(u =>
      ['SENIOR_EDITOR', 'SECTION_EDITOR', 'ADMINISTRATOR'].indexOf(u.role_id) !== -1 && Auth.isUsable(u));
    editors.forEach(u => {
      Notifications.push(u.id, 'submission', 'New submission: ' + a.title,
        session.user.name + ' submitted ' + a.id, 'articles');
    });
    if (editors.length) {
      Email.send(editors[0].email, 'submission_alert', {
        author_name: session.user.name, article_title: a.title,
        article_id: a.id, section: a.category
      }, session);
    }
  }
};
