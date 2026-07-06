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
  /**
   * 文字→グリフインデックス変換 (opentype.js Font 互換)。
   * 0 は .notdef (グリフ未収録)。未実装のフォントはカバレッジ判定をスキップする。
   */
  charToGlyphIndex?(char: string): number;
}

/** フォント面の太字/斜体スタイル */
export interface FontStyle {
  bold?: boolean;
  italic?: boolean;
}

/** グリフカバレッジフォールバック用のフォント候補 */
export interface FallbackFace {
  name: string;
  bold: boolean;
  italic: boolean;
  font: OpentypeFullFont;
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

/**
 * フォントがテキスト内の全文字 (空白類を除く) のグリフを持つか判定する。
 * charToGlyphIndex を持たないフォントは判定不能のため true を返す (従来動作)。
 */
function fontCoversText(font: OpentypeFullFont, text: string): boolean {
  if (!font.charToGlyphIndex) return true;
  for (const char of text) {
    if (/\s/.test(char)) continue;
    if (font.charToGlyphIndex(char) === 0) return false;
  }
  return true;
}

/** テキスト中でフォントにグリフが無い文字を収集する (警告メッセージ用、最大 8 文字) */
function collectMissingChars(font: OpentypeFullFont, text: string): string {
  if (!font.charToGlyphIndex) return "";
  const missing = new Set<string>();
  for (const char of text) {
    if (/\s/.test(char)) continue;
    if (font.charToGlyphIndex(char) === 0) {
      missing.add(char);
      if (missing.size >= 8) break;
    }
  }
  return [...missing].join("");
}

export interface TextPathFontResolver {
  resolveFont(
    fontFamily: string | null | undefined,
    fontFamilyEa: string | null | undefined,
    jpanFallback?: string | null,
    style?: FontStyle,
    text?: string,
  ): OpentypeFullFont | null;
}

const COVERAGE_CACHE_LIMIT = 1000;

export class DefaultTextPathFontResolver implements TextPathFontResolver {
  private fonts: Map<string, OpentypeFullFont>;
  private defaultFont: OpentypeFullFont | null;
  private fallbackPool: FallbackFace[];
  private warnedFonts = new Set<string>();
  private warnedGlyphs = new Set<string>();
  private coverageCache = new Map<string, FallbackFace | null>();

  constructor(
    fonts: Map<string, OpentypeFullFont>,
    defaultFont?: OpentypeFullFont,
    fallbackPool?: FallbackFace[],
  ) {
    this.fonts = fonts;
    this.defaultFont = defaultFont ?? null;
    this.fallbackPool = fallbackPool ?? [];
  }

  resolveFont(
    fontFamily: string | null | undefined,
    fontFamilyEa: string | null | undefined,
    jpanFallback?: string | null,
    style?: FontStyle,
    text?: string,
  ): OpentypeFullFont | null {
    const bold = style?.bold ?? false;
    const italic = style?.italic ?? false;

    // 従来と同じ優先順で候補を収集する
    const candidates: OpentypeFullFont[] = [];
    let namedFound = false;
    for (const name of [fontFamily, fontFamilyEa, jpanFallback]) {
      if (!name) continue;
      const found = this.findFontCandidates(name, bold, italic);
      if (found.length > 0) namedFound = true;
      candidates.push(...found);
    }

    // フォント未検出の警告 (従来どおり名前解決のみで判定する)
    if (!namedFound) {
      for (const name of [fontFamily, fontFamilyEa, jpanFallback]) {
        if (name && !this.warnedFonts.has(name)) {
          this.warnedFonts.add(name);
          warn("font.notFound", `Font not found: "${name}"`);
        }
      }
    }

    if (this.defaultFont) candidates.push(this.defaultFont);
    const primary = candidates[0] ?? null;
    if (!primary) return null;

    // テキストが与えられなければ従来動作 (カバレッジ判定なし)
    if (!text || fontCoversText(primary, text)) return primary;

    // 優先候補にグリフが無い場合、候補列から全文字をカバーするフォントを探す
    for (const candidate of candidates) {
      if (fontCoversText(candidate, text)) return candidate;
    }

    // 全登録フォントからカバーするものを探す (スタイル一致を優先)
    const fallback = this.findCoveringFallback(text, bold, italic);
    const missingChars = collectMissingChars(primary, text);
    this.warnMissingGlyphs(fontFamily ?? fontFamilyEa, missingChars, fallback);
    if (fallback) return fallback.font;

    // どのフォントもカバーしない場合は従来どおり優先候補を返す (.notdef 描画)
    return primary;
  }

  private findFontCandidates(name: string, bold: boolean, italic: boolean): OpentypeFullFont[] {
    const out: OpentypeFullFont[] = [];

    // 要求スタイルに最も近いフェイスを優先順に収集する
    for (const [b, i] of fontStyleVariants(bold, italic)) {
      const direct = this.fonts.get(fontStyleKey(name, b, i));
      if (direct && !out.includes(direct)) out.push(direct);
    }

    // フォントマッピングで OSS 代替名を試行
    const mapped = getCurrentMappedFont(name);
    if (mapped) {
      for (const [b, i] of fontStyleVariants(bold, italic)) {
        const mappedFont = this.fonts.get(fontStyleKey(mapped, b, i));
        if (mappedFont && !out.includes(mappedFont)) out.push(mappedFont);
      }

      // CJK フォールバックチェーン
      for (const fallback of getCjkFallbackFonts(mapped)) {
        const fallbackFont = this.fonts.get(fallback);
        if (fallbackFont && !out.includes(fallbackFont)) out.push(fallbackFont);
      }
    }

    return out;
  }

  /** 登録済み全フォントからテキストをカバーするフォントを探す (結果はキャッシュ) */
  private findCoveringFallback(text: string, bold: boolean, italic: boolean): FallbackFace | null {
    const cacheKey = `${bold ? "b" : ""}${italic ? "i" : ""}|${text}`;
    const cached = this.coverageCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let result: FallbackFace | null = null;
    for (const [b, i] of fontStyleVariants(bold, italic)) {
      const face = this.fallbackPool.find(
        (f) => f.bold === b && f.italic === i && fontCoversText(f.font, text),
      );
      if (face) {
        result = face;
        break;
      }
    }

    if (this.coverageCache.size >= COVERAGE_CACHE_LIMIT) this.coverageCache.clear();
    this.coverageCache.set(cacheKey, result);
    return result;
  }

  private warnMissingGlyphs(
    family: string | null | undefined,
    missingChars: string,
    fallback: FallbackFace | null,
  ): void {
    const familyLabel = family ?? "(default)";
    const key = `${familyLabel}|${missingChars}|${fallback?.name ?? ""}`;
    if (this.warnedGlyphs.has(key)) return;
    this.warnedGlyphs.add(key);
    const detail = fallback
      ? `falling back to "${fallback.name}"`
      : "no available font covers them";
    warn(
      "font.missingGlyphs",
      `Font "${familyLabel}" is missing glyphs for "${missingChars}"; ${detail}`,
    );
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
