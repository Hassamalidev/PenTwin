# Runbook: when something goes wrong

**Written before anything was deployed.** No step here has been carried out on a real
system, because there is none yet. Treat it as the plan to rehearse on staging, and
correct it the first time reality disagrees. Related: [deployment.md](deployment.md),
[environments.md](environments.md), [monitoring.md](monitoring.md).

## First five minutes

1. **Is it the site or the worker?** Open the home page. Open
   `https://<worker>/health/ready`: `{"ok":true}` means the worker and database are fine;
   `503` means the worker is up but cannot reach the database; no answer means the worker
   is down.
2. **Did something just change?** A deploy, a migration or a changed setting in the last
   hour is the cause until proven otherwise. Roll it back first, investigate after.
3. **Is money or data at risk?** If users are being charged wrongly or seeing each
   other's data, stop exports first (below), then investigate.

### Stop exports without taking the site down

Scale the worker to zero machines (`fly scale count 0`). The site stays up, the editor
and previews keep working in the browser, and Export shows an error. Nothing is charged
while the worker is down, because pages are only kept for exports that finish.

## Rolling back the web app

Vercel keeps every deployment. In the project's Deployments list, open the last good one
and choose **Promote to Production** (or `vercel rollback <deployment-url>`). It takes
effect in seconds and nothing is rebuilt.

A rollback restores the old pages **with the settings they were built with**: if the
problem was a wrong `NEXT_PUBLIC_*` value, fix the value and redeploy instead.

## Rolling back the worker

Every production image is deployed with a label (`fly deploy --image-label
v2026-10-08-1`). To go back:

```bash
fly releases                       # find the last good release and its image
fly deploy --image <registry>/pentwin-worker:<last-good-label>
```

- The worker finishes the export in progress before stopping (up to 25 seconds).
- Exports and handwriting are on the `/data` volume and are not touched by a rollback.
- **Check the database first.** If the release being undone came with a migration, the
  old code will run against the new schema. See the next section before rolling back.

## Rolling back a database migration

There are no "down" migrations, on purpose: undoing a schema change automatically is how
data gets lost. The approach is to make rollbacks unnecessary, and to roll **forward**
when one is needed.

**Before: write migrations the old code can live with.**

- Add, do not change: new tables, new nullable columns, new functions. The worker
  running before the migration must keep working after it.
- To remove or rename something, use two releases: first ship code that no longer uses
  it, then drop it in a later migration.
- Apply the migration, confirm the old worker is still healthy, then deploy the new
  worker. With this order the worker can always be rolled back on its own.

**After: if a migration is wrong.**

1. Stop exports (above) if it affects pages or payments.
2. Write a new migration that corrects it, test it locally (`pnpm db:up && pnpm test:db`),
   and apply it. Never edit a migration that has been applied.
3. If data was damaged, restore: Supabase's point-in-time recovery to just before the
   migration, into a **new** project; compare; then either switch `DATABASE_URL` to it or
   copy the damaged rows back. Restoring over the live database loses every payment and
   export made since.
4. Payments that arrived during the gap: Paddle retries notifications, and each one is
   applied once however often it is sent, so replaying them is safe.

`pnpm db:restore-check` proves a backup of this schema restores and works; it has only
been run on a test database (`docs/deployment.md`).

## Specific failures

| Symptom                                     | Likely cause                                                           | What to do                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Worker restarts in a loop after a deploy    | A missing or unsafe setting; it refuses to start                       | Read the log: it lists every problem by name. Fix the setting, redeploy.                                                                  |
| Everyone gets "busy" (503)                  | More exports than one worker can render                                | Expected under a spike; it clears by itself. If constant, give the machine more CPU. Do not add a second machine (files are on one disk). |
| Everyone gets "too many requests" (429)     | `CLIENT_IP_HEADER` not set, so all visitors share a limit              | Set it to the host's header (`fly-client-ip`).                                                                                            |
| Exports work but downloads fail (404)       | The worker restarted without its volume, or a second machine was added | Check the volume is mounted at `/data` and that there is exactly one machine.                                                             |
| Saved handwriting cannot be opened          | `PROFILE_ENCRYPTION_KEY` changed or lost                               | Put the original key back. There is no other way to read those files.                                                                     |
| Payments go through, pages do not arrive    | Webhook secret wrong, or the worker was down                           | Check the notification log in Paddle; fix the secret; resend the failed ones from Paddle.                                                 |
| Alerts say a page costs too much            | Slow renders or oversized output                                       | Look at `/admin/costs` for the plan and time; see `docs/billing.md`.                                                                      |
| Browser says the worker's answer is blocked | `WEB_ORIGIN` does not match the site's address exactly                 | Set it to the site's origin, with https and no trailing slash.                                                                            |

## Changing a secret

| Secret                   | Effect of changing it                                                        | How                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `EXPORT_SIGNING_SECRET`  | Download links already handed out stop working (they last an hour anyway)    | Set the new value, redeploy.                                        |
| `ADMIN_TOKEN`            | The old token stops working at once                                          | Set, redeploy.                                                      |
| `PADDLE_WEBHOOK_SECRET`  | Notifications signed with the old one are refused                            | Change it in Paddle and on the worker together; resend any refused. |
| `SUPABASE_JWT_SECRET`    | Every signed-in user is signed out                                           | Rotate in Supabase, then set the new value on the worker.           |
| `FINGERPRINT_SALT`       | Old address and device fingerprints no longer match: abuse limits start over | Only if it leaked.                                                  |
| `PROFILE_ENCRYPTION_KEY` | **Every stored handwriting profile becomes unreadable.**                     | Do not change it. Re-encrypting existing files is not built.        |

If a secret may have leaked, change it first and work out how afterwards.

## After an incident

Write down what happened, when it was noticed, what fixed it and what would have caught
it sooner, and turn the last answer into a test or an alert. Correct this runbook where
it was wrong.
