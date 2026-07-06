---
"pptx-glimpse": patch
---

Glyph-aware font fallback and Aptos/Corbel mapping

- When the resolved font lacks glyphs for characters in a text run (e.g. Latvian diacritics such as ļ/ē/ā), the renderer now falls back — per run — to another available font that covers those characters instead of rendering .notdef boxes. A new `font.missingGlyphs` warning reports the affected font, the missing characters, and the chosen fallback.
- Fallback is deterministic and family-consistent: embedded fonts first, then well-known families (Carlito, Arimo, Liberation Sans, Noto Sans, DejaVu Sans, …) before other scanned fonts; Regular/Bold/Italic runs of the same text stay within one fallback family with the correct face.
- Fonts that are neither installed nor mapped now use the same preferred order for their substitute instead of an arbitrary first-scanned font, and keep the requested bold/italic face (previously a single default face was used regardless of style).
- Added default font mappings: Aptos family (the Office 2024+ default font) and Corbel → Carlito, 游ゴシック Light / Yu Gothic Light → Noto Sans JP.

Warning reporting is also made usable for services:

- `getWarningEntries()` / `getWarningSummary()` now return the last completed conversion's warnings (previously they were cleared when the conversion flushed, making the exported getters return nothing).
- Font warnings are deduplicated per conversion instead of per process: the cached font resolver previously suppressed `font.notFound` for every conversion after the first one in a long-lived server.
- Bullet fonts (`buFont`) given as theme tokens (`+mj-lt` etc.) are now resolved to the actual theme font instead of being looked up literally.

Output is unchanged for decks whose fonts resolve by name and cover their text.
