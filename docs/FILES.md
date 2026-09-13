# Every file in this project
132 files. The **Phase** column says which build phase created it; "—" means it came later, with branding, the contract tests or version control.

You do not need to understand any of these to run the site. The two that matter when installing are `admin/config.js` (where your engine address goes) and everything in `apps-script/` (which you paste into Google).

## The website readers see

| File | Phase | What it is |
|---|---|---|
| `404.html` | 1 | Page not found. |
| `CNAME` | — | Tells GitHub Pages the site is sustech360.com. |
| `about.html` | 1 | About the publication. |
| `accept.html` | 2 | Where an author invitation link lands. |
| `article.html` | 1 | One article. Structure only — the text arrives as JSON. |
| `category.html` | 1 | A section or topic listing. |
| `guidelines.html` | 4 | The public "How we work" page: every published policy. |
| `index.html` | 1 | The homepage. Renders whatever sections the control centre says, in order. |
| `issues.html` | 8 | The list of magazine issues, and one issue read on the web. |
| `newsletter.html` | 7 | Where a confirmation or unsubscribe link lands. |
| `privacy.html` | 1 | Privacy policy. |
| `robots.txt` | 1 | Keeps crawlers out of /admin/ and /author/. |
| `rss/feed.xml` | 1 | The feed. Only published articles ever enter it. |
| `search.html` | 1 | Search over the prebuilt index, entirely in the browser. |
| `sitemap.xml` | 1 | Regenerated on every publication. |

## Styles, scripts and images

| File | Phase | What it is |
|---|---|---|
| `assets/css/main.css` | 1 | The whole stylesheet. Colours come from settings at runtime. |
| `assets/icons/icon-192.png` | 1 | App icon, 192px. |
| `assets/icons/icon-512.png` | 1 | App icon, 512px. |
| `assets/icons/logo-dark.svg` | — | The masthead logo for dark mode. |
| `assets/icons/logo-mark.svg` | — | The mark alone: favicon and small spaces. |
| `assets/icons/logo.svg` | — | The masthead logo. |
| `assets/js/accept.js` | 2 | Turns an invitation into an account. |
| `assets/js/ads.js` | 6 | The advertising fallback chain. Pure, so it can be tested. |
| `assets/js/api.js` | 1 | The single data boundary. Swap this to change database. |
| `assets/js/article.js` | 1 | Renders an article: blocks, figures, contents, reader controls. |
| `assets/js/guidelines.js` | 4 | Renders the published policy documents. |
| `assets/js/home.js` | 1 | Builds the homepage from its section configuration. |
| `assets/js/issues.js` | 8 | The issue list and the issue reader. |
| `assets/js/listing.js` | 1 | Category and search pages. |
| `assets/js/newsletter.js` | 7 | Confirm and unsubscribe, handled on page load. |
| `assets/js/site.js` | 1 | Shared shell: brand, logo, navigation, theme, ad slots. |
| `assets/js/vitals.js` | 9 | Measures real page loads and reports once, on the way out. |

## Installable app (PWA)

| File | Phase | What it is |
|---|---|---|
| `pwa/build.js` | 9 | Build number, rewritten on every publish so caches retire. |
| `pwa/manifest.json` | 1 | Makes the site installable on a phone. |
| `pwa/service-worker.js` | 1 | Offline shell and caching. |

## Control centre

| File | Phase | What it is |
|---|---|---|
| `admin/admin.css` | 1 | Control centre styling — deliberately not the reading experience. |
| `admin/admin.js` | 1 | Sign in, sessions, users, roles, invitations, audit log. |
| `admin/ads-admin.js` | 6 | Advertising: approvals, creatives, placements, delivery. |
| `admin/billing.js` | 10 | Customers, orders, invoices, payments. |
| `admin/comms.js` | 7 | Newsletter, campaign composer, social queue. |
| `admin/config.js` | 1 | Where you paste your Apps Script address. Not a secret. |
| `admin/editorial.js` | 3 | The queue, the article desk, the reviewer desk. |
| `admin/index.html` | 1 | The control centre shell and its navigation. |
| `admin/issues-admin.js` | 8 | The issue composer. |
| `admin/performance.js` | 9 | Performance centre and payload budget. |
| `admin/rulebook.js` | 4 | Guidelines centre, formats, checklist, writing and image rules. |
| `admin/siteadmin.js` | 5 | Navigation, homepage, categories, flags, brand, publishing. |

## Author portal

| File | Phase | What it is |
|---|---|---|
| `author/author.css` | 2 | Portal styling. |
| `author/author.js` | 2 | Dashboard, editor, submission, profile, notifications. |
| `author/index.html` | 2 | The author portal shell. |

## The engine (Google Apps Script)

| File | Phase | What it is |
|---|---|---|
| `apps-script/Ads.gs` | 6 | Advertisers, campaigns, creatives, delivery counting. |
| `apps-script/Articles.gs` | 2 | Drafts, versions, the submission gate. |
| `apps-script/Audit.gs` | 1 | The append-only record of every sensitive action. |
| `apps-script/Auth.gs` | 1 | Passwords, sessions, MFA, lockout. |
| `apps-script/Authors.gs` | 2 | Author profiles. |
| `apps-script/Backup.gs` | 10 | Snapshots, verification and a guarded restore. |
| `apps-script/Billing.gs` | 10 | Orders, invoices, payments, credit notes. |
| `apps-script/Code.gs` | 1 | The single entry point and the action router. |
| `apps-script/Config.gs` | 1 | Reads secrets from Script Properties. None are in the code. |
| `apps-script/Content.gs` | 1 | Turns tables into the JSON the public site reads. |
| `apps-script/Db.gs` | 1 | The only file that knows the database is a spreadsheet. |
| `apps-script/Editorial.gs` | 3 | The editorial state machine. |
| `apps-script/Email.gs` | 2 | Templates, sending and the log of everything sent. |
| `apps-script/Formats.gs` | 2 | Article formats, fields, checklist, writing and image rules. |
| `apps-script/Guidelines.gs` | 4 | Versioned policy documents through the approval chain. |
| `apps-script/Invitations.gs` | 2 | Author invitations: invite, resend, revoke, accept. |
| `apps-script/Issues.gs` | 8 | Magazine issues and the PDF. |
| `apps-script/Media.gs` | 2 | Figure uploads, with credit and licence required. |
| `apps-script/Newsletter.gs` | 7 | Subscription, campaigns, sending, unsubscribe. |
| `apps-script/Notifications.gs` | 2 | In-portal notifications. |
| `apps-script/Performance.gs` | 9 | Field measurements and the payload budget. |
| `apps-script/Permissions.gs` | 1 | Who may do what. Checked on every call. |
| `apps-script/Publishing.gs` | 1 | The only writer to the public repository. |
| `apps-script/Render.gs` | 3 | Editing shape becomes reading shape here, and only here. |
| `apps-script/Reviews.gs` | 3 | Reviewer assignment and peer review. |
| `apps-script/Roles.gs` | 1 | Roles and their permissions. |
| `apps-script/Schema.gs` | 1 | Every table definition, and setup(). |
| `apps-script/SiteConfig.gs` | 5 | Navigation, homepage, categories, flags, settings, versions. |
| `apps-script/Social.gs` | 7 | Writes social posts; a person sends them. |
| `apps-script/Users.gs` | 1 | User administration, delegation, emergency access. |
| `apps-script/appsscript.json` | 1 | Apps Script project settings and permissions. |

## Published data (the engine rewrites these)

| File | Phase | What it is |
|---|---|---|
| `data/ads.json` | 6 | Approved advertising. |
| `data/articles/sodium-ion-hard-carbon-anodes.json` | 1 | A sample article, replaced by your first publication. |
| `data/bootstrap.json` | 9 | All of the above in one request, for speed. |
| `data/categories.json` | 1 | Sections and topics. |
| `data/features.json` | 1 | Feature switches. |
| `data/guidelines.json` | 4 | Published policies. |
| `data/homepage.json` | 1 | Homepage sections. |
| `data/index/articles.json` | 1 | The article index. |
| `data/menus.json` | 1 | Navigation. |
| `data/search-index.json` | 1 | The search index. |
| `data/settings.json` | 1 | Brand, colours, analytics. Published from the control centre. |

## Tests

| File | Phase | What it is |
|---|---|---|
| `tests/contract.js` | — | Publishes for real, then renders it with the real frontend. 22 checks. |
| `tests/harness.js` | 2 | Runs the engine under Node with Google stubbed out. |
| `tests/phase10.js` | 10 | Billing and backup. 35 checks. |
| `tests/phase2.js` | 2 | Invitations, ownership, submission gate. 47 checks. |
| `tests/phase3.js` | 3 | Review, approval, publication, immutability. 46 checks. |
| `tests/phase4.js` | 4 | Guidelines and the rulebook. 33 checks. |
| `tests/phase5.js` | 5 | Configuration, versioning, delegation. 41 checks. |
| `tests/phase6.js` | 6 | Advertising and the fallback chain. 28 checks. |
| `tests/phase7.js` | 7 | Consent, unsubscribe, sending. 31 checks. |
| `tests/phase8.js` | 8 | Issues and PDF. 22 checks. |
| `tests/phase9.js` | 9 | Performance measurement. 19 checks. |

## Documentation and project files

| File | Phase | What it is |
|---|---|---|
| `.gitignore` | — | What git ignores. |
| `README.md` | — | What this is and how to run the tests. |
| `docs/ADSENSE.md` | — | Google AdSense: what is wired, what Google asks for, realistic expectations. |
| `docs/ARCHITECTURE.md` | 1 | How the pieces fit and how to migrate off Sheets. |
| `docs/CHECKLIST.md` | — | Tick-list of every installation step, stage by stage. |
| `docs/DEVICE-TESTING.md` | — | What was fixed for phones and tablets, and the hour that needs a real device. |
| `docs/FILES.md` | — | This list. |
| `docs/INSTALL.md` | — | Step-by-step installation. Start here. |
| `docs/OVERVIEW.md` | — | Master overview: what the site is, who uses it, how it works. |
| `docs/PHASE-1-STATUS.md` | 1 | What phase 1 built, what it did not, and the bugs found. |
| `docs/PHASE-10-STATUS.md` | 10 | What phase 10 built, what it did not, and the bugs found. |
| `docs/PHASE-2-STATUS.md` | 2 | What phase 2 built, what it did not, and the bugs found. |
| `docs/PHASE-3-STATUS.md` | 3 | What phase 3 built, what it did not, and the bugs found. |
| `docs/PHASE-4-STATUS.md` | 4 | What phase 4 built, what it did not, and the bugs found. |
| `docs/PHASE-5-STATUS.md` | 5 | What phase 5 built, what it did not, and the bugs found. |
| `docs/PHASE-6-STATUS.md` | 6 | What phase 6 built, what it did not, and the bugs found. |
| `docs/PHASE-7-STATUS.md` | 7 | What phase 7 built, what it did not, and the bugs found. |
| `docs/PHASE-8-STATUS.md` | 8 | What phase 8 built, what it did not, and the bugs found. |
| `docs/PHASE-9-STATUS.md` | 9 | What phase 9 built, what it did not, and the bugs found. |
| `docs/RUNBOOK.md` | — | The sequence: 26 numbered steps in order, with what each one produces. |
| `docs/SCHEMA.md` | 1 | The data model. |
| `package.json` | — | Test commands. |
| `tools/audit.js` | — | Release check: dead links, orphaned calls, committed secrets. |
| `tools/genfiles.py` | — | Regenerates the file list from the repository. |
| `tools/responsive.js` | — | Twelve layout checks: widths, scrolling, tap targets, safe areas. |
| `tools/smoke.js` | — | Opens every page as a browser would, including its empty states. |
| `tools/verify.js` | — | One command that runs every check, backend and frontend. |

## Other

| File | Phase | What it is |
|---|---|---|
| `START-HERE.md` | — | The first page to read. Routes you to the right document. |
| `ads.txt` | — | Who may sell advertising here. Put your publisher id in it. |

## Counts

- Engine files to paste into Apps Script: **30 `.gs` files + `appsscript.json`**
- Pages readers can visit: 11
- Control centre screens: 22
- Test files: 11, 324 checks in total
- Total files: 132
