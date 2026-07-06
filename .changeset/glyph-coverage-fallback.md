---
"pptx-glimpse": patch
---

Fall back to a glyph-covering font instead of rendering .notdef boxes

When the resolved font lacks glyphs for characters in a text run (e.g. Latvian diacritics such as ļ/ē/ā), the renderer now falls back — per run — to another available font that covers those characters, preferring embedded fonts and a matching bold/italic face. Decks that previously rendered tofu boxes for such characters now render readable text; output is unchanged whenever the resolved font already covers the text. A new `font.missingGlyphs` warning reports the affected font, the missing characters, and the chosen fallback (or that no available font covers them).
