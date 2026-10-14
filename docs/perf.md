# Engine performance baseline (Task 1.9)

Measured 2026-10-07 with `pnpm bench` (scripts/bench.ts).

## Setup

- 50 A4 pages, college-ruled paper with margin line, default jitter and warp.
- Synthetic test glyph set (3 variants per character, about 25 curve segments per glyph).
- Machine: laptop, Intel Core i5-8365U @ 1.60GHz (4 cores / 8 threads), Node 24.18, Windows 11.
- Single thread, one process. Two consecutive runs; both are shown because the laptop's
  timings vary a lot from run to run.

## Results

| Measure                  | Run 1               | Run 2           |
| ------------------------ | ------------------- | --------------- |
| Glyphs placed            | 58,480 (1,170/page) | same            |
| Layout + glyph placement | 20.9 ms/page        | 40.1 ms/page    |
| PDF export               | 105.4 ms/page       | 116.0 ms/page   |
| **Total, text to PDF**   | **126 ms/page**     | **156 ms/page** |
| Throughput               | 8 pages/s           | 6 pages/s       |
| PDF size                 | 8.02 MB (164 KB/pg) | same            |
| PNG, one page at 150 dpi | 619 ms, 321 KB      | 618 ms, 321 KB  |
| Peak memory (RSS)        | 450 MB              | 437 MB          |
| Heap in use at the end   | 224 MB              | 236 MB          |

## Target

**A page renders to PDF in under 1 second on a modest server.** The baseline is 6 to 8
times inside that on a 2019 laptop CPU, so the target is met with room to spare.

## What the numbers say

- **PDF export dominates**, and within it, turning coordinates into text. Placement is cheap.
- **PNG is the slow output**: about 0.6 s per page at 150 dpi, roughly five times the cost
  of a PDF page. A 50-page PNG export would take around 30 s on this machine.
- **Memory is the thing to watch.** About 450 MB for 50 pages, because every page's
  geometry is held in memory until the PDF is saved. It grows with page count. Rendering
  and writing pages in batches would cap it; do that before allowing very long documents
  on a small worker.
- **File size** is about 164 KB per page, all vector. It scales with the number of glyphs
  and how many curve segments each one has, so a real extracted bank may differ.

## History

The first implementation used pdf-lib's `drawSvgPath` and its built-in compression:
550 to 730 ms/page and about 965 MB for the same 50 pages. Writing the content streams
directly and compressing with the platform's native deflate brought that down to the
figures above.

## With word bounce, line ride and stroke pressure (2026-10-09)

The default hand gained three habits. Stroke pressure draws each pen stroke of a letter
at its own weight, in at most about 15 weights per page so the page still draws as a
handful of groups. Same machine, same command (`pnpm bench`), one run:

| Measure                  | Before          | After         |
| ------------------------ | --------------- | ------------- |
| Layout + glyph placement | 40.1 ms/page    | 38.6 ms/page  |
| PDF export               | 116.0 ms/page   | 105.2 ms/page |
| Total to PDF             | about 156 ms/pg | 143.9 ms/page |
| PDF size                 | 164 KB/page     | 168 KB/page   |
| Peak memory (RSS)        | 437 MB          | 520 MB        |

Speed and size are unchanged within the noise of one run. **Memory is up by about a
fifth.** The worker's 512 MB container had headroom for that in the earlier 50-page test
(peak 356 MB), but that test has not been repeated with the new habits.

## With the release-review changes (2026-10-14)

The release review (`docs/release-review.md`) added dot drift, word tilt and joins to the
presets, and a pen model to every named ink.

**Default hand, no ink** (`pnpm bench`). Before and after were run back to back, old code
from `git stash`, because this laptop's timings swung by a factor of two that day:

| Measure                  | Before (stash) | After, run 1  | After, run 2  |
| ------------------------ | -------------- | ------------- | ------------- |
| Layout + glyph placement | 78.2 ms/page   | 43.8 ms/page  | 48.5 ms/page  |
| PDF export               | 244.8 ms/page  | 125.1 ms/page | 100.3 ms/page |
| Total to PDF             | 323.0 ms/page  | 168.9 ms/page | 148.8 ms/page |
| PDF size                 | 168 KB/page    | 169 KB/page   | 169 KB/page   |
| Peak memory (RSS)        | 518 MB         | 516 MB        | 530 MB        |

Unchanged within the noise; the "before" run happened to be the slow one.

**With a pen** (`pnpm bench --ink ballpoint-blue`, new in this change). A pen-stroke hand
written with a named ink is now drawn as filled outlines whose width follows the pen.
The outline is built only when a page is exported, so a page in memory is no bigger, but
exporting it is more work:

| Measure                  | One run       |
| ------------------------ | ------------- |
| Layout + glyph placement | 73.5 ms/page  |
| PDF export               | 354.7 ms/page |
| Total to PDF             | 428.2 ms/page |
| PDF size                 | 229 KB/page   |
| PNG, one page at 150 dpi | 3874 ms       |
| Peak memory (RSS)        | 648 MB        |

Within the 1 s per page target, but **peak memory for 50 pages is about 130 MB above the
same run without ink**, and the worker's container is held to 512 MB. This applies only to
pen-stroke handwriting (the demo hand and the test letters): handwriting cut from a
user's photo is filled outlines and never goes through the pen model. **The 50-page
container test (7.3) has to be repeated with the demo hand and a named ink before
deploying.** A first attempt that stored the outlines in the page used 705 MB and 287
KB/page; building them at export time brought that down.

### Pen exports in the 512 MB container (2026-10-14, later the same day)

The container test was repeated, then the pen path was made faster. A CPU profile showed
the time going to turning PDF coordinates into text (now written as whole hundredths of a
millimetre under one scale, the same precision) and to building outlines (now plain loops,
with curves cut into only as many pieces as their bend needs at 0.02 mm). Rendered side
by side at 200 dpi, a page differs from before in 62 of 1.9 million pixels.

Same laptop, Docker Desktop, `--memory=512m --memory-swap=512m`, one 50-page A4 document
each, with `pnpm exec tsx scripts/container-check.ts <url> <n> [--hand demo] [--ink <name>]`:

| Export                               | Before speed-up | After       | Peak memory |
| ------------------------------------ | --------------- | ----------- | ----------- |
| test letters, no ink (as in 7.3)     | 18 s (10-08)    | 22.8 s      |             |
| demo hand, no ink                    |                 | 34.0 s      |             |
| demo hand, ballpoint                 | 97.3 s          | 63.0 s      | 423 MiB     |
| demo hand, ballpoint, 3 sent at once |                 | 57 to 149 s | 439 MiB     |

**No export was killed for memory, and the worker stayed healthy.** The memory question is
closed for these cases. Six at once was tried before the speed-up: the container held
(peak 425 MiB) but the test's own client gave up waiting after 300 seconds, because the
exports queue one after another.

What is still open is speed, not memory: a 50-page document in the demo hand with a pen
takes about a minute, close to the request limit some hosts set. Most documents are a few
pages and take a second or two; the long ones are the reason to move exporting to a
background job, as `docs/deployment.md` already says.

`pnpm bench --ink ballpoint-blue` against `pnpm bench`, run back to back on a busy laptop:
603.8 against 350.0 ms/page, 233 against 170 KB/page, 590 against 448 MB peak RSS. The pen
costs about 1.7 times the time of the same page without it.

## Caveats

- One machine, two runs: treat these as a rough baseline, not a precise benchmark.
- Not measured on the actual deployment target (Phase 7.3), nor under concurrent load.
- The glyph set is synthetic. Re-run once a real extracted bank exists (Phase 2).
