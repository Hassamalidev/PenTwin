# Competitor comparison (Task 3.10)

**Phase 3 gate:** in a blind comparison with 5 or more people, PenTwin output is clearly
judged more natural than font-based tools.

**Status: NOT DONE. The gate is not passed.** What exists is the protocol below and one
stand-in image. Neither is a comparison with a real competitor.

## What is here

`font-style-vs-engine.png` (rebuild with `pnpm benchmark`) shows `text.txt` written twice
on the same paper with the same scan effect:

- **Left: font-style.** One fixed shape per letter on a perfectly level line. This is how
  a handwriting font behaves, and so how font-based tools behave at their core.
- **Right: the engine.** Three shapes per letter picked without repeats, per-letter
  warping, drift, the `normal` preset with its ink.

It is useful for seeing what the engine adds. It is **not evidence for the gate**:

- The left side is our own approximation of a font-based tool, not any real product's
  output. Real tools may do more (or less) than this.
- Both sides use the synthetic test glyph set, a smoothed single-stroke font, so neither
  looks like real handwriting. The comparison that matters needs a bank extracted from
  a real person's sample.
- Nobody outside the project has judged it.

## What the real comparison needs

1. **A real glyph bank.** A photo of the sample sheet run through the extractor
   (see the open items at the end of Phase 2).
2. **Two or three existing tools.** Pick the ones a student would actually find by
   searching "text to handwriting". Record each tool's name, URL, the settings used and
   the date, and check that its terms allow using its output this way.
3. **Matched conditions.** The same text (`text.txt`), similar paper and ink colour, the
   same page size, exported at similar resolution. Do not tune PenTwin's settings beyond
   a named preset; use each competitor's defaults or its most natural-looking option.

Save each output here as `<tool>.png`, plus `pentwin.png`.

## Procedure

1. **5 testers at the very least, 10 or more if possible.** None should have seen
   PenTwin output before.
2. Show all pages at once in a random order, labelled A, B, C, D. Shuffle the order for
   every tester and write down which letter was which.
3. Say only this: _"These pages were all made by software imitating handwriting. Put
   them in order from most natural to least natural."_
4. Then ask of the top-ranked page: _"Could this be a real person's handwriting?"_
   (yes / unsure / no), and of every page: _"What gives it away?"_
5. One tester at a time. Do not answer questions about the pages.

## Passing

- PenTwin is ranked first by **at least 4 of 5** testers (8 of 10, 15 of 20). Ranked
  first by chance alone happens 1 time in 3 or 4, so a bare majority is not enough.
- No single giveaway about PenTwin's page is named by two or more testers.

If it does not pass, fix what testers named and rerun with **new testers** before
starting Phase 4. That is the rule the plan sets for this gate.

## Results

| #   | Order shown (A-D) | Ranking (most to least natural) | PenTwin's rank | Could be real? | Giveaways named |
| --- | ----------------- | ------------------------------- | -------------- | -------------- | --------------- |
| 1   |                   |                                 |                |                |                 |
| 2   |                   |                                 |                |                |                 |
| 3   |                   |                                 |                |                |                 |
| 4   |                   |                                 |                |                |                 |
| 5   |                   |                                 |                |                |                 |

- Date, tools and versions, glyph bank, preset, engine commit:
- PenTwin ranked first by: \_\_ of \_\_
- Result: pass / fail
- To fix:
