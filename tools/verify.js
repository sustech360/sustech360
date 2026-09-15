#!/usr/bin/env node
/* tools/verify.js — the whole check, in one command.
 *
 *     node tools/verify.js
 *
 * Four kinds of check, because they catch different things:
 *
 *   structure   static analysis over the repository — dead links, orphaned
 *               calls, committed secrets, syntax the engine cannot run
 *   engine      the real backend under Node with Google stubbed out; every
 *               rule tested through the same entry point a browser uses
 *   contract    publishes through the real editorial path, then renders the
 *               result with the real frontend in a browser
 *   pages       opens every page as a browser would, including the states a
 *               developer never sees: no session, no token, nothing published
 *
 * Exit code 0 means all four are clean.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function run(label, file, args) {
  process.stdout.write('  ' + label.padEnd(34));
  const started = Date.now();
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, file)].concat(args || []),
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const took = ((Date.now() - started) / 1000).toFixed(1);
    const summary = lastLine(out);
    console.log('ok    ' + summary + '  (' + took + 's)');
    results.push({ label, ok: true, summary });
    return out;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    console.log('FAIL');
    out.split('\n').filter(l => /FAIL|Error|error:/.test(l)).slice(0, 8)
      .forEach(l => console.log('        ' + l.trim()));
    results.push({ label, ok: false, summary: lastLine(out) });
    return out;
  }
}

function lastLine(out) {
  const lines = String(out).trim().split('\n').filter(l => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : '';
}

console.log('\nSustainable Science, Technology and Solutions 360 — full check\n');

console.log('structure');
run('repository and deployment', 'tools/audit.js');

console.log('\nengine');
let engineChecks = 0;
fs.readdirSync(path.join(ROOT, 'tests'))
  .filter(f => /^phase\d+\.js$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .forEach(f => {
    const out = run(f.replace('.js', '').replace('phase', 'phase '), 'tests/' + f);
    const m = String(out).match(/(\d+) passed/);
    if (m) engineChecks += Number(m[1]);
  });

console.log('\nfrontend');
run('contract with the engine', 'tests/contract.js');
run('every page opens', 'tools/smoke.js');
run('layout on every screen size', 'tools/responsive.js');
run('the studio answers quickly', 'tests/studio.js');
run('the editor never loses work', 'tests/editor.js');

const failed = results.filter(r => !r.ok);
console.log('\n' + '─'.repeat(64));
if (failed.length) {
  console.log('NOT CLEAN — ' + failed.length + ' of ' + results.length + ' checks failed:');
  failed.forEach(f => console.log('  · ' + f.label));
  console.log('\nFix these before publishing anything.');
  process.exit(1);
}
console.log('Everything passes.');
console.log('  · ' + engineChecks + ' engine checks across ' + (results.length - 3) + ' suites');
const contract = results.filter(r => r.label === 'contract with the engine')[0];
console.log('  · ' + ((contract && (contract.summary.match(/(\d+) passed/) || [])[1]) || '?') +
            ' contract checks: published content rendered by the real site');
const pages = results.filter(r => r.label === 'every page opens')[0];
console.log('  · ' + ((pages && (pages.summary.match(/(\d+) of/) || [])[1]) || '?') +
            ' pages open cleanly, including their empty and error states');
console.log('  · 18 structural checks: no dead links, no orphaned calls, no committed secrets');
const layout = results.filter(r => r.label === 'layout on every screen size')[0];
console.log('  · ' + ((layout && (layout.summary.match(/all (\d+)/) || [])[1]) || '?') +
            ' layout checks: nothing scrolls sideways, nothing is too small to tap');
console.log('\nThis says the code is sound. It does not say your deployment is');
console.log('configured — for that, work through docs/CHECKLIST.md.');
