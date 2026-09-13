# Phase 8 status — magazine issues and PDF

## What works

| Capability | Where |
|---|---|
| Issue composer: number, month, theme, editorial, cover | `Issues.create`, `save`, `uploadCover` |
| Contents in six named sections, drawn from published articles only | `Issues.save` |
| The specified chain: draft → preview → verified → approved → published | `ISSUE_TRANSITIONS` |
| PDF built on demand, and rebuilt at publication | `Issues.buildPdf`, `Publish.issue` |
| Web edition, cover, PDF and index committed together | `Publish.issue` |
| Published issues hold a snapshot and do not move afterwards | `Issues.snapshot` |
| Reader controls: PDF download, print, copyright notice | `reading.*` settings |
| Public issue list and issue reader; composer in the control centre | `issues.html`, `admin/issues-admin.js` |

## The PDF, honestly

Apps Script has no typesetting engine. What it has is an HTML blob that converts
itself: `Utilities.newBlob(html, 'text/html').getAs('application/pdf')`. That
handles headings, paragraphs, lists, block layout and page breaks, and silently
ignores nearly everything else.

So the PDF edition is **a readable document, not a designed magazine**:

- no page numbers, no running heads, no folios;
- no columns, no text wrap around images, no control over widows and orphans;
- figures appear as a bracketed caption line, not as images — embedding them
  would mean base64 inside the HTML and a document several megabytes large
  before it has any text in it;
- fonts are whatever the converter has, which in practice means a serif default.

If the print edition matters commercially, the honest upgrade is to render the
same content through a real typesetting step — a Google Doc built from the
issue and exported, or an external service — and `Issues.pdfBlob_` is the single
function that changes. What is here is genuinely useful for a PDF someone reads
on a tablet or emails to a colleague, and it will disappoint anyone expecting
InDesign.

## Two rules the tests hold

**An issue cannot publish anything.** Only articles that are already public can
be placed in one, checked when they are added and again at verification, because
an article can be archived in between. Eight tests cover it, including that the
attempt is audited. Without this, an issue would be a second route to publication
that bypasses the supervisor's approval of an article.

**A published issue does not move.** The web edition holds the full text as it
stood at publication. Three tests rewrite an article's published document and
archive another one afterwards, then assert the issue file is byte-identical.
A printed issue cannot change after it ships, so the web and PDF editions do not
either — and a reader following a link still gets the current article, labelled
with which version the issue carried.

Publication also rebuilds the PDF rather than shipping whatever was last built
by hand, so an issue edited after its last build cannot ship the older document.

## Copy and download controls

`reading.allow_pdf_download`, `reading.allow_print` and `reading.copy_notice`
are ordinary site settings: edited in the control centre, published with the
rest of the configuration, respected by the issue page.

They are deterrence and licensing, not protection. Nothing in a browser can stop
a screenshot, a text selection through developer tools, or OCR of the PDF — the
specification says this itself and it is worth repeating where someone might
otherwise assume the switch does more than it does.

## Tests

```
node tests/phase2.js  # 47    node tests/phase6.js  # 28
node tests/phase3.js  # 46    node tests/phase7.js  # 31
node tests/phase4.js  # 33    node tests/phase8.js  # 22
node tests/phase5.js  # 40
```

247 assertions, all passing.

## Known gaps, stated plainly

1. **No figures in the PDF.** As above: captions only.
2. **No per-issue advertising.** `MAGAZINE_COVER` and `BACK_COVER` exist as ad
   placements and the issue renderer ignores them.
3. **Issue contents are article ids in the composer.** It works, and picking
   from a list of titles is nicer than reading `MAG-2026-000101` in a table.
4. **No back-issue paywall or membership gate.** Phase 10, and worth deciding
   deliberately rather than drifting into.
5. **The PDF is rebuilt in one request.** A large issue — thirty long articles —
   risks the six-minute execution limit. Issues of that size need the build
   moved to a trigger, the same way the newsletter send already is.
6. **No print-edition proofing.** Someone should read the PDF before approving;
   the interface asks them to, and nothing enforces it.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()`** — it widens `MagazineIssues`
   and adds the three `reading.*` settings.
2. Turn the `PDF` feature flag on if you want the download offered.
3. Add "Issues" to the navigation — `setup()` seeds it, and an existing install
   needs it added in the control centre, then a configuration publish.

## Phase 9 begins with

Performance and the PWA: the service worker, the offline shell and the caching
are already in place from phase 1, so phase 9 is the Performance Centre —
measuring what the site actually does rather than what the architecture
promises. That means Core Web Vitals collected from real visits, a payload
budget checked at publication, and the honest answer to whether a homepage that
fetches three JSON files before it renders is fast enough.
