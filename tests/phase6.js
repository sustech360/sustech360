/* tests/phase6.js — advertising.
 *
 * Two halves. The backend half asks whether an unapproved creative can reach a
 * reader (it cannot) and whether the people selling can approve their own work
 * (they cannot). The frontend half tests the fallback chain directly, because
 * the chain is what decides which advertiser actually got the slot they paid
 * for — and it runs in the browser, where nothing else in this suite reaches.
 *
 *   node tests/phase6.js
 */
const path = require('path');
const { build, test, assert, throwsWith, done } = require('./harness');
const AdChain = require(path.join(__dirname, '..', 'assets', 'js', 'ads.js'));

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
const adManager = staff('ads@example.test', 'Ad Manager', 'ADVERTISING_MANAGER');
const seniorEditor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');

const inDays = n => new Date(Date.now() + n * 86400000).toISOString();
const adsFile = () => JSON.parse(repo.get('data/ads.json'));

/* ------------------------------------------------------------ inventory -- */

console.log('\nplacements, advertisers, campaigns');

test('placements are seeded with a fallback chain that ends in collapse', () => {
  const bundle = call('adsBundle', {}, adManager.token);
  assert(bundle.placements.length >= 4, 'no placements seeded');
  bundle.placements.forEach(p => {
    const chain = Array.isArray(p.chain) ? p.chain : JSON.parse(p.chain);
    assert(chain[chain.length - 1] === 'COLLAPSE', p.id + ' does not end in COLLAPSE');
  });
});

test('a chain is forced to end in collapse even if you leave it out', () => {
  call('saveAdPlacement', {
    id: 'ARTICLE_FOOT', name: 'Below the article', chain: ['DIRECT', 'HOUSE'], active: true
  }, adManager.token);
  const p = call('adsBundle', {}, adManager.token).placements.filter(x => x.id === 'ARTICLE_FOOT')[0];
  const chain = Array.isArray(p.chain) ? p.chain : JSON.parse(p.chain);
  assert(chain[chain.length - 1] === 'COLLAPSE', 'got ' + chain.join(','));
});

let advertiser, campaign;
test('an advertiser and a campaign are recorded', () => {
  advertiser = call('saveAdvertiser', {
    company: 'Northwind Cells', contact: 'A. Buyer', email: 'buyer@northwind.test',
    website: 'https://northwind.test', country: 'IN'
  }, adManager.token);
  campaign = call('saveCampaign', {
    advertiser_id: advertiser.id, name: 'Q4 sodium launch', tier: 'DIRECT',
    starts: inDays(-1), ends: inDays(30)
  }, adManager.token);
  assert(advertiser.id && campaign.id);
});

test('an editor without MANAGE cannot sell advertising', () => {
  throwsWith('forbidden', () => call('saveAdvertiser', { company: 'Sneaky', email: 'x@y.test' }, seniorEditor.token));
});

/* ------------------------------------------------------------- creatives -- */

console.log('\ncreatives and approval');

let creative;
test('a paid creative without a campaign behind it is refused', () => {
  throwsWith('campaign_required', () => call('uploadCreative', {
    placement: 'ARTICLE_MIDDLE', tier: 'DIRECT', mime: 'image/png', data: PNG,
    file: 'orphan.png', alt: 'An advertisement', url: 'https://northwind.test'
  }, adManager.token));
});

test('an advertisement must link somewhere safe and describe itself', () => {
  throwsWith('bad_url', () => call('uploadCreative', {
    placement: 'ARTICLE_MIDDLE', campaign_id: campaign.id, mime: 'image/png', data: PNG,
    file: 'a.png', alt: 'An advertisement', url: 'javascript:alert(1)'
  }, adManager.token));
  throwsWith('alt_required', () => call('uploadCreative', {
    placement: 'ARTICLE_MIDDLE', campaign_id: campaign.id, mime: 'image/png', data: PNG,
    file: 'a.png', alt: '', url: 'https://northwind.test'
  }, adManager.token));
});

test('a creative cannot run outside its campaign window', () => {
  throwsWith('outside_campaign', () => call('uploadCreative', {
    placement: 'ARTICLE_MIDDLE', campaign_id: campaign.id, mime: 'image/png', data: PNG,
    file: 'a.png', alt: 'Sodium cells from Northwind', url: 'https://northwind.test',
    starts: inDays(-1), ends: inDays(200)
  }, adManager.token));
});

test('a valid creative uploads as pending, not live', () => {
  creative = call('uploadCreative', {
    placement: 'ARTICLE_MIDDLE', campaign_id: campaign.id, mime: 'image/png', data: PNG,
    file: 'northwind.png', name: 'Northwind Q4', alt: 'Sodium cells from Northwind',
    url: 'https://northwind.test', label: 'Advertisement', weight: 3,
    targeting: { sections: ['energy-storage'], devices: ['desktop'] }
  }, adManager.token);
  assert(Db.findOne('AdCreatives', { id: creative.id }).status === 'PENDING');
});

test('the person who uploaded it cannot approve it', () => {
  // The ad manager holds MANAGE but not APPROVE, and even with APPROVE the
  // self-approval check stands.
  throwsWith('forbidden', () => call('reviewCreative',
    { creative_id: creative.id, decision: 'APPROVED' }, adManager.token));
  call('grantPermission', {
    user_id: adManager.user.id, permission: 'APPROVE', scope: '*',
    expires_at: inDays(1), reason: 'Testing the self-approval guard'
  }, supervisor.token);
  throwsWith('conflict_of_interest', () => call('reviewCreative',
    { creative_id: creative.id, decision: 'APPROVED' }, adManager.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'CREATIVE_SELF_APPROVAL_BLOCKED'));
});

test('a pending creative is not in the published file', () => {
  call('publishAds', {}, supervisor.token);
  assert(adsFile().creatives.length === 0, 'a pending creative was published');
});

test('an editor approves it and it becomes publishable', () => {
  const res = call('reviewCreative', { creative_id: creative.id, decision: 'APPROVED' }, seniorEditor.token);
  assert(res.status === 'APPROVED');
  assert(Db.findOne('Campaigns', { id: campaign.id }).status === 'APPROVED', 'the campaign did not go live');
});

test('publishing writes the file and the image beside it', () => {
  call('publishAds', {}, supervisor.token);
  const file = adsFile();
  assert(file.creatives.length === 1, 'the approved creative is missing');
  const entry = file.creatives[0];
  assert(repo.has(entry.image), 'the creative image was never committed: ' + entry.image);
  assert(entry.targeting.sections[0] === 'energy-storage', 'targeting was lost');
  assert(entry.weight === 3);
});

test('only the supervisor publishes advertising', () => {
  throwsWith('forbidden', () => call('publishAds', {}, adManager.token));
});

test('pulling a creative needs a reason and takes it off the next publish', () => {
  throwsWith('reason_required', () => call('pauseCreative', { creative_id: creative.id }, adManager.token));
  call('pauseCreative', { creative_id: creative.id, reason: 'Advertiser asked us to hold' }, adManager.token);
  call('publishAds', {}, supervisor.token);
  assert(adsFile().creatives.length === 0, 'a paused creative is still live');
  // Put it back for the delivery tests below.
  Db.update('AdCreatives', { id: creative.id }, { status: 'APPROVED' });
  call('publishAds', {}, supervisor.token);
});

/* --------------------------------------------------------- fallback chain -- */

console.log('\nthe fallback chain');

const cfg = {
  placements: {
    SLOT: { active: true, chain: ['DIRECT', 'STANDARD', 'ADSENSE', 'HOUSE', 'RELATED', 'COLLAPSE'] },
    OFF: { active: false, chain: ['DIRECT', 'COLLAPSE'] }
  },
  creatives: [
    { id: 'c-direct', placement: 'SLOT', tier: 'DIRECT', weight: 1, label: 'Advertisement',
      starts: inDays(-1), ends: inDays(1), targeting: { sections: ['energy-storage'], devices: [] } },
    { id: 'c-standard', placement: 'SLOT', tier: 'STANDARD', weight: 1, label: 'Sponsored',
      starts: inDays(-1), ends: inDays(1), targeting: {} },
    { id: 'c-expired', placement: 'SLOT', tier: 'DIRECT', weight: 1,
      starts: inDays(-10), ends: inDays(-2), targeting: {} }
  ],
  house: [{ id: 'c-house', placement: 'SLOT', tier: 'HOUSE', weight: 1, label: 'Advertisement', targeting: {} }]
};
const base = { advertisingEnabled: true, adsenseClient: '', section: 'energy-storage', device: 'desktop' };
const ctx = extra => Object.assign({}, base, extra);

test('the highest paying step that can fill the slot wins', () => {
  const r = AdChain.resolve(cfg, 'SLOT', ctx());
  assert(r.kind === 'image' && r.creative.id === 'c-direct', 'got ' + JSON.stringify(r));
});

test('an expired creative never fills a slot', () => {
  const only = { placements: cfg.placements, creatives: [cfg.creatives[2]], house: [] };
  assert(AdChain.resolve(only, 'SLOT', ctx()) === null, 'an expired creative was served');
});

test('targeting is respected, and the chain falls through when it misses', () => {
  const r = AdChain.resolve(cfg, 'SLOT', ctx({ section: 'policy' }));
  assert(r.creative.id === 'c-standard', 'a section-targeted creative ran outside its section');
});

test('the disclosure label comes from the creative, not from a guess', () => {
  const r = AdChain.resolve(cfg, 'SLOT', ctx({ section: 'policy' }));
  assert(r.label === 'Sponsored', 'sponsored content would have been labelled "' + r.label + '"');
});

test('adsense needs both a client and a slot, or it is skipped', () => {
  const paidless = { placements: cfg.placements, creatives: [], house: cfg.house };
  assert(AdChain.resolve(paidless, 'SLOT', ctx()).kind === 'image', 'without adsense it should fall to house');

  // A client id with no slot id is the trap: Google's markup is valid, and the
  // unit silently never fills. Falling through to the house ad is the honest
  // outcome — an empty bordered box is worse than our own promotion.
  const clientOnly = AdChain.resolve(paidless, 'SLOT', ctx({ adsenseClient: 'ca-pub-1234567890' }));
  assert(clientOnly.kind === 'image', 'a client with no slot should be skipped, got ' + clientOnly.kind);

  const both = AdChain.resolve(paidless, 'SLOT',
    ctx({ adsenseClient: 'ca-pub-1234567890', adsenseSlots: { SLOT: '9876543210' } }));
  assert(both.kind === 'adsense' && both.slot === '9876543210', JSON.stringify(both));
});

test('a slot id is checked before it can reach a page', () => {
  throwsWith('bad_ad_slot', () => call('saveSiteSettings',
    { ads: { slots: { ARTICLE_MIDDLE: 'not-a-slot' } } }, supervisor.token));
  call('saveSiteSettings', { ads: { slots: { ARTICLE_MIDDLE: '1234567890' } } }, supervisor.token);
  const stored = JSON.parse(Db.findOne('Settings', { key: 'ads.slots' }).value);
  assert(stored.ARTICLE_MIDDLE === '1234567890', 'the slot was not stored');
});

test('a slot with nothing to show falls to related, then collapses', () => {
  const empty = { placements: cfg.placements, creatives: [], house: [] };
  const withRelated = AdChain.resolve(empty, 'SLOT', ctx({ related: { title: 'Another piece', url: 'article.html?a=x' } }));
  assert(withRelated.kind === 'related', 'the slot should offer our own journalism before giving up');
  assert(AdChain.resolve(empty, 'SLOT', ctx()) === null, 'an unfillable slot must collapse, not sit empty');
});

test('an inactive placement and a disabled feature flag both collapse', () => {
  assert(AdChain.resolve(cfg, 'OFF', ctx()) === null);
  assert(AdChain.resolve(cfg, 'SLOT', ctx({ advertisingEnabled: false })) === null);
  assert(AdChain.resolve(cfg, 'NO_SUCH_SLOT', ctx()) === null);
});

test('the two rails fill independently — one direct, one Google', () => {
  // This is the arrangement the magazine will actually run: a placement sold to
  // an advertiser on one side, Google filling the other. Each rail resolves on
  // its own, so one being sold never blocks the other.
  const twoRails = {
    placements: {
      RAIL_LEFT: { active: true, chain: ['DIRECT', 'ADSENSE', 'HOUSE', 'COLLAPSE'] },
      RAIL_RIGHT: { active: true, chain: ['DIRECT', 'ADSENSE', 'HOUSE', 'COLLAPSE'] }
    },
    creatives: [{ id: 'sold-left', placement: 'RAIL_LEFT', tier: 'DIRECT', weight: 1,
                  label: 'Advertisement', starts: inDays(-1), ends: inDays(5), targeting: {} }],
    house: []
  };
  const withGoogle = ctx({ adsenseClient: 'ca-pub-1234567890', adsenseSlots: { RAIL_RIGHT: '5556667778' } });

  const left = AdChain.resolve(twoRails, 'RAIL_LEFT', withGoogle);
  const right = AdChain.resolve(twoRails, 'RAIL_RIGHT', withGoogle);
  assert(left.kind === 'image' && left.creative.id === 'sold-left',
    'the sold rail should serve the advertiser who paid, got ' + JSON.stringify(left));
  assert(right.kind === 'adsense' && right.slot === '5556667778',
    'the unsold rail should fall through to Google, got ' + JSON.stringify(right));
});

test('an unsold rail shows our own promotion before it shows nothing', () => {
  const houseOnly = {
    placements: { RAIL_LEFT: { active: true, chain: ['DIRECT', 'ADSENSE', 'HOUSE', 'COLLAPSE'] } },
    creatives: [],
    house: [{ id: 'own-promo', placement: 'RAIL_LEFT', tier: 'HOUSE', weight: 1,
              label: 'Advertisement', targeting: {} }]
  };
  const r = AdChain.resolve(houseOnly, 'RAIL_LEFT', ctx());
  assert(r && r.creative.id === 'own-promo', 'house advertising did not reach the rail');
});

test('a rail with nothing at all collapses rather than reserving a column', () => {
  const empty = {
    placements: { RAIL_RIGHT: { active: true, chain: ['DIRECT', 'HOUSE', 'COLLAPSE'] } },
    creatives: [], house: []
  };
  assert(AdChain.resolve(empty, 'RAIL_RIGHT', ctx()) === null,
    'an empty rail must return nothing, so the page stays one column');
});

test('weight decides the rotation', () => {
  const pool = [{ id: 'light', weight: 1 }, { id: 'heavy', weight: 9 }];
  assert(AdChain.choose(pool, 0.05).id === 'light', 'the low roll should pick the light creative');
  assert(AdChain.choose(pool, 0.5).id === 'heavy', 'the high roll should pick the heavy one');
});

/* ------------------------------------------------------------- delivery -- */

console.log('\ndelivery counting');

test('counts from a reader are recorded against the creative', () => {
  const res = call('recordAdEvents', { events: [{ id: creative.id, i: 1, c: 0 }] });
  assert(res.counted === 1, 'the impression was not counted');
  call('recordAdEvents', { events: [{ id: creative.id, i: 2, c: 1 }] });
  const report = call('adDelivery', {}, adManager.token);
  const row = report.rows.filter(r => r.creative_id === creative.id)[0];
  assert(row.impressions === 3 && row.clicks === 1, JSON.stringify(row));
  assert(report.caveat, 'the report does not say how reliable these numbers are');
});

test('the counting endpoint cannot be used to invent numbers', () => {
  const before = call('adDelivery', {}, adManager.token).rows[0].impressions;
  call('recordAdEvents', { events: [{ id: 'CRE-does-not-exist', i: 500, c: 500 }] });
  call('recordAdEvents', { events: [{ id: creative.id, i: 999999, c: 999999 }] });
  const after = call('adDelivery', {}, adManager.token).rows[0].impressions;
  assert(after - before <= 5, 'a single report added ' + (after - before) + ' impressions');
  assert(!Db.findOne('AdEvents', { creative_id: 'CRE-does-not-exist' }), 'an unknown creative got a row');
});

test('a flood of events in one call is ignored rather than written', () => {
  const many = [];
  for (let i = 0; i < 200; i++) many.push({ id: creative.id, i: 1 });
  assert(call('recordAdEvents', { events: many }).counted === 0, 'an oversized batch was accepted');
});

test('the public endpoint grants nothing beyond counting', () => {
  // recordAdEvents is reachable without a session; nothing else is, and the
  // beacon cannot be used as a foothold into the authenticated surface.
  throwsWith('unauthenticated', () => call('adDelivery', {}));
  throwsWith('unauthenticated', () => call('listUsers', {}));
  throwsWith('unauthenticated', () => call('uploadCreative', { placement: 'ARTICLE_MIDDLE' }));
});

/* ------------------------------------------------------------- standing -- */

console.log('\nstanding invariants');

test('advertising cannot reach editorial powers', () => {
  throwsWith('forbidden', () => call('publishArticle', { article_id: 'MAG-2026-000001' }, adManager.token));
  throwsWith('forbidden', () => call('publishConfiguration', {}, adManager.token));
});

test('every commercial action is audited', () => {
  ['ADVERTISER_ADDED', 'CAMPAIGN_CREATED', 'CREATIVE_UPLOADED', 'CREATIVE_REVIEWED', 'CREATIVE_PAUSED']
    .forEach(a => assert(Db.all('AuditLogs').some(l => l.action === a), a + ' was not audited'));
});

done();
