---
"pptx-glimpse": minor
---

Add `animationSteps` option to render click-triggered entrance/exit animations as per-step frames

When `animationSteps: true` is passed to `convertPptxToSvg` / `convertPptxToPng`, each slide's click-build sequence (objects that appear or disappear on click) is rendered as separate cumulative frames instead of a single final-state render. Each result carries a `stepIndex` (0 = initial state). Slides without animations produce a single frame. The default behavior is unchanged and fully backward compatible. A new `BuildStep` type is exported.
