# Sustainable Science, Technology and Solutions 360 — master overview

**sustech360.com** · A digital magazine and editorial platform for energy,
materials, sustainability and the research behind them.

This document is the map. It says what the website is, who uses which part of
it, how a piece of writing travels from an invitation to a published article,
and which decisions are already made so nobody has to make them again under
pressure.

---

## 1. What this is

A **magazine** that readers browse, search, subscribe to and read offline, and
an **editorial platform** behind it where invited authors write, editors review
and one supervisor account decides what goes live.

It is not a blog with extra buttons. The difference shows in three places:

- **Nobody can publish except the supervisor admin.** Not an editor, not an
  administrator, not a delegated account, not by any route in the code.
- **Published work is never edited in place.** A correction creates a new
  version that walks the same approval path; until it is approved, readers see
  the version they always saw.
- **Everything configurable is configured, not coded.** Navigation, homepage
  layout, article formats, the submission checklist, word limits, image rules,
  policies, advertising, feature switches — all edited in a control centre by
  someone who does not write code.

---

## 2. How it is built, and why

```
   Readers  →  GitHub Pages         static files on a global network
                    ↑
             publishing engine      writes those files when something is approved
                    ↑
   Staff  →  Control Centre  →  Google Apps Script  →  Sheets + Drive
```

**The public site never calls the backend.** Readers fetch HTML, a small amount
of JavaScript, and JSON files — nothing else. Google being slow, Apps Script
hitting a quota, or the spreadsheet being open in someone's browser cannot make
the magazine slow or take it down.

**Publishing is a commit, not a flag.** When the supervisor approves an article,
the engine writes real files into the site repository. That single decision is
what makes published content immutable: the live file changes only when an
approved version is committed over it, and the previous version stays in the
repository's history.

**One file knows it is a spreadsheet.** `Db.gs` is the whole database layer.
When Sheets becomes the limit — somewhere north of a few thousand articles —
that one file is rewritten against a real database and nothing above it
notices.

**Running costs today: nothing.** GitHub Pages, Apps Script, Sheets and Drive
are all free at this size. The paid ceiling is Gmail's daily send limit, which
matters first for the newsletter.

---

## 3. Who uses what

| Person | Where they work | What they can do |
|---|---|---|
| **Reader** | sustech360.com | Read, search, save, subscribe, install as an app, read offline |
| **Author** | `/author/` | Write drafts in the format they were invited for, upload figures, submit, revise. Cannot publish, cannot see anyone else's draft |
| **Reviewer** | `/admin/` → Your reviews | Read only the article they were assigned, return a reasoned decision. Cannot edit anything |
| **Section editor** | `/admin/` → Queue | Take on submissions in their sections, assign reviewers, request revisions |
| **Senior editor** | `/admin/` | The above, plus accept reviews, decline articles, prepare for publication |
| **Administrator** | `/admin/` | Users, configuration, advertising, billing. **Cannot publish** |
| **Supervisor admin** | `/admin/` | Everything, and the only account that makes anything public |

Roles are editable, and a permission can be delegated to one person, for one
section, until a date — after which it stops working by itself. The one
permission that can never be delegated, granted or added to a role is
`FINAL_PUBLISH`.

---

## 4. How an article reaches a reader

```
invitation → author accepts → draft → submitted → editor takes it on
   → reviewers → revisions → verified → ready → SUPERVISOR APPROVES → published
```

Some details that are easy to miss and hard to add later:

- **Authors arrive only by invitation.** There is no public sign-up, and the
  feature switch for one is locked off in the code, not just turned off.
- **The submission gate is real.** Required sections, word limits, the
  checklist, and a credit and licence for every figure — all checked on the
  server, so a clever browser cannot skip them.
- **A reviewer sees the article, not the others' reviews**, and loses access
  when the assignment is cancelled.
- **Rejecting a revision changes nothing publicly.** The live version stays
  live. This is tested by rewriting an article completely, pushing it through
  review, rejecting it, and asserting the public file is byte-identical.
- **Any approved version can be put back** on the site by the supervisor, with
  a reason, in one click.

---

## 5. What the website does for readers

| | |
|---|---|
| **Reading** | Clean article pages, contents list, reading time, reading-level label, adjustable text size, light/sepia/dark, print-friendly |
| **Finding** | Instant search over a prebuilt index, sections and topics, related articles, RSS |
| **Keeping** | Save articles, install the site as an app, read what they have read before while offline |
| **Following** | Weekly newsletter with a one-click unsubscribe that works from any old email |
| **Issues** | Collected editions with an editorial, a cover and a PDF |
| **Trust** | Published policies with version numbers and dates, visible corrections through versioning, clearly labelled sponsorship |

---

## 6. What the platform does for you

**Editorial** — queue, review workflow, revision rounds, article formats you
define, submission checklist you write, writing and image rules that are
enforced rather than suggested, versioned policy documents.

**Publication** — approve, publish, schedule, roll back, archive. Every
publication regenerates the article page, the index, the search index, RSS and
the sitemap, and nothing else.

**The site itself** — navigation, homepage sections, categories, brand, logo,
colours, feature switches. Edited privately; live when you publish; every
published configuration is a version you can put back.

**Commercial** — advertisers, campaigns, creatives that someone other than the
uploader must approve, a fallback chain that collapses a slot it cannot fill,
and invoices with sequential numbering that are never edited after issue.

**Operational** — an audit log of every sensitive action, daily backups you can
verify and restore, performance measured from real visits, and a payload budget
that tells you when the archive has grown enough to need attention.

---

## 7. What it deliberately does not do

Saying this plainly is part of the design.

- **No card payments.** Invoices are raised and payments recorded; money moves
  by bank transfer or UPI. Taking card details through this stack would be a bad
  idea and is not attempted.
- **No automatic social posting.** The platform writes the post; a person sends
  it. No social credentials are stored anywhere.
- **No membership, jobs board, events or company directory.** Each needs its own
  build. The advice is to earn the audience first.
- **No copy protection.** Download and print controls exist and are honest
  deterrence; nothing in a browser stops a screenshot.
- **No advertiser self-service portal.** Advertisers get an emailed invoice.
- **Delivery figures are indicative, not billable.** Counting happens in the
  reader's browser, so ad blockers and cached pages are uncounted. Do not
  invoice from them.

---

## 8. The rules the code will not let you break

Twelve invariants, each enforced on the server and each covered by tests that
try to violate it:

1. No author publishes directly.
2. No editor bypasses the supervisor's final publication.
3. No delegated administrator creates or promotes a supervisor admin.
4. Published content cannot be edited in place.
5. Private drafts never appear publicly — they have no file to appear in.
6. The spreadsheet is never exposed as the public database.
7. No secret is ever in the website repository.
8. Every sensitive action is auditable.
9. Temporary permissions expire by themselves.
10. Beta and production data are separate.
11. Public content survives a rejected revision.
12. The backend never trusts the frontend's checks.

---

## 9. Proof, rather than assurance

```
node tools/verify.js
```

One command, four kinds of check:

| | What it proves |
|---|---|
| **18 structural checks** | No dead links, no orphaned calls, no committed secrets, nothing the engine cannot run |
| **302 engine checks** | Every rule above, tested through the same entry point a browser uses |
| **22 contract checks** | Content published through the real editorial path, rendered by the real website |
| **18 pages** | Every page opens, including with no session, no token and nothing published |
| **12 layout checks** | Nothing scrolls sideways, nothing is too small to tap, the screen is used fully |

The tests are adversarial on purpose. They have caught, among others: an
ownership check that let any author open any other author's draft; a scoped
permission that became a global one; a copy of every article leaking into a file
the homepage downloads; an unsubscribe link that could never have worked; and a
lock that could have hung invoice numbering. Each is written up in
`docs/PHASE-*-STATUS.md` with what it was and why it happened.

---

## 10. Where everything is

| I want to… | Go to |
|---|---|
| Install it | `docs/CHECKLIST.md`, then `docs/INSTALL.md` |
| Know what a file is | `docs/FILES.md` — all 123, with the phase that made each |
| Understand the architecture | `docs/ARCHITECTURE.md` |
| Understand the data | `docs/SCHEMA.md` |
| Know what a phase built and what it left | `docs/PHASE-1-STATUS.md` … `PHASE-10-STATUS.md` |
| Check everything still works | `node tools/verify.js` |
| Test on phones and tablets | `docs/DEVICE-TESTING.md` |
| Turn on Google advertising | `docs/ADSENSE.md` |

---

## 11. If you do only three things

1. **Work through `docs/CHECKLIST.md` in order.** It is seven stages and about
   two hours.
2. **Practise a restore before you invite anyone** (stage 6.3). A restore you
   have never performed is not a procedure you have.
3. **Put the GitHub token's expiry date in your calendar.** Publishing stops on
   that day, and the error will not say why.
