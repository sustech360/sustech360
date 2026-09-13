# Architecture

## The one rule that shapes everything

The public site is static. A reader's browser fetches HTML, CSS, a few kilobytes
of JavaScript, and JSON files — all from a CDN. It never calls Apps Script, and
Apps Script never renders a public page. Sheets quotas, Apps Script cold starts
and Google outages therefore cannot slow down or take down the magazine.

Everything editorial and administrative happens on the other side of that line.

## Layers

| Layer | Where | Responsibility |
|---|---|---|
| Presentation | `index.html`, `article.html`, `category.html`, `search.html` | Structure only. No content, no config. |
| Data access | `assets/js/api.js` | The only place a URL is constructed. Named methods, swappable adapters. |
| Rendering | `site.js`, `home.js`, `article.js`, `listing.js` | Turn data into DOM. Page-specific files load only where used. |
| Published data | `data/**.json` | Written by the publishing engine. The public contract. |
| API | `apps-script/Code.gs` | One POST endpoint, action router, error shaping. |
| Domain | `Users.gs`, `Roles.gs`, `Content.gs`, `Publish.gs` | Business rules and invariants. |
| Authorisation | `Permissions.gs`, `Auth.gs` | Sessions, permissions, supervisor invariants. |
| Storage | `Db.gs` | The only module that knows the database is a spreadsheet. |

## Migrating off Google Sheets

Two files change, and nothing else:

1. `Db.gs` — reimplement `find/findOne/insert/update/softDelete` against
   Firestore, Supabase or SQL. Callers use plain objects and never touch a cell.
2. `api.js` — add an adapter alongside `StaticSource` if reads move to an API.
   Pages call `MAG.public.getArticle(slug)`, not a URL.

`SCHEMA` in `Schema.gs` is already a table definition, not a sheet layout, so it
translates directly into a relational schema.

## Immutable publication

Published content is a committed file, not a row with a flag. A revision lives
in `Versions` as a private working version. Approval commits it over the public
file; git keeps the previous one. Rejecting a revision touches nothing public,
so requirement 11 (public content survives a rejected revision) holds by
construction rather than by careful coding.

## Caching

| Level | Holds | Invalidated by |
|---|---|---|
| Browser + service worker | Shell, last-read articles | `CACHE` version bump on deploy |
| GitHub Pages / CDN | Everything static | A commit from the publishing engine |
| Apps Script `Db` request cache | Sheet reads within one request | End of request (`Db.flush`) |

Article JSON is fetched network-first so a correction is never masked by a
stale cache; the shell is cache-first so the app opens instantly offline.

## Request flow, admin action

```
Browser → POST /exec  { action, token, payload }   (text/plain: no CORS preflight)
  Code.gs      parse, size limit, unknown action?
  Auth.session resolve token hash → user, check expiry, revocation, epoch, status
  Handler      Perms.require(...)  ← the actual authorisation
  Db           read/write sheet
  Audit.log    append record
  ← { ok: true, data } | { ok: false, error }
```
