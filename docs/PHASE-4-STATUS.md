# Phase 4 status — guidelines and the editorial rulebook

## What works

| Capability | Where |
|---|---|
| Eight guideline documents, each independently versioned | `GUIDELINE_KINDS` |
| The specified chain: draft → preview → verified → approved → published | `GUIDELINE_TRANSITIONS` |
| Supervisor-only publication, previous version archived not deleted | `Guidelines.publish` |
| Any archived or discarded version reopens as a new draft | `Guidelines.restore` |
| Major and minor version numbering | `Guidelines.nextVersion_` |
| Article formats, fields, word limits editable from the control centre | `Formats.saveFormat`, `saveField` |
| Submission checklist editable, items retire rather than vanish | `Formats.saveChecklistItem` |
| Writing rules: title length, summary length, citation style | `Formats.saveRules` → `Articles.validate_` |
| Image rules: accepted types, size, caption/credit/licence | `Formats.saveRules` → `Media.upload` |
| Public "How we work" page, author portal showing the live text and the limits | `guidelines.html`, `author.js` |

## The line this phase draws

Not everything configurable goes through the approval chain, and the split is
deliberate.

A **guideline document** is published content. Authors and readers rely on it,
so it is versioned, approved by the supervisor admin, and never changed under
anyone: editing opens a new version, and the live text stays live until its
replacement is published. The test suite proves the live file does not move
while a replacement is drafted, previewed, verified and approved.

A **format definition or checklist item** is a private tool the editorial team
uses. It takes effect immediately, because an editor fixing a confusing field
label should not need a publication cycle. What it must be is auditable and
non-destructive, and it is both: every change writes an audit row, and nothing
is ever deleted — fields and checklist items deactivate, keeping whatever was
written in them.

The consequence is the useful part: the rulebook is not decoration. Nine tests
change a rule and then prove the change bites — a new required field blocks the
next submission, retiring it releases the block and keeps the author's text, a
new checklist item must be ticked, a shorter title limit is enforced at the
gate, and a narrowed image type list rejects the next upload.

## Two bugs the tests caught

**Guideline gates demanded MANAGE.** `move()` and `get()` both required MANAGE
before anything else. A senior editor holds APPROVE without MANAGE — verifying a
guideline is exactly their job — so they could neither read the draft nor verify
it. Both now gate on REVIEW and let the edge's own permission decide, which is
the same shape `Editorial.move` already used.

**The writing rules were enforced retroactively on a fixture.** Not a bug in the
code: the new 20-word summary minimum failed a phase 3 test whose summary was
sixteen words. The fixture was wrong, the rule was right, and the fixture
changed. Worth recording because the opposite reflex — relaxing a rule to make a
test pass — is how enforcement quietly dies.

## Tests

```
node tests/phase2.js      # 47 assertions
node tests/phase3.js      # 46 assertions
node tests/phase4.js      # 33 assertions
```

126 in total, all passing, all through `doPost`.

## Known gaps, stated plainly

1. **No diff between guideline versions.** You can read v1.1 and v1.0 but the
   interface will not show you what changed. For a policy document that matters,
   and it is the obvious next addition.
2. **One open version per kind at a time.** Simple and predictable; it does mean
   two people cannot draft competing rewrites of the same policy.
3. **Format changes are not versioned.** By the argument above, that is the
   intent, but it means "which field set was this article written against"
   cannot be reconstructed from the format tables — only from the submitted
   payload, which does preserve whatever was written.
4. **`min_pixels` is advisory.** Apps Script cannot measure image dimensions
   without a third-party call, so the portal checks it in the browser and the
   server does not. Everything else in the media rules is enforced server-side.
5. **The public guidelines page is one long document per policy.** Fine for
   seven short documents; it would want per-policy URLs before it becomes twenty.
6. **Guideline bodies are plain text with a simple heading convention** (a short
   first line in a paragraph becomes a heading). No markdown, no tables. That is
   a constraint worth removing in phase 8 when the PDF renderer needs structure
   anyway.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()`** — it adds a `status` column to
   `FormatFields` and three columns to `Guidelines`. Existing rows keep working;
   a field with an empty status is treated as active.
2. Nothing else changes. No new triggers, no new properties.
3. `data/guidelines.json` ships seeded with the default author guidelines so the
   public page works before your first publication. Publishing any guideline
   overwrites it.

## Phase 5 begins with

The rest of the control centre: menus, homepage sections, categories, feature
flags and settings are all already read from the database by `Content.gs` and
already published by `Publish.configuration` — phase 5 is the editing interface
over them, plus the delegation and emergency-access screens for the permission
model that has been running since phase 1.
