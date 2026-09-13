/** Issues.gs — magazine issues, web and PDF.
 *
 *  An issue is a fixed selection of already-published articles, wrapped in an
 *  editorial and given a cover. Two consequences follow from that sentence and
 *  both are enforced here:
 *
 *    - nothing can go into an issue that is not already public. An issue is not
 *      a second publishing route, and the supervisor's approval of an article is
 *      not something an issue can bypass.
 *    - once published, an issue holds a snapshot of what those articles said.
 *      Articles carry on being revised and archived afterwards; a printed issue
 *      cannot change, so the web and PDF editions do not either.
 *
 *  On the PDF: Apps Script has no typesetting engine. What it has is an HTML
 *  blob that can convert itself, which handles headings, paragraphs, images and
 *  page breaks and ignores almost everything else. There are no page numbers,
 *  no running heads and no columns. That is stated plainly in the status notes
 *  rather than papered over here — the output is a readable document, not a
 *  designed magazine, and pretending otherwise would waste someone's afternoon.
 */

const ISSUE_SECTIONS = [
  { key: 'editorial', name: 'Editorial' },
  { key: 'features', name: 'Features' },
  { key: 'research', name: 'Research' },
  { key: 'innovation', name: 'Innovation' },
  { key: 'news', name: 'News and analysis' },
  { key: 'opinion', name: 'Opinion' }
];

const ISSUE_TRANSITIONS = [
  { from: 'DRAFT',    to: 'PREVIEW',   perm: 'MANAGE' },
  { from: 'PREVIEW',  to: 'DRAFT',     perm: 'MANAGE' },
  { from: 'PREVIEW',  to: 'VERIFIED',  perm: 'APPROVE' },
  { from: 'VERIFIED', to: 'PREVIEW',   perm: 'APPROVE',       reason: true },
  { from: 'VERIFIED', to: 'APPROVED',  perm: 'FINAL_PUBLISH' },
  { from: 'DRAFT',    to: 'DISCARDED', perm: 'MANAGE',        reason: true },
  { from: 'PREVIEW',  to: 'DISCARDED', perm: 'MANAGE',        reason: true }
];

const Issues = {

  /* ---------------- reading ---------------- */

  list: function (session) {
    Perms.require(session, 'VIEW');
    return Db.all('MagazineIssues')
      .sort((a, b) => Number(b.number) - Number(a.number))
      .map(i => this.shape_(i));
  },

  get: function (session, p) {
    Perms.require(session, 'VIEW');
    const issue = this.must_(p.id);
    const contents = this.contents_(issue);
    return Object.assign(this.shape_(issue), {
      editorial: this.readText_(issue.editorial_ref),
      contents: contents,
      available: this.available_(contents),
      sections: ISSUE_SECTIONS,
      moves: ISSUE_TRANSITIONS
        .filter(e => e.from === issue.status && Perms.has(session.user, e.perm))
        .map(e => ({ to: e.to, needs_reason: !!e.reason }))
    });
  },

  /** Published articles not already placed in this issue. */
  available_: function (contents) {
    const taken = {};
    Object.keys(contents).forEach(k => (contents[k] || []).forEach(id => { taken[id] = true; }));
    return Db.all('Articles')
      .filter(a => a.status === 'PUBLISHED' && Number(a.public_version || 0) > 0 && !taken[a.id])
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
      .map(a => ({ id: a.id, title: a.title, category: a.category, published_at: a.published_at }));
  },

  /* ---------------- composing ---------------- */

  create: function (session, p) {
    Perms.require(session, 'MANAGE');
    const number = Number(p.number || 0);
    if (!number || number < 1) throw new ApiFail('bad_number');
    if (Db.findOne('MagazineIssues', { number: number })) throw new ApiFail('already_exists', 'issue ' + number + ' exists');
    const year = Number(p.year || new Date().getFullYear());
    const month = String(p.month || '').slice(0, 20);
    const rec = Db.insert('MagazineIssues', {
      id: Db.newId('ISS'), number: number, slug: 'issue-' + number,
      title: String(p.title || 'Issue ' + number).slice(0, 120),
      theme: String(p.theme || '').slice(0, 200),
      month: month, year: year, contents: '{}', status: 'DRAFT', created_by: session.user.id
    });
    Audit.log(session, 'ISSUE_CREATED', 'issue', rec.id, { next: String(number) });
    return this.shape_(Db.findOne('MagazineIssues', { id: rec.id }));
  },

  save: function (session, p) {
    Perms.require(session, 'MANAGE');
    const issue = this.must_(p.id);
    if (['DRAFT', 'PREVIEW'].indexOf(issue.status) === -1) {
      throw new ApiFail('locked', 'send it back to draft before editing');
    }
    const patch = {};
    if (p.title) patch.title = String(p.title).slice(0, 120);
    if (p.theme != null) patch.theme = String(p.theme).slice(0, 200);
    if (p.month != null) patch.month = String(p.month).slice(0, 20);
    if (p.year) patch.year = Number(p.year);

    if (p.contents) {
      const clean = {};
      Object.keys(p.contents).forEach(section => {
        if (!ISSUE_SECTIONS.some(s => s.key === section)) throw new ApiFail('bad_section', section);
        clean[section] = (p.contents[section] || []).map(String).filter(id => {
          const a = Db.findOne('Articles', { id: id });
          // The rule that makes an issue a collection rather than a back door.
          if (!a) throw new ApiFail('not_found', id);
          if (a.status !== 'PUBLISHED' || !Number(a.public_version || 0)) {
            Audit.log(session, 'ISSUE_UNPUBLISHED_BLOCKED', 'issue', issue.id, { meta: { article: id } });
            throw new ApiFail('not_published', a.title + ' is not published yet');
          }
          return true;
        });
      });
      patch.contents = JSON.stringify(clean);
    }
    if (p.editorial != null) {
      patch.editorial_ref = this.writeText_(issue, 'editorial', String(p.editorial));
    }
    // Any change invalidates a PDF built from what came before.
    patch.pdf_built_at = '';
    Db.update('MagazineIssues', { id: issue.id }, patch);
    return { ok: true };
  },

  uploadCover: function (session, p) {
    Perms.require(session, 'MANAGE');
    const issue = this.must_(p.id);
    const rules = Formats.rules().media;
    const mime = String(p.mime || '');
    if (rules.mime.indexOf(mime) === -1) throw new ApiFail('bad_type', 'accepted: ' + rules.mime.join(', '));
    const bytes = Utilities.base64Decode(String(p.data || ''));
    if (!bytes.length) throw new ApiFail('empty_file');
    if (bytes.length > rules.max_bytes) throw new ApiFail('too_large');
    if (!p.credit || !p.licence) throw new ApiFail('credit_required', 'a cover needs a credit and a licence');

    const name = String(p.file || 'cover').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
    const file = this.folder_().createFile(Utilities.newBlob(bytes, mime, name));
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    Db.update('MagazineIssues', { id: issue.id }, {
      cover_ref: file.getId(), cover_file: name, pdf_built_at: '',
      notes: 'Cover: ' + String(p.credit).slice(0, 80) + ' (' + String(p.licence).slice(0, 40) + ')'
    });
    Audit.log(session, 'ISSUE_COVER_SET', 'issue', issue.id, { meta: { bytes: bytes.length } });
    return { ok: true, bytes: bytes.length };
  },

  /* ---------------- workflow ---------------- */

  move: function (session, p) {
    Perms.require(session, 'REVIEW');
    const issue = this.must_(p.id);
    const to = String(p.to || '');
    const edge = ISSUE_TRANSITIONS.filter(e => e.from === issue.status && e.to === to)[0];
    if (!edge) throw new ApiFail('illegal_transition', issue.status + ' cannot become ' + to);
    Perms.require(session, edge.perm);
    const reason = String(p.reason || '').trim();
    if (edge.reason && reason.length < 10) throw new ApiFail('reason_required');

    if (to === 'VERIFIED' || to === 'APPROVED') {
      const problems = this.check_(issue);
      if (problems.length) throw new ApiFail('incomplete', problems.join('; '));
    }
    const patch = { status: to };
    if (reason) patch.notes = reason;
    if (to === 'APPROVED') { patch.approved_by = session.user.id; patch.approved_at = new Date().toISOString(); }
    Db.update('MagazineIssues', { id: issue.id }, patch);
    Audit.log(session, 'ISSUE_TRANSITION', 'issue', issue.id, { prev: issue.status, next: to, reason: reason });
    return { ok: true, status: to };
  },

  check_: function (issue) {
    const out = [];
    const contents = this.contents_(issue);
    const count = Object.keys(contents).reduce((n, k) => n + (contents[k] || []).length, 0);
    if (!count) out.push('The issue has no articles in it');
    if (!String(issue.title || '').trim()) out.push('The issue needs a title');
    if (!issue.editorial_ref) out.push('Write the editorial');
    // An article pulled from the site after it was placed should not be
    // discovered at publication time.
    Object.keys(contents).forEach(section => {
      (contents[section] || []).forEach(id => {
        const a = Db.findOne('Articles', { id: id });
        if (!a || a.status !== 'PUBLISHED') out.push('"' + ((a && a.title) || id) + '" is no longer published');
      });
    });
    return out;
  },

  /* ---------------- the documents ---------------- */

  /** What the web edition reads: a snapshot, taken now, of what these articles
   *  say now. Later revisions do not reach back into a published issue. */
  snapshot: function (issue) {
    const contents = this.contents_(issue);
    const sections = ISSUE_SECTIONS.map(s => {
      const items = (contents[s.key] || []).map(id => {
        const a = Db.findOne('Articles', { id: id });
        const doc = this.published_(id);
        if (!a || !doc) return null;
        return {
          id: a.id, slug: a.slug, title: doc.title, subtitle: doc.subtitle || '',
          summary: doc.summary, category_name: doc.category_name,
          authors: (doc.authors || []).map(x => ({ name: x.name, institution: x.institution })),
          reading_minutes: doc.reading_minutes, version: doc.public_version,
          blocks: doc.blocks || []
        };
      }).filter(Boolean);
      return { key: s.key, name: s.name, items: items };
    }).filter(s => s.items.length);

    return {
      version: 1, number: Number(issue.number), slug: issue.slug,
      title: issue.title, theme: issue.theme || '',
      month: issue.month || '', year: Number(issue.year || 0),
      cover: issue.cover_file ? 'assets/issues/' + issue.slug + '/' + issue.cover_file : '',
      editorial: this.readText_(issue.editorial_ref),
      pdf: issue.pdf_file ? 'issues/' + issue.slug + '.pdf' : '',
      published_at: issue.published_at || new Date().toISOString(),
      sections: sections,
      article_count: sections.reduce((n, s) => n + s.items.length, 0)
    };
  },

  /** Builds the PDF and keeps it in Drive. Separated from publication so an
   *  editor can read the real document before anyone approves it. */
  buildPdf: function (session, p) {
    Perms.require(session, 'MANAGE');
    const issue = this.must_(p.id);
    const blob = this.pdfBlob_(issue);
    let file;
    if (issue.pdf_ref) {
      try { file = DriveApp.getFileById(issue.pdf_ref); file.setContent(blob.getDataAsString()); }
      catch (e) { file = null; }
    }
    if (!file) {
      file = this.folder_().createFile(blob);
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }
    Db.update('MagazineIssues', { id: issue.id }, {
      pdf_ref: file.getId(), pdf_file: issue.slug + '.pdf', pdf_built_at: new Date().toISOString()
    });
    Audit.log(session, 'ISSUE_PDF_BUILT', 'issue', issue.id, { meta: { bytes: blob.getBytes().length } });
    return { ok: true, bytes: blob.getBytes().length, built_at: new Date().toISOString() };
  },

  pdfBlob_: function (issue) {
    const html = this.renderHtml_(issue);
    return Utilities.newBlob(html, 'text/html', issue.slug + '.html').getAs('application/pdf');
  },

  /** Deliberately plain HTML. The converter honours block layout, headings,
   *  images and page breaks, and silently drops the rest. */
  renderHtml_: function (issue) {
    const snap = this.snapshot(issue);
    const esc = s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const parts = [];
    parts.push('<html><head><meta charset="utf-8"><title>' + esc(snap.title) + '</title><style>' +
      'body{font-family:Georgia,serif;font-size:11pt;line-height:1.5;color:#111}' +
      'h1{font-size:26pt;margin:0 0 8pt}h2{font-size:15pt;margin:18pt 0 6pt}h3{font-size:12pt;margin:12pt 0 4pt}' +
      '.cover{text-align:center;padding:80pt 0}.meta{color:#555;font-size:9pt}' +
      '.break{page-break-before:always}.section{page-break-before:always}' +
      'figcaption{font-size:9pt;color:#555}ol.refs{font-size:9pt;color:#333}' +
      '</style></head><body>');

    parts.push('<div class="cover"><h1>' + esc(snap.title) + '</h1>' +
      (snap.theme ? '<p>' + esc(snap.theme) + '</p>' : '') +
      '<p class="meta">Issue ' + snap.number + ' · ' + esc(snap.month) + ' ' + snap.year + '</p>' +
      '<p class="meta">' + esc(Email.brand_()) + '</p></div>');

    parts.push('<div class="break"><h2>Contents</h2><ol>');
    snap.sections.forEach(s => s.items.forEach(a => {
      parts.push('<li>' + esc(a.title) + ' <span class="meta">— ' + esc(s.name) + '</span></li>');
    }));
    parts.push('</ol></div>');

    if (snap.editorial) {
      parts.push('<div class="section"><h2>Editorial</h2>');
      String(snap.editorial).split(/\n{2,}/).forEach(p2 => parts.push('<p>' + esc(p2) + '</p>'));
      parts.push('</div>');
    }

    snap.sections.forEach(section => {
      parts.push('<div class="section"><h2>' + esc(section.name) + '</h2></div>');
      section.items.forEach(a => {
        parts.push('<div class="break"><h2>' + esc(a.title) + '</h2>');
        if (a.subtitle) parts.push('<p><em>' + esc(a.subtitle) + '</em></p>');
        parts.push('<p class="meta">' + esc(a.authors.map(x => x.name + (x.institution ? ', ' + x.institution : '')).join(' · ')) +
          ' · ' + a.reading_minutes + ' min read · version ' + a.version + '</p>');
        if (a.summary) parts.push('<p><strong>' + esc(a.summary) + '</strong></p>');
        (a.blocks || []).forEach(b => {
          if (b.type === 'h2') parts.push('<h3>' + esc(b.text) + '</h3>');
          else if (b.type === 'h3') parts.push('<h3>' + esc(b.text) + '</h3>');
          else if (b.type === 'p') parts.push('<p>' + esc(b.text) + '</p>');
          else if (b.type === 'quote') parts.push('<blockquote>' + esc(b.text) + '</blockquote>');
          else if (b.type === 'list') parts.push('<ul>' + (b.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>');
          else if (b.type === 'figure') parts.push('<p class="meta">[Figure: ' + esc(b.caption || b.alt || '') + ']</p>');
          else if (b.type === 'references') {
            parts.push('<h3>References</h3><ol class="refs">' +
              (b.items || []).map(i => '<li>' + esc(i) + '</li>').join('') + '</ol>');
          }
        });
        parts.push('</div>');
      });
    });

    parts.push('<div class="break"><p class="meta">' + esc(Email.brand_()) + ' · Issue ' + snap.number +
      ' · ' + esc(this.copyNotice_()) + '</p></div>');
    parts.push('</body></html>');
    return parts.join('\n');
  },

  copyNotice_: function () {
    const row = Db.findOne('Settings', { key: 'reading.copy_notice' });
    return (row && row.value) || 'Quote with attribution.';
  },

  /* ---------------- internals ---------------- */

  shape_: function (i) {
    const contents = this.contents_(i);
    return {
      id: i.id, number: Number(i.number), slug: i.slug, title: i.title, theme: i.theme || '',
      month: i.month || '', year: Number(i.year || 0), status: i.status,
      cover: i.cover_file || '', has_pdf: !!i.pdf_ref, pdf_built_at: i.pdf_built_at || '',
      article_count: Object.keys(contents).reduce((n, k) => n + (contents[k] || []).length, 0),
      approved_by: i.approved_by || '', published_at: i.published_at || '', notes: i.notes || ''
    };
  },

  contents_: function (i) {
    try { return JSON.parse(i.contents || '{}'); } catch (e) { return {}; }
  },

  published_: function (id) {
    const row = Db.findOne('Settings', { key: 'public.' + id });
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (e) { return null; }
  },

  must_: function (id) {
    const i = Db.findOne('MagazineIssues', { id: String(id || '') });
    if (!i) throw new ApiFail('not_found');
    return i;
  },

  writeText_: function (issue, kind, text) {
    const name = issue.slug + '-' + kind + '.txt';
    const existing = kind === 'editorial' ? issue.editorial_ref : '';
    if (existing) {
      try { DriveApp.getFileById(existing).setContent(text); return existing; } catch (e) {}
    }
    const file = this.folder_().createFile(name, text, 'text/plain');
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    return file.getId();
  },

  readText_: function (ref) {
    if (!ref) return '';
    try { return DriveApp.getFileById(ref).getBlob().getDataAsString(); } catch (e) { return ''; }
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('issues');
    return it.hasNext() ? it.next() : root.createFolder('issues');
  }
};
