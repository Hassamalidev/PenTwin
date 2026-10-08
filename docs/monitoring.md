# Monitoring

**No monitoring service is connected yet.** There is no Sentry, uptime or chat account.
What exists is the worker's side of it, tested locally, ready to be pointed at a service.

## What the worker provides

| Need                   | What exists                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "Is it up?"            | `GET /health` answers `{"ok":true}` whenever the process is serving.                                                                       |
| "Can it do its job?"   | `GET /health/ready` answers `200` only if the database can be reached, `503` otherwise. Point uptime checks here.                          |
| Unexpected errors      | Logged as `request failed: <error name>` and sent as an alert: `Unexpected error TypeError on POST /export`.                               |
| Crashes                | An uncaught error is logged, alerted (`Worker stopped after an uncaught exception`), and the process exits so the host starts a fresh one. |
| Cost per page too high | Checked hourly against the limit in `docs/billing.md` ($0.01 a page) and sent as an alert.                                                 |
| Too much load          | Visible to users as `503` and `429` answers; not alerted yet.                                                                              |

Alerts are posted to `ALERT_WEBHOOK_URL` as JSON `{"text": "..."}`, which is what a Slack
incoming webhook accepts. The same message is not repeated for ten minutes. Without the
setting, alerts go to the log only (`ALERT: ...`).

**What an alert can contain:** the error's name, the request method, the route with
identifiers replaced by `:id`, and numbers. Never the error's message, document text, a
file name or handwriting. Tests enforce this (`server.test.ts`, `alerts.test.ts`).

## Not done

- **Sentry (task 7.7's acceptance) is not set up**, on the web app or the worker. It is an
  outside service and a new dependency, so it needs the owner's go-ahead and an account.
  When added, it must be configured to send no request bodies and no breadcrumbs with
  user text.
- **Telegram and email alerts** are not built. A Telegram bot does not accept the
  `{"text"}` format directly; it needs a small adapter or a relay service.
- **No uptime check exists**, because nothing is deployed to check.
- **The web app reports nothing.** A page that breaks in a visitor's browser is invisible
  to us today.
- The alert webhook has only been exercised against a stand-in in tests, never a real
  Slack channel.

## When the accounts exist

1. Create the alert channel and set `ALERT_WEBHOOK_URL` on the worker.
2. Point an uptime monitor at `https://<worker>/health/ready` and at the site's home page.
3. Cause an error on staging on purpose and confirm the alert arrives. That, done through
   Sentry, is the acceptance test for 7.7.
