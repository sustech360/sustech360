/* tests/harness.js — runs the .gs backend under Node with the Apps Script
 * services stubbed in memory. It is not a simulator of Google's platform; it is
 * enough of one to exercise the rules that matter: permissions, ownership,
 * invitation lifecycle, and the submission gate.
 *
 *   node tests/phase2.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function bytes(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function toBuf(arr) { return Buffer.from(arr.map(b => (b < 0 ? b + 256 : b))); }

function makeSheet(name) {
  const rows = [];
  return {
    name,
    getLastRow: () => rows.length,
    setFrozenRows: () => {},
    appendRow: r => rows.push(r.slice()),
    getRange(row, col, numRows, numCols) {
      return {
        setValues(vals) {
          vals.forEach((v, i) => {
            const r = row + i - 1;
            while (rows.length <= r) rows.push([]);
            v.forEach((cell, j) => { rows[r][col + j - 1] = cell; });
          });
          return this;
        },
        getValues() {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const r = rows[row + i - 1] || [];
            const line = [];
            for (let j = 0; j < numCols; j++) line.push(r[col + j - 1] === undefined ? '' : r[col + j - 1]);
            out.push(line);
          }
          return out;
        },
        setValue(v) { const r = row - 1; while (rows.length <= r) rows.push([]); rows[r][col - 1] = v; return this; },
        clearContent() {
          for (let i = 0; i < numRows; i++) {
            const r = rows[row + i - 1];
            if (!r) continue;
            for (let j = 0; j < numCols; j++) r[col + j - 1] = '';
          }
          // A cleared block at the end of the sheet is gone, not a run of blanks:
          // otherwise getLastRow keeps counting rows that no longer hold anything.
          while (rows.length && rows[rows.length - 1].every(c => c === '' || c === undefined)) rows.pop();
          return this;
        },
        setFontWeight() { return this; }
      };
    },
    _rows: rows
  };
}

function build(props) {
  const sheets = new Map();
  const outbox = [];
  const files = new Map();
  const cache = new Map();

  const book = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.set(n, s); return s; }
  };

  const folder = (name) => ({
    getFoldersByName: n => {
      const key = 'folder:' + n;
      let has = files.has(key);
      return { hasNext: () => has, next: () => folder(n) };
    },
    createFolder: n => { files.set('folder:' + n, true); return folder(n); },
    createFile: (a, b, c) => {
      const id = 'file-' + crypto.randomUUID().slice(0, 8);
      const content = typeof a === 'string' ? b : a._data;
      files.set(id, { name: typeof a === 'string' ? a : a._name, content, mime: c || 'application/octet-stream' });
      return fileHandle(id);
    }
  });

  /** A blob that can convert itself, the way Apps Script's can. The PDF is not
   *  a real PDF here — it is the source HTML wrapped in a %PDF header — which is
   *  exactly what a test needs: it can assert on what went into the document
   *  without needing a PDF parser. */
  function blob(data, mime, name) {
    const text = typeof data === 'string' ? data : toBuf(data).toString('binary');
    return {
      _data: text, _mime: mime, _name: name,
      getName: () => name,
      setName: function (n) { this._name = n; return this; },
      getBytes: () => (typeof data === 'string' ? bytes(Buffer.from(data, 'utf8')) : data),
      getDataAsString: () => (typeof data === 'string' ? data : toBuf(data).toString('utf8')),
      getAs: function (target) {
        if (target !== 'application/pdf') throw new Error('unsupported conversion: ' + target);
        return blob('%PDF-1.4 (stub)\n' + text, target, String(name || 'file').replace(/\.\w+$/, '') + '.pdf');
      }
    };
  }

  const fileHandle = id => ({
    getId: () => id,
    setContent: c => { files.get(id).content = c; },
    setSharing: () => {},
    getBlob: () => ({
      getDataAsString: () => files.get(id).content,
      getBytes: () => bytes(Buffer.from(String(files.get(id).content), 'utf8'))
    })
  });

  /* A stand-in for the GitHub contents API: enough of it to prove what the
     publishing engine does and does not write to the public site. */
  const lockHeld = { held: false };
  const repo = new Map();
  const UrlFetchApp = {
    fetch: (url, opts) => {
      opts = opts || {};
      const method = (opts.method || 'get').toLowerCase();
      const full = String(url);

      // A repository lookup — what the publishing check asks first.
      const repoOnly = full.match(/^https:\/\/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)$/);
      if (repoOnly) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ full_name: repoOnly[1], default_branch: 'main' })
        };
      }

      const path = decodeURIComponent(full.split('/contents/')[1] || '');

      if (method === 'put') {
        const body = JSON.parse(opts.payload);
        repo.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
        return {
          getResponseCode: () => (body.sha ? 200 : 201),
          getContentText: () => JSON.stringify({ content: { sha: 'sha-' + path.length } })
        };
      }
      if (method === 'delete') {
        repo.delete(path);
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      }
      if (!repo.has(path)) return { getResponseCode: () => 404, getContentText: () => '{}' };
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ sha: 'sha-' + path.length })
      };
    }
  };

  const sandbox = {
    console,
    JSON, Math, Date, String, Number, Object, Array, Boolean, Error, RegExp, isNaN, parseInt, parseFloat, Infinity,
    SpreadsheetApp: { openById: () => book },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        getProperties: () => Object.assign({}, props),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: (obj) => { Object.keys(obj).forEach(k => { props[k] = String(obj[k]); }); }
      })
    },
    // A pessimistic script lock: Apps Script has exactly one, and taking it
    // twice in an execution can block until timeout. The stub refuses the
    // second acquisition so a nested lock fails loudly here rather than
    // intermittently in production.
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (lockHeld.held) throw new Error('Lock timeout: another process was holding the lock');
          lockHeld.held = true;
        },
        releaseLock() { lockHeld.held = false; }
      })
    },
    // Utilities.newBlob(html, 'text/html').getAs('application/pdf') is how Apps
    // Script makes a PDF. The stub keeps the bytes so a test can look inside.
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    DriveApp: {
      getFolderById: () => folder('root'),
      getFileById: id => { if (!files.has(id)) throw new Error('no file'); return fileHandle(id); },
      Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' }
    },
    MailApp: {
      getRemainingDailyQuota: () => 1500 - outbox.length,
      sendEmail: (a, subject, body) => {
        outbox.push(typeof a === 'object' ? a : { to: a, subject, body });
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: t => ({ setMimeType: () => ({ getContent: () => t }), getContent: () => t })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      MacAlgorithm: { HMAC_SHA_1: 'sha1' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      computeDigest: (alg, value) => bytes(crypto.createHash('sha256')
        .update(typeof value === 'string' ? Buffer.from(value, 'utf8') : toBuf(value)).digest()),
      computeHmacSha256Signature: (v, k) => bytes(crypto.createHmac('sha256', k).update(String(v)).digest()),
      computeHmacSignature: (alg, v, k) => bytes(crypto.createHmac('sha1', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuf(v)).toString('base64'),
      base64EncodeWebSafe: v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuf(v))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: s => bytes(Buffer.from(s, 'base64')),
      newBlob: (data, mime, name) => blob(data, mime, name)
    },
    UrlFetchApp,
    outbox, files, sheets, repo, cache
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const dir = path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
  });
  // `const Db = ...` at the top level of a script is script-scoped, not a
  // property of the global object, so a test file cannot reach it through the
  // sandbox. Publish the modules it needs to inspect.
  vm.runInContext(
    'globalThis.internals = { Db, SCHEMA, LIMITS, Auth, Perms, Articles, Invitations, Users, Roles, '
    + 'Billing, Performance, Issues, Social, Ads, Newsletter, Guidelines, Formats, SiteConfig, '
    + 'ACTIONS, PUBLIC_ACTIONS };',
    sandbox);
  return sandbox;
}

/* --- tiny test runner ------------------------------------------------- */

let passed = 0, failed = 0;
/** Tests run in order, and an async one is awaited. Without the await, a test
 *  whose assertion rejects reports "pass" and the suite becomes decoration —
 *  which is worse than no suite, because it is believed. */
let queue = Promise.resolve();

function test(name, fn) {
  queue = queue.then(async () => {
    try {
      await fn();
      console.log('  pass  ' + name);
      passed++;
    } catch (e) {
      console.log('  FAIL  ' + name + '\n        ' + (e && e.message ? e.message : String(e)));
      failed++;
    }
  });
  return queue;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function throwsWith(code, fn, msg) {
  try { fn(); } catch (e) {
    if (e && e.code === code) return e;
    throw new Error((msg || '') + ' expected ' + code + ', got ' + (e.code || e.message));
  }
  throw new Error((msg || '') + ' expected ' + code + ', nothing was thrown');
}
function done() {
  return queue.then(() => {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
}

module.exports = { build, test, assert, throwsWith, done };
