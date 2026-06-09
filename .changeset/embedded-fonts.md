---
"pptx-glimpse": minor
---

Use fonts embedded in the PPTX for rendering

When a deck embeds its fonts (`ppt/fonts/*.fntdata`, saved via PowerPoint's "Embed fonts in the file"), pptx-glimpse now loads and uses those font binaries directly instead of relying on system fonts or name mapping. Embedded fonts take precedence over same-named system fonts, with the correct weight/style face selected per run. Enabled by default; pass `useEmbeddedFonts: false` to opt out. Decks without embedded fonts fall back to the existing system-font/mapping behavior.
