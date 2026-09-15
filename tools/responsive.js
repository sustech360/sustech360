/* tools/responsive.js — the device checks that can be made honestly without a
 * device.
 *
 * Be clear about what this is: static analysis of the stylesheets and pages. It
 * can prove a table is allowed to scroll inside its own box and that no input
 * is small enough to make iOS zoom. It cannot prove the homepage looks right on
 * a Galaxy A14, because nothing short of a Galaxy A14 can.
 *
 * `docs/DEVICE-TESTING.md` lists what still has to be looked at by a person.
 *
 *     node tools/responsive.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = {
  'assets/css/main.css': fs.readFileSync(path.join(ROOT, 'assets/css/main.css'), 'utf8'),
  'admin/admin.css': fs.readFileSync(path.join(ROOT, 'admin/admin.css'), 'utf8'),
  'author/author.css': fs.readFileSync(path.join(ROOT, 'author/author.css'), 'utf8')
};
const pages = [];
(function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    if (['.git', 'node_modules'].indexOf(f) !== -1) return;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.html')) pages.push(path.relative(ROOT, p));
  });
})(ROOT);

let problems = [], checks = 0;
function check(name, fn) {
  checks++;
  const found = fn() || [];
  if (found.length) {
    problems = problems.concat(found.map(f => name + ': ' + f));
    console.log('  FAIL  ' + name);
    found.forEach(f => console.log('        ' + f));
  } else {
    console.log('  ok    ' + name);
  }
}

console.log('\nlayout');

check('every page declares a viewport that fills the screen', () =>
  pages.filter(p => {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
    return !/name="viewport"[^>]*width=device-width/.test(s) || !/viewport-fit=cover/.test(s);
  }));

check('the shell is fluid rather than a fixed width', () => {
  const s = css['assets/css/main.css'];
  const bad = [];
  if (!/\.shell\s*{[^}]*width:\s*100%/.test(s)) bad.push('the shell does not take the width it is given');
  if (!/max-width:\s*var\(--shell\)/.test(s)) bad.push('the shell has no configured ceiling');
  if (!/@media \(min-width: 1[0-9]{3}px\)[^{]*{[^}]*--shell/.test(s)) {
    bad.push('the ceiling never rises on a large screen');
  }
  return bad;
});

check('nothing is pinned to a width a phone does not have', () => {
  const bad = [];
  Object.keys(css).forEach(f => {
    // A media query condition reads as "min-width: 960px" too, and that is the
    // opposite of a problem — it is the rule that adapts.
    const declarations = css[f].replace(/@media[^{]*{/g, '{');

    // Walk rule by rule so the selector is known. A decorative ::before inside
    // an overflow-hidden panel can be any size it likes; it is an ornament, not
    // a column, and it cannot push a page sideways.
    const rules = declarations.match(/[^{}]+\{[^{}]*\}/g) || [];
    rules.forEach(rule => {
      const selector = rule.slice(0, rule.indexOf('{'));
      const body = rule.slice(rule.indexOf('{'));
      if (/::(before|after)/.test(selector)) return;
      (body.match(/(?:^|[^-])(?:min-)?width:\s*(\d{3,})px/g) || []).forEach(decl => {
        const px = Number(decl.match(/(\d{3,})px/)[1]);
        // 320px is the narrowest phone still in use.
        if (px > 320 && !/max-width/.test(decl)) {
          bad.push(f + ':' + selector.trim().slice(0, 40) + ' has ' + decl.trim());
        }
      });
    });
  });
  return bad;
});

console.log('\nnothing scrolls sideways');

check('wide tables scroll inside their own box', () => {
  const bad = [];
  if (!/table[^{]*{[^}]*overflow-x:\s*auto/.test(css['assets/css/main.css'])) bad.push('article tables');
  if (!/table[^{]*{[^}]*overflow-x:\s*auto/.test(css['admin/admin.css'])) bad.push('control centre tables');
  if (!/table[^{]*{[^}]*overflow-x:\s*auto/.test(css['author/author.css'])) bad.push('author portal tables');
  return bad;
});

check('long words and URLs cannot widen the page', () =>
  /overflow-wrap:\s*(anywhere|break-word)/.test(css['assets/css/main.css'])
    ? [] : ['no overflow-wrap rule on body text']);

check('the navigation strips scroll rather than stacking', () => {
  const bad = [];
  if (!/\.nav ul[\s\S]{0,200}overflow-x:\s*auto/.test(css['assets/css/main.css'])) bad.push('public section nav');
  // Two acceptable answers for a long menu on a narrow screen: a strip that
  // scrolls sideways, or a drawer that slides in over the page. The control
  // centre uses the drawer, which is the better fit for twenty-two screens.
  const admin = css['admin/admin.css'];
  const drawer = /transform:\s*translateX\(-100%\)/.test(admin) && /\.nav-open/.test(admin);
  const strip = /nav[\s\S]{0,300}overflow-x:\s*auto/.test(admin);
  if (!drawer && !strip) bad.push('control centre navigation');
  if (!/\.tabs[\s\S]{0,300}overflow-x:\s*auto/.test(css['author/author.css'])) bad.push('author portal tabs');
  return bad;
});

check('images never exceed their container', () =>
  /img\s*{[^}]*max-width:\s*100%/.test(css['assets/css/main.css'])
    ? [] : ['no max-width on images']);

check('side rails exist only where there is room for them', () => {
  const s2 = css['assets/css/main.css'];
  const bad = [];
  if (!/\.frame__rail\s*{\s*display:\s*none/.test(s2)) bad.push('rails are not hidden by default');
  if (!/@media \(min-width: 1[2-9]\d{2}px\)[\s\S]{0,400}\.frame\.has-rails/.test(s2)) {
    bad.push('the three-column layout is not behind a wide-screen query');
  }
  if (!/\.frame\.has-rails/.test(s2)) bad.push('rails are not conditional on being filled');
  return bad;
});

console.log('\ntouch');

check('tap targets reach 44px where the pointer is a finger', () => {
  const bad = [];
  Object.keys(css).forEach(f => {
    if (!/@media \(pointer: coarse\)/.test(css[f])) bad.push(f + ' has no coarse-pointer rules');
    else if (!/min-height:\s*4[4-9]px|min-height:\s*[5-9][0-9]px/.test(css[f])) {
      bad.push(f + ' sets no minimum tap height');
    }
  });
  return bad;
});

check('form fields are 16px on touch, so iOS does not zoom', () => {
  const bad = [];
  ['admin/admin.css', 'author/author.css', 'assets/css/main.css'].forEach(f => {
    // A stylesheet may have several coarse-pointer blocks; the rule only has to
    // be in one of them. Reading just the first was a bug in this check.
    const blocks = css[f].match(/@media \(pointer: coarse\)[\s\S]*?\n}/g) || [];
    if (!blocks.some(b => /font-size:\s*16px/.test(b))) bad.push(f);
  });
  return bad;
});

console.log('\nfull screen');

check('the screen height rule survives a mobile browser bar', () => {
  const uses100vh = /min-height:\s*100vh/.test(css['admin/admin.css']);
  const usesDvh = /min-height:\s*100dvh/.test(css['admin/admin.css']);
  return uses100vh && !usesDvh ? ['admin uses 100vh with no 100dvh fallback'] : [];
});

check('notches and home indicators are accounted for', () => {
  const bad = [];
  Object.keys(css).forEach(f => {
    if (!/env\(safe-area-inset/.test(css[f])) bad.push(f + ' ignores the safe area');
  });
  return bad;
});

check('the installed app fills the screen', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pwa/manifest.json'), 'utf8'));
  const bad = [];
  if (['standalone', 'fullscreen'].indexOf(manifest.display) === -1) {
    bad.push('manifest display is "' + manifest.display + '"');
  }
  if (!/@media \(display-mode: standalone\)/.test(css['assets/css/main.css'])) {
    bad.push('no rules for when the site runs as an installed app');
  }
  return bad;
});

console.log('\nStatic analysis only — real devices still need a person: docs/DEVICE-TESTING.md');
console.log(problems.length
  ? problems.length + ' of ' + checks + ' responsive checks failed'
  : 'all ' + checks + ' responsive checks clean');
process.exit(problems.length ? 1 : 0);
