# Load and abuse test

Run 2026-10-08 on Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz (8 threads), Node v24.18.0. The worker is the bundled file the container runs, one process, with accounts on and a real Postgres. One machine, one run: a baseline, not a benchmark.

### 50 exports at once (3 full pages each, 50 paying users)

| Result | Check                                                              | Measured                                                                           |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| pass   | every user is on the paid plan before the test                     |                                                                                    |
| pass   | every export completed                                             | 50 of 50; statuses: 200                                                            |
| pass   | the worker protected itself instead of taking everything at once   | 41 of 50 were told "busy" (503) at least once and retried; 155 busy answers in all |
| -      | time until a user had their PDF, counting retries                  | p50 23.4 s, **p95 40.4 s**, slowest 41.7 s                                         |
| -      | time the worker spent rendering one export                         | p50 0.6 s, p95 1.1 s                                                               |
| -      | throughput                                                         | 50 exports, 150 pages in 42.0 s: 3.6 pages a second                                |
| pass   | every user was charged exactly once for exactly their pages        | pages left: 147 (expected 147)                                                     |
| pass   | one completed export recorded per user, none left half-done        |                                                                                    |
| pass   | a downloaded file is a complete PDF with the right number of pages | 3 pages                                                                            |

### Races to spend the same pages twice

| Result | Check                                                                       | Measured                                        |
| ------ | --------------------------------------------------------------------------- | ----------------------------------------------- |
| pass   | 20 one-page exports at once with 5 pages: exactly 5 succeed                 | 5 succeeded, 15 refused for lack of pages (402) |
| pass   | the balance ends at zero, not below                                         | 0 pages left                                    |
| pass   | 10 two-page exports at once with 5 pages: exactly 2 succeed, 1 page is left | 2 succeeded, 1 page left                        |
| pass   | the same document sent 20 times at once is charged once                     | 2 pages charged for 20 requests; statuses: 200  |
| pass   | no balance anywhere is negative                                             |                                                 |

### Attempts to get pages or paid features without paying

| Result | Check                                                           | Measured                    |
| ------ | --------------------------------------------------------------- | --------------------------- |
| pass   | a plan in the request is refused outright                       | status 400                  |
| pass   | "no watermark" in the options is refused outright               | status 400                  |
| pass   | a page count in the request is refused outright                 | status 400                  |
| pass   | a user id in the request is refused outright                    | status 400                  |
| pass   | a free user gets a watermark and is charged, whatever they send | watermarked=true, charged 1 |
| pass   | no token is refused                                             | status 401                  |
| pass   | a made-up token is refused                                      | status 401                  |
| pass   | a token signed with the wrong key is refused                    | status 401                  |
| pass   | an expired token is refused                                     | status 401                  |
| pass   | an unsigned token claiming to be someone else is refused        | status 401                  |
| pass   | the other user's pages were not touched by any of that          |                             |
| pass   | the admin report does not exist for someone without the token   |                             |

### Replayed and forged payment notifications

| Result | Check                                                               | Measured                                   |
| ------ | ------------------------------------------------------------------- | ------------------------------------------ |
| pass   | the same payment sent 25 times at once grants its pages once        | 100 extra pages; processed 1, duplicate 24 |
| pass   | a notification signed with the wrong secret is refused              | status 401                                 |
| pass   | a notification a real signature that is five minutes old is refused | status 401                                 |
| pass   | a notification a real signature on a changed body is refused        | status 401                                 |
| pass   | a notification no signature at all is refused                       | status 401                                 |
| pass   | none of the forged notifications granted anything                   | 100 extra pages                            |

### Oversized and malformed requests

| Result | Check                                                                | Measured             |
| ------ | -------------------------------------------------------------------- | -------------------- |
| pass   | a 9 MB request is refused (limit 8 MB)                               | connection closed    |
| pass   | a 101-page document is refused (limit 100)                           | status 413           |
| pass   | a picture over the size limit is refused                             | status 400           |
| pass   | a picture given as an address is refused: the worker fetches nothing | status 400           |
| pass   | broken JSON is refused                                               | status 400           |
| pass   | none of the refused requests cost a page                             | 150 pages, as before |

### One address sending too much

| Result | Check                                                                              | Measured                      |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------- |
| pass   | 26 exports in a row from one address: the first 20 pass, the rest are told to wait | 20 passed, 6 got 429          |
| pass   | the ones told to wait were not charged                                             | 130 pages left (expected 130) |

### Afterwards

| Result | Check                                                   | Measured       |
| ------ | ------------------------------------------------------- | -------------- |
| pass   | the worker is still running and healthy                 |                |
| pass   | no export is stuck half-done and no balance is negative |                |
| pass   | no temporary files were left behind                     | 79 PDFs stored |
| pass   | the log holds no document text                          | 2 lines logged |

**All checks passed.**

## Reading the numbers

- **No overspend, no crash.** Across every race in this run no user was charged twice, no
  balance went below zero, nothing was left half-done, and the worker stayed up.
- **p95 export time under this load: about 40 seconds** (a second run the same day gave
  30 seconds; treat it as 30 to 40). That is the wait for the unluckiest of 50 people who
  all press Export in the same second, each for a three-page document. The rendering
  itself takes about one second per export; the rest is waiting in line, because one
  worker renders one export at a time.
- **41 of the 50 were first told "busy"** and had to try again. The test's client waits
  and retries by itself. **The web app does not do that yet:** it shows the "busy, try
  again in a moment" message and the user has to press Export again.
- Capacity is therefore roughly **four pages a second** on this laptop (3.6 in this run,
  4.8 in the other). More
  than that needs a faster machine or exporting moved to a background job; a second
  worker is not possible until files move off the worker's disk
  ([deployment.md](deployment.md)).

## What this run found and changed

The first run failed. When the worker answered "busy", each retry was counted against
that visitor's allowance of 20 exports a minute, so under heavy load the people who
waited and retried, as asked, were locked out: only 20 of 50 exports completed. Nobody
was charged wrongly, but they could not export. A request turned away as busy no longer
uses up the allowance, and the suggested wait went from 10 seconds to 5.

## Limits of this test

- One laptop, with the test's own 50 clients and the database competing with the worker
  for the same processor. Not the deployment target, and not behind a real proxy.
- The payment notifications are built and signed by the test the way Paddle documents
  them; no real Paddle account has ever sent one.
- The handwriting is the synthetic test set. Real handwriting may render slower.
- It tests the worker. The web pages and the database's own limits (connections, disk)
  were not put under load.

## How to repeat

```bash
pnpm db:up
pnpm load:test
```

It wipes and uses the throwaway test database only. The command exits with an error if
any check fails.
