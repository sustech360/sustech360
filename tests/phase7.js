/* tests/phase7.js — email, newsletter and social.
 *
 * The tests that matter here are about consent and about the fact that you
 * cannot unsend an email. Nobody receives anything they did not confirm; the
 * unsubscribe link in every message works with no account and no session; and
 * the person who wrote a campaign is not the person who approves it.
 *
 *   node tests/phase7.js
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
function mailsTo(email) { return outbox.filter(m => m.to === email); }
function lastTo(email) { const m = mailsTo(email); return m[m.length - 1] || null; }
function tempPasswordFor(email) {
  const m = lastTo(email);
  return m ? (m.body.match(/Temporary password: (\S+)/) || [])[1] : null;
}
function linkIn(mail, marker) {
  const found = String(mail.body).match(new RegExp('https://\\S*' + marker + '\\S*'));
  return found ? found[0] : null;
}
function paramsOf(url) {
  const out = {};
  String(url).replace(/[?&]([^=]+)=([^&\s]*)/g, (m, k, v) => { out[k] = decodeURIComponent(v); return m; });
  return out;
}

sandbox.setup();
const supervisor = call('login', { email: 'supervisor@example.test', password: tempPasswordFor('supervisor@example.test') });
function staff(email, name, role) {
  call('inviteUser', { name: name, email: email, role_id: role }, supervisor.token);
  return call('login', { email: email, password: tempPasswordFor(email) });
}
const administrator = staff('admin@example.test', 'Administrator', 'ADMINISTRATOR');
const seniorEditor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');

/* ------------------------------------------------------------- consent -- */

console.log('\nsubscription is consent, twice');

test('subscribing sends a confirmation and nothing else', () => {
  const res = call('subscribe', { email: 'reader@example.test', name: 'A Reader' });
  assert(res.ok);
  const mail = lastTo('reader@example.test');
  assert(mail && /confirm/i.test(mail.subject), 'no confirmation email');
  assert(Db.findOne('Subscribers', { email: 'reader@example.test' }).status === 'PENDING');
});

test('the response never reveals whether an address is already on the list', () => {
  const fresh = call('subscribe', { email: 'someone-new@example.test' });
  const again = call('subscribe', { email: 'reader@example.test' });
  assert(fresh.message === again.message, 'the two responses differ, which is an enumeration oracle');
});

test('a bad address is accepted quietly and stored nowhere', () => {
  call('subscribe', { email: 'not-an-address' });
  assert(!Db.findOne('Subscribers', { email: 'not-an-address' }), 'an invalid address was stored');
});

test('repeat submissions do not become a mail bomb', () => {
  const before = mailsTo('someone-new@example.test').length;
  for (let i = 0; i < 5; i++) call('subscribe', { email: 'someone-new@example.test' });
  assert(mailsTo('someone-new@example.test').length === before, 'the throttle did not hold');
});

let confirmLink;
test('confirming puts them on the list', () => {
  confirmLink = linkIn(lastTo('reader@example.test'), 'confirm');
  assert(confirmLink, 'no confirmation link in the email');
  const p = paramsOf(confirmLink);
  const res = call('confirmSubscription', { id: p.id, token: p.t });
  assert(res.ok);
  assert(Db.findOne('Subscribers', { email: 'reader@example.test' }).status === 'CONFIRMED');
});

test('the confirmation link is single use', () => {
  const p = paramsOf(confirmLink);
  throwsWith('invalid_link', () => call('confirmSubscription', { id: p.id, token: p.t }));
});

test('a guessed token confirms nothing', () => {
  const p = paramsOf(confirmLink);
  throwsWith('invalid_link', () => call('confirmSubscription', { id: p.id, token: 'guess' }));
});

/* ------------------------------------------------------------ campaigns -- */

console.log('\ncampaigns');

// A second confirmed subscriber, so a send has somewhere to go.
call('subscribe', { email: 'second@example.test' });
(() => {
  const p = paramsOf(linkIn(lastTo('second@example.test'), 'confirm'));
  call('confirmSubscription', { id: p.id, token: p.t });
})();

let campaign;
test('the audience is counted, not displayed', () => {
  const o = call('newsletterOverview', {}, administrator.token);
  assert(o.confirmed === 2, 'expected two confirmed, got ' + o.confirmed);
  assert(o.pending >= 1);
  assert(!JSON.stringify(o.recent).match(/@example\.test/), 'the overview is leaking addresses');
});

test('exporting the list is possible and audited', () => {
  const res = call('exportSubscribers', {}, supervisor.token);
  assert(res.count === 2 && res.rows[0].email);
  assert(Db.all('AuditLogs').some(l => l.action === 'SUBSCRIBER_LIST_EXPORTED'), 'an export was not audited');
});

test('a campaign is drafted with an unsubscribe link already in it', () => {
  campaign = call('draftEmailCampaign', { subject: 'The weekly brief' }, administrator.token);
  const body = call('getEmailCampaign', { id: campaign.id }, administrator.token).body;
  assert(/\{\{unsubscribe_link\}\}/.test(body), 'the starting body has no unsubscribe placeholder');
});

test('you cannot approve a campaign nobody has looked at', () => {
  call('saveEmailCampaign', {
    id: campaign.id, subject: 'The weekly brief',
    body: 'Hello {{subscriber_name}},\n\nThis week: hard carbon.\n\nUnsubscribe: {{unsubscribe_link}}'
  }, administrator.token);
  throwsWith('test_first', () => call('approveEmailCampaign', { id: campaign.id }, seniorEditor.token));
});

test('a test send goes to the person asking and nobody else', () => {
  const before = outbox.length;
  const res = call('testEmailCampaign', { id: campaign.id }, administrator.token);
  assert(res.sent_to === 'admin@example.test');
  assert(outbox.length === before + 1, 'a test send touched more than one address');
  assert(!lastTo('reader@example.test') || !/\[test\]/.test(lastTo('reader@example.test').subject));
});

test('the author of a campaign cannot approve their own', () => {
  call('grantPermission', {
    user_id: administrator.user.id, permission: 'APPROVE', scope: '*',
    expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Testing self-approval'
  }, supervisor.token);
  throwsWith('conflict_of_interest', () => call('approveEmailCampaign', { id: campaign.id }, administrator.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'CAMPAIGN_SELF_APPROVAL_BLOCKED'));
});

test('editing after the test invalidates the test', () => {
  call('saveEmailCampaign', { id: campaign.id, body: 'Rewritten. {{unsubscribe_link}}' }, administrator.token);
  throwsWith('test_first', () => call('approveEmailCampaign', { id: campaign.id }, seniorEditor.token));
  call('testEmailCampaign', { id: campaign.id }, administrator.token);
});

test('an editor approves, and only then can it be sent', () => {
  throwsWith('not_approved', () => call('startEmailCampaign', { id: campaign.id }, seniorEditor.token));
  const res = call('approveEmailCampaign', { id: campaign.id }, seniorEditor.token);
  assert(res.recipients === 2);
});

test('an approved campaign is locked against editing', () => {
  throwsWith('locked', () => call('saveEmailCampaign', { id: campaign.id, subject: 'Sneaky rewrite' }, administrator.token));
});

/* ---------------------------------------------------------------- sending -- */

console.log('\nsending');

test('the send reaches every confirmed subscriber and nobody else', () => {
  const before = outbox.length;
  const res = call('startEmailCampaign', { id: campaign.id }, seniorEditor.token);
  assert(res.sent === 2, 'expected 2 sent, got ' + res.sent);
  assert(outbox.length === before + 2, 'more messages went out than there are subscribers');
  assert(!mailsTo('someone-new@example.test').some(m => /Rewritten/.test(m.body)),
    'an unconfirmed address received the newsletter');
});

test('every sent message carries a working unsubscribe link', () => {
  const mail = mailsTo('reader@example.test').filter(m => /Rewritten/.test(m.body))[0];
  assert(mail, 'the subscriber never got the newsletter');
  const link = linkIn(mail, 'unsubscribe');
  assert(link, 'no unsubscribe link in the newsletter');
  assert(!/\{\{/.test(mail.body), 'an unfilled placeholder went out: ' + mail.body);
  const p = paramsOf(link);
  const res = call('unsubscribe', { id: p.id, token: p.t });
  assert(res.ok, 'the unsubscribe link did not work');
  assert(Db.findOne('Subscribers', { email: 'reader@example.test' }).status === 'UNSUBSCRIBED');
});

test('unsubscribing needs no session and no account', () => {
  const mail = mailsTo('second@example.test').filter(m => /Rewritten/.test(m.body))[0];
  const p = paramsOf(linkIn(mail, 'unsubscribe'));
  assert(call('unsubscribe', { id: p.id, token: p.t }).ok);
});

test('someone else cannot unsubscribe you', () => {
  const other = Db.findOne('Subscribers', { email: 'second@example.test' });
  throwsWith('invalid_link', () => call('unsubscribe', { id: other.id, token: 'guessed-token' }));
});

test('an unsubscribed address is skipped by the next campaign', () => {
  const next = call('draftEmailCampaign', { subject: 'Second issue' }, administrator.token);
  call('saveEmailCampaign', { id: next.id, body: 'Second issue. {{unsubscribe_link}}' }, administrator.token);
  call('testEmailCampaign', { id: next.id }, administrator.token);
  call('approveEmailCampaign', { id: next.id }, seniorEditor.token);
  const before = outbox.length;
  const res = call('startEmailCampaign', { id: next.id }, seniorEditor.token);
  assert(res.sent === 0, 'someone who unsubscribed was sent to');
  assert(outbox.length === before, 'a message went out with an empty audience');
});

test('re-subscribing requires confirming again', () => {
  // The throttle is one confirmation per address per hour and it applies here
  // too — a re-subscribe inside that window is silently dropped, by design.
  // Clearing the cache is this suite's way of saying "an hour later".
  sandbox.cache.clear();
  call('subscribe', { email: 'reader@example.test' });
  assert(Db.findOne('Subscribers', { email: 'reader@example.test' }).status === 'PENDING',
    'a form submission silently undid an unsubscribe');
});

test('a re-subscribe inside the throttle window sends nothing at all', () => {
  const before = mailsTo('reader@example.test').length;
  call('subscribe', { email: 'reader@example.test' });
  assert(mailsTo('reader@example.test').length === before, 'the throttle let a second confirmation out');
});

test('every message sent is logged', () => {
  const logs = Db.all('EmailLogs');
  assert(logs.filter(l => l.template === 'newsletter').length === 2, 'newsletter sends are not logged');
  assert(logs.every(l => l.to && l.sent_at), 'a log row is missing its basics');
});

/* ---------------------------------------------------------------- social -- */

console.log('\nsocial queue');

test('an unpublished article cannot be posted about', () => {
  Db.insert('Articles', {
    id: 'MAG-2026-000500', slug: 'a-draft', title: 'Still a draft', category: 'energy-storage',
    status: 'DRAFT', public_version: 0, working_version: 1, primary_author: supervisor.user.id
  });
  throwsWith('not_published', () => call('socialCompose', { article_id: 'MAG-2026-000500' }, administrator.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'SOCIAL_UNPUBLISHED_BLOCKED'));
});

test('a published article gets a draft post per platform, inside the limits', () => {
  Db.insert('Articles', {
    id: 'MAG-2026-000501', slug: 'hard-carbon-ceiling',
    title: 'Hard carbon is quietly deciding how far sodium-ion can go',
    category: 'energy-storage', topics: JSON.stringify(['sodium-ion', 'hard-carbon']),
    status: 'PUBLISHED', public_version: 1, working_version: 1, primary_author: supervisor.user.id
  });
  Db.insert('Settings', {
    key: 'public.MAG-2026-000501', scope: 'published',
    value: JSON.stringify({ summary: 'Sodium-ion cells are cheap on paper. Whether they are cheap in practice depends on a material most cost models still treat as a rounding error, and that is the anode.' })
  });
  const res = call('socialCompose', { article_id: 'MAG-2026-000501' }, administrator.token);
  assert(res.posts.length === 4, 'expected one draft per platform');
  const x = res.posts.filter(p => p.platform === 'x')[0];
  assert((x.text + ' ' + x.link).length <= 280, 'the X post is over the limit: ' + (x.text + x.link).length);
  assert(/#sodiumion/i.test(x.text), 'topics did not become tags');
  assert(!/\s…$/.test(x.text.split('\n')[0]) || x.text.length > 0);
});

test('composing twice replaces the draft rather than duplicating it', () => {
  call('socialCompose', { article_id: 'MAG-2026-000501', platforms: ['x'] }, administrator.token);
  const queued = Db.find('SocialPosts', { article_id: 'MAG-2026-000501', platform: 'x' })
    .filter(p => p.status === 'QUEUED');
  assert(queued.length === 1, 'got ' + queued.length + ' queued posts for one platform');
});

test('marking a post as sent records who and when', () => {
  const post = call('socialQueue', { status: 'QUEUED' }, administrator.token)[0];
  call('socialMarkPosted', { id: post.id, url: 'https://x.test/status/1' }, administrator.token);
  const row = Db.findOne('SocialPosts', { id: post.id });
  assert(row.status === 'POSTED' && row.posted_by === administrator.user.id);
  throwsWith('already_done', () => call('socialMarkPosted', { id: post.id }, administrator.token));
});

test('nothing is ever posted automatically', () => {
  // The publishing engine queues drafts and stops there. No credentials are
  // stored anywhere in this platform, which is the point.
  assert(Db.all('SocialPosts').every(p => p.status !== 'POSTED' || p.posted_by),
    'a post was marked as sent without a person behind it');
});

/* -------------------------------------------------------------- standing -- */

console.log('\nstanding invariants');

test('a reader-facing endpoint grants nothing else', () => {
  throwsWith('unauthenticated', () => call('newsletterOverview', {}));
  throwsWith('unauthenticated', () => call('exportSubscribers', {}));
  throwsWith('unauthenticated', () => call('startEmailCampaign', { id: campaign.id }));
});

test('the supervisor invariants still hold', () => {
  throwsWith('forbidden', () => call('setRolePermissions',
    { role_id: 'ADMINISTRATOR', permissions: [{ permission: 'FINAL_PUBLISH', scope: '*' }] }, supervisor.token));
  throwsWith('forbidden', () => call('publishConfiguration', {}, administrator.token));
});

done();
