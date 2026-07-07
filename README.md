# pptx-glimpse

Local tool for converting PowerPoint (.pptx) files to SVG/PNG with high fidelity and click-build animation support.

## Commands

```bash
pnpm install
pnpm dev -- samples/petrika.pptx          # live preview (auto-reload on src/ changes)
pnpm render -- deck.pptx                  # export SVG + PNG to ./output
pnpm render -- deck.pptx --steps          # export each animation build step
pnpm render:samples                       # batch-render all decks in samples/
pnpm baseline:update                      # save reference PNGs to samples/baselines/
pnpm render:check                         # pixel-diff renders vs baselines
pnpm inspect -- deck.pptx slide1          # dump internal OOXML
pnpm test                                 # unit tests
```

## samples/

Personal stress-test suite (`samples/README.md`). Decks are gitignored; add `.pptx` files locally.

## Animation steps

```bash
pnpm render -- samples/animated.pptx --steps --width 1920
```

Outputs `slide-01-step-00.png`, `slide-01-step-01.png`, etc.

## Fonts

Embedded fonts in the PPTX are used automatically. For substitution, pass `fontDirs` and `fontMapping` via the API in `src/converter.ts`.

## Library API

```typescript
import { convertPptxToPng } from "./src/converter.js";

const frames = await convertPptxToPng(pptxBuffer, {
  animationSteps: true,
  width: 1920,
  logLevel: "warn",
});
```
