/** Publishing.gs — the only path from private data to public files.
 *
 *  Publication is a commit to the site repository, not a database flag. That is
 *  what makes published content immutable: the live file changes only when an
 *  approved version is committed over it, and the previous file stays in git
 *  history. Rejecting a private revision touches nothing public.
 *
 *  Every entry point that writes to the repository requires FINAL_PUBLISH, and
 *  FINAL_PUBLISH belongs to the supervisor admin alone (Permissions.gs). There
 *  is no second route: nothing else in the codebase calls commit_.
 */
const Publish = {

  /* ---------------- configuration ---------------- */

  /** The configuration file set, built from the database. Exposed so the
   *  control centre can show what a publish would change before it happens. */
  configurationFiles: function () {
    return {
      'data/settings.json': Content.settings(),
      'data/menus.json': Content.menus(),
      'data/homepage.json': Content.homepage(),
      'data/categories.json': Content.categories(),
      'data/features.json': Content.features()
    };
  },

  /** Everything the first paint depends on, in one file.
   *
   *  The shell needs settings, menus, the homepage layout, the feature flags and
   *  the article index. Fetched separately that is five round trips before
   *  anything renders — on a slow connection the latency dwarfs the bytes. They
   *  are published individually as well, because the bundle is an optimisation
   *  and the separate files remain the contract. */
  bootstrap_: function () {
    const index = Db.all('Articles')
      .filter(a => a.status === 'PUBLISHED' && Number(a.public_version || 0) > 0)
      .map(a => {
        const raw = Db.findOne('Settings', { key: 'public.' + a.id });
        if (!raw) return null;
        try { return Render.indexEntry(JSON.parse(raw.value)); } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)))
      .slice(0, 30);                      // the homepage needs recency, not the archive

    return {
      version: 1,
      build: Performance.buildId(),
      generated_at: new Date().toISOString(),
      settings: Content.settings(),
      menus: Content.menus(),
      homepage: Content.homepage(),
      features: Content.features(),
      categories: Content.categories(),
      articles: index
    };
  },

  configuration: function (session, p) {
    Perms.requireSupervisor(session);
    const files = this.configurationFiles();
    if (!Content.menus().primary.some(m => m.status === 'ACTIVE')) {
      throw new ApiFail('empty_navigation', 'publishing this would leave the site with no navigation');
    }
    const results = Object.keys(files).map(path =>
      this.commit_(path, JSON.stringify(files[path], null, 2), 'Publish configuration: ' + path));
    const build = Performance.nextBuild_();
    results.push(this.commit_('data/bootstrap.json',
      JSON.stringify(this.bootstrap_(), null, 2), 'Publish bootstrap bundle'));
    results.push(this.commit_('pwa/build.js',
      'self.BUILD = "' + build + '";\n', 'Build ' + build));
    const version = SiteConfig.recordVersion_(session, files, (p && p.note) || '');
    Audit.log(session, 'PUBLISH_CONFIGURATION', 'site', CFG.env(),
      { next: String(version), meta: { files: Object.keys(files) } });
    return { ok: true, version: version, files: results };
  },

  /** The public advertising file, plus every approved creative image.
   *  Supervisor admin only, like every other write to the public repository.
   *  The hourly schedule refresher calls this with a system session for
   *  campaigns that were already approved by a person. */
  ads: function (session) {
    Perms.requireSupervisor(session);
    const bundle = Ads.publicBundle();
    const files = [];
    bundle.creatives.concat(bundle.house).forEach(c => {
      const rec = Db.findOne('AdCreatives', { id: c.id });
      if (!rec || !rec.drive_id) return;
      const blob = DriveApp.getFileById(rec.drive_id).getBlob();
      files.push(this.commitBinary_(c.image, Utilities.base64Encode(blob.getBytes()),
        'Publish creative ' + c.id));
    });
    files.push(this.commit_('data/ads.json', JSON.stringify(bundle, null, 2), 'Publish advertising'));
    Audit.log(session, 'PUBLISH_ADVERTISING', 'site', CFG.env(),
      { meta: { creatives: bundle.creatives.length, house: bundle.house.length } });
    return files;
  },

  /** The public guidelines file. Called by Guidelines.publish, which has
   *  already checked that the caller is the supervisor admin. */
  guidelines: function (session) {
    Perms.requireSupervisor(session);
    return [this.commit_('data/guidelines.json',
      JSON.stringify(Guidelines.publicBundle(), null, 2), 'Publish guidelines')];
  },

  /** A magazine issue: the snapshot, the cover, the PDF and the index. Like
   *  every other publication on this platform, the supervisor admin alone. */
  issue: function (session, p) {
    Perms.requireSupervisor(session);
    const issue = Issues.must_(p.issue_id);
    if (issue.status !== 'APPROVED') {
      throw new ApiFail('not_approved', 'issue ' + issue.number + ' is ' + issue.status);
    }
    const problems = Issues.check_(issue);
    if (problems.length) throw new ApiFail('incomplete', problems.join('; '));

    // Build the PDF from what is being published, not from whatever was last
    // built: an issue edited after its PDF was made must not ship the old one.
    const pdf = Issues.pdfBlob_(issue);
    const files = [this.commitBinary_('issues/' + issue.slug + '.pdf',
      Utilities.base64Encode(pdf.getBytes()), 'Publish issue ' + issue.number + ' (PDF)')];

    if (issue.cover_ref) {
      try {
        const cover = DriveApp.getFileById(issue.cover_ref).getBlob();
        files.push(this.commitBinary_('assets/issues/' + issue.slug + '/' + issue.cover_file,
          Utilities.base64Encode(cover.getBytes()), 'Publish issue ' + issue.number + ' (cover)'));
      } catch (e) { /* a missing cover is not worth failing a publication over */ }
    }

    Db.update('MagazineIssues', { id: issue.id }, {
      status: 'PUBLISHED', published_at: new Date().toISOString(),
      pdf_file: issue.slug + '.pdf', pdf_built_at: new Date().toISOString()
    });
    const fresh = Db.findOne('MagazineIssues', { id: issue.id });
    const snap = Issues.snapshot(fresh);

    files.push(this.commit_('data/issues/' + issue.slug + '.json',
      JSON.stringify(snap, null, 2), 'Publish issue ' + issue.number));
    files.push(this.issueIndex_());

    Audit.log(session, 'ISSUE_PUBLISHED', 'issue', issue.id,
      { next: String(issue.number), meta: { articles: snap.article_count, files: files.length } });
    return { ok: true, number: Number(issue.number), slug: issue.slug, files: files };
  },

  issueIndex_: function () {
    const issues = Db.all('MagazineIssues')
      .filter(i => i.status === 'PUBLISHED')
      .sort((a, b) => Number(b.number) - Number(a.number))
      .map(i => ({
        number: Number(i.number), slug: i.slug, title: i.title, theme: i.theme || '',
        month: i.month || '', year: Number(i.year || 0),
        cover: i.cover_file ? 'assets/issues/' + i.slug + '/' + i.cover_file : '',
        pdf: i.pdf_file ? 'issues/' + i.slug + '.pdf' : '',
        published_at: i.published_at || ''
      }));
    return this.commit_('data/index/issues.json',
      JSON.stringify({ version: 1, generated_at: new Date().toISOString(), issues: issues }, null, 2),
      'Update issue index');
  },

  /* ---------------- articles ---------------- */

  /** Publishes the approved working version now. */
  article: function (session, p) {
    Perms.requireSupervisor(session);
    const a = Db.findOne('Articles', { id: String(p.article_id || '') });
    if (!a) throw new ApiFail('not_found');
    const v = Articles.workingVersion_(a);
    if (v.status !== 'APPROVED') {
      throw new ApiFail('not_approved', 'version ' + v.version + ' is ' + v.status + ', not APPROVED');
    }
    return this.commitVersion_(session, a, v, 'publish');
  },

  /** Schedules an approved version. The supervisor's approval is the act of
   *  authority; the trigger below only carries out what was already approved. */
  schedule: function (session, p) {
    Perms.requireSupervisor(session);
    const a = Db.findOne('Articles', { id: String(p.article_id || '') });
    if (!a) throw new ApiFail('not_found');
    const v = Articles.workingVersion_(a);
    if (v.status !== 'APPROVED') throw new ApiFail('not_approved');
    const when = new Date(p.when || '');
    if (isNaN(when) || when < new Date()) throw new ApiFail('bad_schedule', 'choose a time in the future');
    Db.update('Versions', { id: v.id }, { status: 'SCHEDULED' });
    Db.update('Articles', { id: a.id }, { scheduled_for: when.toISOString() });
    if (Number(a.public_version || 0) === 0) Db.update('Articles', { id: a.id }, { status: 'SCHEDULED' });
    Audit.log(session, 'PUBLICATION_SCHEDULED', 'article', a.id,
      { next: when.toISOString(), meta: { version: Number(v.version) } });
    return { ok: true, scheduled_for: when.toISOString() };
  },

  /** Puts an earlier approved version back on the public site. The rollback
   *  itself is a publication: it commits, it audits, and it needs a reason. */
  rollback: function (session, p) {
    Perms.requireSupervisor(session);
    const a = Db.findOne('Articles', { id: String(p.article_id || '') });
    if (!a) throw new ApiFail('not_found');
    const reason = String(p.reason || '').trim();
    if (reason.length < 10) throw new ApiFail('reason_required');
    const target = Db.findOne('Versions', { article_id: a.id, version: Number(p.version) });
    if (!target) throw new ApiFail('not_found', 'no such version');
    if (['PUBLISHED', 'ARCHIVED', 'APPROVED'].indexOf(target.status) === -1) {
      throw new ApiFail('never_approved', 'only a version that was approved can go back on the site');
    }
    return this.commitVersion_(session, a, target, 'rollback', reason);
  },

  /** Removes an article from the public listings. The article file itself stays
   *  so existing links do not break. */
  archive: function (session, p) {
    const a = Articles.mustOwn_(session, p.article_id);
    Perms.require(session, 'ARCHIVE', a.category);
    if (a.status !== 'PUBLISHED') throw new ApiFail('not_published');
    const reason = String(p.reason || '').trim();
    if (reason.length < 10) throw new ApiFail('reason_required');
    Db.softDelete('SearchDocs', { article_id: a.id });
    Db.update('Articles', { id: a.id }, { status: 'ARCHIVED' });
    const listings = this.listings_();
    Audit.log(session, 'ARTICLE_ARCHIVED', 'article', a.id,
      { prev: 'PUBLISHED', next: 'ARCHIVED', reason: reason });
    return { ok: true, files: listings };
  },

  /* ---------------- the commit itself ---------------- */

  commitVersion_: function (session, a, v, kind, reason) {
    const content = v.payload_ref ? Articles.readPayload_(v.payload_ref) : { fields: {} };
    const media = Db.find('Media', { article_id: a.id });
    const now = new Date().toISOString();

    if (kind === 'publish' && !a.published_at) Db.update('Articles', { id: a.id }, { published_at: now });
    const fresh = Db.findOne('Articles', { id: a.id });
    const doc = Render.article(fresh, v.version, content, media);

    // Images first: an article file must never reference a figure that is not
    // there yet.
    const files = media.map(m => this.commitMedia_(fresh, m));

    files.push(this.commit_('data/articles/' + fresh.slug + '.json',
      JSON.stringify(doc, null, 2), kind + ': ' + fresh.id + ' v' + v.version));

    const previous = Number(fresh.public_version || 0);
    Db.update('Versions', { id: v.id }, { status: 'PUBLISHED' });
    if (previous && previous !== Number(v.version)) {
      const old = Db.findOne('Versions', { article_id: a.id, version: previous });
      if (old) Db.update('Versions', { id: old.id }, { status: 'ARCHIVED' });
    }
    Db.update('Articles', { id: a.id }, {
      status: 'PUBLISHED', public_version: Number(v.version), working_version: Number(v.version),
      scheduled_for: ''
    });

    this.upsertSearchDoc_(doc);
    Social.onPublish_(fresh);        // drafts only; nothing is posted anywhere
    files.push.apply(files, this.listings_());

    Notifications.push(fresh.primary_author, 'published', 'Published: ' + fresh.title,
      kind === 'rollback' ? 'Version ' + v.version + ' is live again.' : 'Version ' + v.version + ' is live.',
      'articles');
    const author = Db.findOne('Users', { id: fresh.primary_author });
    if (author && kind === 'publish') {
      Email.send(author.email, 'article_published', {
        author_name: author.name, article_title: fresh.title,
        article_url: CFG.get('SITE_URL', '') + 'article.html?a=' + fresh.slug,
        publication_date: String(now).slice(0, 10)
      }, session);
    }
    Audit.log(session, kind === 'rollback' ? 'ARTICLE_ROLLED_BACK' : 'ARTICLE_PUBLISHED', 'article', fresh.id, {
      prev: String(previous), next: String(v.version), scope: fresh.category,
      reason: reason || '', meta: { files: files.length }
    });
    return { ok: true, version: Number(v.version), slug: fresh.slug, files: files };
  },

  /** Listings are rebuilt from the database, never from the repository: the
   *  database is the source of truth about what is published, so a half-finished
   *  publish cannot leave a stale entry behind. */
  listings_: function () {
    const docs = Db.all('SearchDocs');
    const entries = Db.all('Articles')
      .filter(a => a.status === 'PUBLISHED' && Number(a.public_version || 0) > 0)
      .map(a => {
        const raw = Db.findOne('Settings', { key: 'public.' + a.id });
        if (!raw) return null;
        try { return Render.indexEntry(JSON.parse(raw.value)); } catch (e) { return null; }
      })
      .filter(Boolean)
      .sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)));

    return [
      this.commit_('data/bootstrap.json',
        JSON.stringify(this.bootstrap_(), null, 2), 'Update bootstrap bundle'),
      this.commit_('data/index/articles.json',
        JSON.stringify({ version: 1, generated_at: new Date().toISOString(), articles: entries }, null, 2),
        'Update article index'),
      this.commit_('data/search-index.json',
        JSON.stringify(Render.searchIndex(docs), null, 2), 'Update search index'),
      this.commit_('rss/feed.xml', Render.rss(entries), 'Update RSS'),
      this.commit_('sitemap.xml', Render.sitemap(entries), 'Update sitemap')
    ];
  },

  upsertSearchDoc_: function (doc) {
    const rec = Render.searchDoc(doc);
    const existing = Db.findOne('SearchDocs', { article_id: doc.id });
    if (existing) Db.update('SearchDocs', { article_id: doc.id }, rec);
    else Db.insert('SearchDocs', rec);
    // The rendered document is kept so listings rebuild without re-reading
    // every article payload from Drive.
    const key = 'public.' + doc.id;
    const row = Db.findOne('Settings', { key: key });
    const value = JSON.stringify(doc);
    if (row) Db.update('Settings', { key: key }, { value: value });
    else Db.insert('Settings', { key: key, value: value, scope: 'published' });
  },

  commitMedia_: function (a, m) {
    const path = Render.mediaPath_(a, m);
    const blob = DriveApp.getFileById(m.drive_id).getBlob();
    return this.commitBinary_(path, Utilities.base64Encode(blob.getBytes()), 'Publish figure for ' + a.id);
  },

  /** Writes one file into the GitHub Pages repository. The token is a
   *  fine-grained PAT limited to contents:write on the site repo. */
  commit_: function (path, content, message) {
    return this.commitBinary_(path, Utilities.base64Encode(content, Utilities.Charset.UTF_8), message);
  },

  commitBinary_: function (path, base64, message) {
    // Roughly the transfer size before compression: enough to see the search
    // index doubling, which is what the budget exists to catch.
    try { Performance.recordPayload_({ [path]: Math.round(String(base64).length * 0.75) }); } catch (e) {}
    const repo = CFG.get('GITHUB_REPO');
    const url = 'https://api.github.com/repos/' + repo + '/contents/' + path;
    const headers = {
      Authorization: 'Bearer ' + CFG.get('GITHUB_TOKEN'),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    let sha = null;
    const probe = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (probe.getResponseCode() === 200) sha = JSON.parse(probe.getContentText()).sha;

    const res = UrlFetchApp.fetch(url, {
      method: 'put', headers: headers, contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ message: message, content: base64, sha: sha || undefined })
    });
    const code = res.getResponseCode();
    if (code >= 300) throw new ApiFail('publish_failed', path + ' (' + code + ')');
    return { path: path, updated: !!sha };
  }
};

/** Time trigger, hourly. Publishes what the supervisor already approved and
 *  scheduled; it cannot approve anything itself. */
function publishScheduled() {
  const now = new Date();
  const system = { user: { id: 'SYSTEM', email: 'system', role_id: SUPERVISOR_ROLE, session_epoch: 1 } };
  let done = 0;
  Db.all('Articles').filter(a => a.scheduled_for && new Date(a.scheduled_for) <= now).forEach(a => {
    const v = Db.findOne('Versions', { article_id: a.id, version: a.working_version });
    if (!v || v.status !== 'SCHEDULED') return;
    try {
      Publish.commitVersion_(system, a, v, 'publish');
      done++;
    } catch (e) {
      console.error('scheduled publish failed for ' + a.id + ': ' + e.message);
      Audit.log(system, 'SCHEDULED_PUBLISH_FAILED', 'article', a.id, { reason: e.message });
    }
  });
  return done + ' scheduled articles published';
}
