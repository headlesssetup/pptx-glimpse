/** SVG <text> 用のクロスプラットフォーム絵文字フォントスタック */
export const EMOJI_FONT_FAMILY =
  "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, emoji, sans-serif";

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export function isEmojiText(text: string): boolean {
  return text.length > 0 && EMOJI_PATTERN.test(text);
}

export interface EmojiTextPart {
  text: string;
  isEmoji: boolean;
}

/** テキストを絵文字セグメントと通常テキストに分割する */
export function splitByEmoji(text: string): EmojiTextPart[] {
  if (text.length === 0) return [];

  const parts: EmojiTextPart[] = [];
  const re = /\p{Extended_Pictographic}+/gu;
  let lastIndex = 0;

  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), isEmoji: false });
    }
    parts.push({ text: match[0], isEmoji: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isEmoji: false });
  }

  return parts;
}

export function countEmojiGraphemes(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return [...segmenter.segment(text)].length;
  }
  return [...text].length;
}

/** 絵文字テキストの描画幅 (おおむね 1em 四方のグリフを仮定) */
export function measureEmojiWidth(text: string, fontSizePx: number): number {
  return countEmojiGraphemes(text) * fontSizePx;
}
