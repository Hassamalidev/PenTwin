# Environments

There are three: **development** (your machine), **staging** (a deployed copy that takes
only test payments) and **production**. Which one a worker is running as is set by
`APP_ENV`. Every setting is documented in [`.env.example`](../.env.example); a test fails
if the code reads a setting that file does not list, or the file lists one nothing reads.

## A fresh clone

```bash
pnpm install
cp .env.example .env     # the defaults are enough to run everything locally
pnpm worker              # terminal 1: http://localhost:8787
pnpm web                 # terminal 2: http://localhost:3000
```

Both programs read the `.env` file at the root of the repository. Anything already set in
the real environment wins over the file, which is how the deployed copies are configured:
they have no `.env` file at all, only settings in the host's dashboard.

With the defaults the worker runs without accounts: exporting is open and unmetered. To
run with accounts locally, start the test database (`pnpm db:up`), apply
`supabase/migrations`, and fill in the "Accounts, pages and payments" section.

## What each environment needs

| Setting                                   | Development                   | Staging                       | Production                     |
| ----------------------------------------- | ----------------------------- | ----------------------------- | ------------------------------ |
| `APP_ENV`                                 | `development` (default)       | `staging`                     | `production`                   |
| `EXPORT_SIGNING_SECRET`                   | optional (temporary one used) | required, 32+ characters      | required, 32+ characters       |
| `EXPORT_STORAGE_DIR`                      | optional (temp folder)        | required                      | required, on a persistent disk |
| `WEB_ORIGIN`                              | `http://localhost:3000`       | required, https               | required, https                |
| `DATABASE_URL`                            | optional                      | required (staging project)    | required (production project)  |
| `SUPABASE_JWT_SECRET`                     | with a database               | required                      | required                       |
| `PADDLE_ENVIRONMENT`                      | `sandbox`                     | **must be `sandbox`**         | **must be `production`**       |
| `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_*` | with a database               | the sandbox ones              | the live ones                  |
| `PROFILE_ENCRYPTION_KEY`                  | with a database               | required, 32+ characters      | required, 32+ characters       |
| `PROFILE_STORAGE_DIR`                     | optional (temp folder)        | required                      | required, on a persistent disk |
| `FINGERPRINT_SALT`                        | with a database               | required, 16+ characters      | required, 16+ characters       |
| `ADMIN_TOKEN`                             | optional                      | optional, 32+ characters      | optional, 32+ characters       |
| `RESEND_API_KEY`, `EMAIL_FROM`            | optional                      | optional (emails wait unsent) | needed for emails to go out    |
| `NEXT_PUBLIC_WORKER_URL`                  | `http://localhost:8787`       | the staging worker            | the production worker          |
| `NEXT_PUBLIC_SITE_URL`                    | `http://localhost:3000`       | the staging address           | the real domain                |

The worker checks all of this when it starts. In staging and production it refuses to
start, listing every problem at once, if a secret is missing or too short, storage is not
set, the web origin is not https, there is no database, or the payment environment does
not match. The messages name the setting and never print its value.

## Rules

- **Separate everything.** Staging and production each have their own database project,
  their own secrets and their own storage. Never point staging at the production database.
- **Staging takes no real money.** `PADDLE_ENVIRONMENT=production` is rejected unless
  `APP_ENV=production`, and the other way round. Use the sandbox webhook secret and the
  sandbox price ids on staging.
- **`PROFILE_ENCRYPTION_KEY` is forever.** Stored handwriting is encrypted with it. Lose
  it or change it and every stored profile becomes unreadable. Keep a copy somewhere safe
  that is not the host's dashboard.
- **`NEXT_PUBLIC_*` values are read when the site is built**, not when it starts. Changing
  one means building again.
- Generate secrets with `openssl rand -hex 32`. Never commit a `.env` file or paste a
  secret into an issue, a commit message or a chat.

## Not yet in place

No staging or production environment exists yet: there are no hosting, database, payment
or email accounts. This document describes how they must be configured when they do.
