# Security checklist

Last reviewed 2026-10-08. A ticked item is built **and** covered by an automated test or
a check that was actually run; the test or evidence is named. Unticked items are listed
honestly at the end: most wait for a real deployment.

This is a self-review by the people who wrote the code. Nobody independent has tested it.

## Browser protections (web app)

- [x] **Content Security Policy** on every page: data can only be sent to the site itself
      and the export worker; no plugins, no framing, no `eval`.
      _Test: `e2e/security.spec.ts`; the whole app is driven under the policy by the other
      browser tests._
- [x] **HSTS** (two years, including subdomains), `X-Content-Type-Options: nosniff`,
      `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (no camera,
      microphone or location). _Test: `e2e/security.spec.ts`._
- [x] No third-party scripts unless an analytics domain is configured.
      _Evidence: `apps/web/src/app/layout.tsx`; Lighthouse best-practices 100._

## Uploads

- [x] **Type, size and content are all checked before a file is parsed.** A file's name
      must match its first bytes (a `.pdf` must start like a PDF, a `.docx` must be a zip,
      a photo must be a JPEG, PNG or WebP). Documents are limited to 20 MB and photos to
      30 MB. _Tests: `packages/shared/src/file-kind.test.ts`, `e2e/security.spec.ts`
      ("a file dressed up as another kind")._
- [x] **Documents and photos never reach the server.** They are read and parsed in the
      visitor's own browser tab, which is the sandbox: a malicious file can at worst break
      that one tab. _Evidence: `apps/web/src/lib/import-file.ts`, `photo.ts`; the worker
      has no upload route._
- [x] **What the worker does accept is validated strictly**: JSON only, 8 MB at most,
      unknown fields refused, every number and string bounded, 100 pages at most. Pictures
      inside a document must be real PNG or JPEG data, 2 MB and 30 per document at most.
      The worker never fetches an address found in a request.
      _Tests: `apps/worker/src/schema.test.ts`, `export.test.ts`._
- [x] Handwriting letter shapes are read by our own path parser, not drawn by a browser
      or an image library, so a crafted shape file cannot run anything.
      _Evidence: `packages/engine/src/glyphs.ts`._

## Worker

- [x] Runs in a container as an unprivileged user with a memory limit; one export at a
      time, eight waiting, then `503`. _Evidence: `Dockerfile`; measured in
      `docs/deployment.md`; test: "worker server under load"._
- [x] **Rate limits** per network address: 240 requests and 20 exports a minute, answered
      with `429` and `Retry-After`. _Tests: `rate-limit.test.ts`, "worker server rate
      limits"._
- [x] Request timeouts: a client that stalls is cut off after 30 seconds.
      _Evidence: `apps/worker/src/server.ts`._
- [x] Strict response headers and CORS for the web app's origin only.
      _Test: `e2e/security.spec.ts`._
- [x] **Signed, expiring download links** (HMAC-SHA256, one hour, compared in constant
      time). A changed or expired link is refused. _Test: `export.test.ts`._
- [x] **Temporary files are cleaned up.** Files are written under a temporary name and
      moved into place only when complete; a failed export leaves nothing; exports are
      deleted after 24 hours and strays after one hour. _Test: `export.test.ts`._
- [x] Errors never echo internals to the user, and logs never contain document text.
      _Evidence: `server.ts`; cost records hold only time and size._

## Accounts, money and stored data

- [x] Sign-in tokens are verified (signature, expiry) on every request; the plan and the
      page balance are read from the database, never from the request.
      _Tests: `packages/billing`, `apps/worker/src/accounts.db.test.ts`._
- [x] **Row-level security** on every table; the credit ledger is append-only.
      _Test: `pnpm test:db`._
- [x] Payment webhooks: signature verified over the raw body, 30-second tolerance, each
      event applied once however often it is sent. _Test: `pnpm test:db`._
- [x] Stored handwriting is encrypted (AES-256-GCM); network addresses and device
      identifiers are stored only as salted hashes. _Tests: `accounts.db.test.ts`._
- [x] The admin token is compared in constant time, and the admin route pretends not to
      exist without it. _Evidence: `apps/worker/src/api.ts`._

- [x] **Account deletion** removes every row and every file, and a user can get a copy of
      everything held about them; consent is logged append-only. _Tests:
      `accounts.db.test.ts` (privacy); details in `docs/privacy.md`._

## Secrets and dependencies

- [x] No secret is in the repository; `.env` is ignored and `.env.example` holds no
      values. _Test: `apps/worker/src/config.test.ts`._
- [x] Staging and production refuse to start with a missing or short secret, without
      https, or with live payments outside production; error messages never print a value.
      _Test: `config.test.ts`._
- [x] **Dependency audit** (`pnpm audit --prod`, 2026-10-08): no critical or high
      findings. One moderate finding with no fix available: `sprintf-js`, reached only
      through the command-line part of the Word reader (`mammoth > argparse`), which the
      app never runs. CI fails on any high or critical finding.

- [x] Changing each secret, and what breaks when you do, is written down.
      _Evidence: `docs/runbook.md` ("Changing a secret"); never rehearsed._

## Not done

- [ ] **Nothing here has been checked on a real deployment.** HSTS, TLS and the headers
      must be re-checked on the real domain (for example with securityheaders.com).
- [ ] **`CLIENT_IP_HEADER` must be set on the host.** Without it every visitor behind the
      host's proxy shares one rate limit and one address fingerprint.
- [ ] The Content Security Policy still allows inline scripts and styles. Removing that
      needs per-request nonces, which means giving up pre-built pages.
- [ ] Rate limits are counted in the worker's memory: correct for one worker, and reset
      when it restarts. They need shared storage before a second worker is added.
- [ ] No independent security review or penetration test has been done.
- [ ] Database backups (7.4) and error monitoring (7.7) are tracked in their own tasks.
