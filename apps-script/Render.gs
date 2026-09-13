/** Render.gs — the private editing shape becomes the public reading shape here,
 *  and only here. The editor stores fields keyed by the format definition; the
 *  site reads an ordered list of blocks. Keeping the translation in one file is
 *  what lets either side change without the other noticing.
 */
const Render = {

  /** The public article file. Everything a reader's browser will see. */
  article: function (a, version, content, media) {
    const format = Db.findOne('ArticleFormats', { slug: a.format });
    const fields = format
      ? Db.find('FormatFields', { format_id: format.id }).sort((x, y) => Number(x.order) - Number(y.order))
      : [];
    const values = content.fields || {};
    const placed = {};
    const blocks = [];

    fields.forEach(f => {
      const raw = String(values[f.field] || '').trim();
      if (!raw) return;
      if (f.field === 'summary') return;                       // becomes the standfirst
      if (f.field === 'references') {
        blocks.push({ type: 'references', items: raw.split(/\n+/).map(s => s.trim()).filter(Boolean) });
        return;
      }
      blocks.push({ type: 'h2', text: f.label });
      raw.split(/\n{2,}/).forEach(para => {
        const t = para.trim();
        if (!t) return;
        const fig = t.match(/^\[figure:([^\]]+)\]$/i);
        if (fig) {
          const m = this.findMedia_(media, fig[1]);
          if (m) { blocks.push(this.figure_(a, m)); placed[m.id] = true; }
          return;
        }
        blocks.push({ type: 'p', text: t });
      });
    });

    // Figures the author never placed still belong in the article, before the
    // references rather than nowhere.
    const trailing = media.filter(m => !placed[m.id]).map(m => this.figure_(a, m));
    if (trailing.length) {
      const refAt = blocks.map(b => b.type).lastIndexOf('references');
      if (refAt === -1) blocks.push.apply(blocks, trailing);
      else blocks.splice.apply(blocks, [refAt, 0].concat(trailing));
    }

    const authors = this.authors_(a);
    const summary = String(values.summary || '').trim();
    const category = Db.findOne('Categories', { slug: a.category });
    const words = this.words_(blocks) + this.count_(summary);
    const site = CFG.get('SITE_URL', '');

    return {
      id: a.id, slug: a.slug, public_version: Number(version),
      title: a.title, subtitle: String(values.subtitle || content.subtitle || '').trim(),
      summary: summary,
      category: a.category, category_name: category ? category.name : a.category,
      topics: asList(a.topics), tags: asList(a.tags),
      level: a.level, format: a.format,
      authors: authors,
      published_at: a.published_at || new Date().toISOString(),
      updated_at: Number(version) > 1 ? new Date().toISOString() : null,
      reading_minutes: Math.max(1, Math.round(words / 220)),
      sponsored: a.sponsored === true || a.sponsored === 'TRUE',
      seo: {
        title: String(a.title).slice(0, 70),
        description: summary.slice(0, 160),
        canonical: site + 'article.html?a=' + a.slug
      },
      blocks: blocks,
      related: []
    };
  },

  figure_: function (a, m) {
    return {
      type: 'figure',
      src: this.mediaPath_(a, m),
      alt: m.caption || m.name,
      caption: (m.caption || '') + (m.credit ? ' (' + m.credit + ', ' + m.licence + ')' : '')
    };
  },

  mediaPath_: function (a, m) {
    return 'assets/media/' + a.id + '/' + m.name;
  },

  findMedia_: function (media, key) {
    key = String(key).trim().toLowerCase();
    return media.filter(m => String(m.name).toLowerCase() === key ||
                             String(m.id).toLowerCase() === key)[0];
  },

  authors_: function (a) {
    const ids = [String(a.primary_author)].concat(asList(a.co_authors).map(String));
    const out = [];
    ids.forEach(id => {
      const profile = Db.findOne('Authors', { user_id: id });
      const user = Db.findOne('Users', { id: id });
      if (!user) return;
      out.push({
        id: profile ? profile.id : id,
        name: (profile && profile.display_name) || user.name,
        institution: (profile && profile.institution) || user.institution || '',
        orcid: (profile && profile.orcid) || ''
      });
    });
    return out;
  },

  /** The line that appears in listings. Small on purpose: the index is fetched
   *  by every visitor on the homepage. */
  indexEntry: function (doc) {
    return {
      id: doc.id, slug: doc.slug, title: doc.title, subtitle: doc.subtitle,
      summary: doc.summary, category: doc.category, category_name: doc.category_name,
      topics: doc.topics, tags: doc.tags, level: doc.level, format: doc.format,
      authors: doc.authors.map(x => ({ id: x.id, name: x.name, institution: x.institution })),
      published_at: doc.published_at, updated_at: doc.updated_at,
      reading_minutes: doc.reading_minutes, public_version: doc.public_version,
      image: (doc.blocks.filter(b => b.type === 'figure')[0] || {}).src || '',
      sponsored: doc.sponsored
    };
  },

  searchDoc: function (doc) {
    const text = doc.blocks.map(b => b.text || (b.items || []).join(' ') || '').join(' ');
    const keywords = (doc.topics || []).concat(doc.tags || [])
      .concat(this.keywords_(text)).join(' ').toLowerCase();
    return {
      article_id: doc.id, slug: doc.slug, title: doc.title, summary: doc.summary,
      category: doc.category_name, keywords: keywords.slice(0, 1200),
      published_at: String(doc.published_at).slice(0, 10),
      reading_minutes: doc.reading_minutes,
      authors: doc.authors.map(a => a.name).join(', ')
    };
  },

  /** Frequency-ranked words, so the index carries the article's vocabulary
   *  without carrying the article. */
  keywords_: function (text) {
    const stop = ' the a an and or of to in for on with is are was were be been that this it as by from at not but which their its can may also than then more most such using used use ';
    const freq = {};
    (String(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).forEach(w => {
      if (stop.indexOf(' ' + w + ' ') !== -1) return;
      freq[w] = (freq[w] || 0) + 1;
    });
    return Object.keys(freq).sort((x, y) => freq[y] - freq[x]).slice(0, 60);
  },

  searchIndex: function (docs) {
    return {
      version: 1,
      generated_at: new Date().toISOString(),
      docs: docs.map(d => ({
        s: d.slug, t: d.title, d: d.summary, c: d.category, k: d.keywords, p: d.published_at
      }))
    };
  },

  rss: function (entries) {
    const site = CFG.get('SITE_URL', '');
    const brand = Email.brand_();
    const items = entries.slice(0, 30).map(e =>
      '<item>' +
      '<title>' + this.xml_(e.title) + '</title>' +
      '<link>' + this.xml_(site + 'article.html?a=' + e.slug) + '</link>' +
      '<guid isPermaLink="false">' + this.xml_(e.id) + '</guid>' +
      '<pubDate>' + new Date(e.published_at).toUTCString() + '</pubDate>' +
      '<category>' + this.xml_(e.category_name || '') + '</category>' +
      '<description>' + this.xml_(e.summary || '') + '</description>' +
      '</item>').join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n' +
      '<title>' + this.xml_(brand) + '</title>\n<link>' + this.xml_(site) + '</link>\n' +
      '<description>Energy, materials, sustainability and the research behind them.</description>\n' +
      '<language>en</language>\n<lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
      items + '\n</channel></rss>\n';
  },

  sitemap: function (entries) {
    const site = CFG.get('SITE_URL', '');
    const urls = ['<url><loc>' + this.xml_(site) + '</loc></url>'].concat(entries.map(e =>
      '<url><loc>' + this.xml_(site + 'article.html?a=' + e.slug) + '</loc>' +
      '<lastmod>' + String(e.updated_at || e.published_at).slice(0, 10) + '</lastmod></url>'));
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
  },

  xml_: function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  },

  words_: function (blocks) {
    return blocks.reduce((n, b) => n + this.count_(b.text || (b.items || []).join(' ')), 0);
  },

  count_: function (s) { return (String(s || '').match(/\S+/g) || []).length; }
};
