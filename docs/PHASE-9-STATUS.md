# Phase 9 status — performance and the PWA

## What works

| Capability | Where |
|---|---|
| Core Web Vitals from real visits: LCP, FCP, INP, CLS, TTFB | `assets/js/vitals.js` |
| Histogram storage, so a sheet can hold a year of measurements | `Performance.record` |
| p75 per page and device, with Web Vitals ratings and slow-page flags | `Performance.report` |
| Payload budget measured at publication, with specific advice | `Performance.budget` |
| One bootstrap bundle instead of five requests before first paint | `Publish.bootstrap_`, `api.js` |
| Build number stamped into the service worker on every publish | `pwa/build.js` |
| Install that survives a missing file rather than caching nothing | `pwa/service-worker.js` |
| Performance Centre in the control centre | `admin/performance.js` |

## The honest answer to last phase's question

The homepage was making **five sequential requests before it could render**:
settings, menus, homepage layout, feature flags and the article index. Each one
is small; on a slow connection the latency is what hurts, not the bytes.

Publishing now writes `data/bootstrap.json` carrying all five, and the data
layer prefers it. One round trip instead of five. The individual files are still
published and the fallback still works — verified directly, including that a
category page still consults the full archive rather than the recent slice the
bundle carries.

The bundle holds the most recent thirty articles rather than the whole index,
because the homepage needs recency and the archive grows forever. That is also
why `data/index/articles.json` still exists and is fetched when something
actually needs it.

## Measurement, and what it is worth

Field data is the only evidence that counts. A laboratory score on a fast laptop
says nothing about a reader on a train with a four-year-old phone, and this
platform's whole architecture is a bet about that reader.

The collector is about a kilobyte, uses no library, and reports once as the page
goes away. It sends five numbers, a page type and whether the screen is narrow.
No identifiers, no URLs, nothing about the reader.

What the numbers are **not**: complete. Blocked scripts, cached pages and
abandoned loads are uncounted, and browsers discard unload beacons sometimes.
The report says so in its payload so the caveat cannot be quietly dropped when
someone pastes the figures into a board deck. A page with nine samples is not a
finding, and the screen refuses to flag one as a problem.

Measurements are stored as histograms — one row per day, page, metric and device
— because a sheet cannot hold a row per page view and should not try. p75 is
interpolated inside the bucket it lands in. A test proves it behaves: 80 fast
samples and 20 slow ones give a p75 in the fast group and a mean dragged up by
the tail, which is exactly why the percentile is the number worth showing.

## Caching that actually invalidates

The service worker's cache name was a hardcoded `v1`. Readers would have kept
last month's JavaScript until their browser decided to look. It now imports
`build.js`, which publishing rewrites with an incrementing number — imported
scripts are part of a service worker's update check, so a publish retires every
stale shell.

The install step also no longer fails as a unit: one renamed asset used to mean
`addAll` rejected and the reader got no offline shell at all.

## Tests

```
node tests/phase2.js  # 47    node tests/phase6.js  # 28
node tests/phase3.js  # 46    node tests/phase7.js  # 31
node tests/phase4.js  # 33    node tests/phase8.js  # 22
node tests/phase5.js  # 40    node tests/phase9.js  # 19
```

266 assertions, all passing.

## Known gaps, stated plainly

1. **No server-side timing.** TTFB is whatever GitHub Pages and the CDN did.
   There is nothing to tune there, which is the point of the architecture, but
   it also means a slow TTFB is a fact to route around rather than fix.
2. **INP is approximated** from the longest event duration rather than the full
   interaction-to-next-paint definition. Close enough to spot a page that feels
   stuck; not what a proper library would report.
3. **No alerting.** Someone has to open the screen. A weekly digest email to the
   supervisor would cost little and is the obvious next addition.
4. **The budget measures what publishing committed**, not what a browser
   transfers. Compression typically halves it, so treat the numbers as upper
   bounds and the trend as the signal.
5. **No image optimisation anywhere.** Figures are committed as uploaded. A
   4 MB photograph will be served as a 4 MB photograph, and that is by far the
   most likely cause of a poor LCP on this site.
6. **Article pages still need two requests** — bundle then article. That is
   correct: an article's text should not be in a file every visitor downloads.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()`** — it adds the `Vitals` table.
2. **Publish the configuration once.** That writes `data/bootstrap.json` and
   `pwa/build.js`; until it runs, the site uses the fallback path and works
   exactly as it did before.
3. Nothing else. No new triggers, no new properties.

## Phase 10 begins with

The commercial platform: billing, membership, jobs, events and the company
directory. That is the largest remaining phase and the one where the honest
advice is to build the smallest part that revenue actually depends on — most
likely invoicing against the advertising campaigns that already exist — rather
than the whole catalogue at once.
