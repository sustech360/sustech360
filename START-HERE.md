# Start here

**Sustainable Science, Technology and Solutions 360** — sustech360.com

Everything needed to run the publication is in this folder. You do not need to
write code to use it, and you do not need to read most of these files.

---

## Read these three, in this order

| | | Time |
|---|---|---|
| **1** | **`docs/OVERVIEW.md`** — what this is, who uses which part, how an article reaches a reader | 10 minutes |
| **2** | **`docs/RUNBOOK.md`** — the sequence. 26 numbered steps in the order they must happen, what each produces, and why the order matters | Read once before starting |
| **3** | **`docs/INSTALL.md`** — the same journey with every click spelled out, plus how to deploy changes afterwards | 2 hours, following along |

`docs/CHECKLIST.md` is the same sequence as a printable tick-list. Keep it beside
you while you work.

If you only have five minutes, read the overview. If you are ready to install,
read the runbook first — it is the one that stops you getting the order wrong.

---

## What installing involves

Four things, in this order. None needs a developer.

1. **A Google spreadsheet and a Drive folder** — where everything is stored.
2. **A Google Apps Script project** — the engine. You paste in 30 files, add nine
   settings, press Run once, and deploy it.
3. **A GitHub repository** — the website itself. You upload this folder and turn
   on GitHub Pages.
4. **Cloudflare DNS** — pointing sustech360.com at the site.

Two hours in total, plus waiting for the domain. You can stop after step 3 and
come back: the site is already live at a GitHub address by then.

---

## The rest of the documents

| File | For |
|---|---|
| `docs/ADSENSE.md` | Google advertising and your own — when to apply, how to switch it on |
| `docs/DEVICE-TESTING.md` | What was fixed for phones and tablets, and the hour of testing that still needs you |
| `docs/FILES.md` | Every file in the project, with what it is |
| `docs/ARCHITECTURE.md` | How the pieces fit together |
| `docs/SCHEMA.md` | The data model |
| `docs/PHASE-1-STATUS.md` … `PHASE-10-STATUS.md` | What each build phase did, what it deliberately did not, and the bugs found |
| `README.md` | For whoever helps you with code |

---

## Checking it still works

In the project folder, one command:

```
node tools/verify.js
```

Five kinds of check, about fifteen seconds. A clean run means the code is sound. It
says nothing about whether your deployment is configured — that is what the
checklist is for.

---

## The three things people regret skipping

1. **Practise a restore** before you invite anyone (checklist 6.2 and 6.3). A
   restore you have never performed is not a procedure you have.
2. **Put the GitHub token's expiry in your calendar.** Publishing stops that day
   and the error will not explain why.
3. **Publish configuration after changing settings.** Readers keep seeing the
   last published version until you do — which is the point, but it surprises
   people the first time.
