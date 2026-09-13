/* tests/phase9.js — performance.
 *
 * Measurement code is easy to write and easy to trust wrongly. These tests
 * check the arithmetic (a p75 that is actually a p75), the resilience of an
 * unauthenticated endpoint, and that the optimisation this phase adds — one
 * bootstrap file instead of five requests — actually contains what the shell
 * needs and is rebuilt when the site changes.
 *
 *   node tests/phase9.js
 */
const { build, test, assert, throwsWith, done } = require('./harness');

const sandbox = build({
  ENV: 'test',
  SPREADSHEET_ID: 'sheet',
  DRIVE_FOLDER_ID: 'folder',
  PASSWORD_PEPPER: 'pepper-for-tests-only',
  TOKEN_PEPPER: 'token-pepper-for-tests-only',
  SITE_URL: 'https://example.test/magazine/',
  GITHUB_REPO: 'owner/repo',
  GITHUB_TOKEN: 'unused',
  BOOTSTRAP_EMAIL: 'supervisor@example.test'
});

const { outbox, repo } = sandbox;
const Db = sandbox.internals.Db;

function call(action, payload, token) {
  const res = sandbox.doPost({ postData: { contents: JSON.stringify({ action, token: token || null, payload: payload || {} }) } });
  const out = JSON.parse(res.getContent());
  if (out.ok) return out.data;
  const err = new Error(out.error + (out.detail ? ': ' + out.detail : ''));
  err.code = out.error;
  err.detail = out.detail;
  throw err;
}
function tempPasswordFor(email) {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i].to === email) {
      const m = (outbox[i].body || '').match(/Temporary password: (\S+)/);
      if (m) return m[1];
    }
  }
  return null;
}

sandbox.setup();
const supervisor = call('login', { email: 'supervisor@example.test', password: tempPasswordFor('supervisor@example.test') });
call('inviteUser', { name: 'Administrator', email: 'admin@example.test', role_id: 'ADMINISTRATOR' }, supervisor.token);
const administrator = call('login', { email: 'admin@example.test', password: tempPasswordFor('admin@example.test') });
call('inviteUser', { name: 'A Reviewer', email: 'rev@example.test', role_id: 'REVIEWER' }, supervisor.token);
const reviewer = call('login', { email: 'rev@example.test', password: tempPasswordFor('rev@example.test') });

function send(events) { return call('recordVitals', { events: events }); }

/* ------------------------------------------------------------ collection -- */

console.log('\ncollecting measurements');

test('a reported measurement is counted', () => {
  const res = send([{ m: 'LCP', v: 1800, p: 'home', d: 'mobile' }]);
  assert(res.counted === 1, 'nothing was counted');
  const row = Db.findOne('Vitals', { metric: 'LCP', page: 'home', device: 'mobile' });
  assert(row && Number(row.count) === 1);
});

test('an unknown metric or page is dropped, not guessed at', () => {
  assert(send([{ m: 'VIBES', v: 10, p: 'home', d: 'mobile' }]).counted === 0, 'an invented metric was stored');
  send([{ m: 'LCP', v: 900, p: 'not-a-page', d: 'phone' }]);
  const row = Db.findOne('Vitals', { metric: 'LCP', page: 'other', device: 'desktop' });
  assert(row, 'an unknown page and device should fall back to other/desktop, not be invented');
});

test('absurd values are clamped rather than allowed to poison an average', () => {
  send([{ m: 'LCP', v: 99999999, p: 'article', d: 'desktop' }]);
  const row = Db.findOne('Vitals', { metric: 'LCP', page: 'article', device: 'desktop' });
  assert(Number(row.worst) <= 60000, 'a four-hour page load was recorded as fact: ' + row.worst);
});

test('negative and non-numeric values are ignored', () => {
  assert(send([{ m: 'CLS', v: -5, p: 'home', d: 'mobile' }]).counted === 0);
  assert(send([{ m: 'CLS', v: 'fast', p: 'home', d: 'mobile' }]).counted === 0);
});

test('an oversized batch is refused wholesale', () => {
  const many = [];
  for (let i = 0; i < 50; i++) many.push({ m: 'LCP', v: 1000, p: 'home', d: 'mobile' });
  assert(send(many).counted === 0, 'a flood was accepted');
});

test('the endpoint grants nothing', () => {
  throwsWith('unauthenticated', () => call('performanceReport', {}));
  throwsWith('unauthenticated', () => call('payloadBudget', {}));
  throwsWith('unauthenticated', () => call('listUsers', {}));
});

/* ------------------------------------------------------------- reporting -- */

console.log('\nreporting');

test('p75 lands where it should', () => {
  // 100 samples: 80 fast, 20 slow. The 75th percentile must sit in the fast
  // group — an average would be dragged up by the slow tail and hide that.
  for (let i = 0; i < 80; i++) send([{ m: 'FCP', v: 900, p: 'category', d: 'desktop' }]);
  for (let i = 0; i < 20; i++) send([{ m: 'FCP', v: 5500, p: 'category', d: 'desktop' }]);
  const row = call('performanceReport', {}, administrator.token)
    .metrics.filter(m => m.metric === 'FCP' && m.page === 'category')[0];
  assert(row.samples === 100, 'got ' + row.samples);
  assert(row.p75 <= 1000, 'p75 came out at ' + row.p75 + ', which is the mean, not the percentile');
  assert(row.mean > 1500, 'the mean should show the slow tail: ' + row.mean);
  assert(row.rating === 'good');
});

test('a genuinely slow page is rated poor and listed as a problem', () => {
  for (let i = 0; i < 30; i++) send([{ m: 'LCP', v: 5200, p: 'search', d: 'mobile' }]);
  const report = call('performanceReport', {}, administrator.token);
  const row = report.metrics.filter(m => m.metric === 'LCP' && m.page === 'search')[0];
  assert(row.rating === 'poor', 'got ' + row.rating + ' at p75 ' + row.p75);
  assert(report.problems.some(p => p.page === 'search'), 'the slow page is not flagged');
});

test('a handful of samples is not presented as a finding', () => {
  send([{ m: 'INP', v: 900, p: 'issues', d: 'mobile' }]);
  const report = call('performanceReport', {}, administrator.token);
  assert(!report.problems.some(p => p.page === 'issues'), 'one bad sample became a problem');
  assert(report.caveat, 'the report does not say how it was measured');
});

test('CLS is carried as thousandths and read back correctly', () => {
  for (let i = 0; i < 20; i++) send([{ m: 'CLS', v: 30, p: 'home', d: 'mobile' }]);   // 0.030
  const row = call('performanceReport', {}, administrator.token)
    .metrics.filter(m => m.metric === 'CLS' && m.page === 'home')[0];
  assert(row.unit === 'x1000' && row.rating === 'good', JSON.stringify(row));
});

test('anyone who can sign in can read the report', () => {
  // Performance is not a secret from the people writing for the site.
  assert(call('performanceReport', {}, reviewer.token).metrics.length > 0);
});

/* ---------------------------------------------------------------- budget -- */

console.log('\npayload budget');

test('publishing records what it committed', () => {
  call('publishConfiguration', { note: 'First' }, supervisor.token);
  const b = call('payloadBudget', {}, administrator.token);
  const bootstrap = b.lines.filter(l => l.path === 'data/bootstrap.json')[0];
  assert(bootstrap.bytes > 0, 'no size recorded for the bundle');
  assert(b.measured_at, 'no measurement timestamp');
});

test('going over budget is reported with advice, not just a red number', () => {
  Db.insert('Settings', {
    key: 'perf.budgets', scope: 'system',
    value: JSON.stringify({ 'data/bootstrap.json': 10 })
  });
  const b = call('payloadBudget', {}, administrator.token);
  assert(b.over.length >= 1, 'an over-budget file was not flagged');
  assert(b.advice.join(' ').indexOf('round trips') !== -1, 'the advice is not specific: ' + b.advice.join(' '));
  Db.update('Settings', { key: 'perf.budgets' }, { value: JSON.stringify({ 'data/bootstrap.json': 60000 }) });
  assert(call('payloadBudget', {}, administrator.token).over.length === 0);
});

/* --------------------------------------------------------------- bundle -- */

console.log('\nthe bootstrap bundle');

test('the bundle carries everything the first paint needs', () => {
  const b = JSON.parse(repo.get('data/bootstrap.json'));
  ['settings', 'menus', 'homepage', 'features', 'categories', 'articles'].forEach(k => {
    assert(b[k] !== undefined, 'the bundle is missing ' + k);
  });
  assert(b.menus.primary.length, 'the navigation is empty in the bundle');
  assert(b.settings.brand.name, 'the brand is missing from the bundle');
});

test('the separate files are still published, so the bundle stays optional', () => {
  ['data/settings.json', 'data/menus.json', 'data/homepage.json',
   'data/categories.json', 'data/features.json'].forEach(f => {
    assert(repo.has(f), f + ' is no longer published — the fallback path is dead');
  });
});

test('the bundle carries the recent articles, not the whole archive', () => {
  for (let i = 1; i <= 40; i++) {
    const id = 'MAG-2026-0003' + String(i).padStart(2, '0');
    Db.insert('Articles', {
      id: id, slug: 'article-' + i, title: 'Article ' + i, category: 'energy-storage',
      status: 'PUBLISHED', public_version: 1, working_version: 1, primary_author: supervisor.user.id,
      published_at: new Date(Date.now() - i * 86400000).toISOString()
    });
    Db.insert('Settings', {
      key: 'public.' + id, scope: 'published',
      value: JSON.stringify({ id: id, slug: 'article-' + i, title: 'Article ' + i, summary: 's',
        category: 'energy-storage', category_name: 'Energy storage', topics: [], tags: [],
        authors: [], published_at: new Date(Date.now() - i * 86400000).toISOString(),
        reading_minutes: 5, public_version: 1, blocks: [] })
    });
  }
  call('publishConfiguration', { note: 'After a lot of publishing' }, supervisor.token);
  const b = JSON.parse(repo.get('data/bootstrap.json'));
  assert(b.articles.length === 30, 'the bundle holds ' + b.articles.length + ' articles');
  assert(b.articles[0].slug === 'article-1', 'the newest article is not first');
});

test('each publication bumps the build and stamps the service worker', () => {
  const before = Number(Db.findOne('Settings', { key: 'perf.build' }).value);
  call('publishConfiguration', { note: 'Again' }, supervisor.token);
  const after = Number(Db.findOne('Settings', { key: 'perf.build' }).value);
  assert(after === before + 1, 'the build number did not move');
  const stamp = repo.get('pwa/build.js');
  assert(stamp.indexOf('self.BUILD = "' + after + '"') !== -1, 'the service worker stamp is stale: ' + stamp);
});

test('the service worker derives its cache name from that stamp', () => {
  const fs = require('fs');
  const sw = fs.readFileSync(require('path').join(__dirname, '..', 'pwa', 'service-worker.js'), 'utf8');
  assert(/importScripts\('build\.js'\)/.test(sw), 'the worker does not import the build stamp');
  assert(/CACHE = 'mag-shell-' \+ self\.BUILD/.test(sw), 'the cache name is not tied to the build');
});

/* -------------------------------------------------------------- standing -- */

console.log('\nstanding invariants');

test('nothing in this phase reached the publication controls', () => {
  throwsWith('forbidden', () => call('publishConfiguration', {}, administrator.token));
  throwsWith('forbidden', () => call('setRolePermissions',
    { role_id: 'ADMINISTRATOR', permissions: [{ permission: 'FINAL_PUBLISH', scope: '*' }] }, supervisor.token));
});

done();
