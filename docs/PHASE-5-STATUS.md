# Phase 5 status — control centre

## What works

| Capability | Where |
|---|---|
| Navigation editing: add, pause, nest two levels, footer menu | `SiteConfig.saveMenu` |
| Homepage sections: type, source, count, layout, order, schedule | `SiteConfig.saveSection` |
| Categories: add, retire, parent — retiring is blocked if articles are live | `SiteConfig.saveCategory` |
| Feature flags: on, off, scheduled; locked flags refuse to move | `SiteConfig.setFlag` |
| Brand, palette, theme, GA4 and AdSense identifiers | `SiteConfig.saveSettings` |
| Preview: which configuration files would change, before publishing | `SiteConfig.preview` |
| Every publication snapshotted, with rollback and adopt | `SiteConfig.rollback`, `adopt` |
| Delegation list, revoke, and capped emergency access | `Users.listGrants`, `emergencyAccess` |
| Nine control centre screens for all of it | `admin/siteadmin.js` |

Editing configuration changes the database. Readers keep seeing the last
published configuration until a supervisor admin publishes — the same
private-until-approved property articles and guidelines have, and it falls out
of the static architecture rather than needing bookkeeping.

Rollback and adopt are deliberately separate. Rollback changes the live site
only, leaving whatever has been edited since intact in the database; adopt
resets the working copy to match a published version. Putting the site back and
throwing away a week of unpublished work are different decisions, and the
control centre asks which one you mean.

## Two security bugs the tests caught

**1. A scoped grant satisfied every unscoped check.** `Perms.has` read a missing
scope as "any scope will do":

```js
p.permission === permission && (p.scope === '*' || !scope || p.scope === scope)
```

Most checks in the control centre pass no scope — `Perms.require(session,
'MANAGE')` asks a platform-wide question. So delegating `MANAGE` scoped to one
section handed that person the whole control centre: site configuration, user
administration, the rulebook. The correct reading is that an unscoped check is
platform-wide and only a `*` permission answers it. This was live from phase 1;
role permissions are all `*`, so nothing had exposed it until delegation with a
real scope was tested.

**2. `data/settings.json` was publishing the internal Settings sheet.** The
Settings table doubles as internal storage — phase 3 stores each rendered
article document there so listings can be rebuilt without re-reading Drive, and
submissions store the author's checklist answers. `Content.settings()` published
every row. That put a second copy of every published article, and every author's
declarations, into a file the homepage downloads on first visit. Public settings
are now filtered by scope, and two tests assert that internal rows stay out.

The same principle applied to the other files: disabled menu items and inactive
homepage sections were being published too. The public configuration now
describes the site as it is, not as it is being planned.

**And one boundary.** A grant revoked "now" still read as active, because both
the permission check and the listing used `now <= expires_at`. An expiry is when
access ends. Both now use `<`.

## Tests

```
node tests/phase2.js   # 47     node tests/phase4.js   # 33
node tests/phase3.js   # 46     node tests/phase5.js   # 40
```

166 assertions, all passing. Phase 5 adds the ones that matter most for a
configuration system: that editing does not leak to the site, that what does
reach the site is validated (a `javascript:` menu URL, a palette token carrying
`url()`, a homepage section pointing at a category that does not exist, a GA4 id
of the wrong shape), and that a publish which would leave the site with no
navigation is refused outright.

## A note on process

While removing a superseded view from `admin.js` I cut too wide and deleted the
author invitations screen with it. The check that caught it — comparing every
`data-view` button against the registered views — is worth keeping as a habit,
and the phase 4 package is what the screen was restored from. Shipping each
phase as a zip turns out to be a cheap substitute for version control, but only
a substitute: this repository should be in git.

## Known gaps, stated plainly

1. **No drag to reorder.** The `reorder` endpoint exists and is tested through
   the API, but the screens set order numerically. It is a UI gap, not a
   capability gap.
2. **Adopt retires rather than deletes.** Items created after the adopted
   version are set to disabled or inactive, not removed, so the tables
   accumulate. That is the right trade for safety and the wrong one for tidiness
   after a few years.
3. **Configuration snapshots live in Drive** and are read back through one file
   per version. Fine at this size; it would want compaction past a few hundred
   publications.
4. **No per-section scoping in the UI.** The backend supports a section editor
   scoped to one category, and `Perms.has` now enforces it properly, but the
   delegation screen offers a free-text scope rather than a category picker.
5. **The audit screen still has no filters.** It lists the most recent 150
   entries. With configuration changes now flowing through it, filtering by
   action and date is overdue — and export is specified but not built.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()`** — it adds the `ConfigVersions`
   sheet. Existing data is untouched.
2. **Publish the configuration once** after upgrading. The published files now
   exclude internal settings, so the first publish after this change will shrink
   `data/settings.json` noticeably. That is the fix landing, not data loss.
3. No new triggers or script properties.

## Phase 6 begins with

Advertising: placements, campaigns, creatives and the fallback chain. The public
side already exists — `site.js` walks a fallback chain and collapses a slot it
cannot fill, and `AdPlacements`, `AdCreatives`, `Advertisers` and `Campaigns`
are already in the schema. What is missing is the control centre over them, the
scheduling, and the delivery counting.
