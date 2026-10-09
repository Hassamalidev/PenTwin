# Private beta plan (Phase 8.1 to 8.3)

**Not started.** There are no testers and nothing is deployed. This is the plan and the
tools that are ready for it. Nothing below is a result.

## Before inviting anyone

- [ ] Staging and production are deployed and the Phase 5 gate has passed with a real
      sandbox purchase (`docs/owner-setup.md`).
- [ ] The app has been tried by the owner on a real iPhone and a real Android phone
      (`docs/qa-checklist.md`).
- [ ] At least one real handwriting sample has gone through the whole flow, and the
      result looked like that person's writing to them.
- [ ] The legal pages have been reviewed, or testers are told plainly that they are drafts.
- [ ] `ALERT_WEBHOOK_URL` is set and someone is watching it.

## Who and how many

20 to 50 students, in two waves: 5 first (to find what is broken), then the rest a week
later. Aim for a mix: phone-only users, neat and messy writers, at least a few who join
their letters (joined-up writing is the known weak spot).

Give each tester a paid plan for the month through a 100%-off code in Paddle, so they
exercise the real payment path without paying.

## The gate: can they do it unaided?

The gate for 8.1 is that testers complete **sign up, sample, export** without help. So
do not walk them through it. Send the link and one sentence, and watch what happens.

Measured from data that already exists:

| Step              | Where it shows up                                               |
| ----------------- | --------------------------------------------------------------- |
| Signed up         | accounts created                                                |
| Confirmed email   | `activated_at` set                                              |
| Saved handwriting | a row in `handwriting_profiles`, or the `sample_uploaded` event |
| First export      | first completed row in `exports`                                |

The gate is passed if most testers reach a first export with no message to support. Decide
the exact bar before the beta starts, not after, and write it here: ______.

## Collecting feedback (built)

- **The feedback form** on the account page, and **"Something looks wrong with this
  result?"** after every export. Both are for signed-in users and store only the user's
  words and a few settings: never the document or the handwriting.
- **Reading it:** `GET https://<worker>/admin/feedback` with the admin token returns
  counts by kind and the 200 most recent, without saying who wrote what.
- **Not built:** a session recording tool. Recording screens that show a person's
  handwriting and documents is hard to make privacy-safe; it needs a decision first.
- A short interview with 5 testers at the end is worth more than any form.

## Triage (8.2)

Sort every item into one of: handwriting extraction failed, result does not look real,
could not work out what to do, something broke, price. Fix the five that stopped the most
people. Record the decisions in `docs/beta-findings.md` (to be written from real findings;
it does not exist yet, on purpose).

## Pricing check (8.3)

- Open `/admin/costs` after two weeks: real cost per page and margin per plan. The target
  is at least $2 margin per paying user; the current figures are estimates from a laptop.
- Ask every tester what they would pay, before telling them the price.
- Change prices in one place: `packages/shared/src/plans.ts`, and the matching prices in
  Paddle.
