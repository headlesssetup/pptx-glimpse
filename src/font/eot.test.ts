import { describe, expect, it } from "vitest";

import { extractFontFromEot, unwrapEmbeddedFontData } from "./eot.js";

/** opentype.js で最小の生 TTF を作る */
async function makeTtf(): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const opentype: {
    Glyph: new (opts: Record<string, unknown>) => unknown;
    Path: new () => {
      moveTo(x: number, y: number): void;
      lineTo(x: number, y: number): void;
      close(): void;
    };
    Font: new (opts: Record<string, unknown>) => { toArrayBuffer(): ArrayBuffer };
  } = await import("opentype.js");
  const notdef = new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 650,
    path: new opentype.Path(),
  });
  const p = new opentype.Path();
  p.moveTo(0, 0);
  p.lineTo(300, 800);
  p.lineTo(600, 0);
  p.close();
  const a = new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: p });
  const font = new opentype.Font({
    familyName: "EotTest",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, a],
  });
  return new Uint8Array(font.toArrayBuffer());
}

/** 生フォントを最小の EOT ヘッダ (version 0x00010000, 名前長すべて 0) でラップする */
function wrapEot(font: Uint8Array, flags = 0, xorKey = 0): Uint8Array {
  const HEADER = 96; // 固定 82 + 名前長フィールド 14 (すべて 0)
  const total = HEADER + font.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, total, true); // EOTSize
  dv.setUint32(4, font.length, true); // FontDataSize
  dv.setUint32(8, 0x00010000, true); // Version
  dv.setUint32(12, flags, true); // Flags
  dv.setUint16(34, 0x504c, true); // MagicNumber
  const body = xorKey ? font.map((b) => b ^ xorKey) : font;
  out.set(body, HEADER);
  return out;
}

describe("extractFontFromEot", () => {
  it("EOT ラップから生フォントを取り出す", async () => {
    const ttf = await makeTtf();
    const eot = wrapEot(ttf);
    const extracted = extractFontFromEot(eot);
    expect(extracted).not.toBeNull();
    // 取り出したバイト列は元のフォントと完全一致する
    expect(Array.from(extracted!)).toEqual(Array.from(ttf));
  });

  it("XOR 暗号化 (flags 0x10000000) を復号する", async () => {
    const ttf = await makeTtf();
    const eot = wrapEot(ttf, 0x10000000, 0x50);
    const extracted = extractFontFromEot(eot);
    expect(extracted).not.toBeNull();
    expect(Array.from(extracted!)).toEqual(Array.from(ttf));
  });

  it("MicroType Express 圧縮 (flags 0x4) は未対応で null", async () => {
    const ttf = await makeTtf();
    const eot = wrapEot(ttf, 0x00000004);
    expect(extractFontFromEot(eot)).toBeNull();
  });

  it("EOT マジックが無ければ null", () => {
    expect(extractFontFromEot(new Uint8Array(100))).toBeNull();
  });
});

describe("unwrapEmbeddedFontData", () => {
  it("生フォントはそのまま返す", async () => {
    const ttf = await makeTtf();
    expect(unwrapEmbeddedFontData(ttf)).toBe(ttf);
  });

  it("EOT は中身を取り出す", async () => {
    const ttf = await makeTtf();
    const out = unwrapEmbeddedFontData(wrapEot(ttf));
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(ttf));
  });
});
