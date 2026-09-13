# Phase 3 status — review, approval, publication

## What works

| Capability | Where |
|---|---|
| Editorial queue, scoped to the sections you actually cover | `Editorial.queue` |
| The full workflow as a transition table, each edge naming its permission | `EDITOR_TRANSITIONS` |
| Reviewer assignment with conflict-of-interest checks | `Reviews.assign` |
| Reviewer desk: read the assigned version, return a reasoned decision | `Reviews.read`, `Reviews.submit` |
| Revision round trip: request, revise, resubmit, re-review | `Editorial.move`, `Articles.submit` |
| Supervisor approval, publication, scheduling, rollback, archive | `Publishing.gs` |
| Rendering: editing fields become reading blocks, figures placed inline | `Render.gs` |
| Incremental publish: article, figures, index, search index, RSS, sitemap | `Publish.commitVersion_` |
| Editorial workspace and reviewer desk in the control centre | `admin/editorial.js` |

Publication is the only thing that writes to the public repository, `commit_` is
the only function that performs a write, and every entry point that reaches it
requires `FINAL_PUBLISH` — which `Permissions.gs` refuses to grant to any role
or user other than the supervisor admin. Three tests attack that from three
directions: an administrator, a senior editor, and a delegated grant.

## Three bugs the tests caught

**1. Version numbers were reused after a rejection.** `startRevision` numbered
the new version `public_version + 1`. With v1 live and v2 rejected, the next
revision was also numbered 2 — overwriting the record of a decision and
confusing `workingVersion_`. It now takes one past the highest number that has
ever existed. A rejected version keeps its number and its history.

**2. Assignment required `status === 'ACTIVE'`.** Invited editors and reviewers
sit at `PASSWORD_RESET_REQUIRED` until they choose a password, so nobody could
be assigned a review until they had logged in — and the failure surfaced as
`not_found`, which is not a clue anybody could act on. There is now one
definition of a usable account, `Auth.isUsable`, and login, session resolution,
assignment and notification all ask it. Only suspension and revocation disable
a person.

**3. `move()` consulted the transition table before checking the caller was
editorial at all.** An author owns their article, so ownership alone let them
probe which transitions exist by reading the error messages. The permission gate
now comes first.

**And one from the phase-2 fix, extended.** Read access and write access are now
separate checks. An assigned reviewer can read the version they were asked to
review; they hold `REVIEW` without `EDIT`, so they cannot save over it, cannot
decide it, and lose the read when the assignment is cancelled.

## Tests

```
node tests/phase2.js      # 47 assertions
node tests/phase3.js      # 47 assertions
```

Phase 3 asserts against the repository rather than the database, because the
repository is what readers get. The harness now stubs the GitHub contents API,
so a test can ask what is actually on the public site at any moment.

The immutability sequence is worth reading in full (`tests/phase3.js`, "immutability
of published content"): it publishes v1, opens v2, rewrites it completely,
submits it, moves it through review, rejects it — and checks the live file is
byte-identical to v1 at every step, the article is still `PUBLISHED`, and the
index still points at version 1. Then it publishes v3, rolls back to v1 with a
reason, and confirms the rejected v2 can never be put on the site at all.

## Known gaps, stated plainly

1. **Scheduled publication needs an hourly trigger**, and it runs as the
   deploying account. The supervisor's approval is the act of authority; the
   trigger only carries out what was already approved, and it cannot approve
   anything. If the trigger is not installed, scheduled articles simply sit.
2. **One reviewer's decision does not bind an editor.** Reviews inform; the
   `VERIFIED` transition is the editor's, and it is possible to verify an
   article every reviewer declined. That is a policy decision, and it is
   auditable, but the system will not stop it.
3. **No double-blind option.** Reviewers see author names, and editors see
   reviewer names. Anonymity would need the payload rendering to strip author
   fields before `Reviews.read` returns them.
4. **Publishing is one commit per file.** Publishing an article with six figures
   is ten or more GitHub API calls, serially. It is well inside rate limits for
   normal volume and would want the git trees API at scale.
5. **`listings_` rebuilds every listing on each publish.** Correct, and O(n) in
   published articles. Past a few thousand articles, paginate the index.
6. **Archive removes an article from the listings but leaves its page.** Links
   do not break. If you need the page gone, that is a deliberate deletion and
   phase 5 should add it with its own audit trail.
7. **No corrections notice.** Republishing a revision changes the live file and
   sets `updated_at`, but readers are not shown what changed. The specification
   asks for a corrections policy page; the mechanism to match it is not built.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()` again**. It adds the `SearchDocs`
   sheet and three columns to `Reviews`. Existing data is untouched.
2. Add an hourly time trigger for `publishScheduled`.
3. The `GITHUB_TOKEN` now does real work. Publishing fails loudly and changes
   nothing if it is wrong, but check it before the first publication.
4. Reviewers are invited as staff (Users → Invite, role `REVIEWER`), not through
   the author invitation centre. Authors and reviewers are different things.

## Phase 4 begins with

The Guidelines Centre: `Guidelines`, `ArticleFormats`, `FormatFields` and
`SubmissionChecklist` are already the live source of the editor's behaviour, so
phase 4 is about editing them from the control centre and versioning them
through the same private → preview → approve → public path that articles use.
The publishing primitive it needs already exists.
