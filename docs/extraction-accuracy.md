# Extraction accuracy (Tasks 2.5 to 2.7)

Measured 2026-10-07 with `pnpm extract:measure`.

## Read this first

**Every number here comes from synthetic photos, not real handwriting.** The test pages
are written by the engine with the synthetic glyph set, then rotated, dimmed, shadowed or
blurred. That gives exact ground truth (the character at every position is known), but
the letters are regular and mostly well separated. Real handwriting will score lower,
most of all where letters join. Treat this as proof that the method works and as a
regression check, not as a prediction for real users.

## Results

One page of the copy-paragraph: 591 characters, 126 words, 17 lines.

| Case             | Lines | Labeled correctly | Labeled wrongly | Left out | Clean cuts | Split | Merged | Pairs refused |
| ---------------- | ----- | ----------------- | --------------- | -------- | ---------- | ----- | ------ | ------------- |
| good photo       | 17/17 | 99.3%             | 0.0%            | 0.7%     | 584        | 0     | 3      | 2             |
| dim photo        | 17/17 | 99.3%             | 0.0%            | 0.7%     | 584        | 0     | 3      | 2             |
| skewed photo     | 17/17 | 99.0%             | 0.0%            | 1.0%     | 583        | 0     | 2      | 3             |
| shadowed photo   | 17/17 | 99.3%             | 0.0%            | 0.7%     | 584        | 0     | 3      | 2             |
| blurry photo     | 17/17 | 98.6%             | 0.0%            | 1.4%     | 577        | 4     | 2      | 4             |
| neat writing     | 17/17 | 100.0%            | 0.0%            | 0.0%     | 589        | 0     | 2      | 0             |
| rushed writing   | 17/17 | 99.8%             | 0.2%            | 0.0%     | 570        | 4     | 17     | 0             |
| touching letters | 17/17 | 95.4%             | 0.2%            | 4.4%     | 560        | 0     | 5      | 13            |

How to read the columns:

- **Labeled wrongly** is the bad-cut rate: a cut given the wrong character. This is the
  number that matters most, because a wrong glyph ends up in the user's bank.
- **Left out** is what was flagged or missed instead of guessed. A higher number here is
  the intended trade: it costs coverage (fixed later by the top-up flow), not correctness.
- **Split** counts glyphs cut out of two touching letters; **Merged** counts glyphs put
  together from two marks (the two ticks of a double quote are the usual case).
- **Pairs refused** counts touching letter pairs that were joined by more than a thin
  stroke and were deliberately not cut.

## The bank from one page (Tasks 2.8 to 2.10)

From `pnpm extract:demo`: one synthetic photo, shadowed and rotated 2.5 degrees.

| Measure                    | Result                                                     |
| -------------------------- | ---------------------------------------------------------- |
| Strong characters (3+)     | 36: every lowercase letter and the digits 0, 1, 2, 5       |
| Weak characters (1-2)      | 40: all capitals, six digits, most punctuation             |
| Missing characters         | 6: `# % * + = @`                                           |
| Bank size                  | 162 KB (up to 6 variants per character)                    |
| Time, photo to bank        | 2.3 s on a laptop (quality 0.7, cleanup 1.2, the rest 0.4) |
| Traced outline vs original | over 80% overlap on average                                |

Two things follow directly from the copy-paragraph, not from the extractor:

- **Capitals are weak by design.** The paragraph guarantees each capital only twice, and
  "strong" needs three. Either lengthen the paragraph or accept two variants for capitals.
- **Six symbols are missing** because the paragraph does not contain them. They need the
  fallback chain (2.11) or a top-up sheet (2.12).

The time is for a desktop CPU. A mid-range phone will be several times slower; that is
what Task 2.15 has to measure.

## What holds up

- Dim light, shadow and a few degrees of rotation make no measurable difference.
- A word the writer skipped, or an extra word, does not shift the labels after it
  (covered by tests in `align.test.ts`).
- When letters touch, the result is mostly "left out", not "wrong".

## Known limits

- **Joined-up writing.** Letters connected by a normal pen stroke are refused, not cut.
  A fully cursive sample would leave most letters out. Detecting that case and telling
  the user is not built yet.
- **Perspective.** Only rotation is corrected. A page photographed at an angle is not
  flattened.
- **Curved or drifting lines.** Lines are found from horizontal bands after straightening
  the whole page. A line that sags, or lines at different angles, will be cut badly.
- **Ruled paper, pencil, coloured ink.** Not tested. The instructions ask for plain paper
  and a dark pen for this reason.
- **Confidence** is a fixed score per kind of cut (clean about 0.9, merged 0.6, split 0.5,
  a little lower inside a doubtful word). It ranks cuts sensibly but is not a calibrated
  probability.
