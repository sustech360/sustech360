/* tests/phase8.js — magazine issues and PDF.
 *
 * The two rules worth testing: an issue cannot publish anything, it can only
 * collect what is already published; and once an issue is out, later revisions
 * to those articles do not reach back into it.
 *
 *   node tests/phase8.js
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
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
function staff(email, name, role) {
  call('inviteUser', { name: name, email: email, role_id: role }, supervisor.token);
  return call('login', { email: email, password: tempPasswordFor(email) });
}
const administrator = staff('admin@example.test', 'Administrator', 'ADMINISTRATOR');
const seniorEditor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');
const sectionEditor = staff('section@example.test', 'Section Editor', 'SECTION_EDITOR');

/** A published article, the way phase 3 leaves one. */
function publishedArticle(id, slug, title, summary) {
  Db.insert('Articles', {
    id: id, slug: slug, title: title, category: 'energy-storage',
    topics: JSON.stringify(['sodium-ion']), status: 'PUBLISHED',
    public_version: 1, working_version: 1, primary_author: supervisor.user.id,
    published_at: new Date().toISOString()
  });
  Db.insert('Settings', {
    key: 'public.' + id, scope: 'published',
    value: JSON.stringify({
      id: id, slug: slug, title: title, subtitle: '', summary: summary,
      category_name: 'Energy storage', public_version: 1, reading_minutes: 7,
      authors: [{ name: 'R. Menon', institution: 'IISc' }],
      blocks: [{ type: 'h2', text: 'Background' }, { type: 'p', text: summary },
               { type: 'references', items: ['Stevens & Dahn (2000).'] }]
    })
  });
  return id;
}

const first = publishedArticle('MAG-2026-000101', 'hard-carbon-ceiling',
  'Hard carbon and the sodium-ion ceiling', 'The anode decides the cost, not the cathode.');
const second = publishedArticle('MAG-2026-000102', 'electrolyte-additives',
  'What electrolyte additives actually do', 'Three additives, one mechanism, a lot of confusion.');

/* -------------------------------------------------------------- composing -- */

console.log('\ncomposing an issue');

let issue;
test('an issue is created with a number that cannot repeat', () => {
  issue = call('createIssue', { number: 1, month: 'September', year: 2026, title: 'Issue 1 — The anode problem' }, administrator.token);
  assert(issue.slug === 'issue-1' && issue.status === 'DRAFT');
  throwsWith('already_exists', () => call('createIssue', { number: 1 }, administrator.token));
});

test('only published articles can be placed in it', () => {
  Db.insert('Articles', {
    id: 'MAG-2026-000199', slug: 'still-a-draft', title: 'Still a draft', category: 'energy-storage',
    status: 'DRAFT', public_version: 0, working_version: 1, primary_author: supervisor.user.id
  });
  throwsWith('not_published', () => call('saveIssue', {
    id: issue.id, contents: { features: ['MAG-2026-000199'] }
  }, administrator.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'ISSUE_UNPUBLISHED_BLOCKED'),
    'the attempt to slip an unpublished article into an issue was not audited');
});

test('an unknown section is refused', () => {
  throwsWith('bad_section', () => call('saveIssue', {
    id: issue.id, contents: { horoscopes: [first] }
  }, administrator.token));
});

test('articles and an editorial are saved', () => {
  call('saveIssue', {
    id: issue.id,
    contents: { features: [first], research: [second] },
    editorial: 'Welcome to the first issue.\n\nWe start where the cost models do not.'
  }, administrator.token);
  const full = call('getIssue', { id: issue.id }, administrator.token);
  assert(full.article_count === 2, 'got ' + full.article_count);
  assert(/Welcome to the first issue/.test(full.editorial));
  assert(full.available.every(a => a.id !== first), 'a placed article is still offered as available');
});

test('a cover needs a credit and a licence like any other image', () => {
  throwsWith('credit_required', () => call('uploadIssueCover', {
    id: issue.id, mime: 'image/png', data: PNG, file: 'cover.png'
  }, administrator.token));
  const res = call('uploadIssueCover', {
    id: issue.id, mime: 'image/png', data: PNG, file: 'cover.png',
    credit: 'R. Menon', licence: 'CC BY 4.0'
  }, administrator.token);
  assert(res.bytes > 0);
});

/* ---------------------------------------------------------------- the PDF -- */

console.log('\nthe PDF');

test('the PDF contains the cover, the contents, the editorial and the articles', () => {
  const res = call('buildIssuePdf', { id: issue.id }, administrator.token);
  assert(res.bytes > 0, 'no PDF bytes');
  const row = Db.findOne('MagazineIssues', { id: issue.id });
  const text = sandbox.files.get(row.pdf_ref).content;
  assert(/%PDF/.test(text), 'the document is not a PDF');
  assert(text.indexOf('Issue 1 — The anode problem') !== -1, 'the title is missing');
  assert(text.indexOf('Contents') !== -1, 'no contents page');
  assert(text.indexOf('Welcome to the first issue') !== -1, 'the editorial is missing');
  assert(text.indexOf('What electrolyte additives actually do') !== -1, 'an article is missing');
  assert(text.indexOf('Stevens &amp; Dahn') !== -1, 'references were dropped');
});

test('editing the issue invalidates the built PDF', () => {
  call('saveIssue', { id: issue.id, theme: 'Why the anode decides' }, administrator.token);
  assert(!Db.findOne('MagazineIssues', { id: issue.id }).pdf_built_at, 'a stale PDF is still marked current');
});

/* -------------------------------------------------------------- approval -- */

console.log('\napproval and publication');

test('an incomplete issue cannot be verified', () => {
  const empty = call('createIssue', { number: 9, title: 'Issue 9' }, administrator.token);
  call('moveIssue', { id: empty.id, to: 'PREVIEW' }, administrator.token);
  const e = throwsWith('incomplete', () => call('moveIssue', { id: empty.id, to: 'VERIFIED' }, seniorEditor.token));
  assert(/no articles/.test(e.detail), e.detail);
});

test('the chain runs draft, preview, verified, approved', () => {
  call('moveIssue', { id: issue.id, to: 'PREVIEW' }, administrator.token);
  // A section editor can review but not approve, so verification is closed to them.
  throwsWith('forbidden', () => call('moveIssue', { id: issue.id, to: 'VERIFIED' }, sectionEditor.token));
  call('moveIssue', { id: issue.id, to: 'VERIFIED' }, seniorEditor.token);
  throwsWith('forbidden', () => call('moveIssue', { id: issue.id, to: 'APPROVED' }, seniorEditor.token));
  assert(call('moveIssue', { id: issue.id, to: 'APPROVED' }, supervisor.token).status === 'APPROVED');
});

test('an approved issue is locked against editing', () => {
  throwsWith('locked', () => call('saveIssue', { id: issue.id, title: 'Sneaky rename' }, administrator.token));
});

test('publication is refused to everyone but the supervisor', () => {
  throwsWith('forbidden', () => call('publishIssue', { issue_id: issue.id }, administrator.token));
  throwsWith('forbidden', () => call('publishIssue', { issue_id: issue.id }, seniorEditor.token));
});

test('publishing writes the PDF, the cover, the issue and the index', () => {
  const res = call('publishIssue', { issue_id: issue.id }, supervisor.token);
  assert(repo.has('issues/issue-1.pdf'), 'no PDF on the site');
  assert(repo.has('assets/issues/issue-1/cover.png'), 'no cover on the site');
  assert(repo.has('data/issues/issue-1.json'), 'no web edition');
  assert(repo.has('data/index/issues.json'), 'no issue index');
  assert(res.files.length >= 4);
});

test('the published PDF is built from what was approved, not from the old build', () => {
  // The PDF was invalidated by an edit before approval; publication rebuilds it,
  // so the theme added after the last manual build has to be in the file.
  assert(repo.get('issues/issue-1.pdf').indexOf('Why the anode decides') !== -1,
    'the site is serving a PDF built before the last edit');
});

test('an unapproved issue cannot be published', () => {
  const other = call('createIssue', { number: 2, title: 'Issue 2' }, administrator.token);
  throwsWith('not_approved', () => call('publishIssue', { issue_id: other.id }, supervisor.token));
  assert(!repo.has('data/issues/issue-2.json'), 'a draft issue reached the site');
});

test('the index lists published issues only', () => {
  const index = JSON.parse(repo.get('data/index/issues.json'));
  assert(index.issues.length === 1 && index.issues[0].number === 1);
  assert(index.issues[0].pdf === 'issues/issue-1.pdf');
});

/* ------------------------------------------------------------- immutable -- */

console.log('\na published issue does not move');

test('the web edition holds what the articles said at publication', () => {
  const edition = JSON.parse(repo.get('data/issues/issue-1.json'));
  const article = edition.sections[0].items[0];
  assert(article.title === 'Hard carbon and the sodium-ion ceiling');
  assert(article.blocks.length, 'the issue kept no text, only a link');
  assert(edition.article_count === 2);
});

test('revising an article afterwards does not rewrite the issue', () => {
  const before = repo.get('data/issues/issue-1.json');
  Db.update('Settings', { key: 'public.' + first }, {
    value: JSON.stringify({
      id: first, slug: 'hard-carbon-ceiling', title: 'COMPLETELY DIFFERENT TITLE',
      summary: 'Rewritten', category_name: 'Energy storage', public_version: 2,
      reading_minutes: 9, authors: [], blocks: [{ type: 'p', text: 'Rewritten' }]
    })
  });
  assert(repo.get('data/issues/issue-1.json') === before, 'the published issue changed under a revision');
  assert(before.indexOf('COMPLETELY DIFFERENT') === -1);
});

test('archiving an article does not empty a published issue', () => {
  Db.update('Articles', { id: second }, { status: 'ARCHIVED' });
  const edition = JSON.parse(repo.get('data/issues/issue-1.json'));
  assert(edition.article_count === 2, 'the archived article vanished from a printed issue');
});

test('but a new issue cannot be verified with an unpublished article in it', () => {
  const next = call('createIssue', { number: 3, title: 'Issue 3' }, administrator.token);
  Db.update('Articles', { id: second }, { status: 'PUBLISHED' });
  call('saveIssue', { id: next.id, contents: { features: [second] }, editorial: 'Short.' }, administrator.token);
  Db.update('Articles', { id: second }, { status: 'ARCHIVED' });
  call('moveIssue', { id: next.id, to: 'PREVIEW' }, administrator.token);
  const e = throwsWith('incomplete', () => call('moveIssue', { id: next.id, to: 'VERIFIED' }, seniorEditor.token));
  assert(/no longer published/.test(e.detail), e.detail);
});

/* ---------------------------------------------------------- reader rules -- */

console.log('\nreader controls');

test('download and print controls are configuration, and reach the site', () => {
  call('saveSiteSettings', { reading: { allow_pdf_download: false, allow_print: true } }, administrator.token);
  call('publishConfiguration', { note: 'Reader controls' }, supervisor.token);
  const settings = JSON.parse(repo.get('data/settings.json'));
  // Content.settings parses stored values, so the site receives a real boolean
  // rather than the string "false" — which is the version a frontend can trust.
  assert(settings.reading.allow_pdf_download === false, 'the control did not reach the site');
  assert(settings.reading.allow_print === true, 'print should still be allowed');
  assert(settings.reading.copy_notice, 'the copyright notice is missing');
});

test('every issue action is audited', () => {
  ['ISSUE_CREATED', 'ISSUE_COVER_SET', 'ISSUE_PDF_BUILT', 'ISSUE_TRANSITION', 'ISSUE_PUBLISHED']
    .forEach(a => assert(Db.all('AuditLogs').some(l => l.action === a), a + ' was not audited'));
});

test('the standing invariants survive phase 8', () => {
  throwsWith('forbidden', () => call('publishConfiguration', {}, administrator.token));
  throwsWith('forbidden', () => call('setRolePermissions',
    { role_id: 'ADMINISTRATOR', permissions: [{ permission: 'FINAL_PUBLISH', scope: '*' }] }, supervisor.token));
});

done();
