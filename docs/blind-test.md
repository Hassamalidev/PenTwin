# Blind test protocol (Task 1.11)

**Phase 1 gate:** most testers cannot tell which page was generated.

**Status: not run yet.** See "Before you can run it" below.

## Question being tested

Shown one real handwritten page and one generated page of the same text in the same
handwriting, can people pick out the generated one more often than by guessing?

## Before you can run it

The engine currently only has the synthetic test glyph set, which is a smoothed
single-stroke font. Pages made from it look like a neat font, not like anyone's
handwriting, and would fail this test for a reason that has nothing to do with the
engine. The test needs a glyph bank made from a real person's writing:

- either a hand-built bank (trace or cut that person's letters into the format described
  in `packages/engine/src/glyphs.ts`, at least 3 variants per character),
- or the first working output of the Phase 2 extractor.

The same person must also write the real page.

## Materials

1. **Text:** about 120 words of ordinary prose with digits and punctuation. `tests/sample.txt`
   repeated to fill most of a page works.
2. **Real page:** the writer copies the text by hand on ruled A4 paper with a blue or
   black ballpoint, at normal speed.
3. **Generated page:** the same text rendered with the writer's glyph bank, the `normal`
   preset, matching ruling and ink colour, printed at 100% scale on the **same kind of
   paper** (print on a blank ruled sheet, with the engine's own ruling turned off, so both
   pages have identical printed lines).
4. Scan or photograph both pages the same way if testing on a screen. Printed ink and pen
   ink look different in the hand, so decide up front whether the test is "on paper" or
   "as a scan", and say which in the results. "As a scan" matches how most output will be
   submitted and is the one that counts for the gate.

## Procedure

1. At least **5 testers**, ideally 10 or more. They must not have seen PenTwin output before.
2. Show both pages side by side. Randomise which is on the left for each tester
   (flip a coin) and record it.
3. Say exactly this, and nothing else: _"One of these two pages was written by hand and
   the other was produced by a computer. Which one is the computer's?"_
4. Give them up to 60 seconds. Do not answer questions about the pages.
5. Record their choice, their confidence (1 = pure guess, 5 = certain), and **what made
   them choose**. The reasons are the most useful output of the test.
6. Test people one at a time so they cannot influence each other.

## Passing

A tester guessing at random is right half the time, so with few testers a "pass" is weak
evidence. Use these thresholds:

| Testers | Pass if at most this many pick the generated page |
| ------- | ------------------------------------------------- |
| 5       | 3                                                 |
| 10      | 6                                                 |
| 20      | 12                                                |

Also fail the test if **two or more testers name the same giveaway** with confidence 4 or 5,
even when the count passes. That is a real, fixable defect.

With 5 testers this is only a rough check. Treat a pass at 5 as "no obvious giveaway"
and rerun with 10 or more before relying on it.

## Results

| #   | Generated page was on | Picked | Correct? | Confidence (1-5) | What gave it away |
| --- | --------------------- | ------ | -------- | ---------------- | ----------------- |
| 1   |                       |        |          |                  |                   |
| 2   |                       |        |          |                  |                   |
| 3   |                       |        |          |                  |                   |
| 4   |                       |        |          |                  |                   |
| 5   |                       |        |          |                  |                   |

- Date, glyph bank, preset, engine commit:
- On paper or as a scan:
- Correct identifications: \_\_ of \_\_
- Result: pass / fail
- Giveaways to fix:

## If it fails

Fix what testers named, in this order of likelihood: letters too evenly spaced, the same
letter shape recurring, baseline too straight or too wobbly, uniform pen pressure. Per the
plan, address these with correlated drift, variant avoidance and warping, not by adding
more random noise. Then rerun with **new testers**; people who have seen the pages once
know what to look for.
