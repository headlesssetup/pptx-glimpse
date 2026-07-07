/**
 * PPTX フォント名 → 代替フォントのマッピング。
 * ライブラリはデフォルトの置換を持たない。ユーザーが明示的に指定する。
 */

/** フォントマッピングテーブルの型 */
export type FontMapping = Record<string, string>;

/** 空のデフォルトマッピング (後方互換のため export を維持) */
export const DEFAULT_FONT_MAPPING: Readonly<FontMapping> = {};

/**
 * ユーザーマッピングテーブルを返す。未指定時は空オブジェクト。
 */
export function createFontMapping(userMapping?: FontMapping): FontMapping {
  return { ...(userMapping ?? {}) };
}

/**
 * 全角英数字・記号を半角に正規化する。
 * PPTX テーマでは「ＭＳ Ｐゴシック」のように全角が使われることがある。
 */
function normalizeFullWidth(s: string): string {
  return s
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

export function getMappedFont(
  fontFamily: string | null | undefined,
  mapping: FontMapping,
): string | null {
  if (!fontFamily) return null;

  const direct = mapping[fontFamily];
  if (direct !== undefined) return direct;

  const normalized = normalizeFullWidth(fontFamily);

  // 正規化後の完全一致
  if (normalized !== fontFamily) {
    const directNormalized = mapping[normalized];
    if (directNormalized !== undefined) return directNormalized;
  }

  // 大文字小文字を無視したフォールバック
  const lower = normalized.toLowerCase();
  for (const key of Object.keys(mapping)) {
    if (normalizeFullWidth(key).toLowerCase() === lower) {
      return mapping[key];
    }
  }

  return null;
}

/** 未解決フォント向けの fontMapping 設定例を生成する */
export function buildFontMappingSuggestion(fonts: readonly string[]): FontMapping {
  const mapping: FontMapping = {};
  for (const font of fonts) {
    mapping[font] = "YourSubstitute";
  }
  return mapping;
}

/** 未解決フォントの警告メッセージ (font.notFound 用) */
export function formatFontNotFoundMessage(fontFamily: string): string {
  return (
    `Font not found: "${fontFamily}". ` +
    `Install it on the render host, embed it in the PPTX, or add fontMapping ` +
    `(e.g. { "${fontFamily}": "YourSubstitute" }). ` +
    `Map weight-specific faces separately when needed (e.g. "Corbel Light").`
  );
}
