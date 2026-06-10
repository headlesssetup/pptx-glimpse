import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { extractFontFromEot } from "../eot.js";

// MicroType Express デコーダの回帰テスト。
// フィクスチャは Figtree (OFL) を MTX 圧縮・サブセット化した EOT。
// 期待値 (テーブルディレクトリのチェックサム) は libeot eot2ttf の出力と
// バイト一致することを確認済み。__fixtures__/NOTICE 参照。

const fixture = new Uint8Array(
  readFileSync(new URL("./__fixtures__/figtree-subset.fntdata", import.meta.url)),
);

// libeot の出力と一致する既知の正しいテーブルディレクトリ
const EXPECTED_TABLES: Record<string, { len: number; sum: number }> = {
  GDEF: { len: 180, sum: 0x15e2152e },
  GPOS: { len: 7298, sum: 0x89394a89 },
  GSUB: { len: 904, sum: 0xc4f5b66d },
  "OS/2": { len: 96, sum: 0x605a1daa },
  STAT: { len: 72, sum: 0xe78bcb18 },
  cmap: { len: 388, sum: 0xbbc35f54 },
  gasp: { len: 8, sum: 0x10 },
  glyf: { len: 9134, sum: 0x241cd368 },
  head: { len: 54, sum: 0x236088c2 },
  hhea: { len: 36, sum: 0x0758073a },
  hmtx: { len: 1696, sum: 0x13ee1aed },
  loca: { len: 862, sum: 0x326e2978 },
  maxp: { len: 32, sum: 0x01ba0093 },
  name: { len: 454, sum: 0x28bd4b07 },
  post: { len: 32, sum: 0xff9f0032 },
  prep: { len: 7, sum: 0x68068c85 },
};

function readTableDirectory(d: Uint8Array): Record<string, { len: number; sum: number }> {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const numTables = dv.getUint16(4);
  const out: Record<string, { len: number; sum: number }> = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
    out[tag] = { len: dv.getUint32(o + 12), sum: dv.getUint32(o + 4) >>> 0 };
  }
  return out;
}

describe("MTX (MicroType Express) decoder", () => {
  it("decodes a compressed embedded font to a valid TTF", () => {
    const ttf = extractFontFromEot(fixture);
    expect(ttf).not.toBeNull();
    // sfnt 署名 (TrueType)
    expect(Array.from(ttf!.slice(0, 4))).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it("reconstructs every table byte-exactly (matching libeot)", () => {
    const ttf = extractFontFromEot(fixture)!;
    const dir = readTableDirectory(ttf);
    expect(Object.keys(dir).sort()).toEqual(Object.keys(EXPECTED_TABLES).sort());
    for (const [tag, exp] of Object.entries(EXPECTED_TABLES)) {
      expect(dir[tag], tag).toEqual(exp);
    }
  });

  it("produces a font opentype.js can parse with the expected glyph count", async () => {
    const ttf = extractFontFromEot(fixture)!;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const opentype: { parse: (b: ArrayBuffer) => { glyphs: { length: number } } } =
      await import("opentype.js");
    const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
    expect(font.glyphs.length).toBe(430);
  });
});
