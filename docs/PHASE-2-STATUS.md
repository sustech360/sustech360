# Phase 2 status — author system

## What works

| Capability | Where |
|---|---|
| Author Invitation Centre: invite, resend, revoke, extend, history | `Invitations.gs`, control centre → Invitations |
| Invitation email with a secure, expiring, single-use link | `Email.gs` templates, `accept.html` |
| Acceptance flow that provisions an AUTHOR account and profile | `Invitations.accept` |
| Author portal: dashboard, drafts, editor, profile, notifications, guidelines | `author/` |
| Format-driven editor — fields come from `ArticleFormats` + `FormatFields` | `Formats.gs`, `author.js` |
| Autosave, live word count against the format's limits | `Articles.save` |
| Media upload to private Drive with mandatory credit and licence | `Media.gs` |
| Submission gate: required fields, word count, checklist, image rights | `Articles.validate_` |
| Withdraw, and revision-as-new-version on published articles | `Articles.withdraw`, `Articles.startRevision` |

There is still no way for the public to become an author. `acceptInvitation` is
the only code path that creates an AUTHOR account, and it requires a token this
platform generated and emailed.

## A real bug the tests caught

`Articles.mustOwn_` treated the `EDIT` permission as an editorial override:

```js
if (!this.isOwner_(session, a) && !Perms.has(session.user, 'EDIT', a.category))
```

Every author holds `EDIT` — that is what lets them edit their own drafts — so
the override matched for all of them. Any author could open, edit, submit and
attach media to any other author's draft by article id. That breaks invariant 5
and requirement 12 of the specification.

Editorial access is now defined as holding `REVIEW`, `APPROVE` or `MANAGE` in
the article's section, which no author has. Four tests cover it, and the denial
is audited as `ARTICLE_ACCESS_DENIED` with the section in scope.

The lesson generalises: a permission that a role needs for its *own* objects can
never also serve as the override for *other people's* objects.

## Tests

```
node tests/phase2.js      # 47 assertions, all passing
```

`tests/harness.js` runs the real `.gs` files under Node with Sheets, Drive,
Mail, Cache and Utilities stubbed in memory, and every test goes through
`doPost` — the same entry point the browser uses. A rule enforced only in the
portal's JavaScript fails these tests by construction.

Covered: seeds, bootstrap, login and lockout behaviour, the full invitation
lifecycle (wrong token, expiry, revocation, single use, throttled guessing,
what the unauthenticated view is allowed to return), author permission limits,
draft creation, Drive payloads, all four submission gates, version locking,
withdrawal, cross-author isolation across five actions, media type and rights
checks, session revocation on suspension, and the phase 1 supervisor
invariants.

## Known gaps, stated plainly

1. **Invitation throttling is per invitation id, per hour, in the script cache.**
   It stops guessing at one invitation. It does not stop a wide sweep across
   many ids, and Apps Script's cache can evict early under memory pressure.
2. **No Drive quota accounting.** A determined author can upload many 4 MB
   images. Add a per-article and per-author cap when volume justifies it.
3. **`expireInvitations` needs a daily time trigger.** Correctness does not
   depend on it — `lookup` checks the date on every attempt — but the
   Invitations list will show stale `PENDING` rows without it.
4. **Co-authors are stored but not invited.** `co_authors` accepts user ids;
   there is no flow yet for inviting a co-author to an existing draft.
5. **Autosave is last-write-wins.** Two tabs editing one draft will overwrite
   each other. Version numbers are per revision, not per save.
6. **The portal is unusable without JavaScript**, like the control centre. That
   is acceptable for an authenticated tool and not for public pages.

## Setup delta since phase 1

1. Re-upload the `apps-script/` folder and **run `setup()` again**. It is
   idempotent: it adds the `Media` and `Notifications` sheets, seeds the ten
   article formats with their field sets, the submission checklist, and the
   word-count settings. Existing rows are untouched.
2. Add a time-driven trigger for `expireInvitations`, daily.
3. Nothing changes in `admin/config.js`. The portal and the acceptance page read
   the same endpoint from it.
4. Invitation emails link to `SITE_URL + accept.html`, so `SITE_URL` must end in
   a slash and match where the site is actually served.

## Phase 3 begins with

Reviewer assignment and the review workflow: `Reviews` is already defined, and
`Versions` already carries the status each review acts on. Then the editorial
decision states, then the supervisor approval step that finally calls
`Publish.commit_` with rendered article HTML and JSON — at which point the
`data/` files stop being seed data and start being output.

The author-side edges are already locked down, so phase 3 adds editor-side
transitions without reopening what phase 2 closed.
