# The sequence — every step, in the order it has to happen

`INSTALL.md` tells you what to click. **This tells you what order to click it
in, and why nothing works if you go out of order.**

Twenty-six steps. Each one says what to do, what you should see, and what it
gives you that a later step needs. Work down the page. Do not skip ahead: eight
of these steps produce something a later step cannot start without.

---

## Before step 1 — what to have ready

| You need | Why | Have it? |
|---|---|---|
| A Google account | Holds the spreadsheet, the engine and the media | |
| A GitHub account (free) | Holds the website | |
| Your Cloudflare login | sustech360.com is registered there | |
| This folder of files, unzipped | Everything you will upload | |
| A notes file, open | You will collect eleven values as you go | |
| 2 hours | Steps 1–20. The domain then needs a wait | |

**The eleven values you collect.** Write each one down the moment you get it.
Hunting for them later is the slowest part of this whole process.

| # | Value | From step |
|---|---|---|
| 1 | Spreadsheet ID | 2 |
| 2 | Drive folder ID | 3 |
| 3 | Password pepper (you invent it) | 6 |
| 4 | Token pepper (you invent it) | 6 |
| 5 | Site URL | 6 |
| 6 | Repository name | 12 |
| 7 | Supervisor temporary password | 8 |
| 8 | Engine `/exec` address | 11 |
| 9 | GitHub publishing token | 17 |
| 10 | Your new supervisor password | 16 |
| 11 | Token expiry date | 17 |

---

# Stage 1 · Storage — steps 1 to 3

Nothing else can be configured until these exist.

**1. Create the spreadsheet.**
Google Sheets → blank → name it `SusTech360 — production`.
*You should see:* an empty sheet. Leave it empty — the engine builds the tables.

**2. Copy the spreadsheet ID.**
From the address bar, the long code between `/d/` and `/edit`.
→ **Value 1.** Step 6 cannot be completed without it.

**3. Create the Drive folder and copy its ID.**
Drive → New folder → `SusTech360 media`. Open it; the ID is the code after
`/folders/`.
→ **Value 2.** Figures, PDFs and backups go here.

---

# Stage 2 · The engine — steps 4 to 11

This is the longest stretch. Finish it in one sitting if you can.

**4. Create the Apps Script project.**
script.google.com → **New project** → rename it `SusTech360 engine`.

**5. Turn on the settings file.**
⚙ Project Settings → tick **Show "appsscript.json" manifest file**.
*If you skip this,* step 7 has nowhere to put the permissions file and the
engine will ask for the wrong access.

**6. Add the script properties.**
⚙ **Project Settings** (the gear in the left sidebar) → scroll to **Script
Properties** → **Add script property** → then **press "Save script
properties"**.

Six are required now: `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `PASSWORD_PEPPER`,
`TOKEN_PEPPER`, `SITE_URL`, `BOOTSTRAP_EMAIL`. Add `ENV` too. `GITHUB_REPO` and
`GITHUB_TOKEN` arrive at step 17.

*You should see:* the rows still there after the page reloads.

> **The Save button is where installations fail.** Rows typed but not saved do
> not exist, and the screen looks the same either way. Names are case-sensitive:
> `spreadsheet_id` is not `SPREADSHEET_ID`, and the engine sees only the second.

**6b. Run `checkSetup` before anything else.**
Function dropdown → **`checkSetup`** → **Run** → read the log.
*You should see:* `OK` against every required property, then "Ready. Run setup()
next", and confirmation that your spreadsheet and folder actually open.
*It changes nothing.* It exists so a wrong id or an unsaved row is caught here
rather than halfway through setup.

**7. Paste in the 31 engine files.**
One file at a time: **+ → Script**, name it exactly as in `docs/FILES.md`
(without `.gs` — Apps Script adds it), paste, save. Then `appsscript.json`.
*You should see:* 32 files in the left-hand list.
*This is the tedious part.* Take a break after it rather than during it.

**8. Run `setup()`.**
Choose `setup` from the function dropdown → **Run** → **Review permissions** →
choose your account → **Advanced** → **Go to … (unsafe)** → **Allow**.
*You should see:* "Execution completed", and your spreadsheet fills with about
forty tabs.
*Check your email* for the supervisor password → **Value 7**.

> **If this fails,** it is almost always a mistyped property name in step 6.
> They are case-sensitive. Fix and run again — `setup()` is safe to repeat.

**9. Verify the tables.**
Open the spreadsheet. Tabs named `Users`, `Articles`, `Versions`, `AuditLogs`
and others should exist, with a bold header row.
*If they do not,* step 8 did not really succeed. Do not continue.

**10. Add the five automatic jobs.**
⏰ Triggers → Add trigger, five times:

| Function | When |
|---|---|
| `publishScheduled` | Hourly |
| `sendQueuedEmail` | Every 10 minutes |
| `refreshAdSchedule` | Hourly |
| `expireInvitations` | Daily |
| `dailyBackup` | Daily |

*Skip these and:* scheduled articles never publish, a newsletter stalls after
the first batch, and you have no backups.

**11. Deploy the engine.**
Deploy → New deployment → gear → **Web app** → Execute as **Me**, access
**Anyone** → Deploy.
→ **Value 8:** the address ending `/exec`.
*Nothing on the website works before this step.*

---

# Stage 3 · The website — steps 12 to 16

**12. Create the GitHub repository.**
New → **Public** → name it (`sustech360` is fine) → Create.
→ **Value 6.**

**13. Put the engine address into the files.**
On your computer, open `admin/config.js` in a plain text editor. Replace
`PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE` with value 8, keeping the quotes. Save.
*This is the only file you ever edit by hand.*

**14. Upload everything.**
In the repository: **Add file → Upload files** → drag in the whole contents of
the folder (the files, not the folder itself) → Commit.
*You should see:* about 131 files, including `index.html` at the top level.

**15. Turn the website on.**
Settings → Pages → Source **Deploy from a branch** → `main` → `/ (root)` → Save.
Wait two minutes.
*You should see:* a green box with your address —
`https://sustech360.github.io/sustech360/` for a repository named `sustech360` —
and, on opening it, the site with its logo, navigation and sample article.
*If the box shows your domain instead,* a custom domain is already set; clear it
in Settings → Pages to look at the site now, and put it back at step 20.

**16. Sign in and change the password.**
Go to `/admin/` → sign in with your email and value 7 → **Account → Change
password** → set a real one → **Value 10**.
*Do this now.* A temporary password sitting in an inbox is the weakest thing on
the platform.

---

# Stage 4 · Publishing — steps 17 to 19

Until this stage, the control centre can edit but cannot publish anything.

**17. Create the publishing token.**
GitHub → your picture → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token.
- Repository access: **Only select repositories** → yours
- Permissions → Repository → **Contents: Read and write**
- Expiry: a year is sensible
→ **Value 9** (shown once — copy it now) and **Value 11**, the expiry date,
straight into your calendar.

**18. Give the token to the engine.**
Apps Script → Project Settings → Script Properties → `GITHUB_TOKEN` → paste.
*No deployment needed;* properties take effect immediately.

**19. Test publishing.**
Control Centre → **Publish** → **Publish configuration**.
*If it fails:* Apps Script → function dropdown → **`checkPublishing`** → Run.
*You should see:* new files appearing in the repository under `data/`, within a
minute.
*If it fails,* the token is wrong, expired, or lacks Contents: write. Nothing
else in the platform works until this does.

---

# Stage 5 · The domain — steps 20 to 23

You can pause here for a day. Everything already works at the github.io address.

**20. Tell GitHub the domain.**
Settings → Pages → Custom domain → `sustech360.com` → Save.
*You should see:* GitHub creates a `CNAME` file in your repository. It writes
that file itself — you never edit it, and deleting it breaks the domain.

**21. Point the domain at GitHub.**
Cloudflare → sustech360.com → DNS:
- Four **A** records, name `@`, to `185.199.108.153`, `185.199.109.153`,
  `185.199.110.153`, `185.199.111.153`
- One **CNAME**, name `www`, to `yourname.github.io`
- **Every one of them on grey cloud — DNS only.**

> **The orange cloud is the mistake to avoid.** With Cloudflare proxying, GitHub
> cannot issue your certificate, and the site sits on an error for days while
> nothing in the setup looks wrong.

**22. Set the encryption mode before anything else.**
Cloudflare → SSL/TLS → **Full**.
*Never Flexible.* Flexible with GitHub Pages produces an endless redirect loop.

**23. Wait, then switch on HTTPS.**
Check `http://sustech360.com` every so often. When it loads, go back to GitHub →
Settings → Pages and tick **Enforce HTTPS** once it stops being greyed out.
Usually under an hour; sometimes 24.

**Then:** Apps Script properties → confirm `SITE_URL` is
`https://sustech360.com/` **with the trailing slash** → Control Centre →
**Publish configuration** again.

---

# Stage 6 · Before anyone else — steps 24 to 26

**24. Protect the account and prove the backups.**
Two-factor on the Google account. Then Control Centre → Backups → **Create**,
then **Verify**, then practise a **restore** into a second test environment.
*A restore you have never performed is not a procedure you have.*

**25. Set up the publication.**
Brand → name, tagline, logo, colours. Guidelines → write and publish your author
guidelines. Then **Publish configuration**.

**26. Walk one article all the way through, yourself.**
Invite yourself as an author with a second email → accept → write something
short → submit → review it as the editor → approve and publish as supervisor →
open it on your phone.
*This is the only way to know the whole chain works.* Then work through
`docs/DEVICE-TESTING.md`.

**Now** invite your editors and authors.

---

# Why this order

Eight dependencies, and they are the whole reason the sequence is what it is:

```
  spreadsheet + folder (2,3)
        ↓  their IDs are properties
  properties (6) → setup() (8) → tables + supervisor password
        ↓
  deploy (11) → /exec address
        ↓  goes into config.js
  config.js (13) → upload (14) → Pages on (15) → you can sign in (16)
        ↓
  token (17) → into properties (18) → publishing works (19)
        ↓  the engine can now write files
  domain (20–23) → SITE_URL correct → publish again
        ↓
  backups proved (24) → content (25) → one article end to end (26)
```

Read it as: **nothing can publish before step 19, and nothing can be signed into
before step 11.** Everything else is preparation for those two.

---

# Where people actually get stuck

| Step | What happens | What it is |
|---|---|---|
| 6 | Properties vanish after reload | "Save script properties" was never pressed |
| 8 | `setup()` throws "Missing script property" | A property missing, unsaved, or typed in the wrong case. Run `checkSetup` — it lists every one at once |
| 15 | Page loads but is empty | `admin/config.js` still has the placeholder address |
| 16 | "The backend did not respond" | The `/exec` address is wrong, or the deployment was never made |
| 19 | Publishing fails | Run `checkPublishing` — it names the broken link. If the repository is owned by an organisation, fine-grained tokens must be allowed by that organisation first, and everything returns 404 until they are |
| 21 | GitHub: "DNS check unsuccessful" / NotServedByPagesError | The orange cloud is on. Grey it, then re-save the domain in GitHub. `INSTALL.md` 5.3b |
| 23 | Domain never gets HTTPS | The DNS check has not passed, so no certificate can be issued |
| Later | A change does nothing | Configuration changed but never published — see `INSTALL.md` Part 8 |

---

# After installation — deploying changes

Four kinds of change, four different actions. Full detail in **`INSTALL.md`
Part 8**; the short version:

| You changed | What to do | Address changes? |
|---|---|---|
| A setting, menu, page, policy | Control Centre → Publish configuration | no |
| A website file (page, CSS, logo) | Commit it to GitHub | no |
| An engine `.gs` file | Deploy → **Manage deployments** → pencil → **New version** | **no — keep the same one** |
| A script property | Nothing. Immediate | no |

> The engine one is where people go wrong. **"New deployment" makes a second
> engine at a different address**, the website carries on calling the first, and
> your new code appears to do nothing. Always edit the existing deployment and
> choose *New version*.
