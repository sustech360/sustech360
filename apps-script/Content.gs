/** Content.gs — configuration reads used by the control centre, and the
 *  builders that turn sheet rows into the exact JSON shape the public site
 *  expects. One shape, one place. */
const Content = {

  /** Only site-scoped settings are public. The Settings sheet is also used as
   *  internal storage — rendered article documents, submission checklist
   *  answers, counters — and publishing all of it would put a copy of every
   *  article and every author's declarations into a file readers download on
   *  the homepage. Scope is the filter, not a prefix guess. */
  settings: function () {
    const out = {};
    Db.all('Settings')
      .filter(s => (s.scope || 'site') === 'site')
      // A blank value is how the control centre removes something — a social
      // link, an analytics id. Publishing the empty key would leave the setting
      // present but meaningless, and would make an adopted older version
      // impossible to match exactly.
      .filter(s => String(s.value === undefined || s.value === null ? '' : s.value).trim() !== '')
      .forEach(s => { set_(out, s.key, parseMaybe_(s.value)); });
    return out;
  },

  menus: function () {
    // Disabled and paused items are not live, so they are not published. The
    // public file describes the site as it is, not as it is being planned.
    const rows = Db.all('Menus').filter(m => m.status === 'ACTIVE');
    const pick = m => ({
      id: m.id, name: m.name, url: m.url, parent: m.parent || null,
      order: Number(m.order || 0), status: m.status || 'ACTIVE'
    });
    return {
      version: 1,
      primary: rows.filter(m => m.menu === 'primary').map(pick),
      footer: rows.filter(m => m.menu === 'footer').map(pick)
    };
  },

  homepage: function () {
    return {
      version: 1,
      sections: Db.all('Homepage')
        .filter(s => s.active === true || s.active === 'TRUE')
        .map(s => ({
        id: s.section_id, type: s.type, title: s.title, source: s.source,
        count: Number(s.count || 0), layout: s.layout, order: Number(s.order || 0),
        active: s.active === true || s.active === 'TRUE',
        starts: s.starts || null, ends: s.ends || null, items: asList(s.items),
        // Without this an ad section publishes as a slot with no placement, so
        // the homepage loses its advertising the first time configuration is
        // published. The fallback to `source` covers rows seeded before the
        // placement column existed.
        placement: s.type === 'ad' ? (s.placement || s.source || '') : undefined,
        blurb: s.blurb || ''
      }))
    };
  },

  categories: function () {
    return { version: 1, categories: Db.all('Categories').filter(c => c.status !== 'DISABLED') };
  },

  features: function () {
    const flags = {};
    Db.all('Features').forEach(f => {
      flags[f.flag] = { state: f.state, starts: f.starts || null, ends: f.ends || null,
                        locked: f.locked === true || f.locked === 'TRUE', note: f.note || '' };
    });
    // Invariant: open author registration is off by policy and cannot be enabled.
    flags.AUTHOR_REGISTRATION = { state: 'disabled', locked: true, note: 'Invitation-only by policy.' };
    return { version: 1, flags: flags };
  }
};

function set_(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else cur = (cur[p] = cur[p] || {});
  });
}
function parseMaybe_(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}
