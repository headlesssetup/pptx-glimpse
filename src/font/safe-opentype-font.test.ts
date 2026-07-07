import { describe, expect, it, vi } from "vitest";

import type { RawOpentypeFont } from "./safe-opentype-font.js";
import { wrapOpentypeFontSafe } from "./safe-opentype-font.js";

const GSUB_ERROR = new Error("lookupType: 7 - substFormat: 1 is not yet supported");

function path(data: string) {
  return { toPathData: () => data };
}

/**
 * behavior 別に throw を制御できるモック raw フォント。
 * - "ok": フィーチャ有効の通常呼び出しが成功
 * - "featureThrow": フィーチャ有効時のみ throw、無効時 (options あり) は成功
 * - "alwaysThrow": フィーチャ有無に関わらず throw (グリフ単位退避が必要)
 */
function makeRaw(behavior: "ok" | "featureThrow" | "alwaysThrow") {
  const shouldThrow = (options: unknown) =>
    behavior === "alwaysThrow" || (behavior === "featureThrow" && options === undefined);

  const raw: RawOpentypeFont = {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    stringToGlyphs: vi.fn((_text: string, options?: unknown) => {
      if (shouldThrow(options)) throw GSUB_ERROR;
      return [{ advanceWidth: 500, getPath: () => path("FEAT") }];
    }),
    getPath: vi.fn((_t: string, _x: number, _y: number, _s: number, options?: unknown) => {
      if (shouldThrow(options)) throw GSUB_ERROR;
      return path("FEAT");
    }),
    getAdvanceWidth: vi.fn((_t: string, _s: number, options?: unknown) => {
      if (shouldThrow(options)) throw GSUB_ERROR;
      return 111;
    }),
    charToGlyphIndex: vi.fn((ch: string) => (ch === "x" ? 0 : 7)),
    charToGlyph: vi.fn((ch: string) => ({
      advanceWidth: 600,
      getPath: () => path(`G:${ch}`),
    })),
  };
  return raw;
}

describe("wrapOpentypeFontSafe", () => {
  it("正常フォントは生の呼び出しをそのまま通す (フィーチャ有効)", () => {
    const raw = makeRaw("ok");
    const safe = wrapOpentypeFontSafe(raw);
    expect(safe.getPath("hi", 0, 0, 40).toPathData()).toBe("FEAT");
    expect(safe.getAdvanceWidth("hi", 40)).toBe(111);
    // フィーチャ有効 (options なし) で呼ばれている
    expect(raw.getPath).toHaveBeenCalledWith("hi", 0, 0, 40);
    expect(raw.charToGlyph).not.toHaveBeenCalled();
  });

  it("フィーチャ適用が throw したらフィーチャ無効で再試行して復帰する", () => {
    const raw = makeRaw("featureThrow");
    const safe = wrapOpentypeFontSafe(raw);
    expect(safe.getPath("fi", 0, 0, 40).toPathData()).toBe("FEAT");
    // 2 回呼ばれる: 1 回目 (options なし) throw → 2 回目 (options あり) 成功
    expect(raw.getPath).toHaveBeenCalledTimes(2);
    // グリフ単位退避は使われない
    expect(raw.charToGlyph).not.toHaveBeenCalled();
  });

  it("一度フィーチャ適用が失敗したら以降はフィーチャ無効経路のみ (throw を繰り返さない)", () => {
    const raw = makeRaw("featureThrow");
    const safe = wrapOpentypeFontSafe(raw);
    safe.getPath("fi", 0, 0, 40); // 1 回目: throw + retry = 2 呼び出し
    safe.getAdvanceWidth("fl", 40); // 以降はフィーチャ無効から直接 = 1 呼び出し
    safe.getPath("ff", 0, 0, 40); // = 1 呼び出し
    expect(raw.getPath).toHaveBeenCalledTimes(3); // 2 + 1
    expect(raw.getAdvanceWidth).toHaveBeenCalledTimes(1);
    // getAdvanceWidth はフィーチャ無効 (options あり) で呼ばれる
    expect(raw.getAdvanceWidth).toHaveBeenLastCalledWith("fl", 40, expect.anything());
  });

  it("フィーチャ無効でも throw する場合はグリフ単位描画に退避する", () => {
    const raw = makeRaw("alwaysThrow");
    const safe = wrapOpentypeFontSafe(raw);
    // 各文字を charToGlyph で描画して連結
    expect(safe.getPath("ab", 0, 0, 1000).toPathData()).toBe("G:aG:b");
    // advanceWidth: 2 文字 × 600 units × (1000px / 1000em) = 1200
    expect(safe.getAdvanceWidth("ab", 1000)).toBe(1200);
    // stringToGlyphs も退避してグリフ配列を返す
    expect(safe.stringToGlyphs("ab")).toHaveLength(2);
    expect(raw.charToGlyph).toHaveBeenCalled();
  });

  it("charToGlyphIndex は生フォントにそのまま委譲する (GSUB 非経由)", () => {
    const raw = makeRaw("alwaysThrow");
    const safe = wrapOpentypeFontSafe(raw);
    expect(safe.charToGlyphIndex("a")).toBe(7);
    expect(safe.charToGlyphIndex("x")).toBe(0);
  });

  it("メトリクス (unitsPerEm/ascender/descender) を引き継ぐ", () => {
    const safe = wrapOpentypeFontSafe(makeRaw("ok"));
    expect(safe.unitsPerEm).toBe(1000);
    expect(safe.ascender).toBe(800);
    expect(safe.descender).toBe(-200);
  });
});
