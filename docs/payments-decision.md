# Payments decision (Task 0.5)

**Status: CONFIRMED by the project owner on 2026-10-07.** Researched the same day.

> **Approval is unproven.** Neither provider has accepted an application from us yet. Appearing on a supported-country list does not mean an account will be approved, so treat this decision as provisional until one is.

## Question

Which payment provider can sell subscriptions worldwide and pay out to a seller based in Pakistan? Stripe and PayPal do not onboard Pakistan-based businesses directly, so a merchant of record (MoR) that handles tax and pays the seller out is the practical route.

## Decision

| Role    | Provider      | Payout route to Pakistan                                  |
| ------- | ------------- | --------------------------------------------------------- |
| Primary | Paddle        | Payoneer (or bank wire)                                   |
| Backup  | Lemon Squeezy | Bank payout (Pakistan is on the supported list)           |
| Watch   | Polar         | Stripe Connect Express payout (Pakistan is on their list) |

Paddle is first because its payout route is the best documented one for Pakistan: it pays by Payoneer, which is widely used there and avoids the SWIFT fee that can apply to wires.

## Findings

### Paddle

- Seller location: "Paddle works with software businesses anywhere in the world with the exception of the unsupported countries listed below." Pakistan is not on the unsupported list.
- Payouts: "You can receive your payment either via wire transfer or Payoneer." Monthly, issued on the 1st and sent by the 15th. Minimum threshold $100. "For certain countries, a $15 SWIFT fee may be applicable" on wires.
- Approval is manual and stricter than the others. A third-party write-up by a Pakistan-based founder (June 2026) reports verification delays for solo founders with thin landing pages.

### Lemon Squeezy

- Pakistan appears in the "Bank payouts supported in the following countries" list. PayPal payouts are also offered, but PayPal does not operate in Pakistan, so only the bank route is realistic.
- Payouts twice a month (1st and 15th), sales held 13 days, minimum $50. A payout fee may be deducted depending on method, region and currency.

### Polar

- "Polar uses Stripe Connect Express to issue payouts to residents or businesses in any of the countries below", and Pakistan is in that list.
- Not chosen as primary only because we found no independent confirmation of a payout actually landing in a Pakistani bank account. Worth a test account: its fees are reported to be lower than the other two.

### Ruled out

- Dodo Payments: its own Pakistan guide states "merchant onboarding requires KYC documentation issued in a supported country, and Pakistan is not currently supported."
- Stripe and PayPal direct: not available to Pakistan-based entities.

## What is NOT verified

- **Account approval.** Being on a supported-country list is not approval. None of this is certain until an application is accepted. Apply to Paddle early (it needs a live site with pricing, terms, privacy and refund pages) and to Lemon Squeezy in parallel.
- **Acceptable-use review.** A tool that turns typed documents into handwriting may be read as an academic-dishonesty aid by a provider's risk team. Describe the product honestly in the application and have the Acceptable Use page live first. A rejection on these grounds could apply at every provider, so find this out before Phase 5.
- **Fees.** Headline fees (around 5% + $0.50 per transaction for Paddle and Lemon Squeezy, per secondary sources) were not confirmed on the vendors' pricing pages. The fixed $0.50 is a large share of a low-priced student plan, so check current pricing against the plan prices before committing.
- **Payoneer account.** Assumes the owner has or can open a Payoneer account in Pakistan.

## Action items for the owner

1. Open a Payoneer account if there isn't one.
2. Apply to Paddle and Lemon Squeezy as soon as the landing and legal pages exist (Phase 6), not at Phase 5.

## Sources

- Paddle supported countries: https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- Paddle payouts: https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid
- Lemon Squeezy supported countries: https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Lemon Squeezy payouts: https://docs.lemonsqueezy.com/help/getting-started/getting-paid
- Polar supported countries: https://polar.sh/docs/merchant-of-record/supported-countries
- Dodo Payments on Pakistan: https://dodopayments.com/blogs/sell-software-from-pakistan
- Third-party comparison (Pakistan founder, June 2026): https://jawadhassan.dev/blog/paddle-vs-lemonsqueezy-pakistan
