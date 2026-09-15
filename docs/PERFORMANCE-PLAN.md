# Making it faster, without changing what it is

Measured first, then changed, then measured again. The numbers below are Google
operations counted by instrumenting the spreadsheet and Drive stubs the test
harness already provides — `node tools/bench.js` reproduces them.

## What a reader used to cost

| | Before | After |
|---|---|---|
| Apps Script executions per visit | **2** | **1** |
| Spreadsheet rows written per visit | **5** | **0** |
| Spreadsheet reads per visit | **4** | **0** |
| Writes per 100 visits | ~500 | **1 flush, 1 write** |

A visit used to send two beacons — one for advertising, one for page speed —
and each measurement became a row. That is a price charged per reader, which is
the wrong shape for numbers that are only ever read as aggregates.

Now one beacon carries both, and it adds to a counter in the script cache. A
trigger folds the counters into the sheets every ten minutes. **A thousand
visits cost one write instead of five thousand.**

What that costs, plainly: the cache is not durable. If the platform stops
between flushes, the counts since the last flush are gone. Advertising delivery
and page-speed samples are both already described as indicative rather than
billable, so that is the right trade — and nothing financial or editorial goes
through this path. The performance screen reports `awaiting_flush`, so it never
quietly understates itself.

## What an editor used to cost

| | Before | After |
|---|---|---|
| Opening the studio dashboard | 5 executions, 20 range reads, 30 row counts | **1 execution, 3 range reads, 9 row counts** |
| Changing three fields on a row | 5 range calls, 4 writes | **2 range calls, 1 write** |
| Signing in | 5 range calls, 3 writes | 3 range calls, 1 write |

The dashboard made five separate calls that each re-read the same tables. It is
now one call that reads each table once. A row update wrote one cell at a time;
it now writes the whole changed span in a single operation, which is the
difference between a quota that lasts the day and one that does not once
several editors are working at once.

## What a screen in the studio costs

Every screen used to send one request per thing it needed. They now travel
together: calls made in the same tick are collected and sent as one batch, which
the engine runs in a single execution — and because `Db` caches each table for
the life of a request, the second and third call read from memory rather than
from the spreadsheet.

| Screen | Calls it makes | Executions |
|---|---|---|
| Dashboard | 1 | 1 |
| Email centre | 3 | **1** |
| Advertising | 2 | **1** |
| Performance | 2 | **1** |
| Billing | 1 | 1 |
| Navigation | 1 | 1 |
| **Six screens** | **13 calls** | **9 executions** |

Nothing above the data layer changed to get this. Screens still call
`api.call('emailTemplates')` one at a time; the queue collects whatever is asked
for before the browser next paints and hands back the same promises.

Three rules keep it safe. Every call inside a batch is authorised on its own —
the obvious way to get this wrong is to authorise the batch and then trust its
contents. Signing in cannot be batched, or a dozen password attempts would share
one execution and the lockout would be cheaper to grind against. And one refusal
does not discard the answers beside it, so a reviewer opening a screen that also
asks for something they cannot see still gets the part they can.

`node tools/studio-bench.js` reproduces the table.

## Making the studio feel instant

Batching made the studio cost less. It did not make it feel quick — every screen
still waited on a round trip, and Apps Script can take a second or two to wake
up. Three changes, measured with the engine answering in 200ms:

| | First visit | Revisit |
|---|---|---|
| Queue | **12ms** — fetched at sign-in | 8ms |
| Published pages | 309ms | **8ms** |
| Email centre (3 calls) | 347ms | **38ms** |
| Advertising | 342ms | **49ms** |
| Performance | 317ms | **17ms** |

**A screen you have opened before paints from what it showed last time**, and the
fresh answer is fetched quietly behind it. If anything actually changed, the
screen redraws and keeps your scroll position; if nothing did, nothing flickers.
A small mark beside the heading says something is being checked — never a
spinner over text you are already reading.

**The four things most people open first are fetched in one batch at sign-in.**
That also wakes the engine, so the first real click is not the one that pays for
the cold start. Hovering a menu item fetches what that screen needs before it is
clicked.

**A save clears everything held.** Working out which screens a particular save
affects is exactly the kind of cleverness that shows somebody a stale number a
month later.

Only reads are held, only in memory, and only for the tab: nothing about users,
invoices or subscribers is written to disk, and signing out discards it. Seven
tests in `tests/studio.js` hold all of this, including that a revisit does not
wait and that a save makes the next screen ask again.

## Writing: local first, then one request

An author types into the browser's own memory and onto their device, and nothing
waits on the network. What travels is a **changeset** — the fields that actually
moved — sent when the typing pauses rather than on a timer.

| | Before | After |
|---|---|---|
| A paragraph written in one sitting | a save every 20 seconds | **one request when the typing stops** |
| What is sent | the whole draft, every time | only the fields that changed |
| A dropped connection | "Not saved" | kept on the device, queued, sent when it returns |
| Two windows on one draft | the last save wins, silently | merged field by field, and the screen says so |
| Closing the laptop mid-sentence | lost since the last autosave | still there when it reopens |

The engine merges rather than overwrites: it reads the payload once, applies the
changed fields, writes Drive once and updates the row once — one execution
whatever the author did in between. If the draft moved underneath the editor, the
answer says so and carries what the server now holds, so the screen catches up
without anybody retyping.

`tests/editor.js` types into a real editor, pulls the connection out mid-sentence,
puts it back, and checks the words are all there.

## Against the eleven priorities

| | | Where |
|---|---|---|
| 1 | Reduce requests | Bootstrap bundle (one request, not five); one beacon per visit |
| 2 | Reduce Apps Script executions | Two beacons became one; every screen's calls travel in a single batch |
| 3 | Reduce Sheets operations | Counting moved out of the sheet entirely; batched row writes |
| 4 | Reduce Drive operations | Unchanged — Drive is touched at publication, not per reader |
| 5 | Batch writes | `Db.update` writes one span; `Db.insertMany` appends in one call; an author's changes travel as one changeset |
| 6 | Cache reads | Per-request table cache; the bundle is CDN-cached; telemetry buffers in the script cache; the studio holds reads in memory and revalidates behind the screen |
| 7 | Coalesce | A thousand visits coalesce into one row update per metric |
| 8 | Incremental sync | Publication writes only what changed; the editor sends only the fields that moved and merges rather than overwrites |
| 9 | Frontend responsiveness | One request before first paint; ads and measurement load after the text |
| 10 | Concurrency and reliability | One reentrant lock; four cache shards; a flush that never invents a creative |
| 11 | Backend responsiveness | One round trip per screen; a revisited screen paints in under 50ms and checks itself afterwards |

## Still worth doing, in order of value

1. **Cache the published configuration in the script cache.** `Content.settings`
   and friends re-read their tables on every call. A cached copy invalidated on
   write would cut most remaining reads in the control centre.
2. **Paginate the audit log and the article index.** Both are read whole today.
   `AuditLogs` grows forever and will eventually be the slowest table.
3. **Archive old telemetry.** `Vitals` gains a row per day, page, metric and
   device. Roll anything older than a quarter into a monthly summary.
4. **Move publication to the git trees API.** Publishing an issue with six
   figures is ten sequential commits; one tree write would do.
5. **Serve the search index only on demand** — already the case — but split it
   once the archive passes a few thousand articles.

## Setup delta

Add one time trigger: **`flushTelemetry`, every ten minutes.** Without it the
counters stay in the cache and expire after an hour, so the performance and
advertising figures stop moving. Everything else keeps working.
