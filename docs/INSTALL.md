# Installing Sustainable Science, Technology and Solutions 360

**Written for someone who does not write code.** Every step is a thing you click
or paste. Where something can go wrong, it says so and tells you what to do.

Two companions to this document: `docs/RUNBOOK.md` numbers every step end to end
and shows which ones depend on which, and `docs/CHECKLIST.md` is the same
sequence as a printable tick-list. Read the runbook once before you start.

Set aside about two hours. You can stop after Part 3 and come back — the site
will already be live at a GitHub address; the domain is Part 5.

**What you need before starting**

- A Google account (a normal Gmail account is fine)
- A GitHub account — free, at github.com
- Your Cloudflare account, where sustech360.com is registered
- The folder of files you were given

---

## How the pieces fit together

```
   Readers          →   GitHub Pages          (the website: fast, free, static)
                            ↑
   You and your editors →  Control Centre     (a page on that same website)
                            ↓
                        Google Apps Script    (the engine)
                            ↓
                    Google Sheets + Drive     (where everything is stored)
```

The important part: **readers never touch Google.** They read files. Google only
does work when you and your editors are signed in. That is why the site stays
fast no matter what Google is doing.

---

# Part 1 — The database (15 minutes)

### 1.1 Create the spreadsheet

1. Go to **sheets.google.com** and create a **Blank spreadsheet**.
2. Name it `SusTech360 — Production` (top left, where it says "Untitled").
3. Look at the web address. It looks like this:
   `https://docs.google.com/spreadsheets/d/`**`1a2B3c4D5e6F7g8H9i0J`**`/edit`
   The bold part is the **Spreadsheet ID**. Copy it into a notes file. You will
   need it in a moment.

### 1.2 Create the Drive folder

1. Go to **drive.google.com** and create a folder called `SusTech360 — Media`.
2. Open it. The web address ends with the **Folder ID**:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOp`**
3. Copy that too.

This folder will hold article text, figures, invoices and backups. Do not delete
anything in it by hand.

---

# Part 2 — The engine (30 minutes)

### 2.1 Create the Apps Script project

1. In your spreadsheet, click **Extensions → Apps Script**.
2. A new tab opens with a file called `Code.gs` containing a few lines. Delete
   everything in it, but leave the empty file there for now.
3. At the top left, click the project name ("Untitled project") and rename it
   `SusTech360 Backend`.

### 2.2 Show the settings file

1. On the left, click the **gear icon** (Project Settings).
2. Tick **"Show appsscript.json manifest file in editor"**.
3. Click **Editor** (the `<>` icon) to go back.

### 2.3 Paste in the 30 engine files

You now copy each file from the `apps-script` folder into the project.

For **each** file in the `apps-script` folder:

1. Click the **+** next to "Files" → **Script**.
2. Type the file name **without** the `.gs` — so for `Auth.gs` type `Auth`.
3. Open the real file on your computer in Notepad (Windows) or TextEdit (Mac).
4. Select all (Ctrl+A / Cmd+A), copy, then paste into the Apps Script editor,
   replacing anything already there.
5. Press **Ctrl+S** (Cmd+S) to save.

It is 30 files ending in `.gs`, plus `appsscript.json`.

Two exceptions:

- `Code.gs` already exists — paste into it rather than creating it.
- `appsscript.json` already exists — open it and replace its contents with the
  version from the folder.

**The list of 30 files is in `docs/FILES.md`, under "The engine".** Tick them off as you go. Getting
a name wrong (`auth` instead of `Auth`) will cause errors later, so check the
capital letters.

> This is the most tedious part of the whole installation. It takes about twenty
> minutes and you only do it once.

### 2.4 Put in your settings

The engine keeps its settings outside the code, where they cannot end up on
GitHub. This is where people most often come unstuck, so go slowly.

1. In the left sidebar of the Apps Script editor, click **⚙ Project Settings**
   (the gear, below the clock).
2. Scroll to the bottom, to **Script Properties**.
3. Click **Add script property**. Two boxes appear: a name on the left, a value
   on the right.
4. Add these six. Names are **case-sensitive** — type them exactly:

| Property | Value |
|---|---|
| `SPREADSHEET_ID` | The code from step 1.1 — between `/d/` and `/edit`, nothing else |
| `DRIVE_FOLDER_ID` | The code from step 1.2 — after `/folders/` |
| `PASSWORD_PEPPER` | A long random string you invent. 40+ characters. Never reuse it |
| `TOKEN_PEPPER` | A second long random string, different from the first |
| `SITE_URL` | `https://sustech360.com/` — **with the trailing slash** |
| `BOOTSTRAP_EMAIL` | Your email. The supervisor password is sent here, once |

5. Add these three as well. Two can wait, but add `ENV` now:

| Property | Value |
|---|---|
| `ENV` | `production` |
| `GITHUB_REPO` | Leave empty for now — you add it at step 4.2 |
| `GITHUB_TOKEN` | Leave empty for now — you add it at step 4.2 |

6. **Press "Save script properties".**

> **This button is the single most common failure in the whole installation.**
> Rows typed into the boxes but never saved do not exist. The screen looks
> identical either way. If setup fails with "Missing script property", this is
> almost certainly why.

### 2.4b Check before you run anything

Before `setup()`, run the check. It changes nothing and prints what the engine
can actually see.

1. In the function dropdown at the top, choose **`checkSetup`**.
2. Click **Run**.
3. Read the log at the bottom.

You want every required line to say `OK`. If any says `MISSING`, go back to 2.4
— and check you pressed Save. If a name was typed in the wrong case, the check
names it: `spreadsheet_id` and `SPREADSHEET_ID` are different properties, and
the engine only sees the second.

The check also opens your spreadsheet and your media folder, so a wrong id is
caught here rather than halfway through setup.

### 2.5 Run the setup

1. In the editor, open `Schema.gs`.
2. At the top, in the function dropdown, choose **setup**.
3. Click **Run**.
4. Google will ask for permission. Click **Review permissions** → choose your
   account → you will see **"Google hasn't verified this app"** → click
   **Advanced** → **Go to SusTech360 Backend (unsafe)** → **Allow**.

   That warning is normal. It appears because the project is yours and
   unpublished, not because anything is wrong. You are granting your own script
   access to your own spreadsheet.

5. Wait. It takes up to a minute. When the log says `Setup complete for
   production`, open your spreadsheet — it now has about 42 tabs.
6. **Check your email.** There is a message with a temporary password. Keep it.

### 2.6 Set the automatic jobs

Click the **clock icon** (Triggers) on the left, then **Add Trigger** five
times. For each: leave "Choose which deployment" alone, set the event source to
**Time-driven**, and use these settings:

| Function to run | Timer | Interval |
|---|---|---|
| `publishScheduled` | Hour timer | Every hour |
| `sendQueuedEmail` | Minutes timer | Every 10 minutes |
| `refreshAdSchedule` | Hour timer | Every hour |
| `expireInvitations` | Day timer | Any hour you like |
| `dailyBackup` | Day timer | Pick 2am–3am |

These do the work while nobody is signed in: publishing scheduled articles,
sending the newsletter in batches, expiring old invitations, and taking backups.

### 2.7 Publish the engine

1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Fill in:
   - **Description:** `v1`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy**, then **Authorize access** if asked.
5. Copy the **Web app URL**. It ends in `/exec`. Save it in your notes.

> **"Who has access: Anyone" sounds alarming — it is not.** It means the address
> can be reached. Every request still has to prove who it is; without a valid
> sign-in the engine answers "unauthenticated" and nothing else. The only things
> that work without signing in are the ones that must: subscribing to the
> newsletter, unsubscribing, and accepting an author invitation.

---

# Part 3 — The website (20 minutes)

### 3.1 Put your engine address into the files

1. On your computer, open the folder of files.
2. Open `admin/config.js` in Notepad or TextEdit.
3. Replace `PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE` with the `/exec` URL from step
   2.7, keeping the quotation marks. It should look like:

```js
window.MAG_ENDPOINT = "https://script.google.com/macros/s/AKfy...long.../exec";
```

4. Save the file.

This is the only file you edit by hand. It holds an address, not a password —
it is safe for it to be public.

### 3.2 Create the GitHub repository

1. Go to **github.com** → **+** (top right) → **New repository**.
2. **Repository name:** `sustech360`
3. Choose **Public**. (Private works only on paid plans for websites.)
4. Do **not** tick "Add a README file".
5. Click **Create repository**.

### 3.3 Upload the files

1. On the empty repository page, click **uploading an existing file**.
2. Open your files folder. Select **everything inside it** — all the files and
   all the folders — and drag them onto the GitHub page.

   Drag the *contents*, not the folder itself. If GitHub ends up showing a single
   folder called `magazine`, delete the upload and try again with the contents.

3. Wait for every file to finish uploading (it will say "119 files").
4. In the box at the bottom, type `First upload` and click **Commit changes**.

### 3.4 Turn the website on

1. In your repository: **Settings** (top row) → **Pages** (left sidebar).
2. Under "Build and deployment", set **Source** to **Deploy from a branch**.
3. Set the branch to **main** and the folder to **/ (root)**. Click **Save**.
4. Wait two or three minutes, then reload. A green box appears with your
   address: `https://yourname.github.io/sustech360/`
5. Open it. **You should see the site**, with the logo and navigation.

If you see a plain list of files instead, wait another minute and reload.

### 3.5 Sign in and change your password

1. Go to `https://yourname.github.io/sustech360/admin/`
2. Sign in with your email and the temporary password from step 2.5.
3. It will insist you change the password. Choose a strong one: at least 12
   characters with upper case, lower case and digits.
4. You are in. Have a look around — **Publish**, **Navigation** and **Users**
   are the ones you will use first.

---

# Part 4 — Letting the engine publish (10 minutes)

Right now the Control Centre can do everything except put things on the website.
This step gives it permission to write to your repository.

### 4.1 Create a token

1. Go to **github.com** → your photo (top right) → **Settings**
2. Bottom of the left sidebar: **Developer settings**
3. **Personal access tokens → Fine-grained tokens → Generate new token**
4. Fill in:
   - **Token name:** `SusTech360 publishing`
   - **Expiration:** 1 year (put a reminder in your calendar to renew it)
   - **Repository access:** **Only select repositories** → choose `sustech360`
   - **Permissions → Repository permissions → Contents:** change to
     **Read and write**
5. Click **Generate token** and **copy it immediately** — GitHub shows it once.

### 4.2 Give it to the engine

1. Back in Apps Script: **gear icon → Script Properties → Edit**.
2. Paste the token into `GITHUB_TOKEN`.
3. Set `GITHUB_REPO` to `yourname/sustech360` (your GitHub username, then a
   slash, then the repository name).
4. **Save script properties.**

### 4.3 Test it

1. In the Control Centre, go to **Brand**.
2. Change the tagline to anything, click **Save**.
3. Go to **Publish**. It should say one file differs. Click **Publish
   configuration**.
4. Wait a minute, reload the website. Your new tagline is on it.

**If it fails:** the message tells you which file and which error code. `401` or
`403` means the token is wrong or lacks Contents: Read and write. `404` usually
means `GITHUB_REPO` is misspelled.

---

# Part 5 — Your domain (30 minutes, then a wait)

Your domain is registered with Cloudflare, which is also your DNS. Two steps:
tell GitHub the domain, then point the domain at GitHub.

### 5.1 Tell GitHub

1. Repository → **Settings → Pages**.
2. Under **Custom domain**, type `sustech360.com` and click **Save**.
3. GitHub will say "DNS check in progress". That is expected — we have not done
   the DNS yet.

The `CNAME` file already in your upload contains `sustech360.com`, so this
should already be filled in. If it is, leave it alone.

### 5.2 Point the domain at GitHub

1. Sign in to **dash.cloudflare.com** and click **sustech360.com**.
2. Go to **DNS → Records**.
3. Delete any existing `A`, `AAAA` or `CNAME` record for `@` or `www` that
   points somewhere else (a parking page, for instance). Leave MX records alone —
   those are your email.
4. Add these records with **Add record**:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `@` | `185.199.108.153` | **DNS only** (grey cloud) |
| A | `@` | `185.199.109.153` | **DNS only** |
| A | `@` | `185.199.110.153` | **DNS only** |
| A | `@` | `185.199.111.153` | **DNS only** |
| CNAME | `www` | `yourname.github.io` | **DNS only** |

Use your real GitHub username in the last row, and note there is no `https://`
and no trailing slash.

> **The grey cloud matters.** Cloudflare's orange cloud (proxy) sits in front of
> GitHub and stops GitHub from issuing your HTTPS certificate. Leave every one
> of these records on **DNS only** until HTTPS is working. You can turn the
> proxy on afterwards — see 5.5.

### 5.3 Set the encryption mode now, before anything else

1. In Cloudflare: **SSL/TLS → Overview**.
2. Set the encryption mode to **Full** or **Full (strict)**.
3. **Never leave it on "Flexible."** Flexible plus GitHub Pages produces an
   endless redirect loop and your site appears broken. This is the single most
   common mistake with this setup.

### 5.4 Wait, then switch on HTTPS

1. Wait 15 minutes to an hour. DNS changes are not instant.
2. Visit `http://sustech360.com`. The site should appear.
3. Go back to **GitHub → Settings → Pages**. Once the DNS check passes, the
   **Enforce HTTPS** tickbox becomes available. Tick it.

   It can take up to 24 hours to become available. That is GitHub issuing your
   certificate. There is nothing to do but wait, and nothing you can do to speed
   it up.

4. When it is ticked, `https://sustech360.com` works and `http://` redirects to
   it automatically.

### 5.5 Optional: turn on Cloudflare's proxy

Only after HTTPS is working and enforced:

1. Cloudflare → **DNS → Records** → edit each of the five records → switch to
   **Proxied** (orange cloud).
2. Check `https://sustech360.com` still loads. If you get "too many redirects",
   switch them back to grey and check step 5.3 — the encryption mode is the
   cause.

You do not need the proxy. GitHub Pages already serves your site from a global
network. The proxy adds Cloudflare's analytics and firewall if you want them.

### 5.6 Tell the engine the address changed

1. Apps Script → **Script Properties**: confirm `SITE_URL` is
   `https://sustech360.com/` with the trailing slash.
2. Control Centre → **Publish** → **Publish configuration**.

This matters more than it looks: every author invitation, newsletter
confirmation and unsubscribe link is built from `SITE_URL`. If it is wrong, you
send people dead links and cannot take them back.

---

# Part 6 — Before you invite anyone (30 minutes)

### 6.1 Protect your account

Your account can publish, delete and restore everything. Treat it accordingly.

- Use a password you use nowhere else.
- Turn on two-factor authentication on the Google account that owns the Apps
  Script project.

### 6.2 Practise a restore

**Do this before the site matters, not after.**

1. Control Centre → (backups run daily, but take one now from the Apps Script
   editor: choose the `dailyBackup` function and click **Run**).
2. In the Apps Script editor, run `Backup.list` is not needed — instead check
   your Drive folder: a `backups` folder now holds a dated file.
3. Read the "Backup" section of `docs/PHASE-10-STATUS.md` so you know what a
   restore involves before you ever need one.

A backup you have never opened is a hope, not a backup.

### 6.3 Set up the publication

In the Control Centre, in this order:

1. **Brand** — check the name, tagline and colours. Upload a different logo by
   replacing the files in `assets/icons/` on GitHub.
2. **Sections and flags** — add or retire categories to match what you will
   actually publish.
3. **Navigation** — match the menu to those sections.
4. **Formats and rules** — read the submission checklist and the word limits.
   These are enforced when an author submits, so make them what you mean.
5. **Guidelines** — write the author guidelines. They are what invited authors
   read first. Publishing them follows the same approve-then-publish path as an
   article.
6. **Publish** — publish the configuration.

### 6.4 Add your first people

- **Users → Invite** for editors and reviewers. Roles: Senior Editor can
  approve; Section Editor can review within a section; Reviewer can only review
  what they are assigned.
- **Invitations** for authors. Authors cannot sign themselves up — that is
  deliberate and cannot be switched on.

### 6.5 Check it on real devices

Work through **`docs/DEVICE-TESTING.md`** — seven checks, about an hour, on a
phone, a tablet and a laptop. Every automated check on layout has passed, but no
static check can tell you a page *looks* right.

### 6.6 Walk one article all the way through

Invite yourself as an author with a second email address, write something short,
submit it, review it, approve it and publish it. Then look at the live site.

Twenty minutes here will teach you more than any documentation, and it verifies
every part of the chain before a real contributor sees it.

---

# When something goes wrong

| What you see | What it means |
|---|---|
| Control Centre says "the backend did not respond" | The `/exec` URL in `admin/config.js` is wrong, or the deployment was deleted. Redeploy and paste the new URL |
| "Your role does not allow that" | Correct behaviour. Only the supervisor account publishes |
| Publishing fails with 401 or 403 | The GitHub token has expired or lacks Contents: Read and write |
| Publishing fails with 404 | `GITHUB_REPO` is misspelled. It is `username/repository`, nothing else |
| Site shows old content after publishing | Wait two minutes for GitHub, then reload with Ctrl+Shift+R |
| "Too many redirects" on the domain | Cloudflare SSL mode is Flexible. Set it to Full |
| The domain shows a GitHub 404 page | The `CNAME` file is missing from the repository, or the custom domain field in Settings → Pages is empty |
| Emails are not arriving | Gmail's daily limit is 100 messages on a free account, 1,500 on Workspace. Check **Newsletter** for the remaining quota |
| An author cannot sign in | Check **Users**: their status is probably Suspended, or they never set a password |

**Anything else:** the Control Centre's **Audit log** records every action with
who did it and when. It is the first place to look when something has changed
and nobody knows why.

---

# Running things after installation

**Every day:** nothing. The triggers handle scheduled publishing, email and
backups.

**When you change the site's configuration** — navigation, homepage, brand,
categories, flags — you must click **Publish** afterwards. Until you do, readers
see the previous version. This is deliberate: it means you can prepare changes
without them leaking out.

**Publishing an article** publishes itself — no separate configuration publish
needed.

**Once a year:** renew the GitHub token (Part 4) before it expires. Publishing
stops working the day it does.

---

# Part 7 — Advertising, when you are ready (20 minutes)

Do not do this on launch day. Google approves sites that already have content
and readers, and applying early usually earns a rejection that makes the second
attempt harder. Come back at roughly 20–30 published articles.

### 7.1 Your own advertising — works immediately

No approval, no waiting, no Google.

1. Control Centre → **Advertising** → add the advertiser
2. Add a campaign with its dates and tier
3. Upload the creative, with the destination link and alt text
4. **Someone other than the uploader approves it** — that is enforced
5. **Publish advertising**

### 7.2 Google AdSense — after they approve you

1. Open `ads.txt` in GitHub, uncomment the last line, put your publisher number
   in it, commit
2. Control Centre → **Brand** → paste your `ca-pub-…` id
3. In AdSense, create one **responsive display unit per placement** and copy each
   **slot id**
4. Control Centre → **Advertising** → put each slot id against its placement
5. Sections and flags → turn `ADVERTISING` on → **Publish configuration**

A unit with a client id and no slot id never fills. That is the single most
common reason people think AdSense is broken.

### 7.3 Where advertising appears

| Placement | Where | Shown on |
|---|---|---|
| `RAIL_LEFT`, `RAIL_RIGHT` | Columns either side of the page | Screens wider than 1200px only |
| `HOME_TOP`, `HOME_MIDDLE` | Homepage, between sections | Everything |
| `ARTICLE_MIDDLE` | Inside the article | Everything |
| `CATEGORY_TOP` | Above a section listing | Everything |

The two rails fill independently, so one can be an advertiser you sold and the
other Google. A rail with nothing to show does not appear at all, and on a phone
the rails do not exist — those readers get the inline slots instead.

**`docs/ADSENSE.md`** has the full picture, including what Google checks and what
to expect in revenue.


---

# Part 8 — Making changes later

Four kinds of change, and each is deployed differently. Using the wrong one is
the most common way a working site appears to break.

### A. You changed a setting, a menu, the homepage, the brand or a policy

Control Centre → make the change → **Publish** → **Publish configuration**.

Nothing reaches readers until that button. That is deliberate — it is what lets
you edit during the week and publish when you are ready — and it surprises
everyone the first time.

### B. You changed a website file (a page, the stylesheet, a logo)

Upload it to GitHub and commit. GitHub Pages rebuilds within a minute or two.
Nothing else is needed.

If the change does not appear: hard-refresh once (**Ctrl+Shift+R**, or
**Cmd+Shift+R**). The site is designed to cache aggressively, and a publish is
what normally clears it.

### C. You changed an engine file — one of the `.gs` files

**This is the one people get wrong.** After pasting the new code into Apps
Script, the live engine keeps running the old version until you deploy again —
and *how* you deploy matters:

1. **Deploy → Manage deployments**
2. Click the **pencil** on your existing deployment
3. **Version → New version**
4. Add a short description
5. **Deploy**

The `/exec` address **stays the same**, so nothing else needs changing.

> **Do not use "New deployment" for an update.** It creates a *second*
> deployment with a *different* address. The old one keeps answering, your
> website keeps calling it, and your new code appears to do nothing at all. If
> you have already done this, either delete the new deployment and follow the
> steps above, or paste the new URL into `admin/config.js`.

### D. You changed a script property — a pepper, the token, the site URL

Properties take effect immediately. No deployment, no publish.

The exception is `SITE_URL`: confirmation and unsubscribe links in emails you
have **already sent** were built with the old value and cannot be changed. Get
it right before you send a newsletter.

---

## After any change, check it

```
node tools/verify.js
```

If that is clean and something still looks wrong, the problem is configuration
rather than code — start with Control Centre → **Audit log**.

---

# Changing the name, the logo or the colours later

Nothing here needs a developer.

**The name and tagline:** Control Centre → **Brand** → edit → Save → **Publish**
→ Publish configuration.

**The logo:** the three files live in `assets/icons/`.

| File | Where it appears | Replace with |
|---|---|---|
| `logo.svg` | The masthead, light mode | Any SVG or PNG, about 370 × 64 |
| `logo-dark.svg` | The masthead, dark mode | The same logo in lighter ink |
| `logo-mark.svg` | Browser tab, bookmarks | Just the symbol, square |

To swap one: GitHub → the `assets/icons` folder → **Add file → Upload files** →
drop your file in with the same name → **Commit changes**. The site picks it up
within a minute or two. The masthead sizes it to 38 pixels tall automatically,
so the shape matters more than the size — a wide logo reads better than a tall
one.

If your file has a different name, set it in Control Centre → **Brand** →
the logo field, then publish the configuration.

**The colours:** Control Centre → **Brand** → Palette. Use hex codes such as
`#1F6F5C`. Anything that is not a plain colour is rejected, because these values
go straight into the page.

---

# For whoever helps you with code

Two commands, run in the project folder:

```
node tools/audit.js     # dead links, orphaned calls, committed secrets
npm test                # 302 checks against the engine
```

And, once `npm install --no-save jsdom` has been run:

```
npm run test:contract   # publishes for real, then renders it with the real site
```

The contract test is the one that catches the engine and the website quietly
disagreeing — a field one side sends and the other never reads. Run it before
any release. `docs/PHASE-*-STATUS.md` records what each phase does, what it
deliberately does not, and the bugs the tests caught.
