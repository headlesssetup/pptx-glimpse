# samples

Personal "push PPT limits" test suite. PPTX files here are gitignored (large/personal); this README is tracked.

## Stress decks

| File | Notes |
|------|-------|
| `petrika.pptx` | Real-world stress — fonts, bullets |
| `fonts.pptx` | Embedded-font torture test |
| `bigone.pptx` | Large deck |
| `animated.pptx` | Click-build animation steps |

## Real-world fixtures (from shared-fixtures)

| File | Source | Slides | Notes |
|------|--------|--------|-------|
| `real-basic-theme.pptx` | Google Slides | 2 | Title, content, table, image, theme fonts |
| `real-product-page.pptx` | Hand-made | 1 | Rounded rects, ellipse, text boxes |
| `real-financial-report.pptx` | Hand-made | 4 | Charts (bar, pie) + text |
| `sample.pptx` | md-pptx | 6 | Japanese text, bullets, decorations |
| `sample-issue-387.pptx` | Hand-made | 1 | Inline bold/italic formatting |

## Baselines

Saved reference PNGs live in `samples/baselines/<deck-name>/` (gitignored).

```bash
pnpm baseline:update          # save baselines after accepting a change
pnpm render:check             # diff renders vs baselines
pnpm render:samples             # batch export to output/
```

## Adding a deck

Drop a `.pptx` in this folder, add a one-line note to this table, then run `pnpm baseline:update`.
