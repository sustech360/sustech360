# Phase 1 status

## Security invariants: where each one is enforced

| # | Invariant | Enforced | Where |
|---|---|---|---|
| 1 | No author publishes directly | yes | `Perms.require(s,'FINAL_PUBLISH')`; publishing is a supervisor-only commit |
| 2 | No editor bypasses final publication | yes | `SUPERVISOR_ONLY` list; `Roles.setPermissions` refuses FINAL_PUBLISH |
| 3 | No delegated admin creates or promotes a supervisor | yes | `Users.assertRoleAssignable_`, `Users.setRole` |
| 4 | Published content is not directly editable | partly | publication is a git commit; article versioning lands in phase 3 |
| 5 | Private drafts never appear publicly | yes | unpublished content has no static file at all |
| 6 | Sheets never exposed as the public database | yes | public pages fetch only `data/*.json`; `doGet` returns a health check |
| 7 | No secrets in GitHub | yes | Script properties only; `admin/config.js` holds an endpoint URL, not a credential |
| 8 | Every sensitive action auditable | yes | `Audit.log` in each mutating handler, plus denial events |
| 9 | Temporary permissions expire | yes | `Perms.effective` filters by window on every check |
| 10 | Beta and production separated | yes, by configuration | separate script, spreadsheet, peppers; `ENV` reported by the API |
| 11 | Public content survives a rejected revision | yes, by design | the live file only changes on approval |
| 12 | Backend does not trust frontend checks | yes | `admin.js` renders; `Perms.require` decides |

The supervisor admin also cannot be suspended (`Users.suspend`), cannot have
their role changed by anyone else (`Users.setRole`), and cannot change their own
role — so there is no path to a self-inflicted lockout or a silent escalation.

## Known limitations, stated plainly

1. **Password hashing.** Apps Script has no PBKDF2, bcrypt or scrypt. `Auth.gs`
   uses a 4,000-round salted SHA-256 chain with a server-side pepper. That
   resists a leaked-spreadsheet attack far better than a plain hash, but it is
   weaker than a real KDF. Enable MFA on the supervisor account, and move to a
   proper KDF when the backend migrates off Apps Script.
2. **Randomness.** No CSPRNG is exposed. Tokens are two v4 UUIDs plus a
   timestamp, hashed. Adequate; not equivalent to 32 crypto-random bytes.
3. **No IP capture.** Apps Script does not give the caller's address, so audit
   entries carry no IP. Fill this in if the API ever moves behind a proxy.
4. **Rate limiting is per account, not per source.** Five failures locks the
   account for fifteen minutes. It does not stop distributed spraying across
   many accounts.
5. **Sheet-level concurrency.** `Db` takes a script lock for writes. Under heavy
   simultaneous editing this serialises; it is correct, not fast. It is a reason
   to migrate, not a reason to avoid launching.
6. **Copy protection.** Not attempted, and it should not be. Deterrence and
   clear licensing only, as the specification itself concludes.

## Performance notes

- Public pages ship roughly 9 KB of JavaScript before compression and no
  framework, no web fonts and no blocking third-party script.
- Analytics and ads load asynchronously, after content, and an ad slot that
  cannot be filled collapses to zero height rather than reserving blank space.
- The largest risk to LCP is article images; the block renderer already sets
  `loading="lazy"` and `decoding="async"`, and the figure placeholder holds an
  aspect ratio so nothing shifts.
- `article.js` renders from a single JSON fetch. Preloading `data/settings.json`
  and `data/homepage.json` in the homepage head removes one round trip.

## Tests to run before trusting phase 1

**Security**
1. Sign in as an author, call `setUserRole` directly from the console with
   `role_id: 'SUPERVISOR_ADMIN'`. Expect `forbidden`, plus a
   `SUPERVISOR_PROMOTION_BLOCKED` audit row.
2. As an administrator, try `setRolePermissions` with `FINAL_PUBLISH`. Expect
   `forbidden`.
3. Grant a permission with an expiry two minutes out. Confirm it works, then
   fails after expiry, with no cleanup step.
4. Call `publishConfiguration` with a non-supervisor token. Expect `forbidden`.
5. Suspend a user mid-session; their next call must return `unauthenticated`.
6. Use "sign out all devices", then replay an old token. Expect rejection.
7. Request `data/articles/<any-unpublished-slug>.json`. Expect 404.

**Publishing**
8. Change a menu item to `PAUSED`, publish configuration, reload the site. The
   item disappears; nothing else changes.
9. Break `GITHUB_TOKEN` deliberately: publishing must fail loudly and leave the
   live site untouched.

**Frontend**
10. Load the homepage with the network throttled to slow 3G; check FCP and that
    nothing shifts as sections arrive.
11. Turn off JavaScript. The page should degrade to an empty shell, not an
    error — and this is the argument for prerendering article HTML in phase 3.
12. Install the PWA, go offline, open a previously read article.

## Phase 2 begins with

Author invitations (`AuthorInvitations` is already defined): create, resend,
revoke, extend, and a token-based acceptance page that provisions an AUTHOR
account. Then the author portal and the draft editor, writing into `Versions`
with bodies in Drive.

Nothing in phase 2 requires changing what is here. That is the test of whether
phase 1 was built correctly.
