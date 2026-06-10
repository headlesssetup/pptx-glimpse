/**
 * PowerPoint の埋め込みフォント (ppt/fonts/*.fntdata) は EOT (Embedded OpenType)
 * 形式でラップされている (先頭が EOTSize で、末尾に生フォントデータが入る)。
 * opentype.js は EOT を直接解釈できないため、ヘッダを解析して中の生 TTF/OTF を取り出す。
 *
 * EOT ヘッダ (リトルエンディアン):
 *   0  EOTSize      ULONG
 *   4  FontDataSize ULONG
 *   8  Version      ULONG
 *   12 Flags        ULONG
 *   ...
 *   34 MagicNumber  USHORT == 0x504C
 */

import { decodeMtx } from "./mtx/index.js";

// sfnt フォント署名 (ビッグエンディアン uint32)
const SIG_TTF = 0x00010000; // 00 01 00 00
const SIG_OTTO = 0x4f54544f; // "OTTO"
const SIG_TRUE = 0x74727565; // "true"
const SIG_TTCF = 0x74746366; // "ttcf"

const EOT_MAGIC = 0x504c;
const TTEMBED_TTCOMPRESSED = 0x00000004; // MicroType Express 圧縮
const TTEMBED_XORENCRYPTDATA = 0x10000000; // フォントデータが 0x50 で XOR 暗号化
const EOT_XOR_KEY = 0x50;

function u16LE(d: Uint8Array, o: number): number {
  return d[o] | (d[o + 1] << 8);
}

function u32LE(d: Uint8Array, o: number): number {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}

function u32BE(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

function isFontSignature(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const sig = u32BE(data, 0);
  return sig === SIG_TTF || sig === SIG_OTTO || sig === SIG_TRUE || sig === SIG_TTCF;
}

/**
 * 埋め込みフォントのバイナリを生 TTF/OTF に正規化する。
 * - すでに生フォントならそのまま返す
 * - EOT ラップなら中身を取り出す
 * - 解釈できない (MicroType Express 圧縮など) 場合は null
 */
export function unwrapEmbeddedFontData(data: Uint8Array): Uint8Array | null {
  if (isFontSignature(data)) return data;
  return extractFontFromEot(data);
}

/** EOT ラップされたバイナリから生フォントデータを取り出す。失敗時は null。 */
export function extractFontFromEot(data: Uint8Array): Uint8Array | null {
  if (data.length < 82) return null;
  if (u16LE(data, 34) !== EOT_MAGIC) return null;

  const eotSize = u32LE(data, 0);
  const fontDataSize = u32LE(data, 4);
  const flags = u32LE(data, 12);
  if (fontDataSize === 0 || fontDataSize > data.length) return null;

  const xor = (flags & TTEMBED_XORENCRYPTDATA) !== 0;
  const compressed = (flags & TTEMBED_TTCOMPRESSED) !== 0;

  // フォントデータは通常ファイル末尾に置かれる。EOTSize 基準を優先しつつ末尾基準も試す。
  const candidates = [eotSize - fontDataSize, data.length - fontDataSize];
  for (const start of candidates) {
    if (start < 0 || start + fontDataSize > data.length) continue;
    let payload = data.slice(start, start + fontDataSize);
    if (xor) payload = payload.map((b) => b ^ EOT_XOR_KEY);
    if (compressed) {
      // MicroType Express 圧縮 → 展開して生フォントを得る
      try {
        const ttf = decodeMtx(payload);
        if (isFontSignature(ttf)) return ttf;
      } catch {
        // 展開失敗 → 次の候補へ
      }
    } else if (isFontSignature(payload)) {
      return payload;
    }
  }
  return null;
}

/** 埋め込みフォントが MicroType Express 圧縮された EOT かどうか (未対応形式の判定用)。 */
export function isMtxCompressedEot(data: Uint8Array): boolean {
  if (data.length < 82) return false;
  if (u16LE(data, 34) !== EOT_MAGIC) return false;
  return (u32LE(data, 12) & TTEMBED_TTCOMPRESSED) !== 0;
}
