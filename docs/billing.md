# Accounts, pages and payments (Phase 5)

How the paid side works, what has been verified, and what you need to do to connect
real accounts.

## Status

**Built and tested locally. Not connected to any live service.** No Supabase, Paddle or
Resend account existed when this was written, so:

- the database was tested on a plain Postgres in Docker, with a small stand-in for
  Supabase's `auth` schema;
- payment notifications were built and signed by the tests themselves, following Paddle's
  documented format, never received from Paddle;
- no email has been sent.

**The Phase 5 gate is not passed.** It asks for a real test-mode payment. What does pass
is the same sequence with simulated notifications, over HTTP, against a real database:
payment → pages granted → export → pages deducted → cancellation → downgrade
(`apps/worker/src/accounts.db.test.ts`).

## How it works

- **The database enforces the rules.** Row-level security is on for every table. A
  signed-in user can read their own rows and change nothing. Every change goes through
  SQL functions only the server may call (`supabase/migrations/`).
- **Pages are a ledger.** `credit_ledger` is append-only; a balance is the sum of its
  rows, and every row has a reason. Monthly pages lapse at the end of each credit
  period; top-ups and referral bonuses do not, and are spent last.
- **Exports.** The worker lays the document out to get the exact page count, sets that
  many pages aside, makes the PDF, and keeps the pages only if that succeeded. Setting
  aside happens under a lock on the account, so simultaneous exports cannot overspend.
  The same document again within 24 hours is free.
- **The server decides the plan.** It is read from the database on every export. The
  request cannot carry a plan, a price or a watermark setting (unknown fields are
  refused), and paid options asked for on the free plan are replaced by basic ones.
- **Payments.** Paddle notifications are verified by signature, recorded by event id so
  a repeat does nothing, and applied in one transaction.
- **Emails** are written to an outbox in the same transaction as the event that causes
  them, then sent by the worker.

## Plans

Defined once in `packages/shared/src/plans.ts`. **Prices are placeholders.**

| Plan    | Pages a month | Profiles | Watermark | Price (placeholder)    |
| ------- | ------------- | -------- | --------- | ---------------------- |
| Free    | 5             | 1        | yes       | free                   |
| Student | 150           | 3        | no        | $4 a month, $40 a year |
| Pro     | 500           | 10       | no        | $9 a month, $90 a year |

Top-up: 100 pages for $3 (placeholder). Referral: 20 pages each.

On an annual plan the pages still arrive monthly.

## What is not built

- **Sign-in screens in the web app (5.2).** The worker checks Supabase access tokens, but
  the app has no sign-up, sign-in or password-reset pages, and still keeps handwriting in
  the browser. Email verification and Google sign-in are Supabase settings, not code.
- **Checkout (5.6).** Opening Paddle's checkout from the app needs a Paddle account and
  its client token.
- **Billing page (5.8).** `GET /me` returns everything it needs (plan, "37 / 150 pages",
  reset date, renewal date, cancellation state, ledger); the page itself is not built,
  and neither is the link to Paddle's customer portal.
- **Cost dashboard (5.11).** `GET /admin/costs` returns cost per page and margin per plan
  as JSON, and the worker logs an alert above $0.01 a page. There is no visual dashboard.
  The cost rates are estimates until there are real hosting bills.

## Known gaps to close before real money

- **Token format.** Tokens are checked as HS256 with the project's JWT secret. Newer
  Supabase projects can sign with asymmetric keys instead; if yours does, the check in
  `packages/billing/src/auth.ts` must be replaced by a JWKS check.
- **Profile storage is the worker's disk**, encrypted with AES-256-GCM. The plan asked
  for R2 or Supabase Storage. Until that is swapped in, the worker needs a persistent
  disk, and profiles are served through the signed-in API rather than by signed URL.
- **Account farming.** Free pages are granted on activation, limited to 3 accounts a day
  per network address and 2 a month per device. The device value is supplied by the
  browser and can be faked; the address limit is the real barrier, and shared networks
  (a university) will hit it. Expect to tune this.
- **Paddle payloads** were written from the documentation. Field names were checked
  against the docs, but the handler has never seen a real notification.
- **Refunds and chargebacks** from Paddle are not handled (no pages are taken back).
- **The watermark on the free preview** is still only cosmetic (see task 4.5); the
  watermark on free _exports_ is applied by the worker and cannot be bypassed.

## Connecting real accounts

1. **Supabase.** Create a project. Apply the migrations
   (`supabase db push`, or run the files in `supabase/migrations` in order in the SQL
   editor). Do **not** apply `tests/db/supabase-shim.sql`: that is only for tests.
   Turn on email confirmation and, if wanted, Google sign-in under Authentication.
2. **Paddle (sandbox first).** Create the products and prices: Student monthly and
   annual, Pro monthly and annual, and the top-up. Add a notification destination
   pointing at `https://<worker>/webhooks/paddle` for the `subscription.*` and
   `transaction.*` events. When opening a checkout, pass `custom_data: { user_id }` with
   the signed-in user's id: that is how a payment finds its account.
3. **Resend.** Verify a sending domain and create an API key.
4. **Fill in `.env`** from `.env.example`. Never commit it and never paste keys in chat.
5. **Run the gate for real:** sandbox purchase → check the pages on `GET /me` → export →
   cancel in the Paddle customer portal → confirm the plan returns to free at period end.

## Running the tests

```bash
pnpm db:up      # throwaway Postgres in Docker, port 54329
pnpm test:db    # migrations, security, ledger, payments, the HTTP flow
pnpm db:down
```
