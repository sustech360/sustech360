/* tests/editor.js — does the editor lose work, and how often does it interrupt?
 *
 * An author writes on a train. The questions that matter are whether the words
 * survive a dead connection, and whether typing waits on anything. Both are
 * answered here in a browser, against the real engine.
 *
 *   npm install --no-save jsdom
 *   node tests/editor.js
 */
const fs = require('fs');
const path = require('path');
const { build, test, assert, done } = require('./harness');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) {
  try { JSDOM = require('/tmp/domtest/node_modules/jsdom').JSDOM; }
  catch (e2) { console.log('\neditor tests need a DOM:  npm install --no-save jsdom\n'); process.exit(0); }
}

const ROOT = path.join(__dirname, '..');
const sandbox = build({
  ENV: 'production', SPREADSHEET_ID: 'x', DRIVE_FOLDER_ID: 'y',
  PASSWORD_PEPPER: 'p', TOKEN_PEPPER: 't', SITE_URL: 'https://sustech360.com/',
  GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'g', BOOTSTRAP_EMAIL: 'sup@e.test'
});
sandbox.setup();

function call(action, payload, token) {
  const res = sandbox.doPost({ postData: { contents: JSON.stringify({ action, token: token || null, payload: payload || {} }) } });
  const out = JSON.parse(res.getContent());
  if (!out.ok) throw new Error(out.error + (out.detail ? ': ' + out.detail : ''));
  return out.data;
}
const tempPassword = e => {
  for (let i = sandbox.outbox.length - 1; i >= 0; i--) {
    if (sandbox.outbox[i].to === e) {
      const m = (sandbox.outbox[i].body || '').match(/Temporary password: (\S+)/);
      if (m) return m[1];
    }
  }
  return null;
};

// An author with a draft open.
const supervisor = call('login', { email: 'sup@e.test', password: tempPassword('sup@e.test') });
const invitation = call('createInvitation', { name: 'R. Menon', email: 'menon@example.test' }, supervisor.token);
const acceptUrl = sandbox.outbox.filter(m => m.to === 'menon@example.test')
  .map(m => (m.body.match(/https:\/\/\S+/) || [])[0]).filter(Boolean).pop();
call('acceptInvitation', {
  id: invitation.id, token: decodeURIComponent(acceptUrl.match(/[?&]t=([^&\s]+)/)[1]), password: 'Hard-Carbon-2026'
});
const author = call('login', { email: 'menon@example.test', password: 'Hard-Carbon-2026' });
const draft = call('createDraft', {
  title: 'A draft to type into', format: 'research-highlight', category: 'energy-storage'
}, author.token);

let requests = 0, offline = false;
const store = {};
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'author/index.html'), 'utf8'),
  { url: 'https://sustech360.com/author/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  if (offline) return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(JSON.parse(sandbox.doPost({ postData: { contents: opts.body } }).getContent()))
  });
};
['../assets/js/api.js', 'author.js'].forEach(f => {
  const file = f.startsWith('../') ? path.join(ROOT, f.replace('../', '')) : path.join(ROOT, 'author', f);
  w.eval(fs.readFileSync(file, 'utf8'));
});

const settle = ms => new Promise(r => setTimeout(r, ms || 120));
function type(field, text) {
  const box = d.getElementById('f-' + field);
  box.value = text;
  box.dispatchEvent(new w.Event('input', { bubbles: true }));
}

(async function () {
  d.getElementById('email').value = 'menon@example.test';
  d.getElementById('password').value = 'Hard-Carbon-2026';
  d.getElementById('signin').click();
  await settle(300);
  // Opened the way an author opens it: My articles, then Open.
  d.querySelector('[data-view=articles]').click();
  await settle(400);
  const open = d.querySelector('[data-open="' + draft.id + '"]');
  if (open) open.click();
  await settle(500);

  console.log('\nwriting');

  test('the editor opens with its fields', () => {
    assert(d.getElementById('f-background'), 'no background field — the editor did not open');
  });

  test('typing does not wait on anything', async () => {
    const before = requests;
    type('background', 'Graphite barely accepts sodium. ');
    type('background', 'Graphite barely accepts sodium, so the field uses hard carbon. ');
    type('findings', 'Plateau capacity rises with pyrolysis temperature. ');
    await settle(60);
    assert(requests === before, 'typing sent ' + (requests - before) + ' requests before the author paused');
    assert(/device/i.test(d.getElementById('savestate').textContent),
      'the author is not told the work is already safe: ' + d.getElementById('savestate').textContent);
  });

  test('it is on the device the moment it is typed', () => {
    const held = JSON.parse(store['s360.draft.' + draft.id] || '{}');
    assert(held.pending && /hard carbon/.test(held.pending.fields.background || ''),
      'nothing was written to the device');
  });

  test('a pause sends one request carrying only what changed', async () => {
    const before = requests;
    await settle(3200);
    assert(requests === before + 1, 'a pause sent ' + (requests - before) + ' requests');
    const saved = call('getArticle', { article_id: draft.id }, author.token).content.fields;
    assert(/hard carbon/.test(saved.background), 'the engine did not receive the writing');
    assert(/Plateau capacity/.test(saved.findings), 'the second field did not travel with the first');
  });

  test('a dead connection costs nothing', async () => {
    offline = true;
    type('significance', 'Written in a tunnel. ');
    await settle(3200);
    const held = JSON.parse(store['s360.draft.' + draft.id] || '{}');
    assert(/tunnel/.test(held.pending.fields.significance || ''),
      'work written while offline was not kept on the device');
    assert(/waiting to send|device/i.test(d.getElementById('savestate').textContent),
      'the author was not told it is safe but unsent: ' + d.getElementById('savestate').textContent);
  });

  test('and goes as soon as there is one', async () => {
    offline = false;
    await settle(6000);
    const saved = call('getArticle', { article_id: draft.id }, author.token).content.fields;
    assert(/tunnel/.test(saved.significance || ''), 'the queued writing never reached the engine');
  });

  test('nothing is left waiting once it has been sent', async () => {
    await settle(400);
    const held = store['s360.draft.' + draft.id];
    assert(!held || !Object.keys(JSON.parse(held).pending.fields).length,
      'the device still thinks there is unsent work');
  });

  done();
})();
