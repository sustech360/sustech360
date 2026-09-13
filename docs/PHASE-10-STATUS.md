# Phase 10 status — billing, backup, and the end of the plan

## What was built

| Capability | Where |
|---|---|
| Customers, packages, orders with server-side totals | `Billing.createOrder` |
| Invoices: sequential numbering, snapshot of lines and billing details, PDF, email | `Billing.issueInvoice` |
| Payments with overpayment refused and separation of duties on confirmation | `recordPayment`, `verifyPayment` |
| Void for an invoice that should never have existed; credit notes for everything else | `voidInvoice`, `creditNote` |
| An optional credit gate on advertising, off by default | `Billing.campaignClear` |
| Backup, verification and a restore that is hard to do by accident | `Backup.gs` |
| Billing screen in the control centre | `admin/billing.js` |

## What was deliberately not built

The specification lists membership, jobs, events, a company directory, premium
reports, institutional services and payment processing. None of them are here,
and that is the recommendation rather than an omission.

The specification's own principle is audience → trust → engagement → revenue.
Nine of those ten commercial lines need an audience that does not exist yet;
building them now produces seven half-features to maintain and nothing to sell.
The one that earns money on day one is invoicing the advertising that phase 6
already sells, so that is what phase 10 built.

**No card data, ever.** Nothing here touches a payment gateway, and nothing
should: taking card details through an Apps Script web app would put a hobby
deployment inside PCI scope, and the failure mode is somebody else's money. The
platform records payments that arrived by transfer or UPI, and says so on the
screen.

Each of the unbuilt lines needs its own phase, its own schema and its own tests.
When one of them is worth building, the thing to copy is the shape used here:
one module, one router section, one suite that attacks it.

## Money, carefully

Amounts are whole numbers of minor units — paise, cents — everywhere except the
screen that formats them. Tax is computed per line at the line's own rate and
rounded once. A test multiplies ₹333.33 by three and checks the total is
₹999.99 with integer tax, because floating point money is how a ledger drifts by
a rupee a month until someone reconciles a bank statement.

Invoice numbers are sequential per financial year, taken under a lock, and never
reused — a void invoice's number is spent, not recycled. A test issues five in a
row and asserts the sequence has no gaps and no repeats.

An issued invoice has **no edit path at all**. There is no `updateInvoice`
action, and a test asserts the action does not exist. Corrections are credit
notes, which is the same immutability rule the rest of this platform runs on:
the customer has a copy in their inbox, and a document that quietly changes
afterwards is worse than no document.

## Backup — the requirement that had no phase

Section 45 of the specification asks for backups. No phase in the plan contained
them, so until this turn the platform could publish, invoice and email, and could
not be restored. That is one bad afternoon from being gone.

`Backup.gs` writes every table to a JSON file in Drive, records what it wrote,
and can read it back. Three things make it a backup rather than a hope:

- **Verification reads the file**, checks every table is present, and refuses a
  snapshot with no supervisor admin in it — restoring that would lock everyone
  out of their own platform. A snapshot of a site with no articles yet still
  verifies; a young magazine must be able to trust its first backup.
- **Restore is deliberately awkward**: supervisor admin only, verified snapshot
  only, a typed confirmation phrase that differs in production, and a reason on
  the record.
- **The state being replaced is snapshotted first.** A restore is the moment you
  most want to be able to undo.

Google Sheets revision history is not a backup. It does not survive the file
being deleted, the account being lost, or a script writing plausible rubbish
into every row.

## Tests

```
phase2   47      phase6   28      phase10  35
phase3   46      phase7   31
phase4   33      phase8   22      total   301
phase5   40      phase9   19
```

301 assertions, all passing. Plus a whole-surface check: 137 router actions, all
resolving, and none of the 128 authenticated ones reachable without a session.

## Before this goes anywhere near real readers

1. **Put it in git.** Ten phases of zip files is not version control, and one
   afternoon in phase 5 I deleted a working screen and recovered it from the
   previous zip. That was luck.
2. **Run `setup()`, then verify a backup, then practise a restore** into the beta
   environment. A restore you have never performed is a procedure you do not
   have.
3. **Rotate every secret** before production: both peppers, the GitHub token,
   and the supervisor's bootstrap password.
4. **Have someone else read `docs/PHASE-1-STATUS.md`** — the password hashing
   limitation is real, and MFA on the supervisor account is the mitigation.
5. **Get the invoice template checked** by whoever does your tax filing. The
   arithmetic is tested; the compliance wording is not, and GST invoices have
   requirements this does not know about.
6. **Load the real archive before trusting the performance numbers.** Everything
   measured so far is a test fixture.

## What remains unbuilt from the specification

Honest ledger, so nothing is assumed finished that is not:

- Membership, jobs, events, company directory, premium reports, institutional
  services, payment processing — phase 10 scope, deliberately declined above.
- The advertiser self-service portal (§29). Advertisers get an emailed invoice
  with a PDF; they cannot log in and look at their campaigns.
- Double-blind review (§10 does not require it; some publications do).
- A corrections notice on revised articles. Versions are tracked and readers are
  not told what changed.
- Guideline version diffs, per-topic newsletter segmentation, frequency capping
  on advertising, image optimisation, figures inside the PDF.

Every one of these is written up in the phase status notes where it arose, with
what it would take.
