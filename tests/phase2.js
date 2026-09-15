/* tests/phase2.js — drives the real router end to end against stubbed Google
 * services. Everything here goes through doPost, so a rule that exists only in
 * the portal's JavaScript will fail these tests, which is the point.
 *
 *   node tests/phase2.js
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

const { outbox } = sandbox;

/** Calls the web app the way the browser does. Failures are thrown with .code
 *  so tests can assert on the exact error the API returns. */
function call(action, payload, token) {
  const res = sandbox.doPost({ postData: { contents: JSON.stringify({ action, token: token || null, payload: payload || {} }) } });
  const out = JSON.parse(res.getContent());
  if (out.ok) return out.data;
  const err = new Error(out.error + (out.detail ? ': ' + out.detail : ''));
  err.code = out.error;
  err.detail = out.detail;
  throw err;
}

function lastMail(match) {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (!match || (outbox[i].body || '').indexOf(match) !== -1 || (outbox[i].subject || '').indexOf(match) !== -1) return outbox[i];
  }
  return null;
}

/* ---------------------------------------------------------------- setup -- */

console.log('\nsetup and seeds');

sandbox.setup();

test('setup refuses to start, and says everything that is missing at once', () => {
  // A real installation failed here with "Missing script property:
  // SPREADSHEET_ID" — which names one setting, so you fix it and meet the next.
  const bare = build({ ENV: 'test' });
  let message = '';
  try { bare.setup(); } catch (e) { message = e.message; }
  assert(message, 'setup ran with no settings at all');
  ['SPREADSHEET_ID', 'DRIVE_FOLDER_ID', 'PASSWORD_PEPPER', 'TOKEN_PEPPER',
   'SITE_URL', 'BOOTSTRAP_EMAIL'].forEach(k => {
    assert(message.indexOf(k) !== -1, message + '\n— did not mention ' + k);
  });
  assert(/Save script properties/.test(message),
    'the message does not say where to fix it, which is the whole point');
});

test('a setting typed in the wrong case is named, not silently ignored', () => {
  const wrong = build({ ENV: 'test', spreadsheet_id: 'x', DRIVE_FOLDER_ID: 'y' });
  let message = '';
  try { wrong.setup(); } catch (e) { message = e.message; }
  assert(/NEARLY RIGHT/.test(message) && /spreadsheet_id/.test(message),
    'a lower-case property name is invisible to the engine and must be called out');
});

test('the publishing check names the missing piece rather than a code', () => {
  const noToken = build({ ENV: 'test', GITHUB_REPO: 'owner/repo' });
  const report = noToken.checkPublishing();
  assert(/MISSING  GITHUB_TOKEN/.test(report), 'a missing token is not called out:\n' + report);
  assert(/Save script properties/.test(report), 'it does not say where it goes');

  const badRepo = build({ ENV: 'test', GITHUB_REPO: 'https://github.com/o/r', GITHUB_TOKEN: 'x'.repeat(40) });
  const second = badRepo.checkPublishing();
  assert(/WRONG    GITHUB_REPO/.test(second), 'a full URL in GITHUB_REPO is not caught:\n' + second);
});

test('the publishing settings helper leaves the other settings alone', () => {
  const box = build({ ENV: 'test', SPREADSHEET_ID: 'sheet', PASSWORD_PEPPER: 'p' });
  let refused = '';
  try { box.setPublishingSettings(); } catch (e) { refused = e.message; }
  assert(/Put your token in first/.test(refused), 'it should refuse the placeholder token');
  // Writing the two must not wipe what is already there — setProperties can.
  box.PropertiesService.getScriptProperties().setProperties(
    { GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'x'.repeat(40) }, false);
  const after = box.PropertiesService.getScriptProperties().getProperties();
  assert(after.SPREADSHEET_ID === 'sheet', 'an earlier property was lost');
  assert(after.GITHUB_REPO === 'o/r');
});

test('the publishing check writes a test file and removes it', () => {
  const ok = build({ ENV: 'test', GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 'x'.repeat(40) });
  const report = ok.checkPublishing();
  assert(/Publishing works/.test(report), 'a working connection was not confirmed:\n' + report);
  assert(!ok.repo.has('data/.publish-check.json'), 'the test file was left behind');
});

test('the report says saving works when some properties did save', () => {
  // The case that actually happened: ENV saved, the other six did not. That
  // combination rules out the usual explanations — wrong project, wrong
  // account, a Save button that does nothing — and the report should say so
  // rather than repeating advice the person has already followed.
  const partial = build({ ENV: 'test' });
  const report = partial.checkSetup();
  assert(/Saving does work in this project/.test(report),
    'the report does not use the most useful clue it has:\n' + report);
  assert(/setPropertiesOnce/.test(report), 'it does not offer the way round the screen');
});

test('a name with a stray space is reported as nearly right, not missing', () => {
  const spaced = build({ 'SPREADSHEET_ID ': 'abc', ENV: 'test' });
  const report = spaced.checkSetup();
  assert(/Nearly right/.test(report), 'a stray space was reported as simply missing:\n' + report);
  assert(/\[SPREADSHEET_ID \]/.test(report), 'the space is not made visible');
});

test('the diagnostic names a property typed with a stray space', () => {
  // A space pasted from a document is invisible on the settings screen and
  // makes the property a different one entirely. This is the check that finds it.
  const odd = build({ 'SPREADSHEET_ID ': 'abc', ENV: 'test' });
  const report = odd.whatCanISee();
  assert(/\[SPREADSHEET_ID \]/.test(report), 'the stray space is not visible in the report');
  assert(/MISSING SPREADSHEET_ID/.test(report), 'it should still report the real one as missing');
  assert(/Spaces and case matter/.test(report), 'it does not explain what happened');
});

test('settings can be written from code when the screen will not hold them', () => {
  const blank = build({ ENV: 'test' });
  let refused = '';
  try { blank.setPropertiesOnce(); } catch (e) { refused = e.message; }
  assert(/Fill these in first/.test(refused), 'it should refuse to write the placeholder values');
});

test('two-factor is enrolled by the person who will use it', () => {
  const supervisorSession = call('login', { email: 'supervisor@example.test', password: tempPassword });
  const start = call('beginMfa', {}, supervisorSession.token);
  assert(/^[A-Z2-7]{32}$/.test(start.secret), 'the secret is not valid base32: ' + start.secret);
  assert(/^otpauth:\/\/totp\//.test(start.otpauth), 'no link an authenticator app can read');
  assert(start.otpauth.indexOf(start.secret) !== -1, 'the link does not carry the secret');

  // Nothing is in force until a code proves the app and the secret agree.
  assert(call('mfaState', {}, supervisorSession.token).enabled === false,
    'starting the setup should not enable it');
  throwsWith('bad_code', () => call('enableMfa', { code: '000000' }, supervisorSession.token));

  const code = sandbox.internals.Auth.totpAt(
    sandbox.internals.Auth.base32Decode(start.secret), Math.floor(Date.now() / 30000));
  assert(call('enableMfa', { code: code }, supervisorSession.token).enabled === true, 'a valid code did not enable it');
  assert(call('mfaState', {}, supervisorSession.token).enabled === true);
});

test('once enabled, a password alone is not enough', () => {
  throwsWith('mfa_required', () => call('login', { email: 'supervisor@example.test', password: tempPassword }));
  const user = sandbox.internals.Db.findOne('Users', { email: 'supervisor@example.test' });
  const code = sandbox.internals.Auth.totpAt(
    sandbox.internals.Auth.base32Decode(user.mfa_secret), Math.floor(Date.now() / 30000));
  const ok = call('login', { email: 'supervisor@example.test', password: tempPassword, mfa_code: code });
  assert(ok.token, 'a correct code did not let the supervisor in');
});

test('a wrong password fails the same way whether or not two-factor is on', () => {
  // The error must not become an oracle for who has two-factor enabled.
  throwsWith('invalid_credentials', () => call('login',
    { email: 'supervisor@example.test', password: 'wrong', mfa_code: '123456' }));
});

test('turning it off needs a current code as well', () => {
  const user = sandbox.internals.Db.findOne('Users', { email: 'supervisor@example.test' });
  const code = sandbox.internals.Auth.totpAt(
    sandbox.internals.Auth.base32Decode(user.mfa_secret), Math.floor(Date.now() / 30000));
  const session = call('login', { email: 'supervisor@example.test', password: tempPassword, mfa_code: code });
  throwsWith('bad_code', () => call('disableMfa', { code: '000000' }, session.token));
  assert(call('disableMfa', { code: code }, session.token).enabled === false, 'a valid code did not turn it off');
  assert(!sandbox.internals.Db.findOne('Users', { email: 'supervisor@example.test' }).mfa_secret,
    'the secret should be discarded when two-factor is turned off');
  assert(sandbox.internals.Db.all('AuditLogs').some(l => l.action === 'MFA_ENABLED'), 'enabling was not audited');
});

test('every declared table exists', () => {
  Object.keys(sandbox.internals.SCHEMA).forEach(t => assert(sandbox.sheets.get(t), t + ' missing'));
});

test('article formats and their fields are seeded', () => {
  const f = sandbox.internals.Db.findOne('ArticleFormats', { slug: 'research-highlight' });
  assert(f, 'research-highlight missing');
  const fields = sandbox.internals.Db.find('FormatFields', { format_id: f.id });
  assert(fields.length >= 7, 'expected the full field set, got ' + fields.length);
});

test('submission checklist is seeded and required', () => {
  const items = sandbox.internals.Db.all('SubmissionChecklist');
  assert(items.length >= 7, 'checklist too short');
  assert(items.every(i => i.required === true), 'checklist items should be required by default');
});

/* --------------------------------------------------------------- login --- */

console.log('\nauthentication');

const tempPassword = (lastMail('Temporary password').body.match(/Temporary password: (\S+)/) || [])[1];

test('bootstrap emails a one-time supervisor password', () => assert(tempPassword, 'no temporary password was sent'));

let supervisor;
test('supervisor signs in and is told to change the password', () => {
  supervisor = call('login', { email: 'supervisor@example.test', password: tempPassword });
  assert(supervisor.must_change_password === true, 'should demand a password change');
  assert(supervisor.user.role_id === 'SUPERVISOR_ADMIN');
});

test('wrong password is rejected without saying why', () => {
  throwsWith('invalid_credentials', () => call('login', { email: 'supervisor@example.test', password: 'wrong' }));
});

test('an unknown email fails identically — no account enumeration', () => {
  throwsWith('invalid_credentials', () => call('login', { email: 'nobody@example.test', password: 'wrong' }));
});

/* ---------------------------------------------------------- invitations -- */

console.log('\ninvitation lifecycle');

let invitation, acceptUrl;
test('supervisor invites an author', () => {
  invitation = call('createInvitation', {
    name: 'R. Menon', email: 'menon@example.test', institution: 'IISc',
    section: 'energy-storage', format: 'research-highlight', message: 'Write on hard carbon.'
  }, supervisor.token);
  assert(invitation.status === 'PENDING');
  acceptUrl = (lastMail('accept.html').body.match(/https:\/\/\S+/) || [])[0];
  assert(acceptUrl, 'no acceptance link was emailed');
});

const inviteId = () => decodeURIComponent(acceptUrl.match(/[?&]i=([^&]+)/)[1]);
const inviteToken = () => decodeURIComponent(acceptUrl.match(/[?&]t=([^&\s]+)/)[1]);

test('the plaintext token is never stored', () => {
  const row = sandbox.internals.Db.findOne('AuthorInvitations', { id: inviteId() });
  assert(row.token_hash !== inviteToken(), 'the raw token is in the sheet');
  assert(String(row.token_hash).length > 20, 'token_hash looks wrong');
});

test('a duplicate pending invitation is refused', () => {
  throwsWith('already_invited', () => call('createInvitation',
    { name: 'R. Menon', email: 'menon@example.test' }, supervisor.token));
});

test('the acceptance page needs the right token', () => {
  throwsWith('invalid_invitation', () => call('getInvitation', { id: inviteId(), token: 'guessed' }));
});

test('a valid token returns only what the page needs', () => {
  const view = call('getInvitation', { id: inviteId(), token: inviteToken() });
  assert(view.name === 'R. Menon');
  assert(view.email === undefined, 'the unauthenticated view leaks the invitee email');
  assert(view.invited_by === undefined, 'the unauthenticated view leaks internal ids');
});

test('a weak password is refused at acceptance', () => {
  throwsWith('weak_password', () => call('acceptInvitation',
    { id: inviteId(), token: inviteToken(), password: 'short' }));
});

test('acceptance creates exactly one AUTHOR account and a profile', () => {
  const res = call('acceptInvitation', {
    id: inviteId(), token: inviteToken(), password: 'Hard-Carbon-2026', position: 'Postdoc'
  });
  assert(res.ok === true);
  const user = sandbox.internals.Db.findOne('Users', { email: 'menon@example.test' });
  assert(user && user.role_id === 'AUTHOR', 'author account not created with the AUTHOR role');
  assert(sandbox.internals.Db.findOne('Authors', { user_id: user.id }), 'author profile not created');
});

test('the invitation link is single use', () => {
  const e = throwsWith('invalid_invitation', () => call('acceptInvitation',
    { id: inviteId(), token: inviteToken(), password: 'Hard-Carbon-2026' }));
  assert(e, 'replaying the link should fail');
});

test('an expired invitation cannot be accepted', () => {
  const inv = call('createInvitation', { name: 'Late Reply', email: 'late@example.test' }, supervisor.token);
  const url = (lastMail('accept.html').body.match(/https:\/\/\S+/) || [])[0];
  sandbox.internals.Db.update('AuthorInvitations', { id: inv.id }, { expires_at: '2020-01-01T00:00:00Z' });
  throwsWith('invitation_expired', () => call('getInvitation', {
    id: inv.id, token: decodeURIComponent(url.match(/[?&]t=([^&\s]+)/)[1])
  }));
  assert(sandbox.internals.Db.findOne('AuthorInvitations', { id: inv.id }).status === 'EXPIRED', 'status not marked EXPIRED');
});

test('revoking kills the emailed link immediately', () => {
  const inv = call('createInvitation', { name: 'Changed Mind', email: 'nope@example.test' }, supervisor.token);
  const url = (lastMail('accept.html').body.match(/https:\/\/\S+/) || [])[0];
  const token = decodeURIComponent(url.match(/[?&]t=([^&\s]+)/)[1]);
  call('revokeInvitation', { invitation_id: inv.id, reason: 'wrong person' }, supervisor.token);
  throwsWith('invalid_invitation', () => call('getInvitation', { id: inv.id, token: token }));
});

test('token guessing is throttled per invitation', () => {
  const inv = call('createInvitation', { name: 'Target', email: 'target@example.test' }, supervisor.token);
  let hitLimit = false;
  for (let i = 0; i < 15 && !hitLimit; i++) {
    try { call('getInvitation', { id: inv.id, token: 'guess-' + i }); }
    catch (e) { if (e.code === 'too_many_attempts') hitLimit = true; }
  }
  assert(hitLimit, 'unlimited guesses allowed against one invitation id');
});

/* ------------------------------------------------------------- authoring -- */

console.log('\nauthor portal rules');

let author;
test('the new author signs in', () => {
  author = call('login', { email: 'menon@example.test', password: 'Hard-Carbon-2026' });
  assert(author.user.role_id === 'AUTHOR');
  assert(author.must_change_password === false, 'a self-chosen password should not force a reset');
});

test('an author cannot list users', () => {
  throwsWith('forbidden', () => call('listUsers', {}, author.token));
});

test('an author cannot invite other authors', () => {
  throwsWith('forbidden', () => call('createInvitation', { name: 'Friend', email: 'friend@example.test' }, author.token));
});

test('an author cannot publish configuration', () => {
  throwsWith('forbidden', () => call('publishConfiguration', {}, author.token));
});

test('an author cannot grant themselves a permission', () => {
  throwsWith('forbidden', () => call('grantPermission', {
    user_id: author.user.id, permission: 'APPROVE', expires_at: '2030-01-01', reason: 'nope'
  }, author.token));
});

let draft;
test('an unknown format is refused', () => {
  throwsWith('unknown_format', () => call('createDraft', { title: 'A perfectly fine title', format: 'invented' }, author.token));
});

test('a draft gets a sequential article id and a slug', () => {
  draft = call('createDraft', {
    title: 'Hard carbon and the sodium-ion ceiling',
    format: 'research-highlight', category: 'energy-storage', level: 'understand'
  }, author.token);
  assert(/^MAG-\d{4}-000001$/.test(draft.id), 'unexpected id ' + draft.id);
  assert(draft.slug === 'hard-carbon-and-the-sodium-ion-ceiling', 'unexpected slug ' + draft.slug);
  assert(draft.status === 'DRAFT');
});

test('draft bodies are written to Drive, not to a cell', () => {
  const v = sandbox.internals.Db.findOne('Versions', { article_id: draft.id, version: 1 });
  assert(v.payload_ref && sandbox.files.has(v.payload_ref), 'no Drive payload for the working version');
});

test('a changeset is merged field by field, not pasted over the whole draft', () => {
  // Two windows, two sections. The second must not wipe the first.
  call('syncDraft', { article_id: draft.id, changes: { fields: { background: 'From the first window. ' } } }, author.token);
  const res = call('syncDraft', { article_id: draft.id, changes: { fields: { findings: 'From the second window. ' } } }, author.token);
  assert(res.ok && res.saved_at, 'the sync did not report a save');
  const held = call('getArticle', { article_id: draft.id }, author.token).content.fields;
  assert(/first window/.test(held.background), 'the first window\'s section was lost');
  assert(/second window/.test(held.findings), 'the second window\'s section was lost');
});

test('a sync that arrives behind says so, and keeps both', () => {
  const stale = 'not-the-current-timestamp';
  const res = call('syncDraft', {
    article_id: draft.id, base: stale,
    changes: { fields: { significance: 'Written while something else was saving. ' } }
  }, author.token);
  assert(res.merged_with_other_changes === true, 'a stale sync was not reported as merged');
  assert(res.fields && res.fields.background, 'the answer does not carry what the server holds');
  assert(/Written while/.test(res.fields.significance), 'the late change was dropped');
});

test('a sync with nothing in it costs nothing', () => {
  const res = call('syncDraft', { article_id: draft.id, changes: {} }, author.token);
  assert(res.unchanged === true, 'an empty changeset was treated as a save');
});

test('a made-up field name is refused', () => {
  throwsWith('bad_field', () => call('syncDraft',
    { article_id: draft.id, changes: { fields: { 'Drop Table': 'x' } } }, author.token));
});

test('an incomplete submission is refused with reasons', () => {
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: draft.id, checklist: {} }, author.token));
  assert(/required/i.test(e.detail), 'the author is not told what is missing: ' + e.detail);
});

const fullFields = {
  summary: 'Sodium-ion cells are cheap on paper. '.repeat(4),
  background: 'Graphite barely accepts sodium, so the field uses hard carbon. '.repeat(30),
  findings: 'Plateau capacity rises with pyrolysis temperature while the sloping region shrinks. '.repeat(30),
  significance: 'Cost models vary the cathode and hold the anode fixed, which is backwards. '.repeat(30),
  references: 'Stevens & Dahn, J. Electrochem. Soc. 147, 1271 (2000).'
};

function allChecked() {
  const out = {};
  sandbox.internals.Db.all('SubmissionChecklist').forEach(c => { out[c.id] = true; });
  return out;
}

test('an unticked checklist blocks submission even when the writing is done', () => {
  call('saveDraft', { article_id: draft.id, fields: fullFields }, author.token);
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: draft.id, checklist: {} }, author.token));
  assert(/Checklist/.test(e.detail), 'checklist not enforced: ' + e.detail);
});

test('over-length work is refused against the format limit', () => {
  const bloated = Object.assign({}, fullFields, { background: fullFields.background.repeat(12) });
  call('saveDraft', { article_id: draft.id, fields: bloated }, author.token);
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: draft.id, checklist: allChecked() }, author.token));
  assert(/Too long/.test(e.detail), 'word limit not enforced: ' + e.detail);
  call('saveDraft', { article_id: draft.id, fields: fullFields }, author.token);
});

test('a complete submission moves to SUBMITTED and records the checklist', () => {
  const res = call('submitArticle', { article_id: draft.id, checklist: allChecked() }, author.token);
  assert(res.status === 'SUBMITTED', 'got ' + res.status);
  const record = sandbox.internals.Db.findOne('Settings', { key: 'checklist.' + draft.id + '.v1' });
  assert(record, 'the checklist answers were not recorded with the submission');
});

test('a submitted version is locked against further editing', () => {
  throwsWith('locked', () => call('saveDraft', { article_id: draft.id, fields: fullFields }, author.token));
});

test('the author can withdraw while no editor has taken it', () => {
  const res = call('withdrawArticle', { article_id: draft.id }, author.token);
  assert(res.status === 'DRAFT');
  call('saveDraft', { article_id: draft.id, fields: fullFields }, author.token);   // editable again
});

test('an author cannot open a revision on an unpublished article', () => {
  throwsWith('not_published', () => call('startRevision', { article_id: draft.id }, author.token));
});

/* ------------------------------------------------------------ ownership -- */

console.log('\nownership isolation');

let other;
test('a second author is provisioned', () => {
  const inv = call('createInvitation', { name: 'Second Author', email: 'second@example.test' }, supervisor.token);
  const url = (lastMail('accept.html').body.match(/https:\/\/\S+/) || [])[0];
  call('acceptInvitation', {
    id: inv.id, token: decodeURIComponent(url.match(/[?&]t=([^&\s]+)/)[1]), password: 'Second-Author-2026'
  });
  other = call('login', { email: 'second@example.test', password: 'Second-Author-2026' });
});

test('another author cannot read the draft', () => {
  throwsWith('not_found', () => call('getArticle', { article_id: draft.id }, other.token));
});

test('another author cannot save over the draft', () => {
  throwsWith('not_found', () => call('saveDraft', { article_id: draft.id, fields: { summary: 'mine now' } }, other.token));
});

test('another author cannot submit it', () => {
  throwsWith('not_found', () => call('submitArticle', { article_id: draft.id, checklist: allChecked() }, other.token));
});

test('another author cannot sync into this draft', () => {
  throwsWith('not_found', () => call('syncDraft',
    { article_id: draft.id, changes: { fields: { background: 'mine now' } } }, other.token));
});

test('myArticles shows only your own work', () => {
  assert(call('myArticles', {}, other.token).length === 0, 'second author sees articles that are not theirs');
  assert(call('myArticles', {}, author.token).length === 1);
});

test('the denial is audited', () => {
  const rows = sandbox.internals.Db.all('AuditLogs').filter(l => l.action === 'ARTICLE_ACCESS_DENIED');
  assert(rows.length >= 3, 'cross-author access attempts are not being logged');
});

/* ---------------------------------------------------------------- media -- */

console.log('\nmedia');

const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('an unsupported file type is refused', () => {
  throwsWith('bad_type', () => call('uploadMedia', {
    article_id: draft.id, mime: 'application/pdf', data: onePixelPng, credit: 'me', licence: 'CC BY'
  }, author.token));
});

test('an image without credit and licence is refused', () => {
  throwsWith('credit_required', () => call('uploadMedia', {
    article_id: draft.id, mime: 'image/png', data: onePixelPng, name: 'figure1.png'
  }, author.token));
});

test('a credited image uploads and stays private', () => {
  const res = call('uploadMedia', {
    article_id: draft.id, mime: 'image/png', data: onePixelPng,
    name: 'figure1.png', credit: 'R. Menon', licence: 'CC BY 4.0', caption: 'Sodium storage schematic'
  }, author.token);
  assert(res.bytes > 0);
  assert(sandbox.internals.Db.findOne('Media', { id: res.id }).status === 'PRIVATE');
});

test('another author cannot attach media to the draft', () => {
  throwsWith('not_found', () => call('uploadMedia', {
    article_id: draft.id, mime: 'image/png', data: onePixelPng, credit: 'x', licence: 'y'
  }, other.token));
});

/* ------------------------------------------------------------- sessions -- */

console.log('\nsession handling');

test('suspending an author kills their session on the next call', () => {
  call('suspendUser', { user_id: other.user.id, reason: 'test' }, supervisor.token);
  throwsWith('unauthenticated', () => call('myArticles', {}, other.token));
  call('reactivateUser', { user_id: other.user.id }, supervisor.token);
});

test('an unknown action is rejected before any handler runs', () => {
  throwsWith('unknown_action', () => call('deleteEverything', {}, supervisor.token));
});

test('a missing token on a protected action fails cleanly', () => {
  throwsWith('unauthenticated', () => call('myArticles', {}));
});

test('the supervisor role still cannot be assigned through the API', () => {
  throwsWith('forbidden', () => call('setUserRole', {
    user_id: author.user.id, role_id: 'SUPERVISOR_ADMIN'
  }, supervisor.token));
});

done();
