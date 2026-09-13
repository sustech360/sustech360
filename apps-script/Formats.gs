/** Formats.gs — the editorial rulebook.
 *
 *  Read side: the portal renders whatever this returns, so adding a format or a
 *  checklist item changes the author's screen with no deployment.
 *
 *  Write side: the control centre edits these directly rather than through the
 *  guideline approval chain, and deliberately so. A format definition is a tool
 *  the editorial team uses in private, not a public document; what it must be
 *  is auditable and non-destructive, and it is both. Nothing here is ever
 *  deleted — fields and items deactivate, so drafts written against them keep
 *  their content and their history.
 */
const Formats = {

  /* ---------------- read ---------------- */

  bundle: function (session) {
    Perms.require(session, 'VIEW');
    return {
      formats: this.formats(),
      checklist: this.checklist(),
      categories: Content.categories().categories,
      levels: [
        { id: 'discover', name: 'Discover', help: 'A general reader with no background in the field.' },
        { id: 'understand', name: 'Understand', help: 'Students and technical readers outside the speciality.' },
        { id: 'research', name: 'Research', help: 'Specialists. Assume the vocabulary.' }
      ],
      rules: this.rules(),
      guidelines: this.guidelines(),
      documents: Guidelines.forAuthors()
    };
  },

  /** Everything, including inactive formats and fields. Control centre only. */
  all: function (session) {
    Perms.require(session, 'MANAGE');
    return {
      formats: Db.all('ArticleFormats')
        .sort((a, b) => Number(a.order) - Number(b.order))
        .map(f => ({
          id: f.id, slug: f.slug, name: f.name, description: f.description,
          status: f.status, order: Number(f.order || 0), words: this.words_(f.slug),
          fields: Db.find('FormatFields', { format_id: f.id })
            .sort((a, b) => Number(a.order) - Number(b.order))
            .map(x => ({
              id: x.id, field: x.field, label: x.label, help: x.help,
              required: x.required === true || x.required === 'TRUE',
              status: x.status || 'ACTIVE', order: Number(x.order || 0)
            }))
        })),
      checklist: Db.all('SubmissionChecklist')
        .sort((a, b) => Number(a.order) - Number(b.order))
        .map(c => ({ id: c.id, item: c.item, status: c.status, order: Number(c.order || 0),
                     required: c.required === true || c.required === 'TRUE' })),
      rules: this.rules()
    };
  },

  formats: function () {
    return Db.all('ArticleFormats')
      .filter(f => f.status === 'ACTIVE')
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map(f => ({
        slug: f.slug, name: f.name, description: f.description, words: this.words_(f.slug),
        fields: this.fields(f.id).map(x => ({
          field: x.field, label: x.label, help: x.help,
          required: x.required === true || x.required === 'TRUE'
        }))
      }));
  },

  /** Active fields only, in order. The submission gate and the renderer both
   *  read through here, so a deactivated field stops being required and stops
   *  being published in the same moment. */
  fields: function (formatId) {
    return Db.find('FormatFields', { format_id: formatId })
      .filter(x => (x.status || 'ACTIVE') === 'ACTIVE')
      .sort((a, b) => Number(a.order) - Number(b.order));
  },

  checklist: function () {
    return Db.all('SubmissionChecklist')
      .filter(c => c.status === 'ACTIVE')
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map(c => ({ id: c.id, item: c.item, required: c.required === true || c.required === 'TRUE' }));
  },

  /** Writing and media rules, with the defaults that apply until someone sets
   *  them. Both are enforced server-side: writing rules in the submission gate,
   *  media rules on upload. */
  rules: function () {
    return {
      writing: Object.assign({
        title_max: 90, summary_min_words: 20, summary_max_words: 90,
        citation_style: 'Author, journal, volume, page, year.',
        units: 'SI units. Write numbers as digits from ten upwards.'
      }, this.setting_('writing.rules')),
      media: Object.assign({
        mime: LIMITS.MEDIA_MIME.slice(), max_bytes: Math.round(LIMITS.MAX_MEDIA_BYTES * 0.75),
        min_pixels: LIMITS.MIN_IMAGE_PIXELS, credit_required: true, licence_required: true,
        caption_required: false
      }, this.setting_('media.rules'))
    };
  },

  guidelines: function () {
    const live = Guidelines.live_('AUTHOR');
    if (!live) return { version: '0', title: 'Author guidelines', body: DEFAULT_GUIDELINES_ };
    return { version: live.version, title: live.title, body: Guidelines.readBody_(live) };
  },

  /* ---------------- write ---------------- */

  saveFormat: function (session, p) {
    Perms.require(session, 'MANAGE');
    const slug = String(p.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    if (slug.length < 3) throw new ApiFail('bad_slug');
    const existing = Db.findOne('ArticleFormats', { slug: slug });
    const patch = {
      name: String(p.name || slug).slice(0, 80),
      description: String(p.description || '').slice(0, 400),
      status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      order: Number(p.order || (existing ? existing.order : Db.all('ArticleFormats').length + 1))
    };

    let rec;
    if (existing) {
      // Retiring a format must not orphan work already written in it.
      if (patch.status === 'INACTIVE') {
        const inFlight = Db.all('Articles').filter(a =>
          a.format === slug && ['PUBLISHED', 'ARCHIVED', 'REJECTED'].indexOf(a.status) === -1);
        if (inFlight.length) {
          throw new ApiFail('format_in_use', inFlight.length + ' article(s) are still being written in this format');
        }
      }
      rec = Db.update('ArticleFormats', { id: existing.id }, patch);
      Audit.log(session, 'FORMAT_UPDATED', 'format', existing.id,
        { prev: existing.status, next: patch.status, meta: { slug: slug } });
    } else {
      rec = Db.insert('ArticleFormats', Object.assign({ id: Db.newId('FMT'), slug: slug }, patch));
      (p.fields || FORMAT_FIELDS_.default).forEach((f, i) => {
        const spec = Array.isArray(f) ? { field: f[0], label: f[1], required: f[2], help: f[3] } : f;
        Db.insert('FormatFields', {
          id: Db.newId('FLD'), format_id: rec.id, field: spec.field, label: spec.label,
          required: spec.required === true, order: i + 1, help: spec.help || '', status: 'ACTIVE'
        });
      });
      Audit.log(session, 'FORMAT_CREATED', 'format', rec.id, { next: slug });
    }

    if (p.words) {
      const words = { recommended: Number(p.words.recommended || 0), max: Number(p.words.max || 0) };
      if (words.max && words.recommended && words.max < words.recommended) throw new ApiFail('bad_word_limits');
      this.putSetting_(session, 'formats.' + slug + '.words', words, 'editorial');
    }
    return { ok: true, slug: slug, id: rec.id };
  },

  saveField: function (session, p) {
    Perms.require(session, 'MANAGE');
    const format = Db.findOne('ArticleFormats', { slug: String(p.format || '') });
    if (!format) throw new ApiFail('unknown_format');
    const key = String(p.field || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (key.length < 2) throw new ApiFail('bad_field');
    const existing = Db.findOne('FormatFields', { format_id: format.id, field: key });
    const patch = {
      label: String(p.label || key).slice(0, 80),
      help: String(p.help || '').slice(0, 300),
      required: p.required === true,
      order: Number(p.order || (existing ? existing.order : Db.find('FormatFields', { format_id: format.id }).length + 1)),
      status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
    };
    if (existing) {
      Db.update('FormatFields', { id: existing.id }, patch);
      Audit.log(session, 'FORMAT_FIELD_UPDATED', 'format', format.id,
        { prev: existing.status || 'ACTIVE', next: patch.status, meta: { field: key, required: patch.required } });
    } else {
      Db.insert('FormatFields', Object.assign({ id: Db.newId('FLD'), format_id: format.id, field: key }, patch));
      Audit.log(session, 'FORMAT_FIELD_ADDED', 'format', format.id,
        { next: key, meta: { required: patch.required } });
    }
    return { ok: true, field: key };
  },

  saveChecklistItem: function (session, p) {
    Perms.require(session, 'MANAGE');
    const text = String(p.item || '').trim();
    if (p.id) {
      const existing = Db.findOne('SubmissionChecklist', { id: String(p.id) });
      if (!existing) throw new ApiFail('not_found');
      const patch = {
        item: text || existing.item,
        required: p.required === undefined ? existing.required : p.required === true,
        status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        order: Number(p.order || existing.order)
      };
      Db.update('SubmissionChecklist', { id: existing.id }, patch);
      Audit.log(session, 'CHECKLIST_UPDATED', 'checklist', existing.id,
        { prev: existing.status, next: patch.status, meta: { item: patch.item } });
      return { ok: true, id: existing.id };
    }
    if (text.length < 10) throw new ApiFail('item_too_short', 'write it as something an author can confirm');
    const rec = Db.insert('SubmissionChecklist', {
      id: Db.newId('CHK'), item: text, required: p.required !== false,
      order: Number(p.order || Db.all('SubmissionChecklist').length + 1), status: 'ACTIVE'
    });
    Audit.log(session, 'CHECKLIST_ADDED', 'checklist', rec.id, { next: text });
    return { ok: true, id: rec.id };
  },

  saveRules: function (session, p) {
    Perms.require(session, 'MANAGE');
    const current = this.rules();
    if (p.writing) {
      const w = Object.assign({}, current.writing, p.writing);
      w.title_max = Math.max(20, Math.min(200, Number(w.title_max) || 90));
      w.summary_min_words = Math.max(0, Number(w.summary_min_words) || 0);
      w.summary_max_words = Math.max(w.summary_min_words + 5, Number(w.summary_max_words) || 90);
      this.putSetting_(session, 'writing.rules', w, 'editorial');
      Audit.log(session, 'WRITING_RULES_CHANGED', 'settings', 'writing.rules', { meta: w });
    }
    if (p.media) {
      const m = Object.assign({}, current.media, p.media);
      // The upload path enforces these, so a sloppy value here is a real hole.
      m.mime = (m.mime || []).filter(x => /^image\/[a-z0-9.+-]+$/.test(String(x)));
      if (!m.mime.length) throw new ApiFail('bad_media_rules', 'list at least one accepted image type');
      m.max_bytes = Math.max(100000, Math.min(LIMITS.MAX_MEDIA_BYTES, Number(m.max_bytes) || 4000000));
      m.min_pixels = Math.max(0, Number(m.min_pixels) || 0);
      this.putSetting_(session, 'media.rules', m, 'editorial');
      Audit.log(session, 'MEDIA_RULES_CHANGED', 'settings', 'media.rules', { meta: { mime: m.mime, max_bytes: m.max_bytes } });
    }
    return { ok: true, rules: this.rules() };
  },

  /* ---------------- internals ---------------- */

  words_: function (slug) {
    return this.setting_('formats.' + slug + '.words') || {};
  },

  setting_: function (key) {
    const row = Db.findOne('Settings', { key: key });
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (e) { return null; }
  },

  putSetting_: function (session, key, value, scope) {
    const row = Db.findOne('Settings', { key: key });
    const payload = JSON.stringify(value);
    if (row) Db.update('Settings', { key: key }, { value: payload, updated_by: session.user.id });
    else Db.insert('Settings', { key: key, value: payload, scope: scope || 'editorial', updated_by: session.user.id });
  }
};

/** The text an AUTHOR guideline starts from before anyone edits it. Deliberately
 *  short: rules nobody reads protect nobody. */
const DEFAULT_GUIDELINES_ =
  'Who writes here\n' +
  'Contribution is by invitation. Your invitation named a section and a format; write to those.\n\n' +
  'Originality\n' +
  'The article must be yours and unpublished elsewhere. Reusing your own earlier work is fine if you say so.\n\n' +
  'Evidence\n' +
  'Every claim that a reader might reasonably doubt needs a source. Reference primary literature, not press releases.\n\n' +
  'Figures\n' +
  'Supply the figure, a caption, a credit and a licence. If you cannot state the licence, we cannot publish the image.\n\n' +
  'Declarations\n' +
  'Declare funding, commercial interests, and any use of AI tools beyond spelling and grammar.\n\n' +
  'Editing\n' +
  'We edit for clarity and house style, and send substantive changes back to you before publication.\n\n' +
  'After publication\n' +
  'Published articles are not edited in place. Corrections create a new version, and the record shows what changed.';
