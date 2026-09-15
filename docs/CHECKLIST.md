# Installation checklist — Sustainable Science, Technology and Solutions 360

Print this, or keep it open beside `INSTALL.md`. If you want the steps numbered
end to end with their dependencies spelled out, read `RUNBOOK.md` first. Tick each line as you finish it.
`INSTALL.md` has the detail; this is the map, so you always know where you are
and what is left.

**Total time: about two hours**, plus a wait for the domain. You can stop after
Stage 3 and come back — the site is already live at a GitHub address by then.

---

## Stage 1 — Google: the storage (15 minutes)

- [ ] 1.1 Create a new Google Sheet, name it `SusTech360 — production`
- [ ] 1.2 Copy its **spreadsheet ID** from the address bar (the long code between `/d/` and `/edit`)
- [ ] 1.3 Create a Drive folder called `SusTech360 media`
- [ ] 1.4 Copy the **folder ID** from its address bar

**You should have:** two long codes written down.

---

## Stage 2 — Google: the engine (45 minutes)

- [ ] 2.1 Create an Apps Script project, name it `SusTech360 engine`
- [ ] 2.2 Turn on **Show "appsscript.json"** in project settings
- [ ] 2.3 Paste in all **31 `.gs` files** plus `appsscript.json` — the list is in `FILES.md`
- [ ] 2.4 Add the script properties in **⚙ Project Settings → Script Properties** — then **press Save script properties**
- [ ] 2.4b Run **`checkSetup`** — every required line must say `OK` before you go on
- [ ] 2.5 Run `setup()` and approve the permissions Google asks for
- [ ] 2.6 Check your inbox for the temporary supervisor password — **keep it**
- [ ] 2.7 Add the **5 time triggers** (`publishScheduled`, `sendQueuedEmail`, `refreshAdSchedule`, `expireInvitations`, `dailyBackup`)
- [ ] 2.8 Deploy as a **web app**: execute as *me*, access *anyone*
- [ ] 2.9 Copy the **`/exec` address** — you need it twice in Stage 3

**You should have:** an email with a password, and the `/exec` address.

> If `setup()` fails with "Missing script property", run `checkSetup` — it names
> every missing or misspelled one at once. Nine times in ten the cause is the
> **Save script properties** button, which is easy to miss.

---

## Stage 3 — GitHub: the website (30 minutes)

- [ ] 3.1 Paste the `/exec` address into `admin/config.js`, replacing `PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE`
- [ ] 3.2 Create a free GitHub account if you do not have one
- [ ] 3.3 Create a **public** repository
- [ ] 3.4 Upload every file and folder from this package
- [ ] 3.5 Settings → Pages → Deploy from branch `main`, folder `/ (root)` → Save
- [ ] 3.6 Wait two minutes, open the address in the green box — `https://sustech360.github.io/sustech360/`
- [ ] 3.6b If that box shows your domain instead, a custom domain is already set. Clear it in Settings → Pages to view the site now; you add it back at 5.1
- [ ] 3.7 Open `/admin/`, sign in with the temporary password
- [ ] 3.8 **Change the password immediately** (Account → Change password)

**You should have:** a working website and a control centre you can sign into.

---

## Stage 4 — The publishing key (10 minutes)

- [ ] 4.1 GitHub → Settings → Developer settings → **Fine-grained token**
- [ ] 4.2 Give it access to **only this repository**, permission **Contents: Read and write**
- [ ] 4.3 Copy the token — it is shown **once**
- [ ] 4.4 Paste it into the Apps Script property `GITHUB_TOKEN`
- [ ] 4.5 Control Centre → Publish → **Publish configuration**
- [ ] 4.6 Check the repository: new files appeared under `data/`

**You should have:** publishing that works. Nothing else in the platform works without this.

> Write the token's expiry date in your calendar now. Publishing stops the day it expires.

---

## Stage 5 — Your domain (30 minutes, then a wait)

- [ ] 5.1 GitHub → Settings → Pages → Custom domain → `sustech360.com` → Save
- [ ] 5.2 Cloudflare → DNS → add **four A records** for `@` to the GitHub addresses
- [ ] 5.3 Cloudflare → DNS → add a **CNAME** for `www` to `yourname.github.io`
- [ ] 5.4 Set every one of those records to **DNS only (grey cloud)**
- [ ] 5.5 Cloudflare → SSL/TLS → set to **Full** — never *Flexible*
- [ ] 5.6 Wait, then visit `http://sustech360.com`
- [ ] 5.7 GitHub → Pages → tick **Enforce HTTPS** once it becomes available
- [ ] 5.8 Confirm `SITE_URL` is `https://sustech360.com/` **with the trailing slash**
- [ ] 5.9 Publish configuration again

**You should have:** `https://sustech360.com` loading your site.

> The two ways this goes wrong: the orange cloud (blocks the certificate) and
> Flexible SSL (endless redirect loop). Both are in 5.4 and 5.5.
>
> If GitHub says **"DNS check unsuccessful"** or **NotServedByPagesError**, the
> orange cloud is on. Grey every record, then clear and re-enter the custom
> domain in GitHub to force a fresh check. Full steps: `INSTALL.md` 5.3b.

---

## Stage 6 — Before you invite anyone (30 minutes)

- [ ] 6.1 Turn on two-factor authentication for the supervisor account
- [ ] 6.2 Control Centre → **create a backup**, then **verify** it
- [ ] 6.3 **Practise a restore** into a second, test environment
- [ ] 6.4 Brand → check name, tagline, logo and colours → Publish
- [ ] 6.5 Guidelines → write and publish your author guidelines
- [ ] 6.6 Users → invite your editors
- [ ] 6.7 Authors → invite your first author
- [ ] 6.8 Advertising stays off until you have readers — see `docs/ADSENSE.md`

**You should have:** a platform you could hand to someone else.

> 6.3 is the one people skip. A restore you have never performed is not a
> procedure you have.

---

## Stage 7 — One article, all the way through (45 minutes)

Do this yourself before anyone else touches it. It is the only way to know the
whole chain works.

- [ ] 7.1 Invite yourself as an author using a second email address
- [ ] 7.2 Accept the invitation, set a password
- [ ] 7.3 Write a short article in the author portal, upload one figure
- [ ] 7.4 Submit it — the checklist must be ticked
- [ ] 7.5 As an editor: take it on, assign a reviewer, mark it verified
- [ ] 7.6 As supervisor: approve, then publish
- [ ] 7.7 Check the article on the live site, on a phone — then work through `docs/DEVICE-TESTING.md`
- [ ] 7.8 Check the RSS feed and the search box find it

**You should have:** proof, rather than hope.

---

## Keeping it running

| How often | What |
|---|---|
| Every day | Nothing. The triggers do the work. |
| After changing settings | Publish configuration, or readers keep seeing the old version |
| Monthly | Open the Performance screen; check the audit log for anything odd |
| Quarterly | Verify a backup and practise a restore again |
| Yearly | Renew the GitHub token **before** it expires |

---

## If you get stuck

1. **Control Centre → Audit log.** Every action, who did it, when. Start here.
2. **`INSTALL.md` → "When something goes wrong."** The common failures and what each means.
3. **For whoever helps you with code:** `node tools/audit.js` and `npm test` in the project folder. Eighteen structural checks and 324 tests; if those are clean, the problem is configuration rather than code.
