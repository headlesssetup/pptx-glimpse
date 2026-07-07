---
"pptx-glimpse": patch
---

Don't crash the whole conversion on fonts with unsupported GSUB lookups

opentype.js applies `liga`/`rlig` OpenType features on every text measurement and render, and its 1.3.4 feature engine throws on lookup types it doesn't implement (e.g. `lookupType: 7 - substFormat: 1 is not yet supported`, Extension Substitution — used by many real fonts including recent Microsoft ones). A single such font — whether embedded in the deck or installed on the host — previously aborted the entire PPTX conversion.

Parsed fonts are now wrapped so that if feature application throws, rendering retries with features disabled (losing only ligature substitution) and, failing that, falls back to per-glyph rendering that bypasses GSUB entirely. Fonts that work are unaffected and produce byte-identical output; the recovery path is entered at most once per font.
