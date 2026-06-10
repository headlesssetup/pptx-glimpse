---
"pptx-glimpse": minor
---

Decode MicroType Express–compressed embedded fonts

PowerPoint compresses embedded fonts with MicroType Express (MTX) by default, wrapped in EOT. pptx-glimpse now includes a pure-TypeScript MTX decoder (an LZ77 + adaptive-Huffman + RLE entropy stage and CTF→sfnt reassembly, including glyf reconstruction from triplet encodings), so MTX-compressed embeds — previously skipped — now render correctly, including subsetted fonts. The decoder is a port of libeot (MPL-2.0; see `src/font/mtx/NOTICE`) and is validated byte-for-byte against libeot's output. Embedded-font support remains opt-out via `useEmbeddedFonts: false`.
