# Release review: PenTwin, October 2026

Reviewer stance: a release gate, not a cheerleader. Every claim below was checked against
the code, the rendered samples in `docs/samples/`, the site images in
`apps/web/public/gallery/` and the tracker in `PROJECT.md`. Anything I could not check
says so.

## Verdict: not ready to launch

The engineering is unusually careful: seeded, testable output; credits that cannot be
overspent; strict honesty in the tracker. The product, though, fails its own first promise.
**Nobody has yet seen PenTwin write in a real person's hand.** Every page ever produced
uses a synthetic hand (a Hershey font in tests, a hand-drawn demo set on the site). The two
gates that decide whether the product works at all, the blind test (1.11) and the
competitor comparison (3.10), have never run.

So the most important item in this review is not code:

> **Blocker 0.** Before any launch work, run the extractor on 5 real handwriting photos
> from 5 different people, render a page from each, and run the blind test in
> `docs/blind-test.md`. Until then, "looks human" is a hope, not a result.

"110% like a human" cannot be promised, and must not be written anywhere public (rule 7).
What can be done is to remove, one by one, the specific signs that give machine writing
away, and to measure each one. That is the approach this review takes.

## Scorecard

| Area                                | Grade | Why                                                                            |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------ |
| Realism of output (demo hand)       | C+    | Letter shapes are convincing; the pen and the placement are not (see "Tells"). |
| Realism of output (user's own hand) | ?     | Never seen. Blocker 0.                                                         |
| Extraction from a photo             | ?     | 96-100% on synthetic photos; no real photo ever processed.                     |
| Rendering engine design             | A-    | Pure, seeded, correlated noise, separate random streams, golden tests.         |
| Billing and credits                 | B+    | Ledger and concurrency tests are strong; no real payment has ever run.         |
| Security and privacy                | B     | Headers, RLS, deletion tested; nothing deployed, no outside review.            |
| Website look and feel               | C     | Plain and honest but generic; nothing on it says "this is about handwriting".  |
| Editor UX                           | C     | It works, but it hides state, has no undo, and shows no value on its sliders.  |
| Honesty of public text              | A     | No "undetectable", no invented reviews; tests enforce it.                      |

## Part 1: does the output look human?

### How I looked

I looked at the PNG samples at full size and asked one question of each: what would a
forensic document examiner, or a sharp teacher, point at first? Handwriting examiners rely
on a known list of signs that writing was not done by a live hand: uniform line quality,
blunt starts and stops, mechanical alignment, identical repeats, and "patched" marks that
sit exactly where a template put them. I went through that list.

### Tells found in the current output

Ordered by how fast a reader notices them.

1. **The pen has no physics.** Every stroke is a constant-width line with perfectly round
   ends, like a plotter. A real ballpoint lands with a slightly heavier dot and lifts off
   with a thin, fading tail. A fountain pen is thick on downstrokes and thin across, set
   by the angle of the nib. This is the single biggest tell on the site's demo hand,
   visible at normal zoom. (`writer.ts` draws SVG strokes of one width; `pressure` only
   changes the width between strokes, not along one.)
2. **Dots and crossbars sit where the template put them.** People write a whole word and
   then go back to dot the i's and cross the t's, so dots land a little right and high,
   and crossbars tilt up and drift. In PenTwin the dot of every "i" is exactly over its
   stem, every time.
3. **Every letter is a separate lift of the pen.** Even people who print join some
   letters when they hurry: the exit flick of an "a" runs into the next "n". The engine
   never joins anything, so rushed presets look like fast print, not fast writing.
4. **Words follow the line exactly.** `wordBounce` moves each word up and down, but each
   word is still parallel to its line. Real words each have their own small tilt, because
   each is one motion of the wrist.
5. **The photo effect looks like a filter.** A flat grey wash and an even vignette. It is
   not offered to users yet, which is the right call; it should not be until it is
   better. **Improved:** photo mode now adds the phone's own soft shadow from one edge,
   paper that is not quite flat, slight camera softness, lifted blacks and noise that is
   heavier in the dark (`docs/samples/effect-photo.png`); scan mode is unchanged. Whether to
   offer it to users is the owner's decision.
6. **Ink density is flat inside a stroke** in vector output. Raster output adds grain.
   Accepted for PDF: vector output is a feature.

What already works and must be kept: correlated (not white) drift, variant avoidance,
per-placement warping, pair habits in spacing, fatigue that builds slowly, corrections
that never touch numbers or names.

### The new approach: measure the tells, do not eyeball them

Competing tools are fonts with jitter. Their weakness is the same everywhere: they add
noise to a template. PenTwin's edge should be that it models **how the hand and the pen
behave**, not how the letters look, and that every such behaviour is measured.

New concepts introduced in this round:

| Concept             | What it models                                                                                                                                                                      | Where                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Pen dynamics**    | Each stroke becomes a filled outline whose width changes along its length: heavier landing, tapering lift-off, a nib angle for fountain pens. Still vector, so the PDF stays sharp. | `packages/engine/src/pen.ts`                 |
| **Delayed strokes** | i/j dots and t/f crossbars are added "after the word": shifted, tilted and resized on their own.                                                                                    | `packages/engine/src/marks.ts`               |
| **Word tilt**       | Each word gets its own small rotation about its first letter.                                                                                                                       | `jitter.ts`                                  |
| **Pen-drag joins**  | Inside a word, where one letter ends low on the right and the next starts on its left, the pen sometimes stays down and leaves a thin connecting stroke.                            | `writer.ts`                                  |
| **Tell audit**      | An automated check that scores a rendered page on five tells and fails the build if a preset regresses.                                                                             | `packages/engine/src/tells.ts`, `pnpm tells` |

All of them are off unless set, as the engine rules require. The presets switch them on.
The golden page (no variation) does not change.

### Tell audit: what it measures

`pnpm tells` renders the same text with every preset and with no variation at all, then
measures, from the page itself:

| Tell              | Measure                                                                           | A machine page scores |
| ----------------- | --------------------------------------------------------------------------------- | --------------------- |
| Identical repeats | Share of letters whose shape exactly matches an earlier copy of the same letter   | high                  |
| Ruler baselines   | Spread of letter bottoms around a straight line fitted to each line, in x-heights | 0                     |
| Even pen          | Spread of stroke width along and between strokes                                  | 0                     |
| Template dots     | Spread of the i-dot's offset from the centre of its stem, in x-heights            | 0                     |
| Stamped words     | Spread of the tilt of words within a line, in degrees                             | 0                     |

The pass marks are this review's own judgement, set so that a plain page fails all five
and a page a person would call "neat but real" passes. **They are not measured from real
people's writing**, and passing them is not evidence for the blind-test gate. The audit
is a regression guard: it stops a change from quietly making the output more mechanical.
Results are in `docs/realism-audit.md`.

## Part 2: product and UX

### Website

- **No identity.** The site is a generic flat theme with one green accent. Nothing in the
  visual language says paper, ink or handwriting, which is the product.
- **Hero proves nothing at a glance.** The typed/handwritten slider is good; it should be
  larger and come first, not be competing with two buttons and a tick list.
- **Theme.** Dark mode follows the device only; there is no switch.

Direction taken (modelled on the CodeNearby look, as asked): a neutral zinc base with one
warm accent, an editorial serif for headings, plain sans for text, flat bordered cards with
large radii, a faint dot-grid behind the hero (it reads as graph paper here, which fits the
product), pill buttons, and a light/dark switch. The handwriting face stays for the one
word in each heading that is meant to look written.

### Editor

| Problem                                                  | Fix in this round                          |
| -------------------------------------------------------- | ------------------------------------------ |
| Sliders show no value                                    | yes                                        |
| Nothing shows that the preview is being redrawn          | yes                                        |
| "Start over" wipes the draft with no confirmation        | yes, with an Undo instead of a question    |
| Uploading a file replaces the draft with no confirmation | yes, with an Undo instead of a question    |
| The export dialog cannot be closed with Escape           | yes                                        |
| Blocks cannot be reordered; only paragraphs can be added | yes: move up and down; add heading or list |
| Export takes three clicks                                | yes: two, the PDF saves itself when ready  |
| Choosing a style silently resets pen, paper and slips    | yes: it says so, with an Undo              |

### Handwriting capture

- The photo is never shown back to the user, so they cannot see what was read. Fixed: it
  is shown (from the device, never uploaded).
- There is no step indicator for a three-step flow. Fixed.
- "Delete it from this device" has no confirmation. Fixed in this round.

## Part 3: engineering findings

1. **Preview and export could silently disagree.** The worker's `jitter` schema is a
   non-strict `z.object`, so any engine setting it does not list is dropped without an
   error, and the contract test (`settings-contract.test.ts`) only checks for errors. An
   editor setting the worker does not know would render in the preview and vanish from
   the PDF. Fixed: the test now requires the parsed options to equal what the editor
   sent, and the schema lists the new settings.
2. **The extractor's test pages are written with the presets.** Every realism change to a
   preset changes `docs/extraction-accuracy.md`. That is correct (real writing is
   messier) but it means each realism change must be followed by `pnpm extract:measure`.
3. `globals.css` is 1,500 lines with an override block at the end that redefines earlier
   rules. The redesign replaces the token layer and removes that block.
4. **The extractor guesses on joined letters (found by this round).** Once the rushed
   style joins letters the way quick writing does, the extractor labels 5.7% of cuts
   wrongly on that page instead of refusing them (0.8% before), and 1.5% on the
   touching-letters page (0.2% before). Switching joins off alone brings it back to 1.0%,
   so the joins are the cause (`docs/extraction-accuracy.md`). This breaks the rule "low
   confidence means flag or refuse, never guess", and a quick writer's bank would get
   wrong letters that only the review screen can catch.
   **Mostly fixed, not closed.** Half of the 5.7% was the test counting joining strokes as
   letters; the real figure was 2.7%. A per-letter shape check now refuses a cut whose
   height or tail contradicts its label, which brings rushed writing to 1.02% (6 of 591)
   and touching letters to 1.0%, with clean photos unchanged. That is at the 1% rule, not
   under it, and it costs coverage (about 14% of a rushed page is left out for the top-up
   flow). The known-failure test (`align.test.ts`, "refuses letters joined by the pen")
   stays until the rushed page is under 1%.
5. **Memory with a pen (found by this round).** Drawing pen-stroke handwriting with a
   named ink adds about 130 MB of peak memory to a 50-page export on the laptop (648 MB
   against 519 MB, `pnpm bench --ink ballpoint-blue`). The worker's container is held to
   512 MB. Handwriting from a user's photo is filled outlines and is not affected; the
   demo hand is. **Closed for memory:** the 50-page container test was repeated with the
   demo hand and a ballpoint: peak 423 MiB for one export and 439 MiB for three at once in
   the 512 MB container, never killed. The pen path was also made faster (97 s down to 63 s
   for 50 pages). **Speed stays open:** a 50-page pen export takes about a minute, near
   some hosts' request limit; long exports belong in a background job (`docs/perf.md`).
6. **A numbers-only check missed a broken letter.** While building the pen model, a bug
   turned every "o" of the test letters into a dot, and the tell audit still passed. It
   was caught by looking at the picture, as the engine rules require. A test now covers
   closed loops (`pen.test.ts`). The audit is a guard against drift, not a substitute for
   looking.

## Part 4: what must happen before launch (owner and people)

In order. None of these can be done by code alone.

1. **Real handwriting.** Five people photograph the copy-paragraph. Run extraction, review
   the banks, render a page each. Record the extraction numbers next to the synthetic ones.
2. **Blind test (1.11)** with those pages and 5+ outside people. Re-run `pnpm tells` on
   the same pages, so the audit's pass marks can be checked against what people judged.
3. **Competitor comparison (3.10)** against two or three real font-based tools.
4. **One real phone** end to end (2.15, 7.9): camera, HEIC, timing.
5. Accounts: Supabase, Paddle sandbox, hosting, domain (`docs/owner-setup.md`).

## What this round changes

Engine: pen dynamics, delayed strokes, word tilt, pen-drag joins, the tell audit, and
presets that use them. Worker: schema and a stricter contract test. Web: new theme, light
and dark switch, editor and capture fixes listed above. Every number that moved is in
`docs/realism-audit.md`, `docs/extraction-accuracy.md` and `docs/perf.md`, with the
command that reproduces it.

Where the realism changes apply:

| Change       | Demo hand and test letters (pen strokes) | A user's own hand (filled outlines from a photo) |
| ------------ | ---------------------------------------- | ------------------------------------------------ |
| Pen dynamics | yes                                      | no: the photo already carries the user's pen     |
| Dot drift    | dots and crossbars                       | dots only (a crossbar is joined to its stem)     |
| Word tilt    | yes                                      | yes                                              |
| Joins        | yes                                      | no: an outline has no pen path to continue       |

Results (`pnpm tells`): the plain test-letter page fails all five tells; every style
passes all five in both hands; the normal style as it was before this round fails "pen of
one weight" in both hands and "words all parallel" in the test letters.

Commands added: `pnpm tells` (the audit, `--check` to only check), `pnpm closeup`
(300 dpi crops of the demo hand, before and after, for looking), `pnpm bench --ink <name>`.
