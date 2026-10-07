# PenTwin

Your handwriting's twin. Turn any DOCX/PDF into realistic handwriting built from your own writing sample.

**Status:** early development (Phase 1, rendering engine). See [PROJECT.md](PROJECT.md) for the build plan and task tracker.

## Development

Requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

Engine tools:

```bash
pnpm samples          # render the sample images in docs/samples
pnpm bench            # 50-page performance benchmark (see docs/perf.md)
pnpm fixtures:glyphs  # regenerate the synthetic test glyph set
```
