/* tests/phase3.js — review, approval and publication.
 *
 * The interesting assertions are about the repository: what ends up in the
 * public files, and what never does.
 *
 *   node tests/phase3.js
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

function lastMail(match) {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if ((outbox[i].body || '').indexOf(match) !== -1 || (outbox[i].subject || '').indexOf(match) !== -1) return outbox[i];
  }
  return null;
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

/* --------------------------------------------------------------- people -- */

sandbox.setup();
const supervisor = call('login', { email: 'supervisor@example.test', password: tempPasswordFor('supervisor@example.test') });

function staff(email, name, role) {
  call('inviteUser', { name: name, email: email, role_id: role }, supervisor.token);
  return call('login', { email: email, password: tempPasswordFor(email) });
}

function invitedAuthor(email, name, password) {
  const inv = call('createInvitation', { name: name, email: email, section: 'energy-storage' }, supervisor.token);
  const url = lastMail('accept.html').body.match(/https:\/\/\S+/)[0];
  call('acceptInvitation', { id: inv.id, token: decodeURIComponent(url.match(/[?&]t=([^&\s]+)/)[1]), password: password });
  return call('login', { email: email, password: password });
}

const sectionEditor = staff('section@example.test', 'Section Editor', 'SECTION_EDITOR');
const seniorEditor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');
const administrator = staff('admin@example.test', 'Administrator', 'ADMINISTRATOR');
const reviewer = staff('reviewer@example.test', 'A Reviewer', 'REVIEWER');
const otherReviewer = staff('reviewer2@example.test', 'Another Reviewer', 'REVIEWER');
const author = invitedAuthor('menon@example.test', 'R. Menon', 'Hard-Carbon-2026');

/* ------------------------------------------------------------ submission -- */

console.log('\nsubmission reaches the queue');

const fields = {
  summary: 'Sodium-ion cells are cheap on paper, and the anode is what decides whether they are ' +
           'cheap in practice: hard carbon sets the ceiling that cathode chemistry cannot lift.',
  background: 'Graphite barely accepts sodium, so the field uses hard carbon instead. '.repeat(25),
  findings: 'Plateau capacity rises with pyrolysis temperature while the sloping region shrinks. '.repeat(25) +
            '\n\n[figure:schematic.png]\n\nFirst-cycle efficiency falls as accessible surface area rises. '.repeat(1),
  significance: 'Cost models vary the cathode and hold the anode fixed, which is backwards. '.repeat(25),
  references: 'Stevens & Dahn, J. Electrochem. Soc. 147, 1271 (2000).\nBommier et al., Nano Lett. 15, 5888 (2015).'
};

const article = call('createDraft', {
  title: 'Hard carbon and the sodium-ion ceiling',
  format: 'research-highlight', category: 'energy-storage', level: 'understand',
  topics: ['sodium-ion', 'hard-carbon'], tags: ['batteries', 'india']
}, author.token);

call('saveDraft', { article_id: article.id, fields: fields }, author.token);
call('uploadMedia', {
  article_id: article.id, mime: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  name: 'schematic.png', credit: 'R. Menon', licence: 'CC BY 4.0', caption: 'Sodium storage in a disordered carbon'
}, author.token);

const checklist = {};
Db.all('SubmissionChecklist').forEach(c => { checklist[c.id] = true; });
call('submitArticle', { article_id: article.id, checklist: checklist }, author.token);

test('the submission appears in the editorial queue', () => {
  const q = call('editorialQueue', {}, sectionEditor.token);
  assert(q.length === 1 && q[0].id === article.id, 'queue has ' + q.length + ' items');
  assert(q[0].version_status === 'SUBMITTED');
});

test('an author cannot see the editorial queue', () => {
  throwsWith('forbidden', () => call('editorialQueue', {}, author.token));
});

test('an author cannot move their own article along', () => {
  throwsWith('forbidden', () => call('moveArticle', { article_id: article.id, to: 'EDITOR_CHECK' }, author.token));
});

test('an author cannot skip the workflow to APPROVED', () => {
  throwsWith('forbidden', () => call('moveArticle', { article_id: article.id, to: 'APPROVED' }, author.token));
});

/* ---------------------------------------------------------------- review -- */

console.log('\nreview');

test('an editor claims the submission', () => {
  const res = call('moveArticle', { article_id: article.id, to: 'EDITOR_CHECK' }, sectionEditor.token);
  assert(res.status === 'EDITOR_CHECK');
});

test('an illegal jump is refused by the transition table', () => {
  throwsWith('illegal_transition', () => call('moveArticle', { article_id: article.id, to: 'PUBLISHED' }, seniorEditor.token));
});

test('the author cannot be assigned as their own reviewer', () => {
  throwsWith('conflict_of_interest', () => call('assignReviewer',
    { article_id: article.id, reviewer_id: author.user.id }, sectionEditor.token));
});

let reviewId;
test('assigning a reviewer moves the article under review', () => {
  call('assignReviewer', { article_id: article.id, reviewer_id: reviewer.user.id }, sectionEditor.token);
  const q = call('editorialQueue', {}, sectionEditor.token);
  assert(q[0].version_status === 'UNDER_REVIEW', 'got ' + q[0].version_status);
  reviewId = call('myReviews', {}, reviewer.token)[0].id;
  assert(reviewId, 'the reviewer has no assignment');
});

test('the assigned reviewer can read the article', () => {
  const r = call('openReview', { review_id: reviewId }, reviewer.token);
  assert(r.article.id === article.id);
  assert(r.content.fields.findings, 'the reviewer cannot see the text');
});

test('an unassigned reviewer cannot read it', () => {
  throwsWith('not_found', () => call('openReview', { review_id: reviewId }, otherReviewer.token));
  throwsWith('not_found', () => call('getArticle', { article_id: article.id }, otherReviewer.token));
});

test('a reviewer cannot edit the article', () => {
  throwsWith('not_found', () => call('saveDraft', { article_id: article.id, fields: fields }, reviewer.token));
});

test('a reviewer cannot decide the article themselves', () => {
  // Reviewers have no write access at all, so this fails at the access check
  // rather than at the transition table — one layer earlier than a forbidden.
  throwsWith('not_found', () => call('moveArticle', { article_id: article.id, to: 'VERIFIED' }, reviewer.token));
});

test('a decision without reasoning is refused', () => {
  throwsWith('comments_required', () => call('submitReview',
    { review_id: reviewId, decision: 'ACCEPT', comments: 'fine' }, reviewer.token));
});

test('the review is returned and recorded', () => {
  const res = call('submitReview', {
    review_id: reviewId, decision: 'MINOR_REVISION',
    comments: 'Sound work. The first-cycle efficiency argument needs a number attached to it, and figure 1 should be cited in the text.'
  }, reviewer.token);
  assert(res.decision === 'MINOR_REVISION');
  assert(call('articleReviews', { article_id: article.id }, sectionEditor.token)[0].status === 'COMPLETED');
});

test('a completed review cannot be resubmitted', () => {
  throwsWith('already_completed', () => call('submitReview',
    { review_id: reviewId, decision: 'ACCEPT', comments: 'changed my mind, and here is a long enough sentence.' }, reviewer.token));
});

/* ------------------------------------------------------------- revisions -- */

console.log('\nrevision round trip');

test('requesting revisions needs a reason the author can act on', () => {
  throwsWith('reason_required', () => call('moveArticle',
    { article_id: article.id, to: 'REVISION_REQUIRED', reason: 'no' }, sectionEditor.token));
});

test('revisions are requested and the author is told', () => {
  call('moveArticle', {
    article_id: article.id, to: 'REVISION_REQUIRED',
    reason: 'Add a figure of for first-cycle efficiency and cite figure 1 in the findings.'
  }, sectionEditor.token);
  assert(lastMail('Revisions requested'), 'the author was not emailed');
});

test('the author can edit again and resubmit', () => {
  call('saveDraft', { article_id: article.id, fields: fields }, author.token);
  const res = call('submitArticle', { article_id: article.id, checklist: checklist }, author.token);
  assert(res.status === 'RESUBMITTED', 'got ' + res.status);
});

test('a section editor cannot mark it verified — that needs APPROVE', () => {
  call('moveArticle', { article_id: article.id, to: 'EDITOR_CHECK' }, sectionEditor.token);
  call('assignReviewer', { article_id: article.id, reviewer_id: reviewer.user.id }, sectionEditor.token);
  throwsWith('forbidden', () => call('moveArticle', { article_id: article.id, to: 'VERIFIED' }, sectionEditor.token));
});

test('a senior editor marks it verified', () => {
  const res = call('moveArticle', { article_id: article.id, to: 'VERIFIED' }, seniorEditor.token);
  assert(res.status === 'VERIFIED');
});

/* ------------------------------------------------------------- approval -- */

console.log('\napproval is the supervisor alone');

test('an editor prepares it for publication', () => {
  const res = call('moveArticle', { article_id: article.id, to: 'READY_FOR_PUBLICATION' }, seniorEditor.token);
  assert(res.status === 'READY_FOR_PUBLICATION');
});

test('an administrator cannot approve it', () => {
  throwsWith('forbidden', () => call('moveArticle', { article_id: article.id, to: 'APPROVED' }, administrator.token));
});

test('a senior editor cannot approve it', () => {
  throwsWith('forbidden', () => call('moveArticle', { article_id: article.id, to: 'APPROVED' }, seniorEditor.token));
});

test('an administrator cannot publish it either', () => {
  throwsWith('forbidden', () => call('publishArticle', { article_id: article.id }, administrator.token));
});

test('publication is refused before approval', () => {
  throwsWith('not_approved', () => call('publishArticle', { article_id: article.id }, supervisor.token));
});

test('the supervisor approves, and the approval is recorded on the version', () => {
  call('moveArticle', { article_id: article.id, to: 'APPROVED' }, supervisor.token);
  const v = Db.findOne('Versions', { article_id: article.id, version: 1 });
  assert(v.status === 'APPROVED' && v.approved_by === supervisor.user.id, 'approval not recorded');
});

/* ----------------------------------------------------------- publication -- */

console.log('\npublication');

let published;
test('the supervisor publishes and the files reach the repository', () => {
  published = call('publishArticle', { article_id: article.id }, supervisor.token);
  assert(repo.has('data/articles/' + published.slug + '.json'), 'no article file committed');
  assert(repo.has('data/index/articles.json'), 'no index committed');
  assert(repo.has('data/search-index.json'), 'no search index committed');
  assert(repo.has('rss/feed.xml') && repo.has('sitemap.xml'), 'no feed or sitemap');
});

const publicDoc = () => JSON.parse(repo.get('data/articles/' + published.slug + '.json'));

test('the published file is a reading shape, not an editing shape', () => {
  const doc = publicDoc();
  assert(doc.blocks.length > 4, 'fields were not rendered into blocks');
  assert(doc.blocks.some(b => b.type === 'h2' && b.text === 'Key findings'), 'format labels missing');
  assert(doc.blocks.some(b => b.type === 'references'), 'references not rendered');
  assert(doc.fields === undefined, 'the raw editing fields leaked into the public file');
  assert(doc.reading_minutes >= 1);
});

test('the placed figure is committed and referenced by path', () => {
  const doc = publicDoc();
  const fig = doc.blocks.filter(b => b.type === 'figure')[0];
  assert(fig, 'the figure was not rendered');
  assert(repo.has(fig.src), 'the image file was never committed: ' + fig.src);
  assert(/CC BY 4\.0/.test(fig.caption), 'the licence is not shown with the figure');
});

test('the index and search index contain only published work', () => {
  const index = JSON.parse(repo.get('data/index/articles.json'));
  const search = JSON.parse(repo.get('data/search-index.json'));
  assert(index.articles.length === 1 && index.articles[0].slug === published.slug);
  assert(search.docs.length === 1 && search.docs[0].s === published.slug);
});

test('the author is told, in public, that it is live', () => {
  assert(lastMail('Published:'), 'no publication email');
});

/* ------------------------------------------------------------ immutable -- */

console.log('\nimmutability of published content');

const v1Text = () => JSON.stringify(publicDoc().blocks);
let liveBefore;

test('a revision opens privately and leaves the live file alone', () => {
  liveBefore = v1Text();
  const res = call('startRevision', { article_id: article.id, reason: 'Add 2026 cell data' }, author.token);
  assert(res.version === 2, 'expected version 2');
  call('saveDraft', {
    article_id: article.id,
    fields: Object.assign({}, fields, { findings: 'COMPLETELY REWRITTEN FINDINGS. '.repeat(60) })
  }, author.token);
  assert(v1Text() === liveBefore, 'editing a revision changed the published file');
});

test('submitting and reviewing the revision still leaves it alone', () => {
  call('submitArticle', { article_id: article.id, checklist: checklist }, author.token);
  call('moveArticle', { article_id: article.id, to: 'EDITOR_CHECK' }, sectionEditor.token);
  assert(v1Text() === liveBefore, 'the review process changed the published file');
});

test('the article stays PUBLISHED while its revision is in progress', () => {
  const row = Db.findOne('Articles', { id: article.id });
  assert(row.status === 'PUBLISHED', 'status became ' + row.status);
  assert(Number(row.public_version) === 1 && Number(row.working_version) === 2);
});

test('rejecting the revision leaves version 1 live', () => {
  call('moveArticle', {
    article_id: article.id, to: 'REJECTED',
    reason: 'The rewritten findings are not supported by the data supplied.'
  }, seniorEditor.token);
  assert(v1Text() === liveBefore, 'a rejected revision changed the public site');
  assert(Db.findOne('Articles', { id: article.id }).status === 'PUBLISHED');
  const index = JSON.parse(repo.get('data/index/articles.json'));
  assert(index.articles[0].public_version === 1, 'the index moved to a rejected version');
});

/* -------------------------------------------------------------- rollback -- */

console.log('\nsecond version, then rollback');

test('an accepted revision reaches the site', () => {
  const v3 = call('startRevision', { article_id: article.id, reason: 'Second attempt' }, author.token);
  assert(v3.version === 3);
  call('saveDraft', {
    article_id: article.id,
    fields: Object.assign({}, fields, { significance: 'REVISED SIGNIFICANCE SECTION. '.repeat(40) })
  }, author.token);
  call('submitArticle', { article_id: article.id, checklist: checklist }, author.token);
  call('moveArticle', { article_id: article.id, to: 'EDITOR_CHECK' }, sectionEditor.token);
  call('assignReviewer', { article_id: article.id, reviewer_id: otherReviewer.user.id }, sectionEditor.token);
  call('moveArticle', { article_id: article.id, to: 'VERIFIED' }, seniorEditor.token);
  call('moveArticle', { article_id: article.id, to: 'READY_FOR_PUBLICATION' }, seniorEditor.token);
  call('moveArticle', { article_id: article.id, to: 'APPROVED' }, supervisor.token);
  call('publishArticle', { article_id: article.id }, supervisor.token);
  assert(/REVISED SIGNIFICANCE/.test(v1Text()), 'version 3 did not reach the site');
  assert(Number(Db.findOne('Articles', { id: article.id }).public_version) === 3);
});

test('rollback needs a reason', () => {
  throwsWith('reason_required', () => call('rollbackArticle', { article_id: article.id, version: 1 }, supervisor.token));
});

test('only the supervisor can roll back', () => {
  throwsWith('forbidden', () => call('rollbackArticle',
    { article_id: article.id, version: 1, reason: 'undo the change please' }, administrator.token));
});

test('rollback puts the earlier version back on the site', () => {
  call('rollbackArticle', {
    article_id: article.id, version: 1,
    reason: 'The revised significance section misstates the cost model.'
  }, supervisor.token);
  assert(!/REVISED SIGNIFICANCE/.test(v1Text()), 'the rollback did not take');
  assert(Number(Db.findOne('Articles', { id: article.id }).public_version) === 1);
  assert(Db.all('AuditLogs').some(l => l.action === 'ARTICLE_ROLLED_BACK'), 'rollback not audited');
});

test('a version that was never approved cannot be put on the site', () => {
  const v = Db.findOne('Versions', { article_id: article.id, version: 2 });
  assert(v.status === 'REJECTED', 'expected the rejected version to still say so');
  throwsWith('never_approved', () => call('rollbackArticle',
    { article_id: article.id, version: 2, reason: 'trying to sneak the rejected text in' }, supervisor.token));
});

/* ------------------------------------------------ correcting what is live -- */

console.log('\ncorrecting a published article');

test('what is live is listed with everything that can be corrected', () => {
  const live = call('liveArticles', {}, seniorEditor.token);
  assert(live.length >= 1, 'nothing is listed as live');
  const row = live.filter(a => a.id === article.id)[0];
  assert(row && row.url && row.seo_description !== undefined,
    'the listing does not carry what an editor would want to correct');
});

test('only the supervisor may correct a live page', () => {
  throwsWith('forbidden', () => call('correctLiveArticle', {
    article_id: article.id, category: 'materials', reason: 'Filed in the wrong section.'
  }, seniorEditor.token));
  throwsWith('forbidden', () => call('correctLiveArticle', {
    article_id: article.id, category: 'materials', reason: 'Filed in the wrong section.'
  }, administrator.token));
});

test('a correction needs a reason on the record', () => {
  throwsWith('reason_required', () => call('correctLiveArticle',
    { article_id: article.id, level: 'research' }, supervisor.token));
});

test('a correction republishes immediately and is audited', () => {
  const before = repo.get('data/articles/' + published.slug + '.json');
  call('correctLiveArticle', {
    article_id: article.id, level: 'research', sponsored: false,
    seo_description: 'Why anode design, not cathode chemistry, decides the cost of sodium-ion cells.',
    reason: 'Reading level was set too low for this piece.'
  }, supervisor.token);
  const after = JSON.parse(repo.get('data/articles/' + published.slug + '.json'));
  assert(after.level === 'research', 'the correction did not reach the site');
  assert(/anode design/.test(after.seo.description), 'the description was not updated');
  assert(after.updated_at, 'a corrected article should say it was updated');
  assert(before !== JSON.stringify(after), 'nothing changed');
  assert(Db.all('AuditLogs').some(l => l.action === 'LIVE_ARTICLE_CORRECTED'), 'not audited');
});

test('the address of a published article cannot be changed', () => {
  // Somebody already has the link. A slug change is a broken link, not an edit.
  throwsWith('slug_fixed', () => call('correctLiveArticle', {
    article_id: article.id, slug: 'a-better-slug', reason: 'Tidying the address up.'
  }, supervisor.token));
});

test('a correction cannot move an article into a category that does not exist', () => {
  throwsWith('unknown_category', () => call('correctLiveArticle', {
    article_id: article.id, category: 'astrology', reason: 'Testing the guard properly.'
  }, supervisor.token));
});

test('the body is not editable this way', () => {
  // Changing what an article says is a revision and goes back through an
  // editor. Only how it is filed and described can be corrected here.
  const doc = JSON.parse(repo.get('data/articles/' + published.slug + '.json'));
  assert(doc.blocks && doc.blocks.length, 'the text is still there');
  const actions = Object.keys(sandbox.internals.ACTIONS);
  assert(actions.indexOf('editLiveBody') === -1, 'there is a direct route to a published body');
});

/* ------------------------------------------------------------ scheduling -- */

console.log('\nscheduling and archiving');

test('a scheduled publication runs only when it is due', () => {
  const second = call('createDraft', {
    title: 'Second article for scheduling', format: 'expert-opinion', category: 'energy-storage'
  }, author.token);
  const opinion = {
    summary: 'An argument that the field is optimising the wrong electrode, and what would change ' +
             'if funding followed the anode instead of the cathode for a few years.',
    introduction: 'Setting out the question. '.repeat(20),
    discussion: 'The substance of the argument. '.repeat(30),
    perspective: 'What I think, and why. '.repeat(20),
    recommendations: 'What should change. '.repeat(15),
    conclusion: 'Where that leaves us. '.repeat(10)
  };
  call('saveDraft', { article_id: second.id, fields: opinion }, author.token);
  call('submitArticle', { article_id: second.id, checklist: checklist }, author.token);
  call('moveArticle', { article_id: second.id, to: 'EDITOR_CHECK' }, sectionEditor.token);
  call('assignReviewer', { article_id: second.id, reviewer_id: reviewer.user.id }, sectionEditor.token);
  call('moveArticle', { article_id: second.id, to: 'VERIFIED' }, seniorEditor.token);
  call('moveArticle', { article_id: second.id, to: 'READY_FOR_PUBLICATION' }, seniorEditor.token);
  call('moveArticle', { article_id: second.id, to: 'APPROVED' }, supervisor.token);
  call('schedulePublication', { article_id: second.id, when: new Date(Date.now() + 3600000).toISOString() }, supervisor.token);

  assert(!repo.has('data/articles/' + second.slug + '.json'), 'a scheduled article was published early');
  sandbox.publishScheduled();
  assert(!repo.has('data/articles/' + second.slug + '.json'), 'published before its time');

  Db.update('Articles', { id: second.id }, { scheduled_for: new Date(Date.now() - 60000).toISOString() });
  sandbox.publishScheduled();
  assert(repo.has('data/articles/' + second.slug + '.json'), 'the due article was not published');
});

test('scheduling a version that is not approved is refused', () => {
  throwsWith('not_approved', () => call('schedulePublication',
    { article_id: article.id, when: new Date(Date.now() + 3600000).toISOString() }, supervisor.token));
});

test('archiving removes an article from the listings but keeps its page', () => {
  const before = JSON.parse(repo.get('data/index/articles.json')).articles.length;
  call('archiveArticle', {
    article_id: article.id, reason: 'Superseded by a longer piece on the same work.'
  }, supervisor.token);
  const after = JSON.parse(repo.get('data/index/articles.json')).articles.length;
  assert(after === before - 1, 'the archived article is still listed');
  assert(repo.has('data/articles/' + published.slug + '.json'), 'the article page was deleted, breaking links');
  assert(JSON.parse(repo.get('data/search-index.json')).docs.every(d => d.s !== published.slug),
    'the archived article is still searchable');
});

/* ------------------------------------------------------------- the rest -- */

console.log('\nstanding invariants');

test('no draft or unapproved version ever reached the repository', () => {
  const slugs = Db.all('Articles').filter(a => a.status !== 'PUBLISHED' && a.status !== 'ARCHIVED').map(a => a.slug);
  slugs.forEach(s => assert(!repo.has('data/articles/' + s + '.json'), 'unpublished article ' + s + ' is public'));
});

test('publication and rollback are both audited with the version numbers', () => {
  const pub = Db.all('AuditLogs').filter(l => l.action === 'ARTICLE_PUBLISHED');
  assert(pub.length >= 3, 'expected several publications, got ' + pub.length);
  assert(pub.every(l => l.new_version !== ''), 'a publication was logged without a version');
});

test('the supervisor invariants from phase 1 still hold', () => {
  throwsWith('forbidden', () => call('setUserRole',
    { user_id: seniorEditor.user.id, role_id: 'SUPERVISOR_ADMIN' }, supervisor.token));
  throwsWith('forbidden', () => call('setRolePermissions',
    { role_id: 'SENIOR_EDITOR', permissions: [{ permission: 'FINAL_PUBLISH', scope: '*' }] }, supervisor.token));
  throwsWith('forbidden', () => call('grantPermission', {
    user_id: administrator.user.id, permission: 'FINAL_PUBLISH',
    expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'covering leave'
  }, supervisor.token));
});

done();
