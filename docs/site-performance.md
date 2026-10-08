# Site performance (Phase 6.9)

Measured 2026-10-08 with Lighthouse against a production build (`next build`, then
`next start`) on the development laptop, using the installed Chrome in headless mode.
One run per row.

| Page    | Run                      | Performance | LCP   | TBT    | CLS | Page weight |
| ------- | ------------------------ | ----------- | ----- | ------ | --- | ----------- |
| Landing | Mobile, default settings | **85**      | 3.1 s | 340 ms | 0   | 324 KiB     |
| Pricing | Mobile, default settings | **85**      | 2.7 s | 470 ms | 0   | 197 KiB     |
| Landing | Mobile, CPU slowdown 2x  | 94          | 2.9 s | 130 ms | 0   | 324 KiB     |
| Pricing | Mobile, CPU slowdown 2x  | 92          | 2.5 s | 270 ms | 0   | 197 KiB     |
| Landing | Desktop                  | 99          | 0.8 s | 80 ms  | 0   | 360 KiB     |
| Pricing | Desktop                  | 98          | 0.7 s | 130 ms | 0   | 197 KiB     |

Accessibility, best practices and SEO scored 100 in every run.

## Against the targets

| Target                                              | Result                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Lighthouse mobile >= 90                             | **Not shown.** 85 with default settings; 92 to 94 calibrated.                                 |
| LCP < 2.0 s                                         | **Not shown on mobile** (2.5 to 3.1 s simulated). 0.7 to 0.8 s on desktop.                    |
| CLS < 0.1                                           | Met: 0 everywhere.                                                                            |
| INP < 200 ms                                        | **Not measured.** INP needs real interactions from real users; Lighthouse does not report it. |
| Modern image formats, lazy loading, font subsetting | Done (see below).                                                                             |

## Why the mobile numbers cannot be trusted either way

Lighthouse's mobile run slows the CPU four times, assuming it starts from a fast desktop.
This laptop's Lighthouse benchmark index was 420 to 510 during the runs, which Lighthouse
itself classes as slow, so the default run simulates a phone considerably slower than the
one it is meant to. The "CPU slowdown 2x" rows use the lower multiplier Lighthouse's
documentation suggests for a machine in this range. They are an estimate, not a pass.

The largest paint on both pages is the introductory paragraph (plain text in a system
font), and what delays it in the simulation is script work on the main thread, not
downloads. **Re-measure on the deployed site (Phase 7.2) with PageSpeed Insights before
treating 6.9 as done.**

## What was done

- The live demo used to download the handwriting engine (213 KiB) while the page loaded.
  It now starts with a picture rendered at build time and downloads the engine only when
  the demo is touched. Landing page, mobile default run: 56 before, 85 after; total
  blocking time 2,630 ms before, 340 ms after.
- Gallery and hero pictures go through the framework's image optimiser (WebP, sized for
  the screen; AVIF is not switched on); everything below the first screen is lazy-loaded.
- The only web font is the heading face, weight 700, Latin subset, served from the site
  itself with `font-display: swap`. Body text uses system fonts.
- Every picture has explicit dimensions, so nothing moves while the page loads.
- No third-party scripts load unless an analytics domain is configured.

## How to repeat

```
NEXT_PUBLIC_SITE_URL=https://example.test pnpm web:build
pnpm --filter @pentwin/web start -p 3111
npx lighthouse http://localhost:3111/ --chrome-flags="--headless=new"
npx lighthouse http://localhost:3111/pricing --chrome-flags="--headless=new"
```

Add `--preset=desktop` for the desktop rows and `--throttling.cpuSlowdownMultiplier=2`
for the calibrated rows.
