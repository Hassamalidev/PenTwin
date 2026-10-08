# PenTwin

Your handwriting's twin. Turn any DOCX/PDF into realistic handwriting built from your own writing sample.

**Status:** early development. The rendering engine and the handwriting extractor work on synthetic test data; neither has been tried on real handwriting yet. See [PROJECT.md](PROJECT.md) for the build plan and task tracker.

## Development

Requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

Run the app locally (two terminals):

```bash
pnpm worker   # export worker on http://localhost:8787
pnpm web      # web app on http://localhost:3000
```

End-to-end tests (build the app and drive it in a real browser):

```bash
pnpm exec playwright install chromium   # once
pnpm e2e
```

Engine tools:

```bash
pnpm samples          # render the sample images in docs/samples
pnpm bench            # 50-page performance benchmark (see docs/perf.md)
pnpm fixtures:glyphs  # regenerate the synthetic test glyph set
pnpm extract:demo     # photo -> glyph bank -> written page, on a synthetic photo
pnpm extract:measure  # extraction accuracy table (docs/extraction-accuracy.md)
pnpm sample:sheet     # the printable handwriting sample sheet
pnpm benchmark        # font-style vs engine side-by-side (docs/benchmarks)
```
