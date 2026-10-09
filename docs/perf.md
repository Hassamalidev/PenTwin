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

## Caveats

- One machine, two runs: treat these as a rough baseline, not a precise benchmark.
- Not measured on the actual deployment target (Phase 7.3), nor under concurrent load.
- The glyph set is synthetic. Re-run once a real extracted bank exists (Phase 2).
