# PROJECT.md: PenTwin Build Plan

> **PenTwin**: Your handwriting's twin. Turn any DOCX/PDF into realistic handwriting built from the user's own writing sample.
>
> This file is the **task tracker**. `CLAUDE.md` holds the rules and architecture. Read both before starting any task.

Repo: https://github.com/Hassamalidev/PenTwin.git

---

## 0. How Claude Code Must Work (READ FIRST)

### 0.1 One-time repo setup (Phase 0, Task 0.1)

```bash
git init
git branch -M main
git remote add origin https://github.com/Hassamalidev/PenTwin.git
git add .
git commit -m "chore: initial commit with CLAUDE.md and PROJECT.md"
git push -u origin main
```

If `git remote add origin` fails because the remote already exists, run `git remote set-url origin https://github.com/Hassamalidev/PenTwin.git`.

**If the push fails with an authentication error, STOP and tell the user.** Do not try to work around it. The user must authenticate once (`gh auth login`, an SSH key, or a Personal Access Token). Never ask the user to paste a token into chat and never write credentials into any file.

### 0.2 Task completion protocol (MANDATORY after EVERY task)

A task is **not done** until all steps below are complete:

1. Run `pnpm typecheck && pnpm lint && pnpm test`. Everything must pass. (Before Task 0.2 creates the toolchain, skip steps that don't exist yet.)
2. Verify the task's **Acceptance** line. If it needs a visual check, generate a sample output image and describe what to inspect.
3. Tick the task's checkbox in this file (`[ ]` -> `[x]`) and add a one-line note if anything deviated from the plan.
4. Commit with a conventional message that includes the task ID:
   `feat(engine): add baseline drift [1.3]`
5. **Push to GitHub immediately**: `git push origin <current-branch>`
6. Confirm the push succeeded (`git status` shows up to date with origin). Report the commit hash to the user.
7. Only then start the next task.

### 0.3 Branching

- `main` is always deployable.
- Work on one branch per phase: `phase-1-engine`, `phase-2-extractor`, etc.
- **Push after every task** on the phase branch. When the phase's gate is passed, open a PR to `main` (or merge if working solo) and tag it: `git tag phase-1-complete && git push --tags`.
- Never force-push. Never rewrite pushed history.

### 0.4 Hard rules

- **Never commit** secrets, `.env` files, user handwriting images, or user documents. Keep `.env.example` updated instead. Check `.gitignore` before the first commit.
- One task at a time. Don't start features that aren't in the current task.
- Don't add paid services or heavy dependencies without asking.
- If requirements are ambiguous, ask **one** focused question.
- If a task's Acceptance can't be met, stop and report the blocker instead of faking completion.

### 0.5 Legend

`[ ]` not started, `[~]` in progress, `[x]` done and pushed, `[!]` blocked (add a note)

---

## Phase overview

| # | Phase | Outcome | Gate to pass |
|---|---|---|---|
| 0 | Foundations & validation | Repo, tooling, risky assumptions checked | Assumptions validated or plan adjusted |
| 1 | Rendering engine | Text -> realistic handwritten PDF | Blind test: most people can't tell |
| 2 | Sample capture & extraction | Phone photo of one page -> personal glyph bank | Usable bank in < 60s from a real photo |
| 3 | Realism upgrade | Ink, paper, scan effects, fatigue, corrections, bigrams | Side-by-side beats a font-based competitor |
| 4 | Import & editor | DOCX/PDF in, live preview, export dialog | Full local flow works end to end |
| 5 | Accounts, credits, payments | Auth, ledger, subscriptions, free tier | Test-mode payment grants credits correctly |
| 6 | Landing, pricing, SEO | Public site that converts and ranks | Lighthouse targets met, indexable |
| 7 | Deploy, security, QA | Production-ready and hardened | Load test + security checklist pass |
| 8 | Private beta & launch | Real users, real feedback, first revenue | 10 paying users |
| 9 | Post-launch | Cursive, Urdu, donor library, premium upgrades | Driven by demand |

---

## Phase 0: Foundations & Validation

**Goal:** a clean repo and proof that the riskiest assumptions hold, *before* heavy building.

- [x] **0.1 Repo init & first push.** Run the setup in section 0.1. Add `.gitignore` (node_modules, .env*, .next, dist, uploads, fixtures-private). Add README stub.
  *Note:* this tracker was first committed as `claude.md` and later renamed to `PROJECT.md`.
  *Acceptance:* `main` visible on GitHub with CLAUDE.md and PROJECT.md.
- [x] **0.2 Monorepo toolchain.** pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest. Folders per CLAUDE.md (`apps/web`, `apps/worker`, `packages/engine|extractor|importers|shared`).
  *Note:* pnpm pinned to 10.x via `packageManager` (pnpm 12 binary fails to launch on the dev machine); TypeScript held at 6.x until typescript-eslint supports 7.
  *Acceptance:* `pnpm typecheck && pnpm lint && pnpm test` pass on an empty-but-wired repo.
- [x] **0.3 CI.** GitHub Actions running typecheck, lint, tests on every push and PR.
  *Acceptance:* green check on the latest commit.
- [x] **0.4 Shared foundations.** `shared/rng.ts` (seeded PRNG, e.g. mulberry32), `shared/constants.ts`, shared types. Ban `Math.random()` in engine via lint rule.
  *Acceptance:* same seed yields identical sequence; lint fails on `Math.random()` in `packages/engine`.
- [x] **0.5 Assumption check: payments.** Research whether Lemon Squeezy, Paddle, or an alternative can pay out to a Pakistan-based seller. Write findings to `docs/payments-decision.md` with sources and the chosen provider plus a backup. *Do not guess; verify current terms.*
  *Note:* owner confirmed Paddle (primary) and Lemon Squeezy (backup) on 2026-10-07. Account approval is unproven until an application is accepted.
  *Acceptance:* a documented decision, flagged for the user to confirm.
- [x] **0.6 Assumption check: willingness to pay.** Create `docs/user-interviews.md` with a 5-question script for the user to ask 10 students (current solution, price tolerance, must-have features). Claude Code only prepares the template; the user fills it.
  *Acceptance:* template committed. Gate: price tiers in CLAUDE.md are revisited after interviews.
- [x] **0.7 Name & domain check.** Document PenTwin domain/social/trademark check results in `docs/branding.md` (fallback: OwnHand).
  *Note:* "PenTwin" is a placeholder (InkTwin conflict, pentwin.com owned by someone else). The name lives only in `packages/shared/src/brand.ts`.
  *Acceptance:* decision recorded.

**Decision gate:** if payments can't be solved, fix that before Phase 5. It doesn't block Phases 1-4.

---
"use this paragraph"
"Amy, Ben, Cara, Dev, Eli, Fay, Gus, Hana, Ivy, Jack, Kim, Leo, Mia, Noah, Omar, Pria, Quinn, Raj, Sara, Tom, Uma, Vik, Wes, Xena, Yusuf and Zoe.
The quick brown fox jumps over the lazy dog, and my five boxing wizards jump quickly through the cold, green street.
On 03/14/2025 at 9:45 pm, I paid $678.50 for 12 books (all good!). "Really?" she asked; 'Yes,' I said - reading, writing & learning take much attention."
"for user to upload, template"

## Phase 1: Rendering Engine (the make-or-break phase)

**Goal:** text + glyph set + seed -> realistic multi-page PDF. No UI, no accounts. If this doesn't look good, nothing else matters.

- [x] **1.1 Test glyph set.** Create `tests/fixtures/glyphs/sample-user/` with at least 3 SVG variants per a-z, A-Z, 0-9, and common punctuation, plus `metadata.json` (baseline offset, advance width, side bearings). A script to hand-build or convert from the user's own handwriting photos is fine. Rough quality is OK.
  *Note:* the set is synthetic (Hershey single-stroke font, smoothed and perturbed into 3 variants), not real handwriting. Regenerate with `pnpm fixtures:glyphs`.
  *Acceptance:* a loader validates the set with zod and reports missing characters.
- [x] **1.2 Layout engine (`layout.ts`).** Greedy line-breaking with word wrap, margins, A4/Letter/A5, pagination, paragraph spacing, hyphenation off by default.
  *Note:* `hyphenate` only adds a hyphen where an over-long word is force-broken; dictionary hyphenation is not implemented.
  *Acceptance:* unit tests for long words, empty lines, exact-fit lines, page overflow.
- [x] **1.3 Glyph bank & variant selection (`glyphs.ts`).** Load a bank, pick variants with `variantAvoidRepeat` (never the same variant twice in a row, and avoid repeating within a short window).
  *Acceptance:* test shows no immediate repeats over 10,000 picks with >= 2 variants.
- [x] **1.4 Renderer (`render.ts`).** Place glyphs on an SVG page respecting baseline, advance width, and side bearings. Spaces and unknown characters handled safely (report, don't crash).
  *Note:* sample text is `tests/sample.txt`, golden page is `tests/golden/sample-page-1.svg`.
  *Acceptance:* a generated SVG page for `test/sample.txt` committed as a golden snapshot.
- [x] **1.5 Jitter module (`jitter.ts`).** All parameters from CLAUDE.md 5.5 (baseline drift, line slope, rotation, size, word/letter spacing, slant, stroke width), seeded and configurable. Make drift **correlated** (smooth low-frequency noise), not pure white noise. Humans drift smoothly; pure random looks fake.
  *Note:* CLAUDE.md was empty when this was built, so the parameter values are the engine's own defaults, not those of section 5.5. Visual sample: `docs/samples/jitter-off.png` vs `jitter-on.png`.
  *Acceptance:* visual sample with jitter off vs on; same seed reproduces exactly.
- [x] **1.6 Procedural glyph warping.** Per-placement tiny affine + low-frequency noise warp so 3 stored variants never look like 3 variants.
  *Note:* visual sample: `docs/samples/warp-e.png`.
  *Acceptance:* a paragraph with the letter "e" repeated shows visible but natural variation.
- [x] **1.7 Paper backgrounds (`paper.ts`).** Plain, ruled (narrow/wide/college), margin line, graph, dotted. Text must sit **on the lines** with believable imperfection.
  *Note:* graph and dotted paper place one line of writing every two 5mm rows. Visual samples: `docs/samples/paper-*.png`.
  *Acceptance:* ruled-page sample where baseline tracks the ruling.
- [x] **1.8 PDF/PNG export.** pdf-lib multi-page PDF, plus per-page PNG. Embed vector where possible to keep files small.
  *Note:* a 10-page ruled A4 PDF is 1.7 MB (about 170 KB per page), fully vector, and was checked by rasterizing it in a separate PDF renderer. PNG export uses `@resvg/resvg-js` (new dependency, Node only).
  *Acceptance:* 10-page PDF opens in a standard viewer; file size is reasonable (record it).
- [x] **1.9 Performance baseline.** Benchmark pages/second and memory for a 50-page document; record in `docs/perf.md`.
  *Note:* 126-156 ms per page to PDF (6-8 pages/s) and about 450 MB for 50 pages on a laptop i5; target is under 1 s per page. Re-run with `pnpm bench`.
  *Acceptance:* a documented baseline and a target (e.g., a page renders in < 1s on a modest server).
- [x] **1.10 Presets v1.** "Neat", "Normal", "Rushed" as parameter bundles.
  *Note:* visual samples: `docs/samples/preset-*.png`.
  *Acceptance:* three visibly different outputs from the same text.
- [x] **1.11 Blind test protocol.** Write `docs/blind-test.md`: print one generated page beside a real handwritten page, ask 5+ people to identify the generated one, record results.
  *Note:* protocol written; the test itself has NOT been run and the Phase 1 gate is NOT passed. It needs a glyph bank made from real handwriting, which the synthetic test set is not.
  *Acceptance:* protocol committed. **Gate:** most testers can't identify the generated page.

**Risks:**
- Looks "too uniform": fix with correlated drift, variant avoidance, and warping, not by adding more random noise.
- Letters sitting too evenly spaced: vary letter spacing by letter pair, not globally.

---

## Phase 2: Sample Capture & Glyph Extraction

**Goal:** user copies a designed paragraph in their own writing, photographs it, and gets a personal glyph bank. This is the hardest technical phase.

- [x] **2.1 Design the copy-paragraph.** Write 1-2 pages of natural-sounding text that guarantees: every lowercase letter >= 3 times, every capital >= 2, digits 0-9, common punctuation, and common pairs (th, er, ing, tion, ll, ee, oo, ou, st, ch). Store in `docs/sample-text.json`.
  *Note:* built on the paragraph given in this file, plus one more paragraph for second capitals, digits and q/x/z (126 words). It does not contain # % * + = @, so those need the fallback or top-up flow. Check with `pnpm sample:check`.
  *Acceptance:* a **coverage script** counts characters and pairs and fails if any target is missed. Paragraph must read naturally, since awkward text makes people write unnaturally.
- [x] **2.2 Printable/on-screen sample sheet.** A page showing the text in a clear, readable font with instructions: plain white paper, dark pen, normal handwriting, normal speed, don't try to be neat. Generate a printable PDF.
  *Note:* a PDF (`docs/sample-sheet.pdf`, regenerate with `pnpm sample:sheet`). The on-screen version belongs to the web app and is not built yet.
  *Acceptance:* sheet renders on mobile and prints on A4.
- [x] **2.3 Image preprocessing (`clean.ts`).** Load photo -> grayscale -> illumination correction -> adaptive threshold -> deskew/perspective correction -> denoise. OpenCV.js in the browser.
  *Note:* written in plain TypeScript instead of OpenCV.js, so there is no multi-megabyte download on phones and it runs unchanged in tests. Rotation is corrected; **perspective correction is not implemented**. Tested on synthetic photos (engine-rendered pages, degraded), not real ones.
  *Acceptance:* tested on fixtures: good, dim, skewed, shadowed, slightly blurry.
- [x] **2.4 Image quality gate.** Detect blur (Laplacian variance), low resolution, heavy shadow, cropping. Return specific, friendly instructions ("Move closer", "Add more light") instead of a generic error.
  *Note:* limits are calibrated on synthetic photos only and need checking against real phone photos. A page photographed against a dark table is not handled yet (the surroundings would read as ink).
  *Acceptance:* bad fixtures rejected with the right message; good ones pass.
- [x] **2.5 Line & word segmentation (`segment.ts`).** Horizontal projection for lines (handle slanted/uneven lines), gaps for words.
  *Note:* line and word counts match on all five synthetic photo conditions (words within 3%). Relies on deskew; lines that curve or drift on their own are not handled.
  *Acceptance:* line count and word count match expected on fixtures within a tolerance.
- [x] **2.6 Alignment to known text (`align.ts`).** Match detected words/characters to the expected paragraph so each cut gets a label. Use sequence alignment (edit-distance style) so one missed or merged word doesn't ruin everything after it.
  *Note:* about 99% of characters labeled correctly and under 1% wrongly on the synthetic photos; a skipped or extra word no longer shifts what follows. Unplaceable words and joined letters are flagged, not guessed.
  *Acceptance:* >= 90% of characters labeled correctly on clean fixtures; low-confidence cuts flagged, not guessed.
- [x] **2.7 Character cutting.** Connected components + splitting of touching letters (semi-cursive is common). Keep a confidence score per glyph. Where letters connect and can't be split reliably, mark them and don't force a bad cut.
  *Note:* bad-cut rate 0.0-0.2% on synthetic photos, with joined letters refused rather than cut. Numbers and limits are in `docs/extraction-accuracy.md`. Not measured on real handwriting.
  *Acceptance:* confidence scores exist; the bad-cut rate is measured on fixtures.
- [x] **2.8 Normalization.** Baseline detection, x-height, bounding box, stroke-width normalization, advance width and side bearings per glyph.
  *Note:* baselines are fitted per line and the same letter comes out the same height on every line (spread under 10%). Stroke width is measured and stored, but glyphs are **not** thinned or thickened to a common width.
  *Acceptance:* glyphs from different lines are consistently scaled and baselined in a test render.
- [x] **2.9 Vectorization (`vectorize.ts`).** Potrace WASM -> clean SVG paths, simplified to keep bank size small (target a few hundred KB per profile).
  *Note:* uses a small built-in outline tracer instead of Potrace WASM (no extra download, runs in tests). A full bank from one page is about 160 KB. Traced outlines overlap the source bitmaps by over 80% on average; visual check: `docs/samples/extracted-bank.png` (`pnpm extract:demo`).
  *Acceptance:* bank size recorded; visual diff vs raster is acceptable.
- [x] **2.10 Coverage report (`coverage.ts`).** For each character: variant count and quality score. Classify as strong (>= 3), weak (1-2), or missing.
  *Note:* from one page: 36 strong, 40 weak, 6 missing. Capitals are weak because the copy-paragraph only guarantees two of each; the six missing symbols are not in the paragraph at all.
  *Acceptance:* report matches reality on fixtures.
- [x] **2.11 Fallback chain (`fallback.ts`).** Implement in order: reuse own variants -> transform from a related glyph (scaled lowercase for c, o, s, v, w, x, z capitals; and similar) -> top-up request. Mark every derived glyph. **Never substitute silently.**
  *Note:* characters with no sound recipe (`# % * @ & $ ? ! /` and most letters) are never invented; they go to the top-up list. Known flaw: a capital made by enlarging a lowercase letter also gets thicker strokes.
  *Acceptance:* a fixture with deliberately missing letters yields a complete bank with derived glyphs flagged.
- [x] **2.12 Top-up flow.** Generate a small "write these N characters" sheet and merge the results into the existing bank.
  *Note:* each top-up line starts with the word "none" so letter size and baseline can be measured. Handwritten glyphs are never overwritten; derived stand-ins are dropped when a handwritten one arrives. **"%" cannot be topped up yet**: it is three separate marks and the cutter only joins two.
  *Acceptance:* merging improves coverage without overwriting good glyphs.
- [ ] **2.13 Review screen UI.** Grid of every extracted glyph with quality indicator, "replace this letter" and "retake" options, and a live test sentence rendered with the bank.
  *Acceptance:* a user can fix a bad "g" in under 30 seconds.
- [x] **2.14 Style features.** Compute slant, stroke width, x-height ratio, roundness, letter width and store with the profile (used later for the optional donor library and for auto-tuning jitter to the user's own style).
  *Note:* between two samples from the same synthetic writer: slant identical, stroke width within 5%, letter width within 1.3%, the rest identical. Slant is recovered to about 1 degree. Returned as `style` from the extractor; saving it to a profile comes with storage in Phase 5.
  *Acceptance:* features stable across two samples from the same writer (record variance).
- [ ] **2.15 End-to-end timing.** Measure photo -> usable bank on a mid-range phone browser.
  *Acceptance:* **Gate: under 60 seconds** with no server compute.

**Risks:**
- Phone photos are messy. The quality gate and clear instructions matter more than clever algorithms.
- True cursive can't be cut per letter. Detect it (low confidence on many cuts) and tell the user honestly that print/semi-cursive works best at launch.
- Different pens/paper: test with pencil, blue ink, and ruled paper in fixtures.

---

## Phase 3: Realism Upgrade (the competitive edge)

**Goal:** go beyond "letters placed on a line" to output that survives scrutiny.

- [x] **3.1 Auto-tune jitter from the user's own style.** Use style features from 2.14 so a naturally neat writer isn't made messy and vice versa.
  *Note:* the sample now also yields four consistency measures (slant, size, baseline and spacing variation), and `tuneJitter(style, xHeight)` turns them into settings. It adds no slant, because extracted glyphs already lean the way the writer does. Callers pass the result as `jitter`; nothing applies it automatically yet.
  *Acceptance:* two different profiles give visibly different default behavior.
- [x] **3.2 Bigram/ligature support.** Capture common pairs when cleanly cut (th, er, in, an, ing, ll...) and prefer them in rendering to break repetition.
  *Note:* pairs only, no three-letter groups ("ing" is covered by "ng"). A clean sample yields about 29 pairs and the bank grows from about 160 KB to 236 KB. In a test sentence 24 pairs were used with no join artifacts. Pair glyphs are used 70% of the time by default (`bigrams` option).
  *Acceptance:* a count of bigram usage in a sample output; no visible join artifacts.
- [x] **3.3 Ink engine (`ink.ts`).** Ballpoint (blue/black), gel, fountain (shading + slight bleed), pencil (grain). Pressure variation along strokes where data allows; otherwise stroke-width variation.
  *Note:* shading and width follow slow, correlated noise standing in for pressure, since glyphs carry no pressure data. Grain and bleed appear in PNG output only; PDF shows colour, opacity and width. On extracted (filled) glyphs a broader pen is drawn as an outline around the glyph. Samples: `docs/samples/ink-*.png`.
  *Acceptance:* each ink visibly distinct; fountain shows shading.
- [ ] **3.4 Fatigue mode.** Writing degrades gradually through a page: more drift, slightly larger spacing, a bit more slant. Must be **subtle**; overdone it looks fake.
  *Acceptance:* blind check that page 1 vs last line differ believably.
- [ ] **3.5 Corrections.** Occasional strikethrough with a rewritten word, small overwrites. Frequency is a slider, default low. Never alter meaning-critical text (numbers, names, formulas): protect those tokens.
  *Acceptance:* corrections appear naturally and never corrupt protected tokens.
- [ ] **3.6 Scan & photo effects (`effects.ts`).** Clean-scan mode and phone-photo mode: gentle shadow gradient, slight rotation, paper grain, vignette, noise, optional crease. Keep subtle; heavy filters look fake.
  *Acceptance:* before/after samples; effect is toggleable and tuned.
- [ ] **3.7 Headers & page furniture.** Handwritten name/roll number/date header, page numbers, underlined headings, optional margin notes.
  *Acceptance:* header fields configurable and rendered in the user's handwriting.
- [ ] **3.8 Structured content rendering.** Headings (bigger/underlined), bold (heavier stroke), lists with handwritten bullets/numbers, tables with slightly wobbly lines, images placed on the page.
  *Acceptance:* a document with all structure types renders sensibly.
- [ ] **3.9 Presets v2.** Add "Exam hall" and "Lecture notes". Each is a parameter bundle plus paper/ink defaults.
  *Acceptance:* five presets, each distinct.
- [ ] **3.10 Competitor comparison.** Generate the same text with 2-3 existing font-based tools and PenTwin; save side-by-side images in `docs/benchmarks/`.
  *Acceptance:* **Gate:** PenTwin is clearly more natural in a 5+ person blind comparison. If not, iterate before moving on.

**Risk:** realism features combine; always test combinations (fatigue + corrections + photo effect), not just each alone.

---

## Phase 4: Document Import & Editor

**Goal:** the full user flow, locally: upload -> preview -> export.

- [ ] **4.1 DOCX importer.** mammoth.js -> normalized blocks (headings, paragraphs, lists, tables, images, bold/italic).
  *Acceptance:* fixture DOCX with all block types parses correctly.
- [ ] **4.2 Text PDF importer.** pdf.js text extraction with reading-order cleanup (columns, headers/footers, hyphenated line breaks).
  *Acceptance:* fixture PDFs produce clean paragraphs.
- [ ] **4.3 Scanned PDF / OCR (opt-in).** Tesseract.js with a hard page cap, an explicit user opt-in, and a progress indicator. Warn about accuracy and require review before export.
  *Acceptance:* OCR never runs without opt-in; page cap enforced.
- [ ] **4.4 Normalization & unsupported characters.** Smart quotes, dashes, ligatures, and special symbols mapped sensibly. Anything unsupported is **listed in a pre-export warning**, never silently dropped.
  *Acceptance:* a document with emoji and math symbols produces a clear warning list.
- [ ] **4.5 Editor UI.** Left: text blocks (editable). Right: live preview (client-side, free, low-res, watermarked). Controls for preset, ink, paper, realism sliders, font size, seed ("reroll look").
  *Acceptance:* preview updates within ~1 second for a typical page.
- [ ] **4.6 Per-block overrides.** Different style for headings, ability to skip blocks, ability to add a page break.
  *Acceptance:* overrides persist in export.
- [ ] **4.7 Export dialog.** Shows exact page count and credit cost **before** export, with a settings summary.
  *Acceptance:* the displayed cost equals the real cost on export.
- [ ] **4.8 Export worker (local).** Final render on the worker (not client), returns signed download. Idempotent: same document + settings + seed within 24h returns the cached result for free.
  *Acceptance:* repeated export hits cache; failed export leaves no side effects.
- [ ] **4.9 Mobile UX pass.** Most users are on phones: test editor, upload, and download at 380px width.
  *Acceptance:* the whole flow is usable on a phone.
- [ ] **4.10 Full local E2E test.** Playwright: sample photo -> bank -> upload DOCX -> preview -> export.
  *Acceptance:* **Gate:** test passes in CI.

---

## Phase 5: Accounts, Credits & Payments

**Goal:** a business, not a demo. Credits can't be bypassed, and money flows correctly.

- [ ] **5.1 Supabase schema & migrations.** Tables per CLAUDE.md section 7. **RLS on every table.**
  *Acceptance:* an RLS test proves user A can't read user B's data.
- [ ] **5.2 Auth.** Email + Google sign-in, email verification, password reset. Rate limit signups to deter free-tier farming.
  *Acceptance:* full signup/login/reset works.
- [ ] **5.3 Profile storage.** Upload the glyph bank to R2/Supabase Storage with encryption at rest; signed URLs; per-plan profile limits.
  *Acceptance:* a profile is saved, reloaded, and deleted correctly.
- [ ] **5.4 Credit ledger.** Append-only ledger, balance view, server-side deduction **only after successful export**, refund on failure. Concurrency-safe (two simultaneous exports can't overspend).
  *Acceptance:* concurrency test passes; balance never goes negative.
- [ ] **5.5 Free tier enforcement.** 5 watermarked pages/month, 1 profile, basic options. Server decides, never the client.
  *Acceptance:* tampering with client values doesn't change entitlements.
- [ ] **5.6 Payment provider integration.** Hosted checkout for Student/Pro (monthly + annual) using the provider from task 0.5. Test mode first.
  *Acceptance:* test purchase completes.
- [ ] **5.7 Webhooks.** Verify signatures; handle created/updated/cancelled/payment-failed/renewal; **idempotent** (store event IDs); grant monthly credits through the ledger.
  *Acceptance:* replaying the same webhook twice doesn't double-grant.
- [ ] **5.8 Billing UX.** Plan page, usage meter ("37/150 pages"), upgrade/downgrade, link to the customer portal, cancel (access until period end), and a clear "credits reset on [date]".
  *Acceptance:* users can always see what they have and when it renews.
- [ ] **5.9 Top-ups & referrals.** 100-page top-up pack; referral bonus (+20 each) with abuse checks (same-device/IP heuristics).
  *Acceptance:* bonuses appear in the ledger with reasons.
- [ ] **5.10 Transactional email.** Welcome, receipt, low-credits warning, payment failed, export ready (Resend).
  *Acceptance:* each email triggers on the right event.
- [ ] **5.11 Cost tracking.** Log per-export compute time/cost (no document content!) to a dashboard. Alert if cost per page exceeds $0.01.
  *Acceptance:* a dashboard shows cost per page and margin per plan.

**Gate:** test-mode payment -> credits granted -> export -> deducted -> cancellation -> downgrade, all verified.

---

## Phase 6: Landing Page, Pricing & SEO

**Goal:** a site that converts a student searching "text to handwriting" into a free signup in under 60 seconds.

- [ ] **6.1 Design system.** One accent color, clean typography, handwriting-style font for headings **only**, dark/light support, mobile-first.
  *Acceptance:* components documented in a simple style page.
- [ ] **6.2 Hero + live demo.** Headline "Turn any document into *your own* handwriting." Typed-vs-handwritten slider. A **no-signup live demo** (textbox -> instant preview using a demo profile): this is your best conversion tool.
  *Acceptance:* demo works without login; LCP < 2.0s.
- [ ] **6.3 Before/after gallery.** Multiple styles, phone-photo look, accessible alt text.
  *Acceptance:* at least 6 real outputs shown.
- [ ] **6.4 How it works + why it looks real.** 3 steps; short visuals on variation, drift, ink, scan effect.
  *Acceptance:* page tells the story in under 30 seconds of scrolling.
- [ ] **6.5 Pricing page.** Free / Student / Pro cards, annual toggle, FAQ about credits ("1 credit = 1 page, previews are free"), student badge. Remember these prices are placeholders: update after Phase 0.6 interviews.
  *Acceptance:* prices read from one config so they change in one place.
- [ ] **6.6 FAQ & trust.** Privacy ("never shared unless you opt in"), 7-day refund, supported files, detectability honesty, ethical use note.
  *Acceptance:* FAQPage JSON-LD validates.
- [ ] **6.7 Legal pages.** Terms, Privacy Policy, Refund Policy, Acceptable Use (forbid forging others' handwriting and fraudulent documents). Flag for the user to get a legal review, especially around the donor library.
  *Acceptance:* pages live and linked in the footer.
- [ ] **6.8 Technical SEO.** Unique titles (<= 60 chars) and meta descriptions (<= 155), one H1 per page, canonicals, `sitemap.xml`, `robots.txt`, OG/Twitter images, JSON-LD (SoftwareApplication, Offer, FAQPage, Organization, BreadcrumbList).
  *Acceptance:* Rich Results Test passes; Search Console connected.
- [ ] **6.9 Performance.** LCP < 2.0s, CLS < 0.1, INP < 200ms; AVIF/WebP, lazy loading, font subsetting.
  *Acceptance:* Lighthouse mobile >= 90 on landing and pricing.
- [ ] **6.10 SEO landing pages.** `/tools/text-to-handwriting` (free tool, the main magnet), `/tools/pdf-to-handwriting`, `/tools/word-to-handwriting`, `/for/university-students`, `/for/school-projects`.
  *Acceptance:* each page has unique content, not templated duplicates.
- [ ] **6.11 Blog (first 4 posts).** "How to make text look handwritten", "Handwriting generator vs fonts", "Best paper styles for assignments", "How PenTwin makes handwriting look real".
  *Acceptance:* posts published with internal links to the tools.
- [ ] **6.12 Analytics & funnel events.** Plausible/PostHog: visit -> demo used -> signup -> sample uploaded -> first export -> paid. No document content in events.
  *Acceptance:* the funnel is visible in the dashboard.

**SEO rules:** no keyword stuffing, no fake reviews or testimonials, no hidden text. Don't claim "undetectable" anywhere.

---

## Phase 7: Deployment, Security & QA

**Goal:** easy to deploy, hard to break.

- [ ] **7.1 Environment config.** `.env.example` documenting every variable; separate dev/staging/production; payment provider in test mode on staging.
  *Acceptance:* a fresh clone runs with only `.env` filled in.
- [ ] **7.2 Web deployment.** Vercel from GitHub, preview deploy per PR, custom domain, HTTPS.
  *Acceptance:* production URL live behind the correct domain.
- [ ] **7.3 Worker deployment.** Dockerfile -> Railway/Fly.io, health endpoint, autoscale, request timeouts, memory limits.
  *Acceptance:* the worker survives a 50-page export without OOM.
- [ ] **7.4 DB migrations in CI.** Supabase CLI applies migrations on deploy; backups enabled.
  *Acceptance:* a restore from backup tested once.
- [ ] **7.5 Security hardening.** CSP/HSTS headers, upload validation (type, size, magic bytes), sandboxed processing, temp-file cleanup, signed expiring URLs, rate limits, dependency audit.
  *Acceptance:* a security checklist in `docs/security.md` all ticked.
- [ ] **7.6 Privacy implementation.** Data export and delete (account deletion removes glyph banks and exports), consent logs, no document content in logs.
  *Acceptance:* a deletion test leaves no orphaned files.
- [ ] **7.7 Monitoring.** Sentry (web + worker), uptime checks, alert to email/Telegram, cost alerts.
  *Acceptance:* a deliberate error shows up in Sentry.
- [ ] **7.8 Load & abuse testing.** 50 concurrent exports; attempt credit-bypass, webhook replay, oversized uploads, parallel-spend races.
  *Acceptance:* **Gate:** no overspend, no crashes, p95 export time recorded.
- [ ] **7.9 Cross-browser/device QA.** Android Chrome, iOS Safari, desktop Chrome/Firefox/Edge, especially the photo-capture flow.
  *Acceptance:* a checklist with results.
- [ ] **7.10 Rollback plan.** Document the Vercel rollback, tagged worker images, and a DB migration rollback approach.
  *Acceptance:* `docs/runbook.md` written.

---

## Phase 8: Private Beta & Launch

- [ ] **8.1 Private beta (20-50 students).** Feedback form, in-app "report a bad glyph/bad output" button, and a session recording tool only if privacy-safe.
  *Acceptance:* **Gate:** beta users complete signup -> sample -> export unaided.
- [ ] **8.2 Feedback triage.** Categorize issues (extraction failures, realism complaints, UX, pricing). Fix the top 5.
  *Acceptance:* `docs/beta-findings.md` with decisions.
- [ ] **8.3 Pricing validation.** Compare conversion at the placeholder prices; adjust. Verify real margin >= $2 per paying user from the cost dashboard (5.11).
  *Acceptance:* margins documented per plan.
- [ ] **8.4 Launch assets.** Demo video (30-60s), screenshots, Product Hunt page, honest Reddit/community posts (follow each community's rules), student-ambassador or referral push.
  *Acceptance:* assets ready; launch checklist done.
- [ ] **8.5 Public launch.** Announce, monitor errors and costs hourly for the first 48 hours, respond to every support message.
  *Acceptance:* **Gate: first 10 paying users.**
- [ ] **8.6 Post-launch metrics review (week 2 and 4).** Activation rate (signup -> first export), free -> paid conversion, churn, cost per page, support volume.
  *Acceptance:* decisions on what to build next, based on data.

---

## Phase 9: Post-Launch (prioritize by demand)

- [ ] **9.1 Word/syllable-level glyphs for cursive writers.**
- [ ] **9.2 Opt-in donor library** (consent logging, unlinked storage, style matching, delete control, legal review first).
- [ ] **9.3 Urdu/Nastaliq support** (new sample design, shaping engine; large effort, big regional differentiator).
- [ ] **9.4 Mobile capture polish** (guided camera overlay, auto-capture when the page is aligned).
- [ ] **9.5 Premium few-shot generative fill** for missing glyphs (only if revenue supports compute cost; opt-in for Pro).
- [ ] **9.6 Teams/classroom plans, API access, batch/bulk tools.**
- [ ] **9.7 Additional languages and scripts** based on demand.

---

## Appendix A: Cost Guardrails

- Target cost per exported page: **< $0.01**. Investigate if it rises above this.
- Previews, glyph extraction, and style analysis run in the browser: free to you.
- OCR is the only costly step: opt-in, capped, and measured.
- No paid AI API calls in the core pipeline (v1).
- Cache identical exports for 24h; failed exports never charge credits.

## Appendix B: Known Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Output looks fake/uniform | Product fails | Correlated drift, variant avoidance, warping, bigrams, blind tests as gates |
| Bad phone photos | Poor glyph banks, support load | Quality gate with specific instructions, review screen, top-up flow |
| Cursive writers | Poor results | Detect and be honest at launch; Phase 9.1 |
| Payment payout unavailable in Pakistan | No revenue | Validate in 0.5 before Phase 5; keep a backup provider |
| Misuse (forging others' writing, cheating) | Legal/reputation/processor risk | Own-handwriting confirmation, strict Terms, visible ethical-use note, abuse monitoring |
| Credit bypass/free-tier farming | Lost revenue | Server-side enforcement, rate limits, ledger-only changes, concurrency tests |
| Privacy breach of handwriting data | Trust-ending | RLS, encryption, signed URLs, deletion on request, no content logging |
| Prices too high/low | Weak margin or conversion | Interviews (0.6), beta pricing test (8.3), single config for prices |
| Competitors copy | Reduced edge | Compete on realism quality, personal glyph bank, speed, and trust |

## Appendix C: Definition of Done (every task)

- [ ] Acceptance criterion met
- [ ] Typecheck, lint, and tests pass
- [ ] No secrets, user data, or handwriting images committed
- [ ] Checkbox ticked in this file
- [ ] Committed with task ID in the message
- [ ] **Pushed to GitHub and confirmed**