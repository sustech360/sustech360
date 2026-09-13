/* tools/smoke.js — open every page the way a browser does, and report anything
 * that throws.
 *
 * The contract suite proves the published content renders. This proves the
 * pages themselves survive being opened at all: the ones nobody tests because
 * nothing much happens on them, and the ones that open in a state the developer
 * never sees — an invitation link with no token, a control centre with no
 * session, a 404.
 *
 *     npm install --no-save jsdom
 *     node tools/smoke.js
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) {
  try { JSDOM = require('/tmp/domtest/node_modules/jsdom').JSDOM; }
  catch (e2) {
    console.log('\nsmoke tests need a DOM:  npm install --no-save jsdom\n');
    process.exit(0);
  }
}

const ROOT = path.join(__dirname, '..');
const PAGES = [
  ['index.html', '', 'homepage'],
  ['article.html', '?a=sodium-ion-hard-carbon-anodes', 'an article'],
  ['article.html', '', 'an article page with no article named'],
  ['category.html', '?c=energy-storage', 'a section'],
  ['category.html', '?c=does-not-exist', 'a section that does not exist'],
  ['search.html', '?q=sodium', 'search with a term'],
  ['search.html', '', 'search with nothing typed'],
  ['issues.html', '', 'the issue list with none published'],
  ['guidelines.html', '', 'the policies page'],
  ['about.html', '', 'about'],
  ['privacy.html', '', 'privacy'],
  ['404.html', '', 'page not found'],
  ['newsletter.html', '?action=unsubscribe&id=X&t=Y', 'an unsubscribe link'],
  ['newsletter.html', '', 'a newsletter link with nothing attached'],
  ['accept.html', '?i=X&t=Y', 'an invitation link'],
  ['accept.html', '', 'an invitation link with nothing attached'],
  ['admin/index.html', '', 'the control centre, signed out'],
  ['author/index.html', '', 'the author portal, signed out']
];

function load(page, query) {
  return new Promise(resolve => {
    const problems = [];
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const dom = new JSDOM(html, {
      url: 'https://sustech360.com/' + page + query,
      runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window;

    w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    w.addEventListener('error', e => problems.push('error: ' + (e.message || e.error)));
    w.addEventListener('unhandledrejection', e => {
      problems.push('unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason));
    });

    // Serve the repository from disk. A page must also survive a file that is
    // not there yet — data/ads.json before the first publish, for instance.
    w.fetch = url => {
      const rel = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
      const file = path.join(ROOT, rel.split('?')[0]);
      if (!fs.existsSync(file)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')))
      });
    };

    const scripts = Array.from(w.document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
    scripts.forEach(src => {
      const rel = src.replace(/^\.\.\//, '').replace(/^\.\//, '');
      const file = fs.existsSync(path.join(ROOT, rel))
        ? path.join(ROOT, rel)
        : path.join(ROOT, path.dirname(page), src);
      if (!fs.existsSync(file)) { problems.push('script not found: ' + src); return; }
      try { w.eval(fs.readFileSync(file, 'utf8')); }
      catch (e) { problems.push('threw while loading ' + src + ': ' + e.message); }
    });

    setTimeout(() => {
      // A page that renders nothing at all is broken even if it threw nothing.
      const text = (w.document.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 15) problems.push('the page rendered almost nothing');
      if (/\bundefined\b|\[object Object\]|\bNaN\b/.test(text)) {
        problems.push('shows a raw value: ' + text.slice(0, 90));
      }
      resolve({ problems, chars: text.length });
    }, 120);
  });
}

(async () => {
  console.log('\nopening every page as a browser would\n');
  let failed = 0;
  for (const [page, query, label] of PAGES) {
    const { problems, chars } = await load(page, query);
    if (problems.length) {
      failed++;
      console.log('  FAIL  ' + label + '  (' + page + query + ')');
      problems.forEach(p => console.log('        ' + p));
    } else {
      console.log('  ok    ' + label.padEnd(42) + chars + ' characters rendered');
    }
  }
  console.log('\n' + (PAGES.length - failed) + ' of ' + PAGES.length + ' pages open cleanly');
  process.exit(failed ? 1 : 0);
})();
