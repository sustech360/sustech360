/** SiteConfig.gs — everything the specification calls configurable.
 *
 *  Nothing here touches the public site. Editing a menu or a homepage section
 *  changes the database; readers keep seeing the last published configuration
 *  until a supervisor admin publishes. That is the same private-until-approved
 *  property articles and guidelines have, and it comes free from the static
 *  architecture rather than from bookkeeping.
 *
 *  What this file does carry is validation, because a menu URL and an appearance
 *  token both end up inside the public page.
 */
const SiteConfig = {

  /* ---------------- reading ---------------- */

  all: function (session) {
    Perms.require(session, 'MANAGE');
    return {
      menus: Db.all('Menus').sort((a, b) => Number(a.order) - Number(b.order)).map(m => ({
        id: m.id, menu: m.menu, name: m.name, url: m.url, parent: m.parent || '',
        order: Number(m.order || 0), status: m.status, scope: m.scope || ''
      })),
      homepage: Db.all('Homepage').sort((a, b) => Number(a.order) - Number(b.order)).map(s => ({
        id: s.id, section_id: s.section_id, type: s.type, title: s.title, source: s.source,
        count: Number(s.count || 0), layout: s.layout, order: Number(s.order || 0),
        active: s.active === true || s.active === 'TRUE', starts: s.starts || '', ends: s.ends || '',
        items: asList(s.items)
      })),
      categories: Db.all('Categories').sort((a, b) => Number(a.order) - Number(b.order)),
      features: Db.all('Features').map(f => ({
        flag: f.flag, state: f.state, starts: f.starts || '', ends: f.ends || '',
        locked: f.locked === true || f.locked === 'TRUE', note: f.note || ''
      })),
      settings: Content.settings(),
      live: this.liveVersion_()
    };
  },

  /* ---------------- menus ---------------- */

  saveMenu: function (session, p) {
    Perms.require(session, 'MANAGE');
    const menu = ['primary', 'footer'].indexOf(String(p.menu)) !== -1 ? String(p.menu) : 'primary';
    const url = this.safeUrl_(p.url);
    const name = String(p.name || '').trim().slice(0, 60);
    if (name.length < 2) throw new ApiFail('bad_name');
    const status = ['ACTIVE', 'PAUSED', 'DISABLED'].indexOf(String(p.status)) !== -1 ? String(p.status) : 'ACTIVE';

    const existing = p.id ? Db.findOne('Menus', { id: String(p.id) }) : null;
    if (p.id && !existing) throw new ApiFail('not_found');

    const parent = String(p.parent || '');
    if (parent) {
      if (existing && parent === existing.id) throw new ApiFail('bad_parent', 'an item cannot be its own parent');
      const up = Db.findOne('Menus', { id: parent });
      if (!up) throw new ApiFail('bad_parent', 'no such parent item');
      if (up.parent) throw new ApiFail('bad_parent', 'menus go two levels deep, not three');
    }

    const patch = { menu: menu, name: name, url: url, parent: parent, status: status,
                    order: Number(p.order || (existing ? existing.order : Db.all('Menus').length + 1)),
                    scope: String(p.scope || ''), updated_at: new Date().toISOString() };
    if (existing) {
      Db.update('Menus', { id: existing.id }, patch);
      Audit.log(session, 'MENU_UPDATED', 'menu', existing.id, { prev: existing.status, next: status, meta: { name: name } });
      return { ok: true, id: existing.id };
    }
    const rec = Db.insert('Menus', Object.assign({ id: Db.newId('MNU') }, patch));
    Audit.log(session, 'MENU_ADDED', 'menu', rec.id, { next: name });
    return { ok: true, id: rec.id };
  },

  /** Menu URLs land in an href on every page. Only same-site paths and https
   *  are allowed: `javascript:` and `data:` are how a menu becomes an exploit. */
  safeUrl_: function (raw) {
    const url = String(raw || '').trim();
    if (!url) throw new ApiFail('bad_url', 'a menu item needs a destination');
    if (/^https:\/\/[^\s"'<>]+$/i.test(url)) return url;
    if (/^[a-z0-9][a-z0-9._~\/-]*(\.html)?(\?[^\s"'<>]*)?(#[^\s"'<>]*)?$/i.test(url)) return url;
    throw new ApiFail('bad_url', 'use a page on this site or an https address');
  },

  /* ---------------- homepage ---------------- */

  saveSection: function (session, p) {
    Perms.require(session, 'MANAGE');
    const type = ['hero', 'list', 'ad', 'newsletter'].indexOf(String(p.type)) !== -1 ? String(p.type) : 'list';
    const sectionId = String(p.section_id || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (sectionId.length < 2) throw new ApiFail('bad_section');
    const source = this.checkSource_(type, p.source);

    // An ad section carries a placement. Without one it publishes as a slot
    // that can never be filled, which is how a homepage quietly loses its
    // advertising. The fallback reads it from `source` for sections created
    // before placement had a column of its own.
    const placement = String(p.placement || (type === 'ad' ? p.source : '') || '')
      .toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (type === 'ad') {
      if (!placement) throw new ApiFail('placement_required', 'an ad section needs a placement');
      if (!Db.findOne('AdPlacements', { id: placement })) throw new ApiFail('unknown_placement', placement);
    }

    const existing = Db.findOne('Homepage', { section_id: sectionId });

    const patch = {
      type: type, title: String(p.title || '').slice(0, 80), source: source,
      count: Math.max(0, Math.min(24, Number(p.count || 0))),
      layout: ['rows', 'grid', 'lead', ''].indexOf(String(p.layout || '')) !== -1 ? String(p.layout || '') : 'rows',
      order: Number(p.order || (existing ? existing.order : Db.all('Homepage').length + 1)),
      active: p.active !== false,
      starts: p.starts || '', ends: p.ends || '',
      items: JSON.stringify(p.items || []),
      placement: placement,
      blurb: String(p.blurb === undefined ? (existing ? existing.blurb : '') : p.blurb).slice(0, 240),
      updated_at: new Date().toISOString()
    };
    if (patch.starts && patch.ends && new Date(patch.starts) > new Date(patch.ends)) {
      throw new ApiFail('bad_schedule', 'the start is after the end');
    }
    if (existing) {
      Db.update('Homepage', { id: existing.id }, patch);
      Audit.log(session, 'HOMEPAGE_SECTION_UPDATED', 'homepage', sectionId,
        { prev: existing.active, next: patch.active, meta: { source: source } });
      return { ok: true, section_id: sectionId };
    }
    Db.insert('Homepage', Object.assign({ id: Db.newId('SEC'), section_id: sectionId }, patch));
    Audit.log(session, 'HOMEPAGE_SECTION_ADDED', 'homepage', sectionId, { next: type });
    return { ok: true, section_id: sectionId };
  },

  /** A section pointing at a category that does not exist renders as an empty
   *  hole on the homepage. Catch it here rather than in the browser. */
  checkSource_: function (type, raw) {
    const source = String(raw || '').trim();
    // An ad section has a placement, not a content source. It used to be
    // validated as though the placement lived in `source`, which meant an ad
    // section could only be created by putting the placement in the wrong
    // field — and the placement check below never got the chance to run.
    if (type === 'ad') return '';
    if (type === 'newsletter') return '';
    if (!source || source === 'latest' || source === 'manual') return source || 'latest';
    const parts = source.split(':');
    const kinds = { category: 'Categories', topic: 'topics', format: 'ArticleFormats' };
    if (parts.length !== 2 || !kinds[parts[0]]) throw new ApiFail('bad_source', 'use latest, manual, category:, topic: or format:');
    if (parts[0] === 'category' && !Db.findOne('Categories', { slug: parts[1] })) {
      throw new ApiFail('bad_source', 'no category called ' + parts[1]);
    }
    if (parts[0] === 'format' && !Db.findOne('ArticleFormats', { slug: parts[1] })) {
      throw new ApiFail('bad_source', 'no format called ' + parts[1]);
    }
    return source;
  },

  /* ---------------- categories ---------------- */

  saveCategory: function (session, p) {
    Perms.require(session, 'MANAGE');
    const slug = String(p.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '');
    if (slug.length < 3) throw new ApiFail('bad_slug');
    const existing = Db.findOne('Categories', { slug: slug });
    const status = String(p.status) === 'DISABLED' ? 'DISABLED' : 'ACTIVE';

    if (existing && status === 'DISABLED') {
      const live = Db.all('Articles').filter(a => a.category === slug && a.status === 'PUBLISHED');
      if (live.length) {
        throw new ApiFail('category_in_use', live.length + ' published article(s) sit in this section');
      }
    }
    const patch = {
      name: String(p.name || slug).slice(0, 60), parent: String(p.parent || ''),
      description: String(p.description || '').slice(0, 300),
      order: Number(p.order || (existing ? existing.order : Db.all('Categories').length + 1)),
      status: status
    };
    if (patch.parent && !Db.findOne('Categories', { slug: patch.parent })) throw new ApiFail('bad_parent');
    if (existing) {
      Db.update('Categories', { slug: slug }, patch);
      Audit.log(session, 'CATEGORY_UPDATED', 'category', slug, { prev: existing.status, next: status });
    } else {
      Db.insert('Categories', Object.assign({ slug: slug }, patch));
      Audit.log(session, 'CATEGORY_ADDED', 'category', slug, { next: patch.name });
    }
    return { ok: true, slug: slug };
  },

  /* ---------------- feature flags ---------------- */

  setFlag: function (session, p) {
    Perms.require(session, 'MANAGE');
    const flag = String(p.flag || '').toUpperCase().replace(/[^A-Z_]/g, '');
    const row = Db.findOne('Features', { flag: flag });
    if (!row) throw new ApiFail('not_found');
    if (row.locked === true || row.locked === 'TRUE') {
      Audit.log(session, 'LOCKED_FLAG_BLOCKED', 'feature', flag, { reason: row.note || '' });
      throw new ApiFail('flag_locked', row.note || 'this flag is fixed by policy');
    }
    const state = ['enabled', 'disabled', 'scheduled'].indexOf(String(p.state)) !== -1 ? String(p.state) : 'disabled';
    if (state === 'scheduled' && !p.starts) throw new ApiFail('bad_schedule', 'a scheduled flag needs a start');
    Db.update('Features', { flag: flag }, {
      state: state, starts: p.starts || '', ends: p.ends || '',
      note: String(p.note || row.note || '').slice(0, 200), updated_at: new Date().toISOString()
    });
    Audit.log(session, 'FEATURE_FLAG_CHANGED', 'feature', flag, { prev: row.state, next: state });
    return { ok: true, flag: flag, state: state };
  },

  /* ---------------- brand and appearance ---------------- */

  saveSettings: function (session, p) {
    Perms.require(session, 'MANAGE');
    const changed = [];
    const put = (key, value) => {
      const row = Db.findOne('Settings', { key: key });
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      if (row) Db.update('Settings', { key: key }, { value: val, updated_by: session.user.id });
      else Db.insert('Settings', { key: key, value: val, scope: 'site', updated_by: session.user.id });
      changed.push(key);
    };

    if (p.brand) {
      ['name', 'tagline', 'short_name', 'logo', 'favicon'].forEach(k => {
        if (p.brand[k] !== undefined) put('brand.' + k, String(p.brand[k]).slice(0, 120));
      });
    }
    if (p.tokens) put('appearance.tokens', this.safeTokens_(p.tokens));
    if (p.theme) {
      if (['light', 'dark', 'sepia'].indexOf(String(p.theme)) === -1) throw new ApiFail('bad_theme');
      put('appearance.default_theme', String(p.theme));
    }
    if (p.analytics && p.analytics.ga4_id !== undefined) {
      const id = String(p.analytics.ga4_id).trim();
      if (id && !/^G-[A-Z0-9]{6,14}$/.test(id)) throw new ApiFail('bad_analytics_id', 'a GA4 id looks like G-XXXXXXX');
      put('analytics.ga4_id', id);
    }
    if (p.ads) {
      if (p.ads.adsense_client !== undefined) {
        const c = String(p.ads.adsense_client).trim();
        if (c && !/^ca-pub-\d{10,20}$/.test(c)) throw new ApiFail('bad_adsense_id');
        put('ads.adsense_client', c);
      }
      if (p.ads.enabled !== undefined) put('ads.enabled', p.ads.enabled === true ? 'true' : 'false');
      // Each placement needs its own AdSense slot id. A unit without one is
      // valid markup that silently never fills, which is the usual reason
      // somebody thinks AdSense is broken.
      if (p.ads.slots !== undefined) {
        const slots = typeof p.ads.slots === 'string' ? JSON.parse(p.ads.slots) : (p.ads.slots || {});
        const clean = {};
        Object.keys(slots).forEach(placement => {
          const id = String(slots[placement] || '').trim();
          if (!id) return;
          if (!/^\d{6,20}$/.test(id)) throw new ApiFail('bad_ad_slot', placement + ': ' + id);
          if (!/^[A-Z0-9_]{3,40}$/.test(placement)) throw new ApiFail('bad_placement', placement);
          clean[placement] = id;
        });
        put('ads.slots', JSON.stringify(clean));
      }
    }
    // Which social accounts appear in the footer, and where they point. A blank
    // value removes the link — that is the "off" switch, so there is nothing
    // else to remember.
    if (p.social) {
      // More than one host is legitimate for several of these, and rejecting a
      // link someone pasted correctly is worse than accepting a wrong one.
      const allowed = {
        linkedin: ['linkedin.com'],
        x: ['x.com', 'twitter.com'],
        facebook: ['facebook.com', 'fb.com'],
        instagram: ['instagram.com'],
        youtube: ['youtube.com', 'youtu.be'],
        telegram: ['t.me', 'telegram.me'],
        whatsapp: ['whatsapp.com', 'wa.me', 'chat.whatsapp.com'],
        researchgate: ['researchgate.net'],
        email: null, rss: null
      };
      const social = {};
      Object.keys(p.social).forEach(key => {
        if (!(key in allowed)) throw new ApiFail('unknown_platform', key);
        const value = String(p.social[key] || '').trim();
        if (!value) { social[key] = ''; return; }          // blank means hide it

        if (key === 'email') {
          const address = value.replace(/^mailto:/, '');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new ApiFail('bad_email', value);
          social[key] = address;
          return;
        }
        if (key === 'rss') { social[key] = value; return; }

        // Anything that becomes a link on every page is checked before it can.
        if (!/^https:\/\//.test(value)) throw new ApiFail('bad_social_url', key + ': must start with https://');
        if (/[<>"']/.test(value)) throw new ApiFail('bad_social_url', key + ': stray characters');
        const host = value.replace(/^https:\/\//, '').split('/')[0].toLowerCase();
        const hosts = allowed[key];
        if (hosts && !hosts.some(h => host === h || host.endsWith('.' + h))) {
          throw new ApiFail('wrong_platform', key + ': that is a link to ' + host);
        }
        social[key] = value;
      });
      // One key per platform. Content.settings turns dotted keys into nested
      // objects, so these arrive at the site as settings.social.linkedin.
      Object.keys(social).forEach(k => put('social.' + k, social[k]));
    }

    if (p.seo) {
      ['site_url', 'publisher', 'twitter'].forEach(k => {
        if (p.seo[k] !== undefined) put('seo.' + k, String(p.seo[k]).slice(0, 200));
      });
    }
    if (p.contact && p.contact.editorial !== undefined) put('contact.editorial', String(p.contact.editorial).slice(0, 120));
    if (p.reading) {
      if (p.reading.allow_pdf_download !== undefined) put('reading.allow_pdf_download', p.reading.allow_pdf_download === true ? 'true' : 'false');
      if (p.reading.allow_print !== undefined) put('reading.allow_print', p.reading.allow_print === true ? 'true' : 'false');
      if (p.reading.copy_notice !== undefined) put('reading.copy_notice', String(p.reading.copy_notice).slice(0, 300));
    }

    if (!changed.length) throw new ApiFail('nothing_to_save');
    Audit.log(session, 'SETTINGS_CHANGED', 'settings', 'site', { meta: { keys: changed } });
    return { ok: true, changed: changed };
  },

  /** Appearance tokens are written straight into the page's inline style, so a
   *  value carrying a semicolon or a url() is a stylesheet injection. */
  safeTokens_: function (tokens) {
    const out = {};
    Object.keys(tokens).forEach(k => {
      if (!/^--[a-z][a-z0-9-]{1,30}$/.test(k)) throw new ApiFail('bad_token', k + ' is not a token name');
      const v = String(tokens[k]).trim();
      if (!/^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9,.\s%]+\)|[0-9.]+(rem|px|em|%)?)$/i.test(v)) {
        throw new ApiFail('bad_token_value', k + ': use a colour or a simple length');
      }
      out[k] = v;
    });
    if (!Object.keys(out).length) throw new ApiFail('bad_token', 'no tokens supplied');
    return out;
  },

  /* ---------------- staging ---------------- */

  /** What would change if this were published now. */
  preview: function (session) {
    Perms.require(session, 'MANAGE');
    const candidate = Publish.configurationFiles();
    const live = this.liveSnapshot_();
    const changes = Object.keys(candidate).map(path => {
      const next = JSON.stringify(candidate[path], null, 2);
      const prev = live && live.files ? live.files[path] : null;
      return { path: path, changed: prev !== next, is_new: prev == null };
    });
    return {
      live: this.liveVersion_(),
      pending: changes.filter(c => c.changed).length,
      files: changes,
      candidate: candidate
    };
  },

  liveVersion_: function () {
    const row = Db.all('ConfigVersions').filter(v => v.live === true || v.live === 'TRUE')[0];
    return row ? { version: Number(row.version), published_at: row.created_at, note: row.note || '' } : null;
  },

  liveSnapshot_: function () {
    const row = Db.all('ConfigVersions').filter(v => v.live === true || v.live === 'TRUE')[0];
    return row ? this.readSnapshot_(row) : null;
  },

  readSnapshot_: function (row) {
    if (!row || !row.ref) return null;
    try { return JSON.parse(DriveApp.getFileById(row.ref).getBlob().getDataAsString()); }
    catch (e) { return null; }
  },

  /** Called by Publish.configuration once the commit has succeeded. */
  recordVersion_: function (session, files, note) {
    const source = this.sourceRows_();
    const snapshot = { files: {}, source: source, created_at: new Date().toISOString() };
    Object.keys(files).forEach(path => { snapshot.files[path] = JSON.stringify(files[path], null, 2); });

    const folder = this.folder_();
    const version = Db.all('ConfigVersions').length + 1;
    const file = folder.createFile('config-v' + version + '.json', JSON.stringify(snapshot), 'application/json');
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    Db.all('ConfigVersions').forEach(v => {
      if (v.live === true || v.live === 'TRUE') Db.update('ConfigVersions', { id: v.id }, { live: false });
    });
    Db.insert('ConfigVersions', {
      id: Db.newId('CFG'), version: version, created_by: session.user.id,
      note: note || '', ref: file.getId(), live: true
    });
    return version;
  },

  /** Puts a previous published configuration back on the site. The database
   *  still holds whatever has been edited since, so the control centre shows
   *  live and working separately until someone adopts one or publishes again. */
  rollback: function (session, p) {
    Perms.requireSupervisor(session);
    const reason = String(p.reason || '').trim();
    if (reason.length < 10) throw new ApiFail('reason_required');
    const row = Db.all('ConfigVersions').filter(v => Number(v.version) === Number(p.version))[0];
    if (!row) throw new ApiFail('not_found', 'no such configuration version');
    const snapshot = this.readSnapshot_(row);
    if (!snapshot) throw new ApiFail('snapshot_unreadable');

    const files = Object.keys(snapshot.files).map(path =>
      Publish.commit_(path, snapshot.files[path], 'Roll back configuration to v' + row.version));

    Db.all('ConfigVersions').forEach(v => Db.update('ConfigVersions', { id: v.id }, { live: false }));
    Db.update('ConfigVersions', { id: row.id }, { live: true, reason: reason });
    Audit.log(session, 'CONFIGURATION_ROLLED_BACK', 'site', CFG.env(),
      { next: String(row.version), reason: reason, meta: { files: files.length } });
    return { ok: true, version: Number(row.version), files: files };
  },

  /** Brings the database back into line with whatever is currently live. */
  adopt: function (session, p) {
    Perms.requireSupervisor(session);
    const row = Db.all('ConfigVersions').filter(v => Number(v.version) === Number(p.version))[0];
    if (!row) throw new ApiFail('not_found');
    const snapshot = this.readSnapshot_(row);
    if (!snapshot || !snapshot.source) throw new ApiFail('snapshot_unreadable');

    const keys = { Menus: 'id', Homepage: 'section_id', Categories: 'slug', Features: 'flag', Settings: 'key' };
    const retire = { Menus: { status: 'DISABLED' }, Homepage: { active: false },
                     Categories: { status: 'DISABLED' }, Features: { state: 'disabled' } };
    let restored = 0;
    Object.keys(keys).forEach(table => {
      const key = keys[table];
      const rows = snapshot.source[table] || [];
      const seen = {};
      rows.forEach(r => {
        const where = {};
        where[key] = r[key];
        seen[String(r[key])] = true;
        const patch = Object.assign({}, r);
        delete patch._row;
        if (Db.findOne(table, where)) Db.update(table, where, patch);
        else Db.insert(table, patch);
        restored++;
      });
      if (table === 'Settings') {
        // A setting added after this version did not exist in it. Adopting means
        // going back to that version, so those are blanked — but only the ones
        // that describe the public site. Editorial, billing and system rows are
        // not part of a configuration version and must survive untouched.
        Db.all('Settings').forEach(existing => {
          if (seen[String(existing.key)]) return;
          if ((existing.scope || 'site') !== 'site') return;
          if (!String(existing.value || '').trim()) return;
          Db.update('Settings', { key: existing.key }, { value: '' });
        });
        return;
      }
      if (!retire[table]) return;
      Db.all(table).forEach(existing => {
        if (seen[String(existing[key])]) return;
        const where = {};
        where[key] = existing[key];
        Db.update(table, where, retire[table]);
      });
    });
    Audit.log(session, 'CONFIGURATION_ADOPTED', 'site', CFG.env(),
      { next: String(row.version), meta: { rows: restored } });
    return { ok: true, version: Number(row.version), rows: restored };
  },

  versions: function (session) {
    Perms.require(session, 'MANAGE');
    return Db.all('ConfigVersions')
      .sort((a, b) => Number(b.version) - Number(a.version))
      .map(v => ({
        version: Number(v.version), created_at: v.created_at, created_by: v.created_by,
        note: v.note || '', reason: v.reason || '', live: v.live === true || v.live === 'TRUE'
      }));
  },

  sourceRows_: function () {
    const strip = rows => rows.map(r => { const o = Object.assign({}, r); delete o._row; return o; });
    return {
      Menus: strip(Db.all('Menus')),
      Homepage: strip(Db.all('Homepage')),
      Categories: strip(Db.all('Categories')),
      Features: strip(Db.all('Features')),
      Settings: strip(Db.all('Settings').filter(s => String(s.key).indexOf('public.') !== 0 &&
                                                     String(s.key).indexOf('checklist.') !== 0))
    };
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('configuration');
    return it.hasNext() ? it.next() : root.createFolder('configuration');
  }
};
