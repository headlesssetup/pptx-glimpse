/**
 * opentype.js Font オブジェクトのクラッシュ耐性ラッパ。
 *
 * opentype.js は getPath / getAdvanceWidth / stringToGlyphs のたびに既定で
 * latn の liga/rlig 等の GSUB フィーチャを適用する。フォントの GSUB が
 * opentype.js 1.3.4 の未対応 lookup (例: lookupType 7 = Extension Substitution)
 * を使っていると featureQuery が
 *   "lookupType: 7 - substFormat: 1 is not yet supported"
 * を throw し、そのまま伝播すると PPTX 変換全体が失敗する。
 *
 * このラッパは各呼び出しを以下の順で退避させ、1 つの問題フォントが変換全体を
 * 巻き込まないようにする:
 *   1. 通常呼び出し (フィーチャ有効。正常フォントは従来と完全に同一の出力)
 *   2. 失敗したらフィーチャ無効で再試行 (リガチャ置換のみ失われる)
 *   3. それでも失敗したらグリフ単位描画 (GSUB を完全に回避)
 *
 * 一度フィーチャ適用が失敗したフォントは以降フィーチャ無効の経路を使うため、
 * try/catch のコストは 1 フォントあたり最大 1 回に抑えられる。
 */
import type { OpentypeFont } from "./opentype-text-measurer.js";
import type { OpentypeFullFont, OpentypePath } from "./text-path-context.js";

interface RawGlyph {
  advanceWidth?: number;
  getPath(x: number, y: number, fontSize: number): OpentypePath;
}

/** ラップ対象の opentype.js Font (必要なメソッドのみ) */
export interface RawOpentypeFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  stringToGlyphs(text: string, options?: unknown): RawGlyph[];
  getPath(text: string, x: number, y: number, fontSize: number, options?: unknown): OpentypePath;
  getAdvanceWidth(text: string, fontSize: number, options?: unknown): number;
  charToGlyphIndex(char: string): number;
  charToGlyph(char: string): RawGlyph;
}

export type SafeOpentypeFont = OpentypeFont & OpentypeFullFont;

// opentype.js の既定 latn フィーチャ (liga/rlig) を無効化するレンダーオプション。
// kerning は既定の true のまま維持される。
const NO_FEATURES = { features: {} };

const FALLBACK_ADVANCE_RATIO = 0.6;

export function wrapOpentypeFontSafe(raw: RawOpentypeFont): SafeOpentypeFont {
  // GSUB フィーチャ適用が未対応 lookup で throw したら true。以降は無効経路を使う。
  let featuresBroken = false;

  const advanceOf = (g: RawGlyph, scale: number): number =>
    (g.advanceWidth ?? raw.unitsPerEm * FALLBACK_ADVANCE_RATIO) * scale;

  // GSUB を完全に回避したグリフ単位の退避経路
  const perGlyphGlyphs = (text: string): RawGlyph[] => {
    const glyphs: RawGlyph[] = [];
    for (const ch of text) glyphs.push(raw.charToGlyph(ch));
    return glyphs;
  };

  const perGlyphWidth = (text: string, fontSizePx: number): number => {
    const scale = fontSizePx / raw.unitsPerEm;
    let width = 0;
    for (const ch of text) width += advanceOf(raw.charToGlyph(ch), scale);
    return width;
  };

  const perGlyphPath = (text: string, x: number, y: number, fontSizePx: number): OpentypePath => {
    const scale = fontSizePx / raw.unitsPerEm;
    const paths: OpentypePath[] = [];
    let cursor = x;
    for (const ch of text) {
      const glyph = raw.charToGlyph(ch);
      paths.push(glyph.getPath(cursor, y, fontSizePx));
      cursor += advanceOf(glyph, scale);
    }
    return {
      toPathData: (decimalPlaces?: number) =>
        paths.map((p) => p.toPathData(decimalPlaces)).join(""),
    };
  };

  return {
    unitsPerEm: raw.unitsPerEm,
    ascender: raw.ascender,
    descender: raw.descender,
    charToGlyphIndex: (char: string) => raw.charToGlyphIndex(char),

    stringToGlyphs(text: string): RawGlyph[] {
      if (!featuresBroken) {
        try {
          return raw.stringToGlyphs(text);
        } catch {
          featuresBroken = true;
        }
      }
      try {
        return raw.stringToGlyphs(text, NO_FEATURES);
      } catch {
        return perGlyphGlyphs(text);
      }
    },

    getAdvanceWidth(text: string, fontSize: number): number {
      if (!featuresBroken) {
        try {
          return raw.getAdvanceWidth(text, fontSize);
        } catch {
          featuresBroken = true;
        }
      }
      try {
        return raw.getAdvanceWidth(text, fontSize, NO_FEATURES);
      } catch {
        return perGlyphWidth(text, fontSize);
      }
    },

    getPath(text: string, x: number, y: number, fontSize: number): OpentypePath {
      if (!featuresBroken) {
        try {
          return raw.getPath(text, x, y, fontSize);
        } catch {
          featuresBroken = true;
        }
      }
      try {
        return raw.getPath(text, x, y, fontSize, NO_FEATURES);
      } catch {
        return perGlyphPath(text, x, y, fontSize);
      }
    },
  };
}
