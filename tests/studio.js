/* tests/studio.js — does the studio answer immediately?
 *
 * The other suites ask whether the engine is correct. This one asks whether the
 * tool feels quick, which is a different question and a measurable one: how long
 * after a click is there something on the screen, and how many times does the
 * engine get asked.
 *
 *   npm install --no-save jsdom
 *   node tests/studio.js
 */
const fs = require('fs');
const path = require('path');
const { build, test, assert, done } = require('./harness');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) {
  try { JSDOM = require('/tmp/domtest/node_modules/jsdom').JSDOM; }
  catch (e2) { console.log('\nstudio tests need a DOM:  npm install --no-save jsdom\n'); process.exit(0); }
}

const ROOT = path.join(__dirname, '..');
const sandbox = build({
  ENV: 'production', SPREADSHEET_ID: 'x', DRIVE_FOLDER_ID: 'y',
  PASSWORD_PEPPER: 'p', TOKEN_PEPPER: 't', SITE_URL: 'https://sustech360.com/',
  GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'g', BOOTSTRAP_EMAIL: 'sup@e.test'
});
sandbox.setup();
const password = (sandbox.outbox.find(m => /Temporary password/.test(m.body))
  .body.match(/Temporary password: (\S+)/))[1];

const LATENCY = 200;                  // Apps Script does not answer instantly
let requests = 0, calls = 0;
const store = {};

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8'),
  { url: 'https://sustech360.com/admin/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
const d = w.document;
w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
w.MAG_ENDPOINT = 'https://engine.test/exec';
w.scrollTo = function () {};
Object.defineProperty(w, 'localStorage', {
  value: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  configurable: true
});
w.fetch = (url, opts) => {
  requests++;
  try {
    const body = JSON.parse(opts.body);
    calls += body.action === 'batch' ? body.payload.calls.length : 1;
  } catch (e) {}
  return new Promise(resolve => setTimeout(() => resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(JSON.parse(sandbox.doPost({ postData: { contents: opts.body } }).getContent()))
  }), LATENCY));
};

['../assets/js/api.js', 'editorial.js', 'rulebook.js', 'siteadmin.js', 'ads-admin.js', 'comms.js',
 'issues-admin.js', 'performance.js', 'billing.js', 'email.js', 'published.js', 'admin.js']
  .forEach(f => {
    const file = f.startsWith('../') ? path.join(ROOT, f.replace('../', '')) : path.join(ROOT, 'admin', f);
    w.eval(fs.readFileSync(file, 'utf8'));
  });

const painted = () => {
  const text = (d.getElementById('view').textContent || '').trim();
  return text && !/^Loading/.test(text);
};

function open(view) {
  return new Promise(resolve => {
    const started = Date.now();
    d.querySelector('#nav button[data-view=' + view + ']').click();
    (function check() {
      if (painted()) return resolve(Date.now() - started);
      if (Date.now() - started > 6000) return resolve(-1);
      setTimeout(check, 4);
    })();
  });
}
const settle = ms => new Promise(r => setTimeout(r, ms || LATENCY * 3));

(async function () {
  d.getElementById('email').value = 'sup@e.test';
  d.getElementById('password').value = password;
  d.getElementById('signin').click();
  await settle(LATENCY * 5);

  console.log('\nopening screens');

  test('signing in fetches what most people click first', () => {
    assert(!d.getElementById('app').classList.contains('hidden'), 'not signed in');
    assert(requests >= 2, 'nothing was warmed up after signing in');
  });

  const firstQueue = await open('queue');
  test('a prefetched screen is there immediately', () => {
    assert(firstQueue >= 0 && firstQueue < LATENCY,
      'the queue took ' + firstQueue + 'ms, which means it waited for the engine');
  });

  await settle();
  const firstEmails = await open('emails');
  test('a screen never opened before waits once, and only once', () => {
    assert(firstEmails >= 0, 'the email centre never painted');
    assert(firstEmails < LATENCY * 3,
      'three calls should travel together, not one after another: ' + firstEmails + 'ms');
  });

  await settle();
  const before = requests;
  const again = await open('emails');
  test('a screen opened before paints without waiting for anything', () => {
    assert(again >= 0 && again < LATENCY,
      'the revisit took ' + again + 'ms — it waited for the engine instead of using what it had');
  });

  test('and it still checks behind your back', async () => {
    await settle();
    assert(requests > before, 'nothing was revalidated, so the screen could go stale unnoticed');
  });

  await settle();

  test('saving something discards what was held', async () => {
    // Working out which screens a save affects is the kind of cleverness that
    // shows somebody a stale number a month later. A write clears the lot, and
    // the next screen goes and asks again.
    await open('appearance');
    await settle();
    d.getElementById('btag').value = 'Changed by the test';
    d.getElementById('savebrand').click();
    await settle();

    const after = requests;
    const reopened = await open('menus');          // also reads siteConfiguration
    assert(requests > after,
      'the navigation screen answered from store after a save, so it may be showing the old brand');
    assert(reopened >= 0, 'the screen never painted');
  });

  test('signing out ends the session on this machine', async () => {
    assert(store['s360.session'], 'there was no session to end');
    d.getElementById('signout').click();
    await settle();
    // The stored session is what a reload would pick up. Gone means the next
    // person lands on the sign-in screen, and the reload clears the held data
    // with the page. (The reload itself is a browser thing this test cannot do.)
    assert(!store['s360.session'], 'the session survived signing out');
  });

  done().then(function () {
    console.log('  ' + requests + ' requests carried ' + calls + ' calls across the session');
  });
})();
