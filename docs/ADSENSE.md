# Google AdSense — what is ready and what Google will ask for

## The short version

The site is **technically ready** for AdSense. Whether it is **eligible** is a
separate question, and the honest answer today is no — not because of anything
in the code, but because Google approves sites with a body of original content
and a real audience, and this one has neither yet. That is a matter of
publishing for a few months, not of configuration.

Apply when you have roughly **20–30 substantial articles** published and a
little organic traffic. Applying before that usually produces a rejection for
"low value content", and a rejection is worth avoiding: reapplying takes time
and the second look is not friendlier.

---

## What is already built

| Requirement | State |
|---|---|
| Ad slots on the homepage, article pages and section pages | Built, configurable |
| One responsive unit that fits phone, tablet and desktop | Built — `auto` format, full-width responsive |
| Ads clearly labelled | Built — every slot says *Advertisement* or *Sponsored* |
| Ads load after the article, never blocking it | Built |
| An unfillable slot collapses instead of leaving a hole | Built |
| No layout jump when an ad arrives | Built — a filled slot reserves its height |
| Privacy policy covering advertising cookies | Built |
| `ads.txt` | File present — **you must put your publisher id in it** |
| A master switch to turn all advertising off | Built — the `ADVERTISING` feature flag |

---

## Turning it on, once Google approves you

1. **`ads.txt`** — open it in GitHub, uncomment the last line, replace
   `pub-0000000000000000` with your own publisher number (the digits from your
   `ca-pub-…` id), commit. Check it at `https://sustech360.com/ads.txt`.
2. **Control Centre → Brand → Analytics and ads** — paste your `ca-pub-…` id.
3. **Create an ad unit in AdSense** for each placement you want to fill —
   Display ad, Responsive. Copy each **slot id** (a long number).
4. **Control Centre → Advertising → Placements** — put each slot id against its
   placement.
5. **Control Centre → Sections and flags** — turn `ADVERTISING` on.
6. **Publish configuration.**

A unit with a client id and **no slot id** is valid markup that silently never
fills. That is the usual reason someone thinks AdSense is broken, and the chain
now skips AdSense entirely rather than rendering an empty box.

---

## The two side rails

On a screen wider than 1200 pixels the page grows a column either side. Each one
resolves on its own, so the normal arrangement works: **a placement you sold on
one side, Google filling the other**. Either can also carry your own promotion —
a call for papers, an issue, a job — through the house tier.

They are called `RAIL_LEFT` and `RAIL_RIGHT` in Advertising → Placements.

Three things worth knowing:

- **A rail with nothing to show does not exist.** The three-column layout only
  appears once a rail has filled, so an unsold site is not a page with two grey
  columns down the sides.
- **Below 1200 pixels there are no rails at all** — not shrunk, not moved to the
  bottom. A phone and a tablet in portrait get the inline slots instead. This is
  deliberate: a column beside the text on a narrow screen is how a page starts
  scrolling sideways.
- **Sizes.** Rails are 170 pixels wide up to 1600, then 300 — the two sizes
  advertisers actually sell (160×600 and 300×600). Supply artwork at twice that
  for sharp display on a high-resolution screen.

## What Google checks, and where you stand

**Original content.** Yours will be. Keep it that way — republished press
releases and lightly rewritten papers are the fastest route to a rejection.

**Navigation that works.** Every section reachable, nothing dead. Checked
automatically by `node tools/audit.js`.

**A privacy policy that mentions advertising cookies.** Now written, at
`/privacy.html`, including the Google partner-sites link Google looks for.

**About and contact pages.** Both exist. Put a real email address on them.

**Ads placed honestly.** The rules that get accounts suspended rather than
rejected: no ads on pages with almost no content, nothing that could be mistaken
for navigation or article text, nothing that pushes content off the screen, and
never click your own ads — not once, not to test. Use Google's preview tools
instead.

**Consent, if you have European readers.** Personalised advertising in the EEA
and UK requires a Google-certified consent platform. This site does not have one
yet, and until it does, readers in those regions should be shown
non-personalised ads. Google's own consent management tool is free and can be
switched on from inside AdSense; do that before you enable advertising if
European traffic matters to you.

---

## What this platform will not do

- **No ad density creep.** Placements are configured deliberately. The
  specification's own principle is audience → trust → engagement → revenue, and
  a research publication that looks like a content farm loses the first two.
- **No automatic optimisation.** Google's Auto Ads inserts units wherever it
  likes, including inside your article text. It is not wired up, on purpose.
  If you want it later, it is one script tag — but read what it does to an
  article page first.
- **No billable figures.** The delivery numbers in the control centre count your
  own direct advertising, not AdSense. AdSense's own dashboard is the record for
  anything you get paid on.

---

## Realistic expectations

A specialist publication with a few thousand monthly readers earns single-digit
to low-tens of dollars a month from AdSense. The reason to run it is that it
costs nothing and establishes that the slots work. The revenue in a title like
this one is direct: a battery manufacturer paying for a placement your readers
actually care about — which is what the advertising and billing sections of this
platform were built for.
