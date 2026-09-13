# Phase 7 status — email, newsletter and social

## What works

| Capability | Where |
|---|---|
| Double opt-in subscription, throttled, no enumeration oracle | `Newsletter.subscribe` |
| Single-use confirmation links | `Newsletter.confirm` |
| One-click unsubscribe, no account, no session, works years later | `Newsletter.unsubscribe` |
| Campaign composer: draft, test on yourself, approve, send | `Newsletter.draft` → `start` |
| Batched sending that survives quota limits and long lists | `Newsletter.sendQueued` |
| Every message logged, sent or failed | `Email.sendRaw` |
| Audience counts without displaying addresses; audited export | `Newsletter.overview`, `exportAudience` |
| Social drafts written at publication, posted by a human | `Social.gs` |
| Reader-facing confirm/unsubscribe page and a working homepage form | `newsletter.html`, `home.js` |

## What I found

The newsletter module was written but unwired, and it would not have worked if
it had been: `Code.gs` had no email actions, `Email.sendRaw` did not exist,
`LIMITS.MAIL_BATCH` and `MAIL_RESERVE` were never defined, and there was no
`newsletter_confirm` template. With `MAIL_BATCH` undefined the sending loop's
condition is `0 < undefined` — false — so a campaign would have been marked
SENDING and then sat there forever, sending nothing, with no error anywhere.

**The unsubscribe link was broken.** The link in every newsletter carries a
token derived from the subscriber record (`linkToken_`, an HMAC of id and
email). The function validating it only knew about the stored confirmation token
hash. Every unsubscribe link would have failed with "this link is not valid".

That is the worst bug in this project so far. Not because it is technically
deep — it is six lines — but because of what it does: it turns a magazine into a
spammer, and the people it fails are the ones already asking to be left alone.
An unsubscribe link is the one piece of an email system that must work on the
first try, from a three-year-old email, on a phone, for someone who is annoyed.
Both token paths are now accepted, the confirmation token is properly single
use, and four tests cover it — including that someone else's guessed token
cannot unsubscribe you.

## The consent model, stated

- Nothing is sent to an address that has not clicked a confirmation link.
- The subscribe response is identical whether the address is new, already
  subscribed, or invalid, so the form cannot be used to test who is on the list.
- One confirmation per address per hour, whatever the form does. A re-subscribe
  inside that window is silently dropped — deliberate, and tested.
- Unsubscribing is a single request with no session, and it cannot be undone by
  someone re-submitting the form: coming back requires confirming again.
- The control centre shows counts, not addresses. Exporting the list is
  possible, and it writes an audit row, because exporting a mailing list is
  exactly the act that leaks one.

## Sending safety

You cannot unsend an email, so the sequence is enforced rather than suggested:
write, send yourself a test, have **someone else** approve it, then send.
Approving a campaign you have not tested is refused; editing after the test
invalidates it; approving your own campaign is refused unless you are the
supervisor admin. The send itself runs in batches and holds back 50 messages of
daily quota so invitations, review requests and password resets keep working
while a newsletter goes out.

## Social, and why it does not post

The platform writes the post and holds it in a queue. A human copies it, posts
it, and marks it done. No social credentials are stored anywhere, because a
compromised long-lived write token means the magazine's name saying something it
did not say. `markPosted` is the seam if API posting is added later.

Drafts are written automatically when an article publishes — and only then. A
test asserts that an unpublished article cannot be composed about, because a
social post is a publication and this must not become a second route to one.

## Tests

```
node tests/phase2.js  # 47    node tests/phase5.js  # 40
node tests/phase3.js  # 46    node tests/phase6.js  # 28
node tests/phase4.js  # 33    node tests/phase7.js  # 31
```

225 assertions, all passing.

## Known gaps, stated plainly

1. **Plain text only.** No HTML email. That is a defensible choice for a
   research newsletter and a real limitation if you want images or tracking.
   There is no open tracking and no click tracking at all.
2. **No bounce handling.** `failures` is incremented when `MailApp` throws, but
   Gmail accepts most addresses and bounces asynchronously where nothing sees
   them. Hard bounces will accumulate as dead weight.
3. **Gmail's daily quota is the ceiling** — 100 or 1,500 messages a day
   depending on the account. Past a few thousand subscribers this needs a real
   sending service, and `Email.sendRaw` is the single place that changes.
4. **No scheduled campaigns.** A campaign is approved and then started by hand.
   The trigger continues an in-flight send; it does not begin one.
5. **No per-topic segmentation.** `Subscribers.topics` is stored and never read.
6. **The subscribe form posts to the Apps Script endpoint**, so a reader with a
   cold Apps Script deployment waits a second or two for the confirmation
   message. Acceptable for a form submission; it would not be for a page load.

## Setup delta

1. Re-upload `apps-script/` and **run `setup()`** — it adds `EmailCampaigns` and
   extends `Subscribers`.
2. Add a time trigger for `sendQueuedEmail`, every ten minutes. Without it a
   send larger than one batch stalls after the first slice.
3. Turn the `NEWSLETTER` feature flag on. Subscription is refused while it is
   off, quietly, like everything else on that endpoint.
4. `SITE_URL` must be exactly right — confirmation and unsubscribe links are
   built from it, and a wrong value means dead links in email you have already
   sent.

## Phase 8 begins with

Magazine issues and PDF: `MagazineIssues` is in the schema, the renderer already
turns a version into structured blocks, and the publishing engine already
commits binaries. What is missing is the issue composer, the cover, and the PDF
itself — which in Apps Script means either HTML-to-PDF through the Drive
conversion or a client-side renderer, and that choice is the first thing phase 8
has to make honestly.
