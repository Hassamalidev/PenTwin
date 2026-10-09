# What the owner needs to provide

Everything that could be built and tested without outside accounts has been. What is
left needs accounts, keys, a domain, people, or a decision, and only the owner can supply
those. This is the full list, in the order to do it.

**Never paste a key into a chat, an issue or a commit.** Each key goes into the host's
settings page named below (or a local `.env` file, which is ignored by git).
[environments.md](environments.md) explains every setting.

## 1. Decisions (no account needed)

| Decision                                   | Why it blocks                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **The product's real name**                | "PenTwin" is a placeholder (`docs/branding.md`). The name decides the domain. Change it in one file: `packages/shared/src/brand.ts`. |
| **A support email address**                | `support@example.com` is shown on the FAQ and legal pages (`apps/web/src/lib/site.ts`).                                              |
| **Company name and address**               | The legal pages have none, and Paddle requires them.                                                                                 |
| **Prices**                                 | Still placeholders ($4 / $9 a month, $3 top-up) in `packages/shared/src/plans.ts`.                                                   |
| **Analytics: Plausible, PostHog, or none** | Plausible is paid. The code is written for Plausible and loads nothing until a domain is set.                                        |
| **Error monitoring: Sentry or not**        | A new dependency and an outside service; not added without a yes.                                                                    |
| **OCR for scanned PDFs**                   | Needs a large library (Tesseract); only the rules around it are built (4.3).                                                         |

## 2. Accounts and the keys each one gives

### Supabase (database and sign-in) - needed first

Create **two projects**: staging and production.

| What to get                                      | Where it goes                                           | Setting                                     |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------- |
| Database connection string (Settings > Database) | Worker                                                  | `DATABASE_URL`                              |
| JWT secret (Settings > API)                      | Worker                                                  | `SUPABASE_JWT_SECRET`                       |
| Project URL (Settings > API)                     | Web app (Vercel)                                        | `NEXT_PUBLIC_SUPABASE_URL`                  |
| "anon" public key (Settings > API)               | Web app (Vercel)                                        | `NEXT_PUBLIC_SUPABASE_ANON_KEY`             |
| The same connection string                       | GitHub > Settings > Environments > staging / production | secret `DATABASE_URL` (for `deploy-db.yml`) |

Also in the Supabase dashboard: turn on **email confirmation**, set the **Site URL** and
allowed redirect to `https://<your-domain>/signin`, turn on **daily backups**, and (only
if wanted) set up **Google** as a sign-in provider, then set
`NEXT_PUBLIC_GOOGLE_SIGN_IN=on`.

The project must sign tokens with the shared JWT secret (HS256). If it uses the newer
asymmetric signing keys, the worker's token check has to be changed first
(`packages/billing/src/auth.ts`).

### Paddle (payments) - approval can take time, start early

Approval is **not guaranteed** for this kind of product (`docs/payments-decision.md`);
Lemon Squeezy is the fallback and would need its own integration work.

Use the **sandbox** for staging and the live account for production.

| What to get                                                                             | Where it goes    | Setting                                                                                               |
| --------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| Five prices: Student monthly and yearly, Pro monthly and yearly, top-up                 | Worker           | `PADDLE_PRICE_STUDENT_MONTH`, `..._YEAR`, `PADDLE_PRICE_PRO_MONTH`, `..._YEAR`, `PADDLE_PRICE_TOP_UP` |
| Notification destination pointing at `https://<worker>/webhooks/paddle`; its secret key | Worker           | `PADDLE_WEBHOOK_SECRET`                                                                               |
| Server-side API key                                                                     | Worker           | `PADDLE_API_KEY` (for "manage subscription")                                                          |
| Client-side token                                                                       | Web app (Vercel) | `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`                                                                     |
| -                                                                                       | Worker           | `PADDLE_ENVIRONMENT` = `sandbox` or `production`                                                      |

Subscribe the destination to: subscription created, updated, canceled, past due;
transaction completed.

### Hosting

| Account                 | For               | What to set                                                                             |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| **Fly.io** (or Railway) | The export worker | See `docs/deployment.md`. One machine, a volume at `/data`, the settings below.         |
| **Vercel**              | The website       | Connect the GitHub repository; root directory `apps/web`; the `NEXT_PUBLIC_*` settings. |
| **A domain**            | Both              | Point it at Vercel; a subdomain (for example `api.`) at the worker.                     |

### Email, alerts, search

| Account                                      | What to get                                             | Where it goes | Setting                        |
| -------------------------------------------- | ------------------------------------------------------- | ------------- | ------------------------------ |
| **Resend**                                   | API key; a verified sender address                      | Worker        | `RESEND_API_KEY`, `EMAIL_FROM` |
| **Slack** (or any chat that takes a webhook) | An incoming webhook address                             | Worker        | `ALERT_WEBHOOK_URL`            |
| **Google Search Console**                    | Verify the domain; submit `/sitemap.xml`                | -             | -                              |
| **An uptime monitor** (any)                  | Check `https://<worker>/health/ready` and the home page | -             | -                              |

## 3. Secrets you make up yourself

Generate each with `openssl rand -hex 32` and set it on the worker. Use **different values
for staging and production**.

| Setting                  | Note                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `EXPORT_SIGNING_SECRET`  | Signs download links.                                                                           |
| `PROFILE_ENCRYPTION_KEY` | **Keep a copy somewhere safe.** Losing or changing it makes every saved handwriting unreadable. |
| `FINGERPRINT_SALT`       |                                                                                                 |
| `ADMIN_TOKEN`            | Opens the cost and feedback reports.                                                            |

Other worker settings with no key behind them: `APP_ENV` (`staging` or `production`),
`WEB_ORIGIN` (the site's address), `CLIENT_IP_HEADER` (`fly-client-ip` on Fly),
`EXPORT_STORAGE_DIR=/data/exports`, `PROFILE_STORAGE_DIR=/data/profiles`. On the site:
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WORKER_URL`.

The worker refuses to start in staging or production if something required is missing,
and lists every problem by name.

## 4. Things only people can do

| What                                                                                                                                                                 | Task         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **A real photo of real handwriting.** Everything so far runs on synthetic test letters. Put photos in `fixtures-private/` (ignored by git), never in the repository. | 2.x, 3.10    |
| Interview 5 to 10 students about price and use                                                                                                                       | 0.6          |
| The blind test: can people tell engine output from real writing?                                                                                                     | Phase 1 gate |
| Try the app on a real iPhone and a real Android phone (camera, HEIC photos)                                                                                          | 2.15, 7.9    |
| A lawyer's review of the four legal pages                                                                                                                            | 6.7          |
| One test purchase in the Paddle sandbox, end to end                                                                                                                  | Phase 5 gate |
| 20 to 50 beta testers                                                                                                                                                | 8.1          |

## 5. First day with the accounts: the order

1. Supabase staging project: apply the migrations (run the `deploy-db` workflow for
   `staging`, or `supabase db push`), and check sign-up and sign-in work on a local site
   pointed at it. **Expect small fixes here**: the sign-in code was written from the
   documentation and has only met a stand-in.
2. Paddle sandbox: create the prices and the notification destination; deploy the worker
   to staging; buy the Student plan with a test card; watch the pages arrive, export,
   cancel. That is the Phase 5 gate.
3. Deploy the site to Vercel pointing at the staging worker. Run `pnpm load:test` ideas
   against staging (it currently targets a local worker) and PageSpeed Insights.
4. Repeat for production with live keys, then the beta (`docs/beta-plan.md`).
