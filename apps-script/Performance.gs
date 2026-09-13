/** Performance.gs — what the site actually does, measured, rather than what the
 *  architecture promises.
 *
 *  Two different things live here and they answer different questions.
 *
 *  Field data comes from readers' browsers: Largest Contentful Paint, layout
 *  shift, interaction latency, and how long the first byte took. It is the only
 *  evidence that matters, because it includes the reader on a train in a tunnel
 *  holding a four-year-old phone, and no laboratory test does.
 *
 *  The payload budget is arithmetic on what the publishing engine committed. It
 *  cannot tell you the site is fast; it can tell you the search index just grew
 *  past the point where the homepage stops being cheap, which is the thing that
 *  actually goes wrong over a year of publishing.
 *
 *  Measurements are stored as histograms rather than one row per visit. A sheet
 *  cannot hold a row per page view and should not try.
 */

const VITAL_METRICS = {
  // edges in the metric's own units; the last bucket is everything above
  LCP:  { edges: [1000, 1500, 2000, 2500, 3000, 4000, 6000, 10000], good: 2500, poor: 4000, unit: 'ms' },
  FCP:  { edges: [500, 1000, 1500, 1800, 2500, 3000, 4000, 6000],   good: 1800, poor: 3000, unit: 'ms' },
  INP:  { edges: [50, 100, 200, 300, 500, 800, 1200, 2000],         good: 200,  poor: 500,  unit: 'ms' },
  TTFB: { edges: [200, 400, 600, 800, 1200, 1800, 3000, 5000],      good: 800,  poor: 1800, unit: 'ms' },
  // CLS is unitless; it is carried as thousandths so the sheet holds integers
  CLS:  { edges: [10, 25, 50, 100, 150, 250, 400, 1000],            good: 100,  poor: 250,  unit: 'x1000' }
};

const VITAL_PAGES = ['home', 'article', 'category', 'search', 'issues', 'guidelines', 'other'];
const VITAL_DEVICES = ['mobile', 'desktop'];

const Performance = {

  /* ---------------- collection (public) ---------------- */

  /** Arrives unauthenticated from readers' browsers. Every field is checked and
   *  anything unrecognised is dropped without comment: the endpoint's job is to
   *  count, and to be useless for anything else. */
  record: function (events) {
    if (!Array.isArray(events) || !events.length || events.length > 12) return { ok: true, counted: 0 };
    const day = new Date().toISOString().slice(0, 10);
    let counted = 0;

    events.forEach(e => {
      const metric = String((e && e.m) || '').toUpperCase();
      const spec = VITAL_METRICS[metric];
      if (!spec) return;
      const page = VITAL_PAGES.indexOf(String(e.p)) !== -1 ? String(e.p) : 'other';
      const device = VITAL_DEVICES.indexOf(String(e.d)) !== -1 ? String(e.d) : 'desktop';
      let value = Number(e.v);
      if (!isFinite(value) || value < 0) return;
      // A page cannot take four hours to paint; a report that says so is noise
      // or mischief, and either way it must not drag an average around.
      value = Math.min(value, spec.edges[spec.edges.length - 1] * 6);

      const where = { day: day, page: page, metric: metric, device: device };
      const row = Db.findOne('Vitals', where);
      const buckets = row ? this.parse_(row.buckets, spec) : this.empty_(spec);
      buckets[this.bucketOf_(value, spec)]++;

      if (row) {
        Db.update('Vitals', where, {
          count: Number(row.count || 0) + 1,
          sum: Number(row.sum || 0) + value,
          worst: Math.max(Number(row.worst || 0), value),
          buckets: JSON.stringify(buckets),
          updated_at: new Date().toISOString()
        });
      } else {
        Db.insert('Vitals', Object.assign({
          id: Db.newId('VIT'), count: 1, sum: value, worst: value,
          buckets: JSON.stringify(buckets), updated_at: new Date().toISOString()
        }, where));
      }
      counted++;
    });
    return { ok: true, counted: counted };
  },

  bucketOf_: function (value, spec) {
    for (let i = 0; i < spec.edges.length; i++) if (value <= spec.edges[i]) return i;
    return spec.edges.length;
  },

  empty_: function (spec) {
    const out = [];
    for (let i = 0; i <= spec.edges.length; i++) out.push(0);
    return out;
  },

  parse_: function (raw, spec) {
    try {
      const b = JSON.parse(raw);
      if (Array.isArray(b) && b.length === spec.edges.length + 1) return b.map(Number);
    } catch (e) {}
    return this.empty_(spec);
  },

  /* ---------------- reporting (staff) ---------------- */

  report: function (session, p) {
    Perms.require(session, 'VIEW');
    const since = (p && p.since) || new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const rows = Db.all('Vitals').filter(v => String(v.day) >= since);
    const grouped = {};

    rows.forEach(v => {
      const spec = VITAL_METRICS[v.metric];
      if (!spec) return;
      const key = v.metric + '|' + v.page + '|' + v.device;
      const g = grouped[key] || (grouped[key] = {
        metric: v.metric, page: v.page, device: v.device,
        count: 0, sum: 0, worst: 0, buckets: this.empty_(spec)
      });
      g.count += Number(v.count || 0);
      g.sum += Number(v.sum || 0);
      g.worst = Math.max(g.worst, Number(v.worst || 0));
      this.parse_(v.buckets, spec).forEach((n, i) => { g.buckets[i] += n; });
    });

    const metrics = Object.keys(grouped).map(k => {
      const g = grouped[k];
      const spec = VITAL_METRICS[g.metric];
      const p75 = this.percentile_(g.buckets, spec, 0.75);
      return {
        metric: g.metric, page: g.page, device: g.device, samples: g.count,
        p75: p75, mean: g.count ? Math.round(g.sum / g.count) : 0, worst: Math.round(g.worst),
        unit: spec.unit, good_below: spec.good, poor_above: spec.poor,
        rating: p75 <= spec.good ? 'good' : (p75 <= spec.poor ? 'needs work' : 'poor')
      };
    }).sort((a, b) => a.metric.localeCompare(b.metric) || a.page.localeCompare(b.page));

    return {
      since: since,
      samples: rows.reduce((n, v) => n + Number(v.count || 0), 0),
      caveat: 'Measured in readers\' browsers. Blocked scripts, cached pages and abandoned loads are not counted, so treat small sample counts as anecdotes.',
      metrics: metrics,
      problems: metrics.filter(m => m.rating !== 'good' && m.samples >= 10)
    };
  },

  /** p75 read off the histogram, interpolated inside the bucket it lands in.
   *  Approximate on purpose: the question is "is this near 2.5 seconds", not
   *  "is this 2,481 milliseconds". */
  percentile_: function (buckets, spec, q) {
    const total = buckets.reduce((n, x) => n + x, 0);
    if (!total) return 0;
    const target = total * q;
    let seen = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (!buckets[i]) continue;
      if (seen + buckets[i] >= target) {
        const low = i === 0 ? 0 : spec.edges[i - 1];
        const high = i < spec.edges.length ? spec.edges[i] : spec.edges[spec.edges.length - 1] * 2;
        const within = (target - seen) / buckets[i];
        return Math.round(low + (high - low) * within);
      }
      seen += buckets[i];
    }
    return Math.round(spec.edges[spec.edges.length - 1]);
  },

  /* ---------------- payload budget ---------------- */

  /** Budgets in bytes, over-rideable from settings. These are the numbers that
   *  decide whether the homepage stays cheap as the archive grows. */
  budgets: function () {
    const row = Db.findOne('Settings', { key: 'perf.budgets' });
    let custom = {};
    if (row) { try { custom = JSON.parse(row.value); } catch (e) {} }
    return Object.assign({
      'data/bootstrap.json': 60000,
      'data/index/articles.json': 120000,
      'data/search-index.json': 250000,
      'data/ads.json': 20000,
      'shell': 60000            // HTML + CSS + JS the first page needs
    }, custom);
  },

  /** Sizes recorded by the publishing engine at the moment it committed. */
  payload: function () {
    const row = Db.findOne('Settings', { key: 'perf.payload' });
    if (!row) return {};
    try { return JSON.parse(row.value); } catch (e) { return {}; }
  },

  recordPayload_: function (files) {
    const current = this.payload();
    Object.keys(files).forEach(path => { current[path] = files[path]; });
    current.updated_at = new Date().toISOString();
    const value = JSON.stringify(current);
    const row = Db.findOne('Settings', { key: 'perf.payload' });
    if (row) Db.update('Settings', { key: 'perf.payload' }, { value: value });
    else Db.insert('Settings', { key: 'perf.payload', value: value, scope: 'system' });
  },

  budget: function (session) {
    Perms.require(session, 'VIEW');
    const sizes = this.payload();
    const budgets = this.budgets();
    const lines = Object.keys(budgets).map(path => {
      const bytes = Number(sizes[path] || 0);
      const limit = Number(budgets[path]);
      return {
        path: path, bytes: bytes, budget: limit,
        share: limit ? Math.round((bytes / limit) * 100) : 0,
        over: bytes > limit
      };
    }).sort((a, b) => b.share - a.share);
    return {
      measured_at: sizes.updated_at || null,
      lines: lines,
      over: lines.filter(l => l.over),
      advice: this.advice_(lines)
    };
  },

  advice_: function (lines) {
    const out = [];
    lines.filter(l => l.over).forEach(l => {
      if (l.path === 'data/search-index.json') {
        out.push('The search index is over budget. Shorten the keyword field per article, or move search to a service and fetch the index only on the search page.');
      } else if (l.path === 'data/index/articles.json') {
        out.push('The article index is over budget. Paginate it: the homepage needs the most recent thirty, not the archive.');
      } else if (l.path === 'data/bootstrap.json') {
        out.push('The bootstrap bundle is over budget. It exists to save round trips, and stops paying for itself once it is this large.');
      } else {
        out.push(l.path + ' is over its budget of ' + l.budget + ' bytes.');
      }
    });
    if (!out.length) out.push('Everything is inside budget.');
    return out;
  },

  /* ---------------- build identity ---------------- */

  /** Each publication gets an identifier. The service worker imports it, which
   *  makes a publish invalidate every stale cached shell — without it, readers
   *  keep the old JavaScript until their browser feels like checking. */
  nextBuild_: function () {
    const row = Db.findOne('Settings', { key: 'perf.build' });
    const next = (row ? Number(row.value) : 0) + 1;
    if (row) Db.update('Settings', { key: 'perf.build' }, { value: String(next) });
    else Db.insert('Settings', { key: 'perf.build', value: String(next), scope: 'system' });
    return next;
  },

  buildId: function () {
    const row = Db.findOne('Settings', { key: 'perf.build' });
    return row ? Number(row.value) : 0;
  }
};
