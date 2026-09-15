#!/usr/bin/env python3
# Regenerates docs/FILES.md from the repository. It fails rather than guessing
# if a file has no description, so the list cannot silently fall out of date.
#
#     python3 tools/genfiles.py
import os, json, subprocess

DESC = {
 # ---- what a reader's browser loads ----
 'index.html': ('1', 'The homepage. Renders whatever sections the control centre says, in order.'),
 'article.html': ('1', 'One article. Structure only — the text arrives as JSON.'),
 'category.html': ('1', 'A section or topic listing.'),
 'search.html': ('1', 'Search over the prebuilt index, entirely in the browser.'),
 'issues.html': ('8', 'The list of magazine issues, and one issue read on the web.'),
 'guidelines.html': ('4', 'The public "How we work" page: every published policy.'),
 'about.html': ('1', 'About the publication.'),
 'privacy.html': ('1', 'Privacy policy.'),
 'newsletter.html': ('7', 'Where a confirmation or unsubscribe link lands.'),
 'accept.html': ('2', 'Where an author invitation link lands.'),
 '404.html': ('1', 'Page not found.'),
 'robots.txt': ('1', 'Keeps crawlers out of /admin/ and /author/.'),
 'sitemap.xml': ('1', 'Regenerated on every publication.'),
 'rss/feed.xml': ('1', 'The feed. Only published articles ever enter it.'),
 'assets/css/main.css': ('1', 'The whole stylesheet. Colours come from settings at runtime.'),
 'assets/js/api.js': ('1', 'The single data boundary. Swap this to change database.'),
 'assets/js/site.js': ('1', 'Shared shell: brand, logo, navigation, theme, ad slots.'),
 'assets/js/home.js': ('1', 'Builds the homepage from its section configuration.'),
 'assets/js/article.js': ('1', 'Renders an article: blocks, figures, contents, reader controls.'),
 'assets/js/listing.js': ('1', 'Category and search pages.'),
 'assets/js/guidelines.js': ('4', 'Renders the published policy documents.'),
 'assets/js/ads.js': ('6', 'The advertising fallback chain. Pure, so it can be tested.'),
 'assets/js/newsletter.js': ('7', 'Confirm and unsubscribe, handled on page load.'),
 'assets/js/issues.js': ('8', 'The issue list and the issue reader.'),
 'assets/js/vitals.js': ('9', 'Measures real page loads and reports once, on the way out.'),
 'assets/icons/logo.svg': ('—', 'The masthead logo.'),
 'assets/icons/logo-dark.svg': ('—', 'The masthead logo for dark mode.'),
 'assets/icons/logo-mark.svg': ('—', 'The mark alone: favicon and small spaces.'),
 'assets/icons/icon-192.png': ('1', 'App icon, 192px.'),
 'assets/icons/icon-512.png': ('1', 'App icon, 512px.'),
 'pwa/manifest.json': ('1', 'Makes the site installable on a phone.'),
 'pwa/service-worker.js': ('1', 'Offline shell and caching.'),
 'pwa/build.js': ('9', 'Build number, rewritten on every publish so caches retire.'),

 # ---- the control centre ----
 'admin/index.html': ('1', 'The control centre shell and its navigation.'),
 'admin/admin.css': ('1', 'Control centre styling — deliberately not the reading experience.'),
 'admin/admin.js': ('1', 'Sign in, sessions, users, roles, invitations, audit log.'),
 'admin/config.js': ('1', 'Where you paste your Apps Script address. Not a secret.'),
 'admin/editorial.js': ('3', 'The queue, the article desk, the reviewer desk.'),
 'admin/rulebook.js': ('4', 'Guidelines centre, formats, checklist, writing and image rules.'),
 'admin/siteadmin.js': ('5', 'Navigation, homepage, categories, flags, brand, publishing.'),
 'admin/ads-admin.js': ('6', 'Advertising: approvals, creatives, placements, delivery.'),
 'admin/comms.js': ('7', 'Newsletter, campaign composer, social queue.'),
 'admin/issues-admin.js': ('8', 'The issue composer.'),
 'admin/performance.js': ('9', 'Performance centre and payload budget.'),
 'admin/billing.js': ('10', 'Customers, orders, invoices, payments.'),
 'admin/email.js': ('—', 'Email centre: every message, who sends it, where replies go.'),
 'admin/published.js': ('—', 'What is live, and the supervisor-only corrections to it.'),

 # ---- the author portal ----
 'author/index.html': ('2', 'The author portal shell.'),
 'author/author.css': ('2', 'Portal styling.'),
 'author/author.js': ('2', 'Dashboard, editor, submission, profile, notifications.'),
 'assets/js/accept.js': ('2', 'Turns an invitation into an account.'),

 # ---- the engine ----
 'apps-script/appsscript.json': ('1', 'Apps Script project settings and permissions.'),
 'apps-script/Code.gs': ('1', 'The single entry point and the action router.'),
 'apps-script/Config.gs': ('1', 'Reads secrets from Script Properties. None are in the code.'),
 'apps-script/Bootstrap.gs': ('—', 'Two one-off helpers: see what the script can read, and set the settings from code.'),
 'apps-script/Schema.gs': ('1', 'Every table definition, and setup().'),
 'apps-script/Db.gs': ('1', 'The only file that knows the database is a spreadsheet.'),
 'apps-script/Auth.gs': ('1', 'Passwords, sessions, MFA, lockout.'),
 'apps-script/Permissions.gs': ('1', 'Who may do what. Checked on every call.'),
 'apps-script/Users.gs': ('1', 'User administration, delegation, emergency access.'),
 'apps-script/Roles.gs': ('1', 'Roles and their permissions.'),
 'apps-script/Audit.gs': ('1', 'The append-only record of every sensitive action.'),
 'apps-script/Content.gs': ('1', 'Turns tables into the JSON the public site reads.'),
 'apps-script/Publishing.gs': ('1', 'The only writer to the public repository.'),
 'apps-script/Invitations.gs': ('2', 'Author invitations: invite, resend, revoke, accept.'),
 'apps-script/Authors.gs': ('2', 'Author profiles.'),
 'apps-script/Articles.gs': ('2', 'Drafts, versions, the submission gate.'),
 'apps-script/Media.gs': ('2', 'Figure uploads, with credit and licence required.'),
 'apps-script/Formats.gs': ('2', 'Article formats, fields, checklist, writing and image rules.'),
 'apps-script/Email.gs': ('2', 'Templates, sending and the log of everything sent.'),
 'apps-script/Notifications.gs': ('2', 'In-portal notifications.'),
 'apps-script/Editorial.gs': ('3', 'The editorial state machine.'),
 'apps-script/Reviews.gs': ('3', 'Reviewer assignment and peer review.'),
 'apps-script/Render.gs': ('3', 'Editing shape becomes reading shape here, and only here.'),
 'apps-script/Guidelines.gs': ('4', 'Versioned policy documents through the approval chain.'),
 'apps-script/SiteConfig.gs': ('5', 'Navigation, homepage, categories, flags, settings, versions.'),
 'apps-script/Ads.gs': ('6', 'Advertisers, campaigns, creatives, delivery counting.'),
 'apps-script/Newsletter.gs': ('7', 'Subscription, campaigns, sending, unsubscribe.'),
 'apps-script/Social.gs': ('7', 'Writes social posts; a person sends them.'),
 'apps-script/Issues.gs': ('8', 'Magazine issues and the PDF.'),
 'apps-script/Performance.gs': ('9', 'Field measurements and the payload budget.'),
 'apps-script/Billing.gs': ('10', 'Orders, invoices, payments, credit notes.'),
 'apps-script/Backup.gs': ('10', 'Snapshots, verification and a guarded restore.'),

 # ---- published data (regenerated by the engine) ----
 'data/settings.json': ('1', 'Brand, colours, analytics. Published from the control centre.'),
 'data/menus.json': ('1', 'Navigation.'),
 'data/homepage.json': ('1', 'Homepage sections.'),
 'data/categories.json': ('1', 'Sections and topics.'),
 'data/features.json': ('1', 'Feature switches.'),
 'data/ads.json': ('6', 'Approved advertising.'),
 'data/guidelines.json': ('4', 'Published policies.'),
 'data/search-index.json': ('1', 'The search index.'),
 'data/bootstrap.json': ('9', 'All of the above in one request, for speed.'),
 'data/index/articles.json': ('1', 'The article index.'),
 'data/articles/sodium-ion-hard-carbon-anodes.json': ('1', 'A sample article, replaced by your first publication.'),

 # ---- tests ----
 'tests/harness.js': ('2', 'Runs the engine under Node with Google stubbed out.'),
 'tests/phase2.js': ('2', 'Invitations, ownership, submission gate. 47 checks.'),
 'tests/phase3.js': ('3', 'Review, approval, publication, immutability. 46 checks.'),
 'tests/phase4.js': ('4', 'Guidelines and the rulebook. 33 checks.'),
 'tests/phase5.js': ('5', 'Configuration, versioning, delegation. 41 checks.'),
 'tests/phase6.js': ('6', 'Advertising and the fallback chain. 28 checks.'),
 'tests/phase7.js': ('7', 'Consent, unsubscribe, sending. 31 checks.'),
 'tests/phase8.js': ('8', 'Issues and PDF. 22 checks.'),
 'tests/phase9.js': ('9', 'Performance measurement. 19 checks.'),
 'tests/phase10.js': ('10', 'Billing and backup. 35 checks.'),
 'tests/contract.js': ('—', 'Publishes for real, then renders it with the real frontend. 22 checks.'),

 # ---- project ----
 'README.md': ('—', 'What this is and how to run the tests.'),
 'START-HERE.md': ('—', 'The first page to read. Routes you to the right document.'),
 'tools/audit.js': ('—', 'Release check: dead links, orphaned calls, committed secrets.'),
 'tools/genfiles.py': ('—', 'Regenerates the file list from the repository.'),
 'package.json': ('—', 'Test commands.'),
 '.gitignore': ('—', 'What git ignores.'),
 'docs/INSTALL.md': ('—', 'Step-by-step installation. Start here.'),
 'docs/FILES.md': ('—', 'This list.'),
 'docs/CHECKLIST.md': ('—', 'Tick-list of every installation step, stage by stage.'),
 'docs/RUNBOOK.md': ('—', 'The sequence: 26 numbered steps in order, with what each one produces.'),
 'docs/OVERVIEW.md': ('—', 'Master overview: what the site is, who uses it, how it works.'),
 'tools/smoke.js': ('—', 'Opens every page as a browser would, including its empty states.'),
 'tools/verify.js': ('—', 'One command that runs every check, backend and frontend.'),
 'tools/responsive.js': ('—', 'Twelve layout checks: widths, scrolling, tap targets, safe areas.'),
 'docs/DEVICE-TESTING.md': ('—', 'What was fixed for phones and tablets, and the hour that needs a real device.'),
 'docs/ADSENSE.md': ('—', 'Google AdSense: what is wired, what Google asks for, realistic expectations.'),
 'ads.txt': ('—', 'Who may sell advertising here. Put your publisher id in it.'),
 'docs/ARCHITECTURE.md': ('1', 'How the pieces fit and how to migrate off Sheets.'),
 'docs/SCHEMA.md': ('1', 'The data model.'),
}
for n in range(1, 11):
    DESC[f'docs/PHASE-{n}-STATUS.md'] = (str(n), f'What phase {n} built, what it did not, and the bugs found.')

actual = []
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules')]
    for f in files:
        actual.append(os.path.join(root, f).replace('./', ''))
actual.sort()

missing = [f for f in actual if f not in DESC]
if missing:
    raise SystemExit('NOT DESCRIBED:\n' + '\n'.join(missing))

GROUPS = [
 ('The website readers see', lambda f: f.endswith('.html') and '/' not in f or f in ('robots.txt','sitemap.xml','CNAME') or f.startswith('rss/')),
 ('Styles, scripts and images', lambda f: f.startswith('assets/')),
 ('Installable app (PWA)', lambda f: f.startswith('pwa/')),
 ('Control centre', lambda f: f.startswith('admin/')),
 ('Author portal', lambda f: f.startswith('author/')),
 ('The engine (Google Apps Script)', lambda f: f.startswith('apps-script/')),
 ('Published data (the engine rewrites these)', lambda f: f.startswith('data/')),
 ('Tests', lambda f: f.startswith('tests/')),
 ('Documentation and project files', lambda f: f.startswith('docs/') or f.startswith('tools/') or f in ('README.md','package.json','.gitignore')),
]

out = []
out.append('# Every file in this project\n')
out.append(f'{len(actual)} files. The **Phase** column says which build phase created it; ')
out.append('"—" means it came later, with branding, the contract tests or version control.\n')
out.append('\nYou do not need to understand any of these to run the site. The two that ')
out.append('matter when installing are `admin/config.js` (where your engine address goes) ')
out.append('and everything in `apps-script/` (which you paste into Google).\n')

placed = set()
for title, match in GROUPS:
    rows = [f for f in actual if f not in placed and match(f)]
    placed.update(rows)
    if not rows: continue
    out.append(f'\n## {title}\n\n')
    out.append('| File | Phase | What it is |\n|---|---|---|\n')
    for f in rows:
        phase, desc = DESC[f]
        out.append(f'| `{f}` | {phase} | {desc} |\n')

leftover = [f for f in actual if f not in placed]
if leftover:
    out.append('\n## Other\n\n| File | Phase | What it is |\n|---|---|---|\n')
    for f in leftover:
        phase, desc = DESC[f]
        out.append(f'| `{f}` | {phase} | {desc} |\n')

out.append('\n## Counts\n\n')
out.append(f'- Engine files to paste into Apps Script: **{len([f for f in actual if f.endswith(".gs")])} `.gs` files + `appsscript.json`**\n')
out.append(f'- Pages readers can visit: {len([f for f in actual if f.endswith(".html") and "/" not in f])}\n')
out.append(f'- Control centre screens: 22\n')
out.append(f'- Test files: {len([f for f in actual if f.startswith("tests/")])}, 324 checks in total\n')
out.append(f'- Total files: {len(actual)}\n')

open('docs/FILES.md', 'w').write(''.join(out))
print('FILES.md regenerated:', len(actual), 'files, all described')
