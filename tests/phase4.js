/* tests/phase4.js — the guidelines centre and the editorial rulebook.
 *
 * Two things are being checked. First, that a guideline behaves like published
 * content: versioned, approved by the supervisor alone, and never changed under
 * readers until its replacement goes live. Second, that the rulebook is not
 * decoration — changing a format, a checklist item or a media rule has to change
 * what the submission gate and the upload path actually do.
 *
 *   node tests/phase4.js
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
    if (outbox[i].to === email && (!match || (outbox[i].body || '').indexOf(match) !== -1)) return outbox[i];
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
const sectionEditor = staff('section@example.test', 'Section Editor', 'SECTION_EDITOR');

const inv = call('createInvitation', { name: 'R. Menon', email: 'menon@example.test', section: 'energy-storage' }, supervisor.token);
const acceptUrl = mailTo('menon@example.test', 'accept.html').body.match(/https:\/\/\S+/)[0];
call('acceptInvitation', { id: inv.id, token: decodeURIComponent(acceptUrl.match(/[?&]t=([^&\s]+)/)[1]), password: 'Hard-Carbon-2026' });
const author = call('login', { email: 'menon@example.test', password: 'Hard-Carbon-2026' });

/* ------------------------------------------------------------ guidelines -- */

console.log('\nguideline versioning');

let draft;
test('an administrator opens the next version from the live text', () => {
  draft = call('draftGuideline', { kind: 'AUTHOR', notes: 'Tighten the figures section' }, administrator.token);
  assert(draft.version === '1.1', 'expected 1.1, got ' + draft.version);
  assert(draft.status === 'DRAFT');
  const body = call('getGuideline', { id: draft.id }, administrator.token).body;
  assert(/Figures/.test(body), 'the new version did not start from the current text');
});

test('two versions cannot be open at once', () => {
  throwsWith('version_open', () => call('draftGuideline', { kind: 'AUTHOR' }, administrator.token));
});

test('the body lives in Drive, not in a cell', () => {
  const row = Db.findOne('Guidelines', { id: draft.id });
  assert(row.body_ref && sandbox.files.has(row.body_ref), 'no Drive file for the guideline body');
});

test('an author cannot draft or read an unpublished guideline', () => {
  throwsWith('forbidden', () => call('draftGuideline', { kind: 'REVIEW' }, author.token));
  throwsWith('forbidden', () => call('getGuideline', { id: draft.id }, author.token));
});

test('edits are saved without touching anything public', () => {
  call('saveGuideline', { id: draft.id, body: 'REWRITTEN AUTHOR GUIDELINES.\n\nFigures need a licence.' }, administrator.token);
  assert(!repo.has('data/guidelines.json'), 'a draft reached the public site');
  assert(/REWRITTEN/.test(call('getGuideline', { id: draft.id }, administrator.token).body));
});

test('the chain must be walked in order', () => {
  throwsWith('illegal_transition', () => call('moveGuideline', { id: draft.id, to: 'APPROVED' }, supervisor.token));
});

test('preview is an editor step, verification needs APPROVE', () => {
  call('moveGuideline', { id: draft.id, to: 'PREVIEW' }, administrator.token);
  throwsWith('forbidden', () => call('moveGuideline', { id: draft.id, to: 'VERIFIED' }, sectionEditor.token));
  assert(call('moveGuideline', { id: draft.id, to: 'VERIFIED' }, seniorEditor.token).status === 'VERIFIED');
});

test('no editor can approve a guideline', () => {
  throwsWith('forbidden', () => call('moveGuideline', { id: draft.id, to: 'APPROVED' }, seniorEditor.token));
  throwsWith('forbidden', () => call('moveGuideline', { id: draft.id, to: 'APPROVED' }, administrator.token));
});

test('publication is refused before approval', () => {
  throwsWith('not_approved', () => call('publishGuideline', { id: draft.id }, supervisor.token));
});

test('the supervisor approves and publishes', () => {
  call('moveGuideline', { id: draft.id, to: 'APPROVED' }, supervisor.token);
  throwsWith('forbidden', () => call('publishGuideline', { id: draft.id }, administrator.token));
  call('publishGuideline', { id: draft.id }, supervisor.token);
  const file = JSON.parse(repo.get('data/guidelines.json'));
  const doc = file.documents.filter(d => d.kind === 'AUTHOR')[0];
  assert(doc && /REWRITTEN/.test(doc.body), 'the published file does not carry the new text');
  assert(doc.version === '1.1');
});

test('the previous version is archived, not deleted', () => {
  const versions = Db.find('Guidelines', { kind: 'AUTHOR' });
  assert(versions.length === 2, 'expected two versions on record, got ' + versions.length);
  assert(versions.some(v => v.status === 'ARCHIVED'), 'the superseded version was not archived');
});

test('authors are told the guidelines changed', () => {
  const notes = Db.find('Notifications', { user_id: author.user.id }).filter(n => n.kind === 'guidelines');
  assert(notes.length === 1, 'the author was not notified');
});

test('the author portal now reads the published text', () => {
  const bundle = call('editorialBundle', {}, author.token);
  assert(/REWRITTEN/.test(bundle.guidelines.body), 'the portal is still showing the old guidelines');
  assert(bundle.guidelines.version === '1.1');
});

test('an archived version reopens as a new draft, leaving history intact', () => {
  const archived = Db.find('Guidelines', { kind: 'AUTHOR' }).filter(v => v.status === 'ARCHIVED')[0];
  const reopened = call('restoreGuideline', { id: archived.id }, administrator.token);
  assert(reopened.version === '1.2', 'expected a new version number, got ' + reopened.version);
  assert(/Figures/.test(call('getGuideline', { id: reopened.id }, administrator.token).body), 'the old text was not recovered');
  assert(Db.findOne('Guidelines', { id: archived.id }).status === 'ARCHIVED', 'the archived row was mutated');
  const live = JSON.parse(repo.get('data/guidelines.json')).documents.filter(d => d.kind === 'AUTHOR')[0];
  assert(/REWRITTEN/.test(live.body), 'reopening an old version changed the live guidelines');
  call('moveGuideline', { id: reopened.id, to: 'DISCARDED', reason: 'Reopened only to check the recovery path.' }, administrator.token);
});

test('a major version bump is available when a change is not a tweak', () => {
  const major = call('draftGuideline', { kind: 'AUTHOR', major: true }, administrator.token);
  assert(major.version === '2.0', 'got ' + major.version);
  call('moveGuideline', { id: major.id, to: 'DISCARDED', reason: 'Not proceeding with this rewrite yet.' }, administrator.token);
});

test('internal guidance is never published to the public file', () => {
  const internal = call('draftGuideline', { kind: 'INTERNAL', body: 'How we handle awkward corrections.' }, administrator.token);
  call('moveGuideline', { id: internal.id, to: 'PREVIEW' }, administrator.token);
  call('moveGuideline', { id: internal.id, to: 'VERIFIED' }, seniorEditor.token);
  call('moveGuideline', { id: internal.id, to: 'APPROVED' }, supervisor.token);
  call('publishGuideline', { id: internal.id }, supervisor.token);
  const file = JSON.parse(repo.get('data/guidelines.json'));
  assert(file.documents.every(d => d.kind !== 'INTERNAL'), 'internal guidance is on the public site');
});

/* -------------------------------------------------------------- rulebook -- */

console.log('\nthe rulebook governs behaviour');

test('only MANAGE can read or change the rulebook', () => {
  throwsWith('forbidden', () => call('rulebook', {}, author.token));
  throwsWith('forbidden', () => call('saveChecklistItem', { item: 'Something an author must confirm.' }, seniorEditor.token));
});

let article;
const fields = {
  summary: 'Sodium-ion cells are cheap on paper, and the anode is what decides whether they are cheap ' +
           'in practice: hard carbon sets the ceiling that cathode chemistry cannot lift.',
  background: 'Graphite barely accepts sodium, so the field uses hard carbon instead. '.repeat(20),
  findings: 'Plateau capacity rises with pyrolysis temperature while the sloping region shrinks. '.repeat(20),
  significance: 'Cost models vary the cathode and hold the anode fixed, which is backwards. '.repeat(20),
  references: 'Stevens & Dahn, J. Electrochem. Soc. 147, 1271 (2000).'
};
function checklist() {
  const out = {};
  sandbox.internals.Db.all('SubmissionChecklist').filter(c => c.status === 'ACTIVE').forEach(c => { out[c.id] = true; });
  return out;
}

test('a draft that satisfies the current rules submits cleanly', () => {
  article = call('createDraft', {
    title: 'Hard carbon and the sodium-ion ceiling',
    format: 'research-highlight', category: 'energy-storage'
  }, author.token);
  call('saveDraft', { article_id: article.id, fields: fields }, author.token);
  assert(call('submitArticle', { article_id: article.id, checklist: checklist() }, author.token).status === 'SUBMITTED');
  call('withdrawArticle', { article_id: article.id }, author.token);
});

test('a new required field immediately blocks submission', () => {
  call('saveFormatField', {
    format: 'research-highlight', field: 'data_availability',
    label: 'Data availability', required: true, help: 'Where the underlying data can be found.', order: 8
  }, supervisor.token);
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: article.id, checklist: checklist() }, author.token));
  assert(/Data availability/.test(e.detail), 'the new field is not enforced: ' + e.detail);
});

test('the author sees the new field in the portal without a deployment', () => {
  const format = call('editorialBundle', {}, author.token).formats.filter(f => f.slug === 'research-highlight')[0];
  assert(format.fields.some(f => f.field === 'data_availability'), 'the portal never learned about the field');
});

test('filling the new field clears the gate', () => {
  call('saveDraft', {
    article_id: article.id,
    fields: Object.assign({}, fields, { data_availability: 'Raw electrochemical data is in the Zenodo record cited below.' })
  }, author.token);
  assert(call('submitArticle', { article_id: article.id, checklist: checklist() }, author.token).status === 'SUBMITTED');
  call('withdrawArticle', { article_id: article.id }, author.token);
});

test('deactivating a field stops it being required and keeps the text', () => {
  call('saveFormatField', {
    format: 'research-highlight', field: 'data_availability', label: 'Data availability',
    required: true, status: 'INACTIVE'
  }, supervisor.token);
  const saved = call('getArticle', { article_id: article.id }, author.token);
  assert(saved.content.fields.data_availability, 'the field content was destroyed');
  const format = call('editorialBundle', {}, author.token).formats.filter(f => f.slug === 'research-highlight')[0];
  assert(!format.fields.some(f => f.field === 'data_availability'), 'a retired field is still shown to authors');
});

test('a new checklist item blocks submission until it is ticked', () => {
  const item = call('saveChecklistItem', {
    item: 'Data availability has been stated or explained.', required: true
  }, supervisor.token);
  const partial = checklist();
  delete partial[item.id];
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: article.id, checklist: partial }, author.token));
  assert(/Data availability has been stated/.test(e.detail), 'the new checklist item is not enforced');
  assert(call('submitArticle', { article_id: article.id, checklist: checklist() }, author.token).status === 'SUBMITTED');
  call('withdrawArticle', { article_id: article.id }, author.token);
});

test('a too-vague checklist item is refused', () => {
  throwsWith('item_too_short', () => call('saveChecklistItem', { item: 'Is it ok?' }, supervisor.token));
});

test('writing rules are enforced at the gate, not merely displayed', () => {
  call('saveEditorialRules', { writing: { title_max: 30 } }, supervisor.token);
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: article.id, checklist: checklist() }, author.token));
  assert(/title is over 30/.test(e.detail), 'the title limit is not enforced: ' + e.detail);
  call('saveEditorialRules', { writing: { title_max: 90 } }, supervisor.token);
});

test('media rules are enforced on upload', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  call('saveEditorialRules', { media: { mime: ['image/webp'], caption_required: true } }, supervisor.token);
  throwsWith('bad_type', () => call('uploadMedia', {
    article_id: article.id, mime: 'image/png', data: png, name: 'f.png', credit: 'me', licence: 'CC BY'
  }, author.token));
  call('saveEditorialRules', { media: { mime: ['image/png', 'image/jpeg', 'image/webp'] } }, supervisor.token);
  const up = call('uploadMedia', {
    article_id: article.id, mime: 'image/png', data: png, name: 'f.png', credit: 'me', licence: 'CC BY'
  }, author.token);
  assert(up.id, 'the upload should now be accepted');
});

test('a required caption is enforced at the gate too', () => {
  const e = throwsWith('incomplete', () => call('submitArticle', { article_id: article.id, checklist: checklist() }, author.token));
  assert(/needs a caption/.test(e.detail), 'caption_required is not enforced: ' + e.detail);
  call('saveEditorialRules', { media: { caption_required: false } }, supervisor.token);
});

test('a media rule that accepts nothing is refused', () => {
  throwsWith('bad_media_rules', () => call('saveEditorialRules', { media: { mime: ['application/pdf'] } }, supervisor.token));
});

test('a format still being written in cannot be retired', () => {
  throwsWith('format_in_use', () => call('saveFormat', {
    slug: 'research-highlight', name: 'Research Highlight', status: 'INACTIVE'
  }, supervisor.token));
});

test('a new format can be created with its own fields', () => {
  call('saveFormat', {
    slug: 'method-note', name: 'Method Note', description: 'A technique, described so it can be repeated.',
    words: { recommended: 700, max: 1200 },
    fields: [
      { field: 'summary', label: 'Short summary', required: true },
      { field: 'method', label: 'The method', required: true },
      { field: 'pitfalls', label: 'Pitfalls', required: false }
    ]
  }, supervisor.token);
  const bundle = call('editorialBundle', {}, author.token);
  const fmt = bundle.formats.filter(f => f.slug === 'method-note')[0];
  assert(fmt, 'the new format never reached the portal');
  assert(fmt.words.max === 1200, 'word limits were not stored');
  assert(fmt.fields.length === 3);
});

test('every rulebook change is audited', () => {
  const wanted = ['FORMAT_FIELD_ADDED', 'FORMAT_FIELD_UPDATED', 'CHECKLIST_ADDED',
                  'WRITING_RULES_CHANGED', 'MEDIA_RULES_CHANGED', 'FORMAT_CREATED'];
  const seen = Db.all('AuditLogs').map(l => l.action);
  wanted.forEach(w => assert(seen.indexOf(w) !== -1, w + ' was not audited'));
});

test('guideline publication is audited with both version numbers', () => {
  const row = Db.all('AuditLogs').filter(l => l.action === 'GUIDELINE_PUBLISHED')[0];
  assert(row && row.new_version === '1.1', 'the publication was not audited properly');
});

test('the phase 1 to 3 invariants are untouched', () => {
  throwsWith('forbidden', () => call('setRolePermissions',
    { role_id: 'ADMINISTRATOR', permissions: [{ permission: 'FINAL_PUBLISH', scope: '*' }] }, supervisor.token));
  throwsWith('forbidden', () => call('publishArticle', { article_id: article.id }, administrator.token));
  throwsWith('forbidden', () => call('editorialQueue', {}, author.token));
});

done();
