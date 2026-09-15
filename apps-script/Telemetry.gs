/** Telemetry.gs — counting what readers do without paying for it per reader.
 *
 *  Before this, one page view cost two Apps Script executions and five rows
 *  written to a spreadsheet: a beacon for advertising, a beacon for page speed,
 *  and a row per measurement. That is a price per visitor, and it is the wrong
 *  shape — the numbers are aggregates, and aggregates do not need a row each.
 *
 *  Now a visit sends one beacon, and the beacon adds to a counter held in the
 *  script cache. A trigger folds those counters into the sheets every ten
 *  minutes. A thousand visits become one write instead of five thousand.
 *
 *  What this costs, stated plainly: the cache is not durable. If the platform
 *  stops between two flushes, the counts since the last flush are gone. For
 *  advertising delivery and page-speed samples — both already described as
 *  indicative rather than billable — that is the right trade. Nothing that
 *  matters financially or editorially goes through here.
 */

const TELEMETRY_SHARDS = 4;          // spread writers so they do not overwrite
const TELEMETRY_TTL = 3600;          // seconds a buffer survives unflushed

const Telemetry = {

  /** The public beacon: advertising and page speed in one call. */
  record: function (payload) {
    payload = payload || {};
    const ads = Array.isArray(payload.ads) ? payload.ads : [];
    const vitals = Array.isArray(payload.vitals) ? payload.vitals : [];
    if (!ads.length && !vitals.length) return { ok: true, counted: 0 };
    if (ads.length > 40 || vitals.length > 12) return { ok: true, counted: 0 };

    const bucket = {};
    let counted = 0;

    // Advertising: validated exactly as before, then counted rather than written.
    ads.forEach(e => {
      const id = String((e && e.id) || '');
      if (!/^CRE-[A-Z0-9]+$/.test(id)) return;
      const impressions = Math.min(Math.max(Number(e.i) || 0, 0), 5);
      const clicks = Math.min(Math.max(Number(e.c) || 0, 0), 5);
      if (!impressions && !clicks) return;
      const key = 'ad|' + id;
      bucket[key] = bucket[key] || { i: 0, c: 0 };
      bucket[key].i += impressions;
      bucket[key].c += clicks;
      counted++;
    });

    // Page speed: the same validation Performance.record applies, because an
    // unauthenticated endpoint is exactly where a made-up number arrives.
    const day = new Date().toISOString().slice(0, 10);
    vitals.forEach(e => {
      const metric = String((e && e.m) || '').toUpperCase();
      const spec = VITAL_METRICS[metric];
      if (!spec) return;
      let value = Number(e.v);
      if (!isFinite(value) || value < 0) return;
      value = Math.min(value, spec.edges[spec.edges.length - 1] * 6);
      const page = VITAL_PAGES.indexOf(String(e.p)) !== -1 ? String(e.p) : 'other';
      const device = VITAL_DEVICES.indexOf(String(e.d)) !== -1 ? String(e.d) : 'desktop';
      const key = ['vital', day, page, metric, device].join('|');
      bucket[key] = bucket[key] || { n: 0, sum: 0, worst: 0, b: {} };
      bucket[key].n += 1;
      bucket[key].sum += value;
      bucket[key].worst = Math.max(bucket[key].worst, value);
      const at = Performance.bucketOf_(value, spec);
      bucket[key].b[at] = (bucket[key].b[at] || 0) + 1;
      counted++;
    });

    if (counted) this.add_(bucket);
    return { ok: true, counted: counted };
  },

  /** Adds to one of several cache shards. Two readers landing in the same
   *  millisecond can still collide; four shards make that rare, and a lost
   *  sample is a lost sample rather than a broken total. */
  add_: function (bucket) {
    const cache = CacheService.getScriptCache();
    const shard = 'tel.' + Math.floor(Math.random() * TELEMETRY_SHARDS);
    let held = {};
    try { held = JSON.parse(cache.get(shard) || '{}'); } catch (e) { held = {}; }

    Object.keys(bucket).forEach(key => {
      const add = bucket[key];
      const cur = held[key];
      if (!cur) { held[key] = add; return; }
      if (add.i !== undefined) { cur.i += add.i; cur.c += add.c; return; }
      cur.n += add.n; cur.sum += add.sum;
      cur.worst = Math.max(cur.worst, add.worst);
      Object.keys(add.b).forEach(i => { cur.b[i] = (cur.b[i] || 0) + add.b[i]; });
    });

    const serialised = JSON.stringify(held);
    // A cache entry is capped. If a shard grows past what it can hold, write it
    // out now rather than silently dropping everything in it.
    if (serialised.length > 90000) {
      this.merge_(held);
      cache.remove(shard);
      return;
    }
    cache.put(shard, serialised, TELEMETRY_TTL);
  },

  /** Time trigger, every ten minutes. Folds the buffers into the sheets. */
  flush: function () {
    const cache = CacheService.getScriptCache();
    const combined = {};
    let found = 0;
    for (let i = 0; i < TELEMETRY_SHARDS; i++) {
      const key = 'tel.' + i;
      let held = null;
      try { held = JSON.parse(cache.get(key) || 'null'); } catch (e) { held = null; }
      if (!held) continue;
      cache.remove(key);
      found++;
      Object.keys(held).forEach(k => {
        const add = held[k], cur = combined[k];
        if (!cur) { combined[k] = add; return; }
        if (add.i !== undefined) { cur.i += add.i; cur.c += add.c; return; }
        cur.n += add.n; cur.sum += add.sum;
        cur.worst = Math.max(cur.worst, add.worst);
        Object.keys(add.b).forEach(x => { cur.b[x] = (cur.b[x] || 0) + add.b[x]; });
      });
    }
    if (!found) return 'nothing buffered';
    const written = this.merge_(combined);
    return written + ' rows updated from ' + found + ' buffers';
  },

  /** One read of each sheet, one write per changed row. */
  merge_: function (combined) {
    const keys = Object.keys(combined);
    if (!keys.length) return 0;
    let written = 0;

    const adKeys = keys.filter(k => k.indexOf('ad|') === 0);
    if (adKeys.length) {
      const approved = {};
      Db.all('AdCreatives').forEach(c => { approved[c.id] = true; });
      const existing = {};
      Db.all('AdEvents').forEach(r => { existing[r.creative_id + '|' + r.day] = r; });
      const day = new Date().toISOString().slice(0, 10);
      const fresh = [];
      adKeys.forEach(k => {
        const id = k.slice(3);
        if (!approved[id]) return;                    // never invent a creative
        const add = combined[k];
        const row = existing[id + '|' + day];
        if (row) {
          Db.update('AdEvents', { id: row.id }, {
            impressions: Number(row.impressions || 0) + add.i,
            clicks: Number(row.clicks || 0) + add.c
          });
        } else {
          fresh.push({ id: Db.newId('ADE'), creative_id: id, day: day,
                       impressions: add.i, clicks: add.c });
        }
        written++;
      });
      if (fresh.length) Db.insertMany('AdEvents', fresh);
    }

    const vitalKeys = keys.filter(k => k.indexOf('vital|') === 0);
    if (vitalKeys.length) {
      const existing = {};
      Db.all('Vitals').forEach(r => { existing[[r.day, r.page, r.metric, r.device].join('|')] = r; });
      const fresh = [];
      vitalKeys.forEach(k => {
        const parts = k.split('|');            // vital | day | page | metric | device
        const add = combined[k];
        const spec = VITAL_METRICS[parts[3]];
        if (!spec) return;
        const row = existing[[parts[1], parts[2], parts[3], parts[4]].join('|')];
        const buckets = row ? Performance.parse_(row.buckets, spec) : Performance.empty_(spec);
        Object.keys(add.b).forEach(i => { buckets[Number(i)] += add.b[i]; });
        if (row) {
          Db.update('Vitals', { id: row.id }, {
            count: Number(row.count || 0) + add.n,
            sum: Number(row.sum || 0) + add.sum,
            worst: Math.max(Number(row.worst || 0), add.worst),
            buckets: JSON.stringify(buckets),
            updated_at: new Date().toISOString()
          });
        } else {
          fresh.push({
            id: Db.newId('VIT'), day: parts[1], page: parts[2], metric: parts[3], device: parts[4],
            count: add.n, sum: add.sum, worst: add.worst,
            buckets: JSON.stringify(buckets), updated_at: new Date().toISOString()
          });
        }
        written++;
      });
      if (fresh.length) Db.insertMany('Vitals', fresh);
    }
    return written;
  },

  /** What is waiting to be written, for the performance screen to admit to. */
  pending: function () {
    const cache = CacheService.getScriptCache();
    let n = 0;
    for (let i = 0; i < TELEMETRY_SHARDS; i++) {
      try {
        const held = JSON.parse(cache.get('tel.' + i) || 'null');
        if (held) n += Object.keys(held).length;
      } catch (e) {}
    }
    return n;
  }
};

/** Time trigger, every ten minutes. */
function flushTelemetry() {
  return Telemetry.flush();
}
