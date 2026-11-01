# How PenTwin learns

PenTwin gets better from measurements and answers, not from collecting people's writing. There
are two loops. Neither one trains on a user's document, and neither stores a handwriting image.

## Loop 1: the styles learn from real handwriting (runs by us)

    real pages -> measure -> compare with generated pages -> adjust the style -> gate -> commit

1. `pnpm real:measure <folder>` measures real pages with `packages/extractor/src/measure.ts`
   and writes **numbers only** to `packages/engine/src/real-ranges.json`.
2. `pnpm learn` changes a few settings of a style at random, writes real pages with them,
   measures them with the same code, and keeps a change only if the pages land closer to
   the real range. Settings are bounded, and it uses the demo hand. Neat aims at the lower part
   of the real range and rushed at the upper part.
3. `pnpm learn:cycle <folder>` runs both, then the gate: `pnpm tells --check` and `pnpm test`.
   If the gate fails it restores the previous settings. Otherwise it leaves a change for a
   person to look at and commit. **Nothing reaches users without that commit.**

Each run adds a row to `docs/learning-log.md`, so progress can be read over time. More real
pages make the targets better without any code change: this is how it keeps improving.

## Loop 2: each writer's own hand (runs in their browser)

1. Their sample page sets how uneven their hand is (`tuneJitter`), so a neat writer is not made
   messy.
2. Under the preview the editor asks whether the page looks like them: too neat, looks right,
   or too messy. Each answer nudges one number, in steps that shrink as answers build up, so
   it settles instead of swinging (`apps/web/src/lib/hand-memory.ts`).
3. It stays in that browser. "Forget" clears it, and deleting the handwriting clears it too.

## What is deliberately not built

- **No model trained on users' handwriting or documents.** That would change the privacy
  promise on the site, and needs consent, a legal review and a decision by the owner.
- **No answers sent to a server.** Pooling answers across users would improve the styles
  further, but only as an opt-in that stores the answer and the style name, never text
  or letters. It needs a new table with row-level security and a consent notice.
- **No automatic release.** A loop that changes output by itself can drift unseen; the engine
  rules require someone to look at the pages.

## What this does not prove

Matching measured ranges is necessary, not sufficient. The ranges come from a few writers
copying set text, and the targets may be skewed by how the extractor reads joined writing. The
real test is still people: the blind test, and whether a writer recognises their own hand.
