# Sustainable Science, Technology and Solutions 360

**Start with [`docs/OVERVIEW.md`](docs/OVERVIEW.md)** for what this is and how it
works, and [`docs/CHECKLIST.md`](docs/CHECKLIST.md) to install it.

Check everything with one command:

```
node tools/verify.js
```

---

## The platform — all ten phases

A static, CDN-served public site with a permissioned Google Apps Script backend.
The public site never talks to Google Sheets. It reads JSON files that the
publishing engine writes into this repository.

```
Supervisor Admin → Control Centre → Apps Script API → Sheets + Drive
                                          ↓
                                  Publishing engine
                                          ↓
                          static JSON + HTML in this repo
                                          ↓
                            GitHub Pages / CDN → readers
```

## What is in this phase

| Area | Status |
|---|---|
| Public shell: home, article, category, search, 404 | working, data-driven |
| Configurable navigation, homepage sections, brand tokens, feature flags | working |
| Client search over a prebuilt index | working |
| PWA offline shell | working |
| Data abstraction layer (`assets/js/api.js`) | working |
| Apps Script API: auth, sessions, MFA, users, roles, delegation, audit | working |
| Supervisor-admin invariants enforced server-side | working |
| Configuration publishing to GitHub | working |
| Author invitations: invite, resend, revoke, extend | working |
| Acceptance flow — the only way an AUTHOR account is created | working |
| Author portal, format-driven editor, autosave, media uploads | working |
| Submission gate: fields, word count, checklist, image rights | working |
| Editorial queue, workflow transitions, reviewer assignment | working |
| Peer review, revision round trip, supervisor approval | working |
| Publishing engine: article, figures, index, search, RSS, sitemap | working |
| Scheduling, rollback to any approved version, archive | working |
| Guidelines centre: versioned policy through the approval chain | working |
| Formats, fields, checklist, writing and image rules — all enforced | working |
| Public "How we work" page | working |
| Control centre: navigation, homepage, categories, flags, brand | working |
| Configuration preview, versioning, rollback and adopt | working |
| Delegated and emergency access, with expiry enforced at check time | working |
| Advertising: placements, campaigns, creative approval, fallback chain | working |
| Delivery counting (indicative, not billable — see PHASE-6-STATUS) | working |
| Newsletter: double opt-in, campaign composer, one-click unsubscribe | working |
| Social queue: drafts written at publication, posted by a human | working |
| Magazine issues: composer, web edition, PDF, reader controls | working |
| Performance: field measurement, payload budget, one-request bootstrap | working |
| Billing: orders, invoices, payments, credit notes | working |
| Backup, verification and guarded restore | working |
| Membership, jobs, events, directory, payments | deliberately not built — see PHASE-10-STATUS |

## Setup

### 1. Spreadsheet and Apps Script

1. Create two spreadsheets: one for **beta**, one for **production**. Never share one.
2. Create an Apps Script project for each. Upload everything in `apps-script/`.
3. In each project set Script properties:

```
ENV=beta|production
SPREADSHEET_ID=...
DRIVE_FOLDER_ID=...
PASSWORD_PEPPER=<64 random characters, unique per environment>
TOKEN_PEPPER=<64 random characters, unique per environment>
SITE_URL=https://<user>.github.io/magazine/
GITHUB_REPO=<owner>/<repo>
GITHUB_TOKEN=<fine-grained PAT, contents:write on that repo only>
BOOTSTRAP_EMAIL=<your email>
```

4. Run `setup()` once. It creates every sheet with headers, seeds roles and
   permissions, and emails a one-time supervisor password. Change it at first
   sign-in — the account is locked to a password change until you do.
5. Deploy as a web app: execute as **you**, access **anyone**. Copy the `/exec` URL.

### 2. Site

1. Push this folder to a repository and turn on GitHub Pages.
2. Put the `/exec` URL in `admin/config.js`. It is an endpoint, not a secret.
   The public pages load it too, for the ad and performance beacons.
3. Open `/admin/` and sign in.

### 3. Run the tests

```
npm test                          # every phase suite
npm install --no-save jsdom       # the contract suite needs a DOM
npm run test:contract             # backend publishes, frontend renders it

node tests/phase2.js
node tests/phase3.js
node tests/phase4.js
node tests/phase5.js
node tests/phase6.js
node tests/phase7.js
node tests/phase8.js
node tests/phase9.js
node tests/phase10.js
```

322 assertions against the real backend with Google's services — including the
GitHub contents API — stubbed. Run both after any change to `apps-script/`. The contract suite is the one that catches
a backend and a frontend that have quietly stopped agreeing — run it before any
release.

This directory is a git repository with the whole platform in its first commit.
Add your remote and push:

```
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

While you are in the editor, add five time triggers: `expireInvitations` daily,
`dailyBackup` daily, `publishScheduled` hourly, `refreshAdSchedule` hourly, and
`sendQueuedEmail` every ten minutes.

Then take a backup, verify it, and practise a restore into the beta environment.
A restore you have never performed is a procedure you do not have.

### 4. Verify before trusting it

Run the checks in `docs/PHASE-1-STATUS.md` under "Tests to run", and read the phase status notes in `docs/`. They exercise
the security invariants directly, which is the only way to know they hold.

## Rules this codebase will keep

- No secret ever enters this repository. Peppers and tokens live in Script properties.
- No frontend check is a security control. The backend re-authorises everything.
- Public reads never hit Apps Script. If a page needs the API to render, it is wrong.
- Nothing is hard-coded that the spec calls configurable: menus, homepage
  sections, categories, feature flags, roles, appearance tokens.
- Deletes are soft. `Db.softDelete` stamps `deleted_at`; rows stay.
- Performance is measured from real visits, not asserted from the architecture.
- Money is held in whole minor units, and an issued invoice is never edited.
- Publication is a commit, never a flag. `Publish.commit_` is the only writer to
  the public repository, and only `FINAL_PUBLISH` reaches it.
- A permission with a scope covers that scope only. An unscoped check is a
  platform-wide question and only a `*` permission answers it.
- A rule that is displayed is a rule that is enforced.
- A magazine issue collects what is already published; it never publishes
  anything itself, and it does not change after it ships.
- Nobody is emailed who did not confirm, and every unsubscribe link works
  without an account, a session, or a second page. Word limits, checklists
  and image rights are checked server-side at the submission gate, not only in
  the portal.
