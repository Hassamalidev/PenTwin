# Deployment

**Nothing is deployed yet.** There are no hosting accounts. This document describes what
has been built and tested locally, and what is left for the day the accounts exist.

## The export worker

The worker ships as a container. The build bundles the worker and everything it imports
into one JavaScript file, so the image is Node plus that file, run as an unprivileged user.

```bash
docker build -t pentwin-worker .
docker run --rm -p 8787:8787 --memory=512m --env-file .env pentwin-worker
```

| What             | How                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health           | `GET /health` answers `{"ok":true}`; the image has a `HEALTHCHECK` that calls it.                                                                 |
| Request timeouts | A client has 30 seconds to send its request (15 for the headers) or is cut off.                                                                   |
| Request size     | 8 MB at most.                                                                                                                                     |
| Document size    | 100 pages per export at most.                                                                                                                     |
| Load             | One export renders at a time and eight wait. Beyond that the answer is `503` with `Retry-After: 5`, and nothing is charged.                       |
| Memory           | Built for a 512 MB machine; the JavaScript heap is capped at 384 MB.                                                                              |
| Stopping         | On `SIGTERM` it stops taking requests, finishes the export in progress (up to 25 seconds), closes the database connections and exits with code 0. |
| Storage          | `/data/exports` (finished PDFs, removed after 24 hours) and `/data/profiles` (encrypted handwriting). Mount a persistent volume at `/data`.       |

### Measured: 50-page exports in a 512 MB container

Measured on 2026-10-08 on the development laptop with Docker Desktop, the container held
to 512 MB with no swap (`--memory=512m --memory-swap=512m`). Each export is a different
50-page A4 document (11.2 MB PDF), sent with `scripts/container-check.ts`, which downloads
every file and opens it to count the pages.

| Sent at once | Result                                          | Time for each | Peak memory |
| ------------ | ----------------------------------------------- | ------------- | ----------- |
| 1            | completed, 50 pages                             | 18 s          | 356 MB      |
| 6            | all 6 completed, one after another              | 15 to 82 s    | 454 MB      |
| 12           | 9 completed, 3 turned away with `503` after 2 s | 13 to 154 s   | 512 MB\*    |

The container was never killed for running out of memory and stayed healthy throughout.

\* The limit was reached, but that figure includes the operating system's file cache for
the PDFs just written, which is given back on demand. The worker's own memory stayed near
350 MB.

**What this found.** The first version let two exports render at once. Two 50-page
documents together pushed the container to its limit and it slowed to a crawl (63 seconds
for two, against 19 for one). Rendering uses a single processor core, so a second export
at once finishes no sooner anyway. The worker now renders one at a time.

**What it means for users.** A 50-page export takes about 18 seconds here, and a second
person arriving at the same moment waits for the first. Typical documents are a few pages
and take a second or two. The time a long export takes is close to the limit some hosts
put on a single request (often 60 seconds), which is a reason to move exporting to a
background job later.

### Why only one machine

Finished PDFs and encrypted handwriting profiles are files on the worker's own disk. If
two machines ran, a download link could reach the machine that does not have the file,
and a profile saved on one would be missing on the other. **Until those files move to
shared storage (Supabase Storage or S3), run exactly one worker machine and scale it by
giving it more memory, not by adding machines.** `fly.toml` is written that way: one
machine, always on, no automatic scaling. This is why "autoscale" in task 7.3 is not done.

### Fly.io (prepared, not run)

[`fly.toml`](../fly.toml) describes one 512 MB machine with a volume at `/data`, the
health check and a 30-second stop grace period. It has not been deployed or even checked
by the Fly tools, because there is no account. When there is:

```bash
fly launch --no-deploy --copy-config        # choose the real app name and region
fly volumes create pentwin_data --size 3
fly secrets set EXPORT_SIGNING_SECRET=... DATABASE_URL=... SUPABASE_JWT_SECRET=... \
  PADDLE_ENVIRONMENT=production PADDLE_WEBHOOK_SECRET=... PROFILE_ENCRYPTION_KEY=... \
  FINGERPRINT_SALT=... WEB_ORIGIN=https://your-domain
fly deploy
```

The worker refuses to start if any required setting is missing and says which
([environments.md](environments.md)). Railway works the same way from the same
Dockerfile; only the dashboard differs.

Tag every image that goes to production (`fly deploy --image-label v2026-10-08-1`) so a
bad release can be rolled back to a known one.

## The database

The schema is the SQL files in `supabase/migrations`, applied in name order. A migration
that has been pushed is never edited; a change is a new file.

**What runs today.** On every push, CI builds a fresh Postgres from the migrations and
runs the database tests against it (job `database`), so a migration that does not apply
cleanly, or breaks a security rule, fails before it can be merged.

**Applying to a real database (prepared, not run).** The workflow
[`deploy-db.yml`](../.github/workflows/deploy-db.yml) applies new migrations with the
Supabase CLI. It is started by hand for staging or production and has never run, because
there is no Supabase project. It is not yet tied to a deploy: until it has been tried on
staging, migrations should be applied by a person, before the worker that needs them.

Two things are only known from the tests' stand-in for Supabase and must be confirmed on
a real project: that the migrations apply there unchanged, and that deleting a user from
`auth.users` (which account deletion does) is allowed for the role the worker connects as.

### Backups

**No backups exist, because no hosted database exists.** When the project is created:
turn on daily backups (and point-in-time recovery on the paid tier), and note the
retention period in the privacy policy, since a deleted account lives on in backups until
they rotate.

**What has been tested** is that a backup of this schema restores and works. Run on
2026-10-08 on the development laptop, against the test container:

```bash
pnpm db:up
pnpm db:restore-check
```

The script fills a database with accounts, subscriptions, exports, a profile, consents, a
referral and a deleted account; takes a `pg_dump` backup; restores it into an empty
database; and checks the result.

| Check                                                               | Result                             |
| ------------------------------------------------------------------- | ---------------------------------- |
| Backup taken and restored                                           | 72 KB, 3.3 s for both              |
| Every table has the same rows; ledger and balances identical        | 11 tables and 2 fingerprints match |
| Row-level security still on for every table; all policies back      | 7 of 7 policies                    |
| The ledger is still append-only                                     | pass                               |
| A signed-in user still sees only their own account                  | pass                               |
| The restored database works: a new export is charged correctly      | 149 pages before, 147 after        |
| A payment handled before the backup is still recognised as a repeat | pass                               |

This proves the method on a small database. **It is not a restore of a hosted backup**,
which is what task 7.4 asks for and can only be done once a Supabase project with backups
exists. Encrypted handwriting files are not in the database and need their own backup of
the worker's `/data` volume; a database restored without them has profiles that cannot be
opened.

## The web app (Vercel: not set up)

**Blocked on two things only the owner can provide: a Vercel account connected to the
GitHub repository, and a domain.** The product name is still a placeholder
(`docs/branding.md`), so there is no domain to point anywhere yet.

What is known to work: CI builds the production site from a clean checkout on Linux on
every push and drives it in four browser engines. Nothing about Vercel itself has been
tried, so the steps below are a plan, not a record.

1. In Vercel, import the GitHub repository and set **Root Directory** to `apps/web`.
   Leave "include files outside the root directory" on: the build reads the shared
   packages and runs two scripts from the repository root that draw the gallery pictures.
2. Framework: Next.js. Install and build commands: the defaults (`pnpm install`, then
   `pnpm build`, which runs those scripts first). Node 22.
3. Environment variables, set separately for Production and Preview:
   `NEXT_PUBLIC_SITE_URL` (the real address, no trailing slash),
   `NEXT_PUBLIC_WORKER_URL` (the production worker for Production, the staging worker for
   Preview). These are read when the site is **built**; changing one needs a redeploy.
4. Every pull request then gets its own preview address automatically. Preview builds
   must point at the staging worker, never production, and the staging worker's
   `WEB_ORIGIN` only allows one origin, so previews can show pages but cannot export
   until that is widened. Decide then whether previews need exporting.
5. Add the domain in Vercel and point DNS at it; HTTPS is issued automatically. Set the
   worker's `WEB_ORIGIN` to exactly that origin, or the browser will refuse its answers.
6. After the first deploy, check: the security headers are present
   (`docs/security.md`), `/sitemap.xml` and canonical links show the real domain, and
   run PageSpeed Insights for the numbers `docs/site-performance.md` could not confirm.

**Things to watch on the first build.** The picture scripts use a native image library
that must install on Vercel's build machine (it installs on GitHub's Linux runners). If
the build cannot reach files outside `apps/web`, the scripts fail with a missing-file
error: that is step 1's setting.
