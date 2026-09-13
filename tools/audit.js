/* tools/audit.js — the checks that catch a platform which has quietly come
 * apart between its halves. Run it before any release:
 *
 *     node tools/audit.js
 *
 * Everything here is static analysis over the repository plus one boot of the
 * backend. It answers questions no unit test asks: does every script tag point
 * at a file that exists, does every call the frontend makes have a handler,
 * does every menu item lead somewhere.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let problems = [];
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    const found = fn() || [];
    if (found.length) {
      problems = problems.concat(found.map(f => name + ': ' + f));
      console.log('  FAIL  ' + name);
      found.forEach(f => console.log('        ' + f));
    } else {
      console.log('  ok    ' + name);
    }
  } catch (e) {
    problems.push(name + ': ' + e.message);
    console.log('  ERROR ' + name + '\n        ' + e.message);
  }
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function walk(dir, out) {
  out = out || [];
  fs.readdirSync(path.join(ROOT, dir)).forEach(f => {
    const rel = path.join(dir, f);
    const s = fs.statSync(path.join(ROOT, rel));
    if (s.isDirectory()) {
      if (['node_modules', '.git'].indexOf(f) === -1) walk(rel, out);
    } else out.push(rel);
  });
  return out;
}

const files = walk('.').map(f => f.replace(/^\.\//, ''));
const htmlFiles = files.filter(f => f.endsWith('.html'));

console.log('\nfile integrity');

check('every file parses', () => {
  const bad = [];
  files.forEach(f => {
    try {
      // A leading #! is valid in a Node script and not in a browser parse.
      if (/\.(js|gs)$/.test(f)) new Function(read(f).replace(/^#!.*\n/, ''));
      else if (/\.json$/.test(f)) JSON.parse(read(f));
    } catch (e) { bad.push(f + ' — ' + e.message); }
  });
  return bad;
});

check('every script and stylesheet a page loads exists', () => {
  const missing = [];
  htmlFiles.forEach(page => {
    const html = read(page);
    const dir = path.dirname(page);
    const refs = [];
    html.replace(/<script[^>]+src="([^"]+)"/g, (m, src) => refs.push(src));
    html.replace(/<link[^>]+href="([^"]+)"/g, (m, href) => refs.push(href));
    refs.filter(r => !/^https?:/.test(r)).forEach(ref => {
      const target = path.normalize(path.join(dir, ref.split('?')[0]));
      if (!exists(target)) missing.push(page + ' → ' + ref);
    });
  });
  return missing;
});

check('the service worker caches files that exist', () => {
  const sw = read('pwa/service-worker.js');
  const block = sw.slice(sw.indexOf('var SHELL'), sw.indexOf('.map(function'));
  const listed = (block.match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
  return listed.filter(f => !exists(f)).map(f => 'shell file missing: ' + f);
});

check('the manifest points at icons that exist', () => {
  const manifest = JSON.parse(read('pwa/manifest.json'));
  return (manifest.icons || [])
    .map(i => path.normalize(path.join('pwa', i.src)))
    .filter(p => !exists(p))
    .map(p => 'icon missing: ' + p);
});

console.log('\nthe seam between frontend and backend');

const routerSource = read('apps-script/Code.gs');
const actionNames = [];
routerSource.replace(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*):\s*\(/gm, (m, name) => actionNames.push(name));

check('every call the frontend makes has a handler', () => {
  const frontend = files.filter(f => /^(admin|assets\/js)\//.test(f) && f.endsWith('.js'));
  const missing = [];
  frontend.forEach(f => {
    const src = read(f);
    const calls = [];
    src.replace(/\.call\(\s*'([a-zA-Z_][a-zA-Z0-9_]*)'/g, (m, name) => calls.push(name));
    src.replace(/action:\s*'([a-zA-Z_][a-zA-Z0-9_]*)'/g, (m, name) => calls.push(name));
    calls.forEach(c => {
      if (actionNames.indexOf(c) === -1) missing.push(f + " calls '" + c + "' — no such action");
    });
  });
  return missing;
});

check('no action name is registered twice', () => {
  const seen = {};
  const dupes = [];
  actionNames.forEach(n => {
    if (seen[n]) dupes.push(n + ' is registered more than once');
    seen[n] = true;
  });
  return dupes;
});

check('every control centre button resolves to a view', () => {
  const html = read('admin/index.html');
  const nav = [];
  html.replace(/data-view="([a-z]+)"/g, (m, v) => nav.push(v));
  const registered = [];
  read('admin/admin.js').replace(/^\s{4}([a-zA-Z]+): function/gm, (m, v) => registered.push(v));
  files.filter(f => f.startsWith('admin/') && f.endsWith('.js')).forEach(f => {
    const src = read(f);
    src.replace(/views\.([a-zA-Z]+) = function/g, (m, v) => registered.push(v));
    const tails = src.match(/return \{\s*([^}]+)\}/g) || [];
    tails.forEach(t => t.replace(/\b([a-z]+):\s*[a-z]+\s*[,}]/g, (m, v) => registered.push(v)));
  });
  return nav.filter(v => registered.indexOf(v) === -1).map(v => 'no view for ' + v);
});

console.log('\nnavigation and configuration');

check('every seeded menu item leads somewhere', () => {
  const schema = read('apps-script/Schema.gs');
  const urls = [];
  schema.replace(/'(m-[a-z]+|f-[a-z]+)',\s*'[a-z]+',\s*'[^']*',\s*'([^']*)'/g, (m, id, url) => urls.push([id, url]));
  const bad = [];
  urls.forEach(pair => {
    const url = pair[1];
    if (!url || /^https?:/.test(url)) return;
    const file = url.split('?')[0].split('#')[0];
    if (!file) return;
    if (!exists(file)) bad.push(pair[0] + ' → ' + url);
  });
  return bad;
});

check('the shipped menu file matches pages that exist', () => {
  const menus = JSON.parse(read('data/menus.json'));
  const bad = [];
  [].concat(menus.primary || [], menus.footer || []).forEach(m => {
    const file = String(m.url).split('?')[0].split('#')[0];
    if (!file || /^https?:/.test(file)) return;
    if (!exists(file)) bad.push(m.name + ' → ' + m.url);
  });
  return bad;
});

check('no page advertises a placement the backend does not seed', () => {
  const schema = read('apps-script/Schema.gs');
  const placements = [];
  schema.replace(/\['([A-Z_]{4,}globalThis?)'/g, () => {});
  schema.replace(/\['([A-Z_]{4,})',\s*'[^']+',\s*\[/g, (m, id) => placements.push(id));
  const used = [];
  htmlFiles.forEach(page => read(page).replace(/data-ad="([A-Z_]+)"/g, (m, p) => used.push([page, p])));
  return used.filter(u => placements.length && placements.indexOf(u[1]) === -1)
    .map(u => u[0] + ' uses ' + u[1] + ', which is not a seeded placement');
});

console.log('\nsecrets and deployment');

check('no secret is committed', () => {
  const found = [];
  files.filter(f => !f.startsWith('docs/') && !f.startsWith('tests/')).forEach(f => {
    if (!/\.(js|gs|json|html|md|txt|xml)$/.test(f)) return;
    const src = read(f);
    if (/ghp_[A-Za-z0-9]{20,}/.test(src)) found.push(f + ' contains what looks like a GitHub token');
    if (/AIza[0-9A-Za-z_-]{30,}/.test(src)) found.push(f + ' contains what looks like a Google API key');
    if (/PASSWORD_PEPPER\s*[:=]\s*['"][^'"]{8,}/.test(src) && !/CFG\.get/.test(src)) {
      found.push(f + ' looks like it hard-codes a pepper');
    }
  });
  return found;
});

check('the backend boots and every action resolves', () => {
  const { build } = require(path.join(ROOT, 'tests', 'harness.js'));
  const sandbox = build({
    ENV: 'audit', SPREADSHEET_ID: 'x', DRIVE_FOLDER_ID: 'y',
    PASSWORD_PEPPER: 'p', TOKEN_PEPPER: 't', SITE_URL: 'https://example.test/',
    GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'g', BOOTSTRAP_EMAIL: 'a@b.test'
  });
  sandbox.setup();
  const A = sandbox.internals.ACTIONS, P = sandbox.internals.PUBLIC_ACTIONS;
  const bad = Object.keys(A).concat(Object.keys(P))
    .filter(n => typeof (A[n] || P[n]) !== 'function')
    .map(n => n + ' is not callable');
  Object.keys(A).forEach(a => {
    const res = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: a, token: null, payload: {} }) } }).getContent());
    if (res.error !== 'unauthenticated') bad.push(a + ' answers without a session (' + (res.error || 'ok') + ')');
  });
  console.log('        ' + (Object.keys(A).length + Object.keys(P).length) + ' actions, ' +
              Object.keys(sandbox.internals.SCHEMA).length + ' tables');
  return bad;
});

console.log('\nthe engine as Apps Script will load it');

const gsFiles = fs.readdirSync(path.join(ROOT, 'apps-script')).filter(f => f.endsWith('.gs'));
const gsSource = {};
gsFiles.forEach(f => { gsSource[f] = fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'); });

check('every function a trigger calls exists', () => {
  const all = Object.values(gsSource).join('\n');
  return ['setup', 'publishScheduled', 'sendQueuedEmail', 'refreshAdSchedule',
          'expireInvitations', 'dailyBackup']
    .filter(fn => all.indexOf('function ' + fn + '(') === -1)
    .map(fn => 'no function named ' + fn);
});

check('no syntax Apps Script may not support', () => {
  // The V8 runtime is not the newest V8. These are the constructs that have
  // actually bitten people, and none is worth the risk to save a line.
  const risky = [['?.', 'optional chaining'], ['??', 'nullish coalescing'],
                 ['structuredClone', 'structuredClone'], ['Object.hasOwn', 'Object.hasOwn']];
  const found = [];
  gsFiles.forEach(f => risky.forEach(pair => {
    if (gsSource[f].indexOf(pair[0]) !== -1) found.push(pair[1] + ' in ' + f);
  }));
  return found;
});

check('nothing takes the script lock twice in one execution', () => {
  // Apps Script has one script lock. An allocator that holds it and then calls
  // a write which takes it again can block until timeout — and the allocators
  // are article ids and invoice numbers.
  const found = [];
  gsFiles.filter(f => f !== 'Db.gs').forEach(f => {
    let i = gsSource[f].indexOf('waitLock(');
    while (i !== -1) {
      const stop = gsSource[f].indexOf('releaseLock', i);
      const body = gsSource[f].slice(i, stop === -1 ? undefined : stop);
      if (/Db\.(insert|update|softDelete|replaceAll)\(/.test(body)) {
        found.push('nested lock in ' + f + ' — wrap the whole sequence in Db.withLock instead');
      }
      i = gsSource[f].indexOf('waitLock(', i + 1);
    }
  });
  return [...new Set(found)];
});

console.log('\npages');

check('every page has a title, a charset and a viewport', () => htmlFiles.filter(p2 => {
  const s2 = fs.readFileSync(path.join(ROOT, p2), 'utf8');
  return !/<title>/.test(s2) || !/charset=/.test(s2) || !/name="viewport"/.test(s2);
}));

check('no page repeats an element id', () => {
  const found = [];
  htmlFiles.forEach(p2 => {
    const ids = [...fs.readFileSync(path.join(ROOT, p2), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    if (dupes.length) found.push(p2 + ' repeats ' + dupes.join(', '));
  });
  return found;
});

check('a page that talks to the engine loads the address file', () => htmlFiles.filter(p2 => {
  const s2 = fs.readFileSync(path.join(ROOT, p2), 'utf8');
  return /ads\.js|vitals\.js|newsletter\.js|accept\.js/.test(s2) && !/config\.js/.test(s2);
}));

console.log('\n' + (problems.length
  ? problems.length + ' problem(s) across ' + checks + ' checks'
  : 'all ' + checks + ' checks clean'));
process.exit(problems.length ? 1 : 0);
