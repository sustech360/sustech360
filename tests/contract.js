/* tests/contract.js — do the two halves of this platform actually agree?
 *
 * Every other suite tests the backend through doPost. This one publishes through
 * the real editorial path, takes the files the publishing engine committed, and
 * renders them with the real frontend in a real DOM. Nothing is mocked in
 * between: the article page runs article.js against the JSON Render.article
 * produced, over the HTML that ships.
 *
 * It exists because the worst bug in phase 6 was exactly this class — the
 * frontend read `creative.sponsored`, a field the backend never emitted, so
 * sponsored advertising would have been labelled "Advertisement". Both halves
 * were individually correct and the contract between them was not.
 *
 *   npm install --no-save jsdom
 *   node tests/contract.js
 */
const fs = require('fs');
const path = require('path');
const { build, test, assert, done } = require('./harness');

let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  try {
    JSDOM = require('/tmp/domtest/node_modules/jsdom').JSDOM;
  } catch (e2) {
    console.log('\ncontract tests need a DOM:  npm install --no-save jsdom\n');
    process.exit(0);
  }
}

const ROOT = path.join(__dirname, '..');
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
function mailTo(email, match) {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i].to === email && (outbox[i].body || '').indexOf(match) !== -1) return outbox[i];
  }
  return null;
}

/* ---------------------------------------------------------------- publish -- */

console.log('\npublishing through the real editorial path');

sandbox.setup();
const supervisor = call('login', { email: 'supervisor@example.test', password: tempPasswordFor('supervisor@example.test') });
function staff(email, name, role) {
  call('inviteUser', { name: name, email: email, role_id: role }, supervisor.token);
  return call('login', { email: email, password: tempPasswordFor(email) });
}
const editor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');
const reviewer = staff('reviewer@example.test', 'A Reviewer', 'REVIEWER');

const invitation = call('createInvitation', { name: 'R. Menon', email: 'menon@example.test', section: 'energy-storage' }, supervisor.token);
const acceptUrl = mailTo('menon@example.test', 'accept.html').body.match(/https:\/\/\S+/)[0];
call('acceptInvitation', {
  id: invitation.id, token: decodeURIComponent(acceptUrl.match(/[?&]t=([^&\s]+)/)[1]), password: 'Hard-Carbon-2026'
});
const author = call('login', { email: 'menon@example.test', password: 'Hard-Carbon-2026' });

const article = call('createDraft', {
  title: 'Hard carbon and the sodium-ion ceiling',
  format: 'research-highlight', category: 'energy-storage', level: 'understand',
  topics: ['sodium-ion', 'hard-carbon'], tags: ['batteries']
}, author.token);

call('saveDraft', {
  article_id: article.id,
  fields: {
    summary: 'Sodium-ion cells are cheap on paper, and the anode is what decides whether they are cheap ' +
             'in practice: hard carbon sets the ceiling that cathode chemistry cannot lift.',
    background: 'Graphite barely accepts sodium, so the field uses hard carbon instead. '.repeat(20),
    findings: 'Plateau capacity rises with pyrolysis temperature while the sloping region shrinks. '.repeat(20) +
              '\n\n[figure:schematic.png]\n\nFirst-cycle efficiency falls as accessible surface area rises.',
    significance: 'Cost models vary the cathode and hold the anode fixed, which is backwards. '.repeat(20),
    references: 'Stevens & Dahn, J. Electrochem. Soc. 147, 1271 (2000).\nBommier et al., Nano Lett. 15, 5888 (2015).'
  }
}, author.token);

call('uploadMedia', {
  article_id: article.id, mime: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  name: 'schematic.png', credit: 'R. Menon', licence: 'CC BY 4.0', caption: 'Sodium storage in a disordered carbon'
}, author.token);

const checklist = {};
Db.all('SubmissionChecklist').forEach(c => { checklist[c.id] = true; });
call('submitArticle', { article_id: article.id, checklist: checklist }, author.token);
call('moveArticle', { article_id: article.id, to: 'EDITOR_CHECK' }, editor.token);
call('assignReviewer', { article_id: article.id, reviewer_id: reviewer.user.id }, editor.token);
call('moveArticle', { article_id: article.id, to: 'VERIFIED' }, editor.token);
call('moveArticle', { article_id: article.id, to: 'READY_FOR_PUBLICATION' }, editor.token);
call('moveArticle', { article_id: article.id, to: 'APPROVED' }, supervisor.token);
const published = call('publishArticle', { article_id: article.id }, supervisor.token);
call('publishConfiguration', { note: 'Contract test' }, supervisor.token);

test('the publishing engine committed a site', () => {
  ['data/bootstrap.json', 'data/settings.json', 'data/menus.json', 'data/homepage.json',
   'data/index/articles.json', 'data/search-index.json',
   'data/articles/' + published.slug + '.json'].forEach(f => {
    assert(repo.has(f), 'missing ' + f);
  });
});

/* ------------------------------------------------------------- rendering -- */

/** Loads one of the real pages, serves it the real published files, and runs
 *  the real scripts in document order. */
function render(page, query, width) {
  // jsdom has no layout, so it answers every media query with "no". A page that
  // asks whether there is room for a side rail has to be told, or the wide-screen
  // behaviour can never be tested at all.
  const viewport = width || 1440;
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://example.test/magazine/' + page + (query || ''),
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;

  w.matchMedia = function (q) {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    let matches = true;
    if (min) matches = viewport >= Number(min[1]);
    if (max) matches = matches && viewport <= Number(max[1]);
    return { matches: matches, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  };
  w.MAG_ENDPOINT = '';                       // no beacons from a test

  w.fetch = function (url) {
    // Pages build URLs with MAG.join, which yields a root-relative path such as
    // /magazine/data/bootstrap.json. Strip the origin and the site base to get
    // the repository path the publishing engine committed.
    const rel = String(url)
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/magazine\//, '')
      .replace(/^\//, '');
    if (repo.has(rel)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(repo.get(rel))) });
    }
    const onDisk = path.join(ROOT, rel);
    if (fs.existsSync(onDisk)) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(fs.readFileSync(onDisk, 'utf8'))) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  };

  const scripts = Array.from(w.document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
  scripts.forEach(src => {
    const file = path.join(ROOT, src.replace(/^\.\//, ''));
    if (!fs.existsSync(file)) return;                       // admin/config.js placeholder
    w.eval(fs.readFileSync(file, 'utf8'));
  });

  // Let the promise chains settle. Everything on these pages is one or two
  // fetches deep and the stub resolves immediately.
  return new Promise(resolve => setTimeout(() => resolve(w), 60));
}

console.log('\nthe homepage');

let home;
test('the homepage renders the published article', async () => {
  home = await render('index.html');
  const text = home.document.body.textContent;
  assert(text.indexOf('Hard carbon and the sodium-ion ceiling') !== -1,
    'the article never reached the homepage');
  assert(home.document.querySelector('.lead h1'), 'no lead story rendered');
});

test('the brand and navigation come from the published configuration', async () => {
  assert(home.document.querySelector('[data-brand]').textContent.trim().length > 0, 'no brand name');
  const nav = home.document.querySelectorAll('[data-nav] a');
  assert(nav.length >= 5, 'navigation has ' + nav.length + ' items');
  assert(Array.from(nav).some(a => /energy/i.test(a.textContent)), 'the energy section is missing');
});

test('the masthead shows the logo, not a text fallback', async () => {
  const logo = home.document.querySelector('.wordmark img');
  assert(logo, 'the wordmark rendered as text — the configured logo did not load');
  const src = logo.getAttribute('src').replace('/magazine/', '');
  assert(fs.existsSync(path.join(ROOT, src)), 'the logo points at a file that does not exist: ' + src);
  assert(logo.getAttribute('alt').indexOf('360') !== -1,
    'the logo has no useful alt text, so the masthead is invisible to a screen reader');
});

test('the publication name and tagline are the configured ones', async () => {
  const name = home.document.querySelector('[data-brand]');
  assert(!name || name.textContent.indexOf('Magazine') === -1, 'a placeholder brand name is still showing');
  assert(home.document.title.indexOf('360') !== -1, 'the page title is not branded: ' + home.document.title);
  const icon = home.document.querySelector('link[rel="icon"]');
  assert(icon && fs.existsSync(path.join(ROOT, icon.getAttribute('href').replace(/^\//, ''))),
    'the favicon link points at nothing');
});

test('paused and disabled menu items do not appear', async () => {
  const names = Array.from(home.document.querySelectorAll('[data-nav] a')).map(a => a.textContent.trim());
  assert(names.indexOf('Policy') === -1, 'a paused menu item was rendered: ' + names.join(', '));
});

test('an unfillable advertising slot takes up no space', async () => {
  const slots = home.document.querySelectorAll('[data-ad]');
  assert(slots.length > 0, 'the homepage has no ad slots at all');
  Array.from(slots).forEach(s => {
    assert(!s.classList.contains('is-filled'), 'an empty slot rendered as filled');
    assert(s.innerHTML.trim() === '', 'an unfilled slot left markup behind: ' + s.innerHTML);
  });
});

test('no template placeholder or literal undefined reached the page', async () => {
  const text = home.document.body.textContent;
  ['undefined', 'null', '{{', 'NaN', '[object Object]'].forEach(bad => {
    assert(text.indexOf(bad) === -1, 'the homepage shows "' + bad + '"');
  });
});

console.log('\nthe article page');

let page;
test('the article page renders what Render.article produced', async () => {
  page = await render('article.html', '?a=' + published.slug);
  const body = page.document.getElementById('body');
  assert(body.querySelectorAll('p').length >= 4, 'paragraphs did not render');
  assert(Array.from(body.querySelectorAll('h2')).some(h => h.textContent === 'Key findings'),
    'the format labels from the rulebook did not become headings');
});

test('the figure the author placed appears where they placed it', async () => {
  const figures = page.document.getElementById('body').querySelectorAll('figure');
  assert(figures.length === 1, 'expected one figure, got ' + figures.length);
  const caption = figures[0].querySelector('figcaption').textContent;
  assert(/CC BY 4\.0/.test(caption), 'the licence is not shown with the figure: ' + caption);
  const src = figures[0].querySelector('img').getAttribute('src');
  assert(repo.has(src.replace('/magazine/', '')), 'the figure points at a file that was never committed: ' + src);
});

test('references render as a numbered list, not as prose', async () => {
  const refs = page.document.querySelector('#body ol.refs');
  assert(refs && refs.querySelectorAll('li').length === 2, 'references did not render as a list');
});

test('byline, reading time and level come through', async () => {
  const head = page.document.getElementById('head').textContent;
  assert(head.indexOf('R. Menon') !== -1, 'no byline');
  assert(/\d+ min read/.test(head), 'no reading time');
  assert(head.indexOf('Understand') !== -1, 'the reading level did not render');
});

test('the page sets its own title, description and structured data', async () => {
  assert(page.document.title.indexOf('Hard carbon') !== -1, 'title: ' + page.document.title);
  const desc = page.document.querySelector('meta[name="description"]');
  assert(desc && desc.getAttribute('content').length > 20, 'no meta description');
  const ld = page.document.querySelector('script[type="application/ld+json"]');
  assert(ld, 'no structured data');
  const data = JSON.parse(ld.textContent);
  assert(data.headline && data.author.length === 1 && data.datePublished, JSON.stringify(data));
});

test('the table of contents is built from the rendered headings', async () => {
  const links = page.document.querySelectorAll('#toc a');
  assert(links.length >= 3, 'the contents list has ' + links.length + ' entries');
  Array.from(links).forEach(a => {
    const target = a.getAttribute('href').slice(1);
    assert(page.document.getElementById(target), 'a contents link points at nothing: ' + target);
  });
});

test('a missing article fails as a page, not as a stack trace', async () => {
  const missing = await render('article.html', '?a=no-such-article');
  const text = missing.document.getElementById('head').textContent;
  assert(/not here/i.test(text), 'unexpected message: ' + text);
  assert(text.indexOf('undefined') === -1);
});

console.log('\ncategory and search');

test('the category page finds the article through the full index', async () => {
  const cat = await render('category.html', '?c=energy-storage');
  assert(cat.document.getElementById('title').textContent === 'Energy storage', 'wrong heading');
  assert(cat.document.getElementById('results').textContent.indexOf('Hard carbon') !== -1,
    'the article is missing from its own category');
});

test('a category that does not exist says so', async () => {
  const cat = await render('category.html', '?c=astrology');
  assert(/not found/i.test(cat.document.getElementById('title').textContent));
});

test('search finds the article by a word from its body', async () => {
  const s = await render('search.html', '?q=pyrolysis');
  await new Promise(r => setTimeout(r, 200));               // the box debounces
  assert(s.document.getElementById('results').textContent.indexOf('Hard carbon') !== -1,
    'the search index does not carry the article vocabulary');
});

test('search for nonsense says nothing matched', async () => {
  const s = await render('search.html', '?q=zzzzqqq');
  await new Promise(r => setTimeout(r, 200));
  assert(/No articles match/i.test(s.document.getElementById('results').textContent));
});

console.log('\nadvertising through both halves');

test('an approved creative is rendered with the label the backend set', async () => {
  call('saveAdPlacement', { id: 'HOME_TOP', name: 'Homepage top', chain: ['DIRECT', 'COLLAPSE'], active: true }, supervisor.token);
  const advertiser = call('saveAdvertiser', { company: 'Northwind', email: 'a@northwind.test' }, supervisor.token);
  const campaign = call('saveCampaign', {
    advertiser_id: advertiser.id, name: 'Launch', tier: 'DIRECT',
    starts: new Date(Date.now() - 86400000).toISOString(), ends: new Date(Date.now() + 30 * 86400000).toISOString()
  }, supervisor.token);
  const creative = call('uploadCreative', {
    placement: 'HOME_TOP', campaign_id: campaign.id, mime: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    file: 'nw.png', name: 'Northwind', alt: 'Northwind sodium cells',
    url: 'https://northwind.test', label: 'Sponsored', weight: 1
  }, supervisor.token);
  call('reviewCreative', { creative_id: creative.id, decision: 'APPROVED' }, editor.token);
  call('setFeatureFlag', { flag: 'ADVERTISING', state: 'enabled' }, supervisor.token);
  call('publishAds', {}, supervisor.token);
  call('publishConfiguration', { note: 'Advertising on' }, supervisor.token);

  const withAd = await render('index.html');
  const slot = withAd.document.querySelector('[data-ad="HOME_TOP"]');
  assert(slot && slot.classList.contains('is-filled'), 'the approved creative did not render');
  assert(slot.querySelector('.adslot__label').textContent === 'Sponsored',
    'the disclosure label is "' + slot.querySelector('.adslot__label').textContent + '" — the backend said Sponsored');
  const link = slot.querySelector('a');
  assert(/nofollow/.test(link.getAttribute('rel')) && /sponsored/.test(link.getAttribute('rel')),
    'a paid link is missing rel=nofollow sponsored');
});

test('a sold rail and a Google rail render side by side on a wide screen', async () => {
  // Both sides, from different sources, on the page at once — and the page
  // only becomes three columns because they filled.
  ['RAIL_LEFT', 'RAIL_RIGHT'].forEach(id => {
    call('saveAdPlacement', { id: id, name: id, chain: ['DIRECT', 'ADSENSE', 'HOUSE', 'COLLAPSE'], active: true }, supervisor.token);
  });
  const advertiser = call('saveAdvertiser', { company: 'Rail Co', email: 'r@rail.test' }, supervisor.token);
  const campaign = call('saveCampaign', {
    advertiser_id: advertiser.id, name: 'Rail campaign', tier: 'DIRECT',
    starts: new Date(Date.now() - 86400000).toISOString(), ends: new Date(Date.now() + 30 * 86400000).toISOString()
  }, supervisor.token);
  const creative = call('uploadCreative', {
    placement: 'RAIL_LEFT', campaign_id: campaign.id, mime: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    file: 'rail.png', name: 'Rail advertiser', alt: 'Rail Co cells',
    url: 'https://rail.test', label: 'Advertisement', weight: 1
  }, supervisor.token);
  call('reviewCreative', { creative_id: creative.id, decision: 'APPROVED' }, editor.token);
  call('saveSiteSettings', {
    ads: { adsense_client: 'ca-pub-1234567890', slots: { RAIL_RIGHT: '1122334455' } }
  }, supervisor.token);
  call('publishAds', {}, supervisor.token);
  call('publishConfiguration', { note: 'Rails' }, supervisor.token);

  const wide = await render('index.html', '', 1440);
  const left = wide.document.querySelector('[data-ad="RAIL_LEFT"]');
  const right = wide.document.querySelector('[data-ad="RAIL_RIGHT"]');
  assert(left && right, 'the page has no rails to fill');
  assert(left.classList.contains('is-filled'), 'the sold rail did not render');
  assert(left.querySelector('img'), 'the advertiser image is missing');
  assert(right.classList.contains('is-filled'), 'the Google rail did not render');
  const unit = right.querySelector('ins.adsbygoogle');
  assert(unit, 'no AdSense unit');
  assert(unit.getAttribute('data-ad-slot') === '1122334455', 'the unit has no slot id — it would never fill');
  assert(unit.getAttribute('data-full-width-responsive') === 'true', 'the unit is not responsive');
  assert(wide.document.querySelector('.frame').classList.contains('has-rails'),
    'the three-column layout never turned on');
});

test('a phone gets no rails at all — not shrunk, absent', async () => {
  const phone = await render('index.html', '', 390);
  const left = phone.document.querySelector('[data-ad="RAIL_LEFT"]');
  assert(left && !left.classList.contains('is-filled'),
    'a rail filled on a 390px screen, which is how a page starts scrolling sideways');
  assert(left.innerHTML.trim() === '', 'the rail left markup behind on a phone');
  assert(!phone.document.querySelector('.frame').classList.contains('has-rails'),
    'the three-column layout turned on for a phone');
  // The inline slot is what a phone gets instead, and it still works.
  const inline = phone.document.querySelector('[data-ad="HOME_TOP"]');
  assert(inline, 'a phone has no inline ad slot to fall back to');
});

console.log('\nthe issue edition');

test('a published issue renders on the web', async () => {
  const issue = call('createIssue', { number: 1, title: 'Issue 1 — The anode problem', month: 'September', year: 2026 }, supervisor.token);
  call('saveIssue', {
    id: issue.id, contents: { features: [article.id] },
    editorial: 'Welcome to the first issue.\n\nWe start where the cost models do not.'
  }, supervisor.token);
  call('moveIssue', { id: issue.id, to: 'PREVIEW' }, supervisor.token);
  call('moveIssue', { id: issue.id, to: 'VERIFIED' }, editor.token);
  call('moveIssue', { id: issue.id, to: 'APPROVED' }, supervisor.token);
  call('publishIssue', { issue_id: issue.id }, supervisor.token);

  const list = await render('issues.html');
  assert(list.document.body.textContent.indexOf('The anode problem') !== -1, 'the issue is not listed');

  const one = await render('issues.html', '?i=issue-1');
  const text = one.document.body.textContent;
  assert(text.indexOf('Welcome to the first issue') !== -1, 'the editorial did not render');
  assert(text.indexOf('Hard carbon') !== -1, 'the contents did not render');
  assert(one.document.querySelector('a[download]'), 'no PDF offered');
});

console.log('\nthe guidelines page');

test('published guidelines render for readers', async () => {
  const draft = call('draftGuideline', { kind: 'AUTHOR', body: 'Who writes here\nContribution is by invitation.' }, supervisor.token);
  call('moveGuideline', { id: draft.id, to: 'PREVIEW' }, supervisor.token);
  call('moveGuideline', { id: draft.id, to: 'VERIFIED' }, editor.token);
  call('moveGuideline', { id: draft.id, to: 'APPROVED' }, supervisor.token);
  call('publishGuideline', { id: draft.id }, supervisor.token);

  const page2 = await render('guidelines.html');
  const text = page2.document.getElementById('docs').textContent;
  assert(text.indexOf('Contribution is by invitation') !== -1, 'the published guidelines did not render');
  assert(/Version/.test(page2.document.getElementById('docs').textContent), 'no version shown on a policy document');
});

done();
