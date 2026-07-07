# CLAUDE.md

Local PPTX → SVG/PNG converter. Personal tool, not published.

## Commands

```bash
pnpm test
pnpm run typecheck
pnpm run build
pnpm dev -- samples/petrika.pptx
pnpm render -- deck.pptx [--steps] [--width 1920] [--out ./output]
pnpm render:samples
pnpm baseline:update
pnpm render:check
pnpm inspect -- deck.pptx slide1
```

## Architecture

```
PPTX → parser/ (ZIP + XML) → model/ → renderer/ → SVG → png/ (resvg-wasm) → PNG
```

Entry: `src/index.ts` exports `convertPptxToSvg`, `convertPptxToPng`.

## Key constraints

- SVG uses inline attributes only (no CSS classes)
- EMU units: `emuToPixels()`, branded types in `src/utils/unit-types.ts`
- `isArray` config required in fast-xml-parser for OOXML tags

## Animation

`animationSteps: true` in `ConvertOptions` → per-click build frames via `src/parser/timing-parser.ts` and `renderSlideToSvgFrames()`.

## samples/

Limits test suite. Baselines in `samples/baselines/` (gitignored). See `samples/README.md`.

## Tests

Unit tests colocated in `src/**/*.test.ts`. Run with `pnpm test`.
