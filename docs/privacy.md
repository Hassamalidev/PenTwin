# Privacy: what is stored, where, and for how long

Written for whoever reviews the privacy policy, and for anyone changing the code. Every
claim here is backed by a test named in brackets. Last reviewed 2026-10-08.

## What never leaves the visitor's browser

- **Sample photos.** The photo of handwriting is read, cleaned and cut into letters on the
  visitor's own device. It is never uploaded. [`e2e/full-flow.spec.ts`: the worker has no
  upload route; the glyph bank is built in the page.]
- **Documents, while editing.** Word, PDF and text files are parsed in the browser.
  Previews are drawn in the browser. [`apps/web/src/lib/import-file.ts`]

## What the server receives and keeps

| Data                           | Sent when                                     | Stored as                                                                       | Kept for                                           |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| Document text and layout       | Export                                        | Rendered straight to the PDF. **The text itself is never stored.**              | Not at all; only the PDF.                          |
| The finished PDF               | Export                                        | A file on the worker's disk, reachable only by a signed link.                   | 24 hours, then deleted. [`export.test.ts`]         |
| A hash of the export request   | Export                                        | `exports.request_hash`, not reversible; lets a repeat within 24 h be free.      | With the account.                                  |
| Letter shapes (the glyph bank) | Export, or saving a profile                   | Export: in memory only. Profile: encrypted file (AES-256-GCM) plus a row.       | Until the user deletes the profile or the account. |
| Pages, plan, payments          | Payment events, exports                       | `accounts`, `credit_ledger` (append-only), `exports` (time and size only).      | With the account.                                  |
| Network address and device     | Activating, consenting, referrals             | **Salted hashes only**; the raw values are never stored.                        | With the account.                                  |
| Consent                        | Agreeing to terms, privacy, "own handwriting" | `consents`: kind, version of the text, granted or withdrawn, when. Append-only. | With the account. [`accounts.db.test.ts`]          |
| Email address                  | Sign-up                                       | Supabase Auth (`auth.users`).                                                   | With the account.                                  |
| Queued emails                  | Receipts, warnings                            | `email_outbox`: kind and a few fields, no document content.                     | With the account.                                  |
| Cost records                   | Export                                        | Compute time and output size per export. No content.                            | With the account; the report looks back 30 days.   |

Logs contain error names, timings and counts. A test fails if document text appears in
the worker's log, even when an export crashes. [`export.test.ts`: "what the worker
writes to its log"]. Analytics events carry only allow-listed fields. [`analytics.test.ts`]

## A copy of your data

`GET /me/data` returns everything above for the signed-in user as one JSON document,
including their handwriting decrypted for them, and nothing about any other user.
Exported documents are listed by date, pages and plan only, because their text was never
stored. [`accounts.db.test.ts`: "gives the user everything held about them"]

## Deleting an account

`DELETE /me` with `{"confirm": "delete my account"}`:

1. Refused while a paid subscription would still renew, so nobody keeps paying for an
   account that no longer exists. Cancel first (access stays until the period ends), then
   delete.
2. In one database transaction: the account, ledger, exports, profiles, consents,
   referrals and queued emails are removed, and the sign-in record with them.
3. Then the files: every encrypted handwriting file and every PDF of that account's recent
   exports.
4. What remains is one row saying that _an_ account with _n_ profiles was deleted, and
   nothing that says whose.

A test deletes an account with two profiles, an export and consents, then checks every
table, the sign-in record, every file, and that nothing on disk is left without a row
pointing to it. [`accounts.db.test.ts`: "deletes an account with every row and file"]

If the worker crashes between steps 2 and 3, the files are orphaned for at most an hour:
an hourly sweep deletes handwriting files no profile points to (leaving anything newer
than an hour, which may be a save in progress) and PDFs older than 24 hours.
[`accounts.db.test.ts`: "sweeps stray handwriting files"]

## Not done

- **There is no page for any of this.** Deletion, the data copy and consent are worker
  routes only, because sign-in pages (5.2) and the account page (5.8) are not built. The
  privacy policy's promise that users can delete their handwriting is true of the system
  but not yet something a user can do without help.
- Supabase Auth keeps its own audit log of sign-ins; deleting the user removes the user,
  but Supabase's retention of its auth logs is Supabase's, not ours. Check it when the
  project exists.
- Backups (7.4) will hold deleted data until they rotate. The retention period must be
  stated in the privacy policy once backups exist.
- The payment provider keeps its own records of customers and transactions, as the law
  on invoices requires. The privacy policy must say so.
