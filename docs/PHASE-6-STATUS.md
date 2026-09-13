# Phase 6 status — advertising

## What works

| Capability | Where |
|---|---|
| Placements with a configurable fallback chain, always ending in COLLAPSE | `Ads.savePlacement` |
| Advertisers, campaigns, tiers, windows | `Ads.saveAdvertiser`, `saveCampaign` |
| Creative upload with URL, alt text, size and window validation | `Ads.uploadCreative` |
| Approval by someone other than the uploader | `Ads.reviewCreative` |
| Pull a live creative, with a reason, in one click | `Ads.pauseCreative` |
| Publication of approved creatives and their images | `Publish.ads` |
| The fallback chain itself: tiers, targeting, weighting, collapse | `assets/js/ads.js` |
| Impression and click counting, batched into one beacon per visit | `AdChain.Counter`, `Ads.record` |
| Advertising Control Centre with an approval queue and delivery figures | `admin/ads-admin.js` |

## What I found

The backend module was already written when I started, and **completely
unwired**: `Code.gs` had no advertising actions at all, so none of it could be
called by anything. The frontend had the phase 1 placeholder chain, which read
`creative.sponsored` — a field the backend does not emit. Sponsored content
would have been labelled "Advertisement" rather than "Sponsored", which is the
one labelling error that actually matters. The published file carries a `label`
per creative and the renderer now uses it, with a test that fails if it goes
back to guessing.

The chain also had no targeting, no weighting and no counting. Those are now in
`assets/js/ads.js`, deliberately separate from the DOM so the function that
decides which advertiser gets the slot is the same function the tests exercise.
Eight tests cover it: highest paying step first, expired creatives never served,
targeting falls through rather than showing the wrong thing, AdSense only with a
client id, our own journalism offered before a slot gives up, and collapse when
nothing fits.

## The honest limit on delivery numbers

Counting happens in the reader's browser and is sent once, on the way out, as a
single beacon. That is the price of a static site: there is no server in the
request path to count anything, and adding one would undo the architecture the
whole platform rests on.

So the numbers are indicative, not billable. Ad blockers are not counted, cached
pages are not counted, and browsers that discard the unload beacon are not
counted. The control centre says this on the screen, and `Ads.delivery` returns
the caveat in its payload so it cannot be quietly dropped. **Do not invoice from
these figures.** When advertising revenue justifies it, either an ad server or a
counted redirect endpoint is the honest upgrade.

The endpoint is unauthenticated by necessity, so it is written to be useless to
an attacker: it only ever increments a counter on an already approved creative,
caps each report at five impressions and five clicks, ignores batches over
forty, and returns nothing but a count. Three tests attack it directly.

## Tests

```
node tests/phase2.js  # 47    node tests/phase5.js  # 40
node tests/phase3.js  # 46    node tests/phase6.js  # 28
node tests/phase4.js  # 33
```

194 assertions, all passing.

## Known gaps, stated plainly

1. **No frequency capping.** A reader refreshing the homepage sees the same
   creative every time. Capping needs per-reader state, which means local
   storage and a rule about how long to keep it.
2. **Creative images are committed to the site repository.** Fine at this
   volume; a repository is not an asset host, and a busy advertiser rotating
   weekly creatives will bloat the git history.
3. **No invoicing, no payment, no contract record.** Deliberately: phase 10.
   `Campaigns` has a `package` field and nothing reads it yet.
4. **Approval is per creative, not per campaign.** Approving twelve sizes of the
   same advertisement is twelve clicks.
5. **Targeting is section and device only.** No geography, no time of day, and
   nothing that would require knowing anything about the reader — which is a
   defensible place to stop.
6. **`refreshAdSchedule` needs an hourly trigger** for campaigns to start and
   stop on their dates without someone signing in. It republishes only what was
   already approved.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()`** — it adds the `AdEvents` sheet
   and seeds the standard placements.
2. Add an hourly time trigger for `refreshAdSchedule`.
3. Turn the `ADVERTISING` feature flag on in the control centre when you are
   ready. Until then every slot collapses regardless of what is published, so
   the flag is a safe master switch.
4. The public pages now load `admin/config.js` for the endpoint, because the
   counting beacon needs it. It is an endpoint, not a secret, and the beacon
   carries no reader data.

## Phase 7 begins with

Email and the newsletter: `Subscribers`, `EmailTemplates` and `EmailLogs` are in
the schema, `Email.gs` already logs everything it sends and reads templates from
the sheet when they exist. What is missing is subscription with confirmation,
the campaign composer, and the unsubscribe link that every message the platform
sends already has a variable for.
