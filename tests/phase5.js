/* tests/phase5.js — the control centre: site configuration and delegation.
 *
 * The thing to prove here is that configuration behaves like everything else on
 * this platform — edited privately, published deliberately, reversible — and
 * that the values which end up inside a public page are validated before they
 * get there.
 *
 *   node tests/phase5.js
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
function mailTo(email, match) {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i].to === email && (!match || (outbox[i].body || '').indexOf(match) !== -1 ||
        (outbox[i].subject || '').indexOf(match) !== -1)) return outbox[i];
  }
  return null;
}
function tempPasswordFor(email) {
  const m = mailTo(email, 'Temporary password');
  return m ? (m.body.match(/Temporary password: (\S+)/) || [])[1] : null;
}

sandbox.setup();
const supervisor = call('login', { email: 'supervisor@example.test', password: tempPasswordFor('supervisor@example.test') });
function staff(email, name, role) {
  call('inviteUser', { name: name, email: email, role_id: role }, supervisor.token);
  return call('login', { email: email, password: tempPasswordFor(email) });
}
const administrator = staff('admin@example.test', 'Administrator', 'ADMINISTRATOR');
const seniorEditor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');

const menus = () => JSON.parse(repo.get('data/menus.json'));

/* ------------------------------------------------------------- seeding -- */

console.log('\na fresh install is publishable');

test('setup seeds a site rather than an empty shell', () => {
  const cfg = call('siteConfiguration', {}, supervisor.token);
  assert(cfg.menus.length >= 8, 'no menu items seeded');
  assert(cfg.homepage.length >= 4, 'no homepage sections seeded');
  assert(cfg.categories.length >= 5, 'no categories seeded');
  assert(cfg.settings.brand.name, 'no brand name seeded');
  assert(cfg.live === null, 'nothing should be published yet');
});

test('the first publication writes every configuration file', () => {
  const res = call('publishConfiguration', { note: 'Initial configuration' }, supervisor.token);
  assert(res.version === 1, 'expected version 1');
  ['data/settings.json', 'data/menus.json', 'data/homepage.json',
   'data/categories.json', 'data/features.json'].forEach(f => assert(repo.has(f), f + ' was not committed'));
  assert(menus().primary.filter(m => m.status === 'ACTIVE').length >= 6);
});

/* ------------------------------------------------------------ privately -- */

console.log('\nediting is private until published');

test('an administrator can edit configuration', () => {
  const res = call('saveMenuItem', {
    menu: 'primary', name: 'Hydrogen', url: 'category.html?c=hydrogen', order: 7
  }, administrator.token);
  assert(res.id, 'the item was not created');
});

test('the live site does not move when configuration is edited', () => {
  assert(!menus().primary.some(m => m.name === 'Hydrogen'), 'an unpublished menu item is already public');
});

test('preview names exactly which files would change', () => {
  const pv = call('previewConfiguration', {}, administrator.token);
  assert(pv.pending === 1, 'expected one pending file, got ' + pv.pending);
  assert(pv.files.filter(f => f.changed)[0].path === 'data/menus.json');
  assert(pv.live.version === 1);
});

test('an editor without MANAGE cannot edit configuration', () => {
  throwsWith('forbidden', () => call('saveMenuItem',
    { menu: 'primary', name: 'Sneaky', url: 'about.html' }, seniorEditor.token));
});

test('an administrator cannot publish it', () => {
  throwsWith('forbidden', () => call('publishConfiguration', {}, administrator.token));
});

test('the supervisor publishes and the change goes live', () => {
  const res = call('publishConfiguration', { note: 'Add hydrogen' }, supervisor.token);
  assert(res.version === 2);
  assert(menus().primary.some(m => m.name === 'Hydrogen'), 'the published menu is missing the item');
  assert(call('previewConfiguration', {}, administrator.token).pending === 0, 'still pending after publishing');
});

/* ------------------------------------------------------------ validation -- */

console.log('\nwhat reaches a public page is validated');

test('a javascript: menu URL is refused', () => {
  throwsWith('bad_url', () => call('saveMenuItem',
    { menu: 'primary', name: 'Bad', url: 'javascript:alert(1)' }, administrator.token));
  throwsWith('bad_url', () => call('saveMenuItem',
    { menu: 'primary', name: 'Bad', url: 'data:text/html;base64,PHNjcmlwdD4=' }, administrator.token));
});

test('an http (not https) external URL is refused', () => {
  throwsWith('bad_url', () => call('saveMenuItem',
    { menu: 'primary', name: 'Insecure', url: 'http://example.com' }, administrator.token));
});

test('menus stay two levels deep', () => {
  const parent = Db.findOne('Menus', { id: 'm-energy' });
  const child = Db.findOne('Menus', { id: 'm-storage' });
  assert(parent && child);
  throwsWith('bad_parent', () => call('saveMenuItem', {
    id: 'm-about', menu: 'primary', name: 'About', url: 'about.html', parent: child.id
  }, administrator.token));
});

test('an item cannot be its own parent', () => {
  throwsWith('bad_parent', () => call('saveMenuItem', {
    id: 'm-about', menu: 'primary', name: 'About', url: 'about.html', parent: 'm-about'
  }, administrator.token));
});

test('a homepage section pointing at a category that does not exist is refused', () => {
  throwsWith('bad_source', () => call('saveHomepageSection', {
    section_id: 'ghost', type: 'list', title: 'Ghosts', source: 'category:does-not-exist', count: 4
  }, administrator.token));
});

test('a section schedule that ends before it starts is refused', () => {
  throwsWith('bad_schedule', () => call('saveHomepageSection', {
    section_id: 'promo', type: 'list', title: 'Promo', source: 'latest', count: 3,
    starts: '2026-10-01T00:00:00Z', ends: '2026-09-01T00:00:00Z'
  }, administrator.token));
});

test('an appearance token carrying CSS is refused', () => {
  throwsWith('bad_token_value', () => call('saveSiteSettings', {
    tokens: { '--accent': 'red; background:url(https://evil.test/x)' }
  }, administrator.token));
  throwsWith('bad_token', () => call('saveSiteSettings', {
    tokens: { 'accent': '#123456' }
  }, administrator.token));
});

test('a valid palette change is accepted', () => {
  call('saveSiteSettings', { tokens: { '--accent': '#8A3324', '--ink': '#13212E' }, theme: 'sepia' }, administrator.token);
  const cfg = call('siteConfiguration', {}, administrator.token);
  assert(cfg.settings.appearance.tokens['--accent'] === '#8A3324', 'the token was not stored');
});

test('analytics and adsense identifiers are checked for shape', () => {
  throwsWith('bad_analytics_id', () => call('saveSiteSettings', { analytics: { ga4_id: 'UA-12345' } }, administrator.token));
  throwsWith('bad_adsense_id', () => call('saveSiteSettings', { ads: { adsense_client: 'pub-123' } }, administrator.token));
  call('saveSiteSettings', { analytics: { ga4_id: 'G-ABC1234567' } }, administrator.token);
});

test('a save that changes nothing is refused rather than silently succeeding', () => {
  throwsWith('nothing_to_save', () => call('saveSiteSettings', {}, administrator.token));
});

/* --------------------------------------------------------------- guards -- */

console.log('\nguards on destructive configuration');

test('publishing a site with no navigation is refused', () => {
  const active = Db.all('Menus').filter(m => m.menu === 'primary' && m.status === 'ACTIVE');
  active.forEach(m => Db.update('Menus', { id: m.id }, { status: 'DISABLED' }));
  throwsWith('empty_navigation', () => call('publishConfiguration', {}, supervisor.token));
  active.forEach(m => Db.update('Menus', { id: m.id }, { status: 'ACTIVE' }));
});

test('a category with published articles cannot be retired', () => {
  const id = 'MAG-2026-000999';
  Db.insert('Articles', {
    id: id, slug: 'test-live-article', title: 'A live article', category: 'energy-storage',
    status: 'PUBLISHED', public_version: 1, working_version: 1, primary_author: supervisor.user.id
  });
  throwsWith('category_in_use', () => call('saveCategory', {
    slug: 'energy-storage', name: 'Energy storage', status: 'DISABLED'
  }, administrator.token));
  Db.update('Articles', { id: id }, { status: 'ARCHIVED' });
});

test('the locked author-registration flag cannot be switched on', () => {
  throwsWith('flag_locked', () => call('setFeatureFlag', { flag: 'AUTHOR_REGISTRATION', state: 'enabled' }, supervisor.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'LOCKED_FLAG_BLOCKED'), 'the attempt was not audited');
});

test('the published feature file always reports it disabled and locked', () => {
  const flags = JSON.parse(repo.get('data/features.json')).flags;
  assert(flags.AUTHOR_REGISTRATION.state === 'disabled' && flags.AUTHOR_REGISTRATION.locked === true);
});

test('an ordinary flag can be switched and scheduled', () => {
  call('setFeatureFlag', { flag: 'ADVERTISING', state: 'enabled', note: 'First direct campaign' }, administrator.token);
  throwsWith('bad_schedule', () => call('setFeatureFlag', { flag: 'EVENTS', state: 'scheduled' }, administrator.token));
  call('setFeatureFlag', { flag: 'EVENTS', state: 'scheduled', starts: '2026-12-01T00:00:00Z' }, administrator.token);
  call('publishConfiguration', { note: 'Turn advertising on' }, supervisor.token);
  assert(JSON.parse(repo.get('data/features.json')).flags.ADVERTISING.state === 'enabled');
});

test('internal settings never reach the public settings file', () => {
  // The Settings sheet doubles as internal storage: rendered articles, authors'
  // checklist answers, counters. None of it belongs in a file every reader
  // downloads on the homepage.
  Db.insert('Settings', { key: 'public.MAG-2026-000998', value: '{"secret":"rendered article"}', scope: 'published' });
  Db.insert('Settings', { key: 'checklist.MAG-2026-000998.v1', value: '{"ai_declared":true}', scope: 'system' });
  call('publishConfiguration', { note: 'Leak check' }, supervisor.token);
  const published = repo.get('data/settings.json');
  assert(published.indexOf('rendered article') === -1, 'a stored article document was published in settings.json');
  assert(published.indexOf('checklist') === -1, 'submission checklist answers were published');
  assert(JSON.parse(published).brand.name, 'the real settings went missing');
});

test('unpublished menu items and inactive sections stay out of the public files', () => {
  call('saveMenuItem', { menu: 'primary', name: 'Draft section', url: 'about.html', status: 'DISABLED' }, administrator.token);
  call('saveHomepageSection', { section_id: 'future', type: 'list', title: 'Coming soon', source: 'latest', count: 3, active: false }, administrator.token);
  call('publishConfiguration', { note: 'Check the shape of the public files' }, supervisor.token);
  assert(!menus().primary.some(m => m.name === 'Draft section'), 'a disabled menu item is public');
  const home = JSON.parse(repo.get('data/homepage.json'));
  assert(!home.sections.some(x => x.id === 'future'), 'an inactive homepage section is public');
});

test('an ad section keeps its placement through a publish', () => {
  // The seeded homepage carries an ad slot. If publication drops the placement,
  // the slot renders as an empty box that can never be filled — which is how a
  // homepage silently loses its advertising.
  const home = JSON.parse(repo.get('data/homepage.json'));
  const ad = home.sections.filter(x => x.type === 'ad')[0];
  assert(ad && ad.placement, 'the published ad section has no placement');
  throwsWith('placement_required', () => call('saveHomepageSection', {
    section_id: 'ad-middle', type: 'ad', title: ''
  }, administrator.token));
  throwsWith('unknown_placement', () => call('saveHomepageSection', {
    section_id: 'ad-middle', type: 'ad', placement: 'NOT_A_SLOT'
  }, administrator.token));
});

/* ----------------------------------------------------------- versioning -- */

console.log('\nconfiguration versions');

test('every publication is a recoverable version', () => {
  const versions = call('configurationVersions', {}, administrator.token);
  assert(versions.length >= 3, 'expected several versions, got ' + versions.length);
  assert(versions.filter(v => v.live).length === 1, 'exactly one version should be live');
  assert(versions[0].version > versions[1].version, 'versions should be newest first');
});

test('rollback needs a reason and the supervisor', () => {
  throwsWith('reason_required', () => call('rollbackConfiguration', { version: 1 }, supervisor.token));
  throwsWith('forbidden', () => call('rollbackConfiguration',
    { version: 1, reason: 'undoing the hydrogen menu item' }, administrator.token));
});

test('rollback puts the earlier configuration back on the site', () => {
  call('rollbackConfiguration', { version: 1, reason: 'The hydrogen section is not ready to launch.' }, supervisor.token);
  assert(!menus().primary.some(m => m.name === 'Hydrogen'), 'the rollback did not reach the site');
  assert(JSON.parse(repo.get('data/features.json')).flags.ADVERTISING.state === 'disabled',
    'the rollback did not restore the earlier flags');
});

test('the database still holds the working copy after a rollback', () => {
  const cfg = call('siteConfiguration', {}, administrator.token);
  assert(cfg.menus.some(m => m.name === 'Hydrogen'), 'rollback destroyed unpublished work');
  assert(cfg.live.version === 1, 'the live version is not reported correctly');
  assert(call('previewConfiguration', {}, administrator.token).pending > 0, 'the gap should show as pending');
});

test('adopting the live version brings the database back into line', () => {
  call('adoptConfiguration', { version: 1 }, supervisor.token);
  const cfg = call('siteConfiguration', {}, administrator.token);
  const hydrogen = cfg.menus.filter(m => m.name === 'Hydrogen')[0];
  assert(!hydrogen || hydrogen.status === 'DISABLED', 'adopt left the later item active');
  assert(call('previewConfiguration', {}, administrator.token).pending === 0, 'adopt should close the gap');
});

test('rollback and adoption are both audited', () => {
  const actions = Db.all('AuditLogs').map(l => l.action);
  assert(actions.indexOf('CONFIGURATION_ROLLED_BACK') !== -1);
  assert(actions.indexOf('CONFIGURATION_ADOPTED') !== -1);
});

/* ----------------------------------------------------------- delegation -- */

console.log('\ndelegated and emergency access');

test('a temporary grant is visible, scoped and time-boxed', () => {
  call('grantPermission', {
    user_id: seniorEditor.user.id, permission: 'MANAGE', scope: 'energy-storage',
    expires_at: new Date(Date.now() + 3600000).toISOString(), reason: 'Covering leave'
  }, supervisor.token);
  const grants = call('listGrants', {}, supervisor.token);
  const g = grants.filter(x => x.user_id === seniorEditor.user.id)[0];
  assert(g && g.active && g.scope === 'energy-storage', 'the grant is not listed correctly');
});

test('a scoped grant does not become a general one', () => {
  // MANAGE scoped to one section must not open the whole control centre.
  throwsWith('forbidden', () => call('siteConfiguration', {}, seniorEditor.token));
});

test('revoking ends it immediately', () => {
  const g = call('listGrants', {}, supervisor.token).filter(x => x.user_id === seniorEditor.user.id)[0];
  call('revokeGrant', { grant_id: g.id, reason: 'Back from leave' }, supervisor.token);
  const after = call('listGrants', {}, supervisor.token).filter(x => x.id === g.id)[0];
  assert(after && !after.active, 'the grant is still active');
  assert(after.reason, 'the record of why it was granted was destroyed');
});

test('emergency access demands a real reason and a duration', () => {
  throwsWith('reason_required', () => call('emergencyAccess', {
    user_id: administrator.user.id, permission: 'ARCHIVE', hours: 2, reason: 'urgent'
  }, supervisor.token));
  throwsWith('duration_required', () => call('emergencyAccess', {
    user_id: administrator.user.id, permission: 'ARCHIVE',
    reason: 'Sponsored article published with the wrong disclosure, needs pulling now.'
  }, supervisor.token));
});

test('emergency access is capped, granted and announced', () => {
  const res = call('emergencyAccess', {
    user_id: administrator.user.id, permission: 'ARCHIVE', hours: 999,
    reason: 'Sponsored article published with the wrong disclosure, needs pulling now.'
  }, supervisor.token);
  assert(res.hours <= 24, 'the duration cap did not apply: ' + res.hours);
  assert(mailTo('supervisor@example.test', 'Emergency'), 'the supervisor was not told');
  assert(Db.all('AuditLogs').some(l => l.action === 'EMERGENCY_ACCESS_GRANTED'), 'not audited');
});

test('emergency access cannot reach FINAL_PUBLISH', () => {
  throwsWith('forbidden', () => call('emergencyAccess', {
    user_id: administrator.user.id, permission: 'FINAL_PUBLISH', hours: 1,
    reason: 'The supervisor is unreachable and this needs publishing tonight.'
  }, supervisor.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'FINAL_PUBLISH_GRANT_BLOCKED'));
});

test('an expired grant stops working without any cleanup job', () => {
  const g = call('grantPermission', {
    user_id: seniorEditor.user.id, permission: 'MANAGE', scope: '*',
    expires_at: new Date(Date.now() + 60000).toISOString(), reason: 'Short window'
  }, supervisor.token);
  assert(call('siteConfiguration', {}, seniorEditor.token).menus.length, 'the grant did not take effect');
  Db.update('UserGrants', { id: g.id }, { expires_at: new Date(Date.now() - 1000).toISOString() });
  throwsWith('forbidden', () => call('siteConfiguration', {}, seniorEditor.token));
});

/* ------------------------------------------------------------- standing -- */

console.log('\nstanding invariants');

test('the supervisor invariants survive phase 5', () => {
  throwsWith('forbidden', () => call('setUserRole',
    { user_id: administrator.user.id, role_id: 'SUPERVISOR_ADMIN' }, supervisor.token));
  throwsWith('forbidden', () => call('setRolePermissions',
    { role_id: 'ADMINISTRATOR', permissions: [{ permission: 'FINAL_PUBLISH', scope: '*' }] }, supervisor.token));
});

test('configuration publication remains supervisor-only after everything above', () => {
  throwsWith('forbidden', () => call('publishConfiguration', {}, administrator.token));
});

done();
