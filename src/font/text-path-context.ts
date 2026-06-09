/**
 * テキスト→パス変換用のフォントリゾルバーコンテキスト。
 * opentype.js の getPath() メソッドを持つ Font オブジェクトへのアクセスを提供する。
 */

import { warn } from "../warning-logger.js";
import { getCjkFallbackFonts } from "./cjk-font-fallback.js";
import { getCurrentMappedFont } from "./font-mapping-context.js";

export interface OpentypePath {
  toPathData(decimalPlaces?: number): string;
}

export interface OpentypeFullFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  getPath(text: string, x: number, y: number, fontSize: number): OpentypePath;
  getAdvanceWidth(text: string, fontSize: number): number;
}

/** フォント面の太字/斜体スタイル */
export interface FontStyle {
  bold?: boolean;
  italic?: boolean;
}

/**
 * フォントマップのキーを生成する。
 * Regular (太字でも斜体でもない) はファミリ名そのもの。
 * Bold/Italic はサフィックスを付け、同名ファミリの別フェイスを区別する。
 */
export function fontStyleKey(name: string, bold: boolean, italic: boolean): string {
  if (!bold && !italic) return name;
  return `${name} ${bold ? "b" : ""}${italic ? "i" : ""}`;
}

/**
 * 要求スタイルに対するフェイス探索の優先順位を返す。
 * 完全一致 → 太字のみ → 斜体のみ → Regular の順にフォールバックする。
 */
export function fontStyleVariants(bold: boolean, italic: boolean): [boolean, boolean][] {
  const out: [boolean, boolean][] = [];
  const push = (b: boolean, i: boolean) => {
    if (!out.some(([x, y]) => x === b && y === i)) out.push([b, i]);
  };
  push(bold, italic);
  push(bold, false);
  push(false, italic);
  push(false, false);
  return out;
}

export interface TextPathFontResolver {
  resolveFont(
    fontFamily: string | null | undefined,
    fontFamilyEa: string | null | undefined,
    jpanFallback?: string | null,
    style?: FontStyle,
  ): OpentypeFullFont | null;
}

export class DefaultTextPathFontResolver implements TextPathFontResolver {
  private fonts: Map<string, OpentypeFullFont>;
  private defaultFont: OpentypeFullFont | null;
  private warnedFonts = new Set<string>();

  constructor(fonts: Map<string, OpentypeFullFont>, defaultFont?: OpentypeFullFont) {
    this.fonts = fonts;
    this.defaultFont = defaultFont ?? null;
  }

  resolveFont(
    fontFamily: string | null | undefined,
    fontFamilyEa: string | null | undefined,
    jpanFallback?: string | null,
    style?: FontStyle,
  ): OpentypeFullFont | null {
    const bold = style?.bold ?? false;
    const italic = style?.italic ?? false;

    if (fontFamily) {
      const font = this.findFont(fontFamily, bold, italic);
      if (font) return font;
    }
    if (fontFamilyEa) {
      const font = this.findFont(fontFamilyEa, bold, italic);
      if (font) return font;
    }
    if (jpanFallback) {
      const font = this.findFont(jpanFallback, bold, italic);
      if (font) return font;
    }

    // フォント未検出の警告
    for (const name of [fontFamily, fontFamilyEa, jpanFallback]) {
      if (name && !this.warnedFonts.has(name)) {
        this.warnedFonts.add(name);
        warn("font.notFound", `Font not found: "${name}"`);
      }
    }

    return this.defaultFont;
  }

  private findFont(name: string, bold: boolean, italic: boolean): OpentypeFullFont | null {
    // 要求スタイルに最も近いフェイスを優先順に探す
    for (const [b, i] of fontStyleVariants(bold, italic)) {
      const direct = this.fonts.get(fontStyleKey(name, b, i));
      if (direct) return direct;
    }

    // フォントマッピングで OSS 代替名を試行
    const mapped = getCurrentMappedFont(name);
    if (mapped) {
      for (const [b, i] of fontStyleVariants(bold, italic)) {
        const mappedFont = this.fonts.get(fontStyleKey(mapped, b, i));
        if (mappedFont) return mappedFont;
      }

      // CJK フォールバックチェーン
      for (const fallback of getCjkFallbackFonts(mapped)) {
        const fallbackFont = this.fonts.get(fallback);
        if (fallbackFont) return fallbackFont;
      }
    }

    return null;
  }
}

let currentResolver: TextPathFontResolver | null = null;

export function setTextPathFontResolver(resolver: TextPathFontResolver): void {
  currentResolver = resolver;
}

export function getTextPathFontResolver(): TextPathFontResolver | null {
  return currentResolver;
}

export function resetTextPathFontResolver(): void {
  currentResolver = null;
}
