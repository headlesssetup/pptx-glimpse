/**
 * opentype.js を使ってフォントを読み込み OpentypeTextMeasurer を構築するヘルパー。
 */
import { readFile } from "node:fs/promises";

import type { FontMapping } from "./font-mapping.js";
import { createFontMapping } from "./font-mapping.js";
import type { OpentypeFont } from "./opentype-text-measurer.js";
import { OpentypeTextMeasurer } from "./opentype-text-measurer.js";
import { collectFontFilePaths } from "./system-font-loader.js";
import type { OpentypeFullFont, TextPathFontResolver } from "./text-path-context.js";
import { DefaultTextPathFontResolver, fontStyleKey } from "./text-path-context.js";
import { extractTtcFonts, isTtcBuffer } from "./ttc-parser.js";

/** フォントバッファの入力形式 */
export interface FontBuffer {
  name?: string;
  data: ArrayBuffer | Uint8Array;
}

interface OpentypeFontWithNames extends OpentypeFont {
  names: {
    fontFamily?: Record<string, string>;
    preferredFamily?: Record<string, string>;
    fontSubfamily?: Record<string, string>;
    preferredSubfamily?: Record<string, string>;
  };
  tables?: {
    os2?: { fsSelection?: number };
    head?: { macStyle?: number };
  };
}

interface FontFace {
  bold: boolean;
  italic: boolean;
}

// OS/2 fsSelection ビット
const FS_ITALIC = 0x01;
const FS_BOLD = 0x20;
// head.macStyle ビット
const MAC_BOLD = 0x01;
const MAC_ITALIC = 0x02;

/**
 * フォントの太字/斜体フェイスを判定する。
 * OS/2 fsSelection・head.macStyle・サブファミリ名の各シグナルを OR で統合する。
 * 単一テーブルに頼らないのは、bold/italic ビットを設定し損ねているフォントや、
 * 名前テーブルにしかスタイルを持たないフォントでも正しく判定するため。
 */
function getFontStyle(font: OpentypeFontWithNames): FontFace {
  const fsSelection = font.tables?.os2?.fsSelection ?? 0;
  const macStyle = font.tables?.head?.macStyle ?? 0;

  const sub: string[] = [];
  if (font.names.fontSubfamily) sub.push(...Object.values(font.names.fontSubfamily));
  if (font.names.preferredSubfamily) sub.push(...Object.values(font.names.preferredSubfamily));
  const joined = sub.join(" ").toLowerCase();

  const bold =
    (fsSelection & FS_BOLD) !== 0 ||
    (macStyle & MAC_BOLD) !== 0 ||
    /\b(bold|black|heavy)\b/.test(joined);
  const italic =
    (fsSelection & FS_ITALIC) !== 0 ||
    (macStyle & MAC_ITALIC) !== 0 ||
    /\b(italic|oblique)\b/.test(joined);
  return { bold, italic };
}

/**
 * opentype.js を動的 import でロードする。
 * opentype.js がインストールされていない場合は null を返す。
 */
async function tryLoadOpentype(): Promise<{
  parse: (buffer: ArrayBuffer) => OpentypeFontWithNames;
} | null> {
  try {
    // Use a variable to prevent bundlers from statically resolving this import
    const specifier = "opentype.js";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod: { parse: (buffer: ArrayBuffer) => OpentypeFontWithNames } = await import(
      /* @vite-ignore */ specifier
    );
    return { parse: mod.parse };
  } catch {
    return null;
  }
}

/**
 * フォントマッピングの逆引きテーブルを構築する。
 * OSS フォント名 → PPTX フォント名[] のマッピング。
 * 例: "Carlito" → ["Calibri"]
 */
function buildReverseMapping(mapping: FontMapping): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const [pptxName, ossName] of Object.entries(mapping)) {
    const existing = reverse.get(ossName) ?? [];
    existing.push(pptxName);
    reverse.set(ossName, existing);
  }
  return reverse;
}

/**
 * ArrayBuffer | Uint8Array → ArrayBuffer に変換する。
 * Uint8Array の場合は slice で独立した ArrayBuffer を取得する。
 */
function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/**
 * バッファ (TTF/OTF または TTC) からパース済みフォント配列を返す。
 * TTC の場合はメモリ消費を抑えるため最初の1フォントのみ抽出してパースする。
 */
function parseFontBuffer(
  arrayBuffer: ArrayBuffer,
  opentype: { parse: (buffer: ArrayBuffer) => OpentypeFontWithNames },
): OpentypeFontWithNames[] {
  if (isTtcBuffer(arrayBuffer)) {
    // TTC からは最初の1フォントのみ抽出する。
    // CJK TTC (NotoSansCJK 等) は全フォント展開すると数百MBのメモリを消費するため。
    const fonts = extractTtcFonts(arrayBuffer);
    if (fonts.length > 0) {
      try {
        return [opentype.parse(fonts[0])];
      } catch {
        // パース失敗はスキップ
      }
    }
    return [];
  }
  return [opentype.parse(arrayBuffer)];
}

/**
 * フォントバッファ配列から OpentypeTextMeasurer を構築する。
 *
 * 内部で opentype.js を動的 import してフォントをパースする。
 * opentype.js が利用不可な場合は null を返す。
 */
export async function createOpentypeTextMeasurerFromBuffers(
  fontBuffers: FontBuffer[],
  fontMapping?: FontMapping,
): Promise<OpentypeTextMeasurer | null> {
  const setup = await createOpentypeSetupFromBuffers(fontBuffers, fontMapping);
  return setup?.measurer ?? null;
}

export interface OpentypeSetup {
  measurer: OpentypeTextMeasurer;
  fontResolver: TextPathFontResolver;
}

/**
 * フォントバッファ配列から OpentypeTextMeasurer と TextPathFontResolver を同時に構築する。
 *
 * opentype.parse() が返すオブジェクトは OpentypeFont と OpentypeFullFont の両方を満たすため、
 * 同じ Font オブジェクトを measurer と fontResolver の両方に渡す。
 */
export async function createOpentypeSetupFromBuffers(
  fontBuffers: FontBuffer[],
  fontMapping?: FontMapping,
): Promise<OpentypeSetup | null> {
  if (fontBuffers.length === 0) return null;

  const opentype = await tryLoadOpentype();
  if (!opentype) return null;

  const mapping = createFontMapping(fontMapping);
  const reverseMap = buildReverseMapping(mapping);
  const measurerFonts = new Map<string, OpentypeFont>();
  const resolverFonts = new Map<string, OpentypeFullFont>();
  const plainRegular = new Set<string>();
  let firstMeasurerFont: OpentypeFont | null = null;
  let firstResolverFont: OpentypeFullFont | null = null;

  for (const buffer of fontBuffers) {
    try {
      const arrayBuffer = toArrayBuffer(buffer.data);
      const isTtc = isTtcBuffer(arrayBuffer);
      const fonts = parseFontBuffer(arrayBuffer, opentype);

      for (const font of fonts) {
        if (!firstMeasurerFont) firstMeasurerFont = font;
        if (!firstResolverFont) firstResolverFont = font as unknown as OpentypeFullFont;

        const style = getFontStyle(font);
        if (isTtc) {
          // TTC: names テーブルからフォント名を取得して登録
          for (const name of collectFontNames(font)) {
            registerFont(name, font, style, reverseMap, measurerFonts, resolverFonts, plainRegular);
          }
        } else if (buffer.name) {
          registerFont(
            buffer.name,
            font,
            style,
            reverseMap,
            measurerFonts,
            resolverFonts,
            plainRegular,
          );
        }
      }
    } catch {
      // パース失敗のフォントはスキップ
    }
  }

  if (measurerFonts.size === 0 && !firstMeasurerFont) return null;

  const measurer = new OpentypeTextMeasurer(measurerFonts, firstMeasurerFont ?? undefined);
  const fontResolver = new DefaultTextPathFontResolver(
    resolverFonts,
    firstResolverFont ?? undefined,
  );

  return { measurer, fontResolver };
}

function registerFont(
  name: string,
  font: OpentypeFontWithNames,
  style: FontFace,
  reverseMap: Map<string, string[]>,
  measurerFonts: Map<string, OpentypeFont>,
  resolverFonts: Map<string, OpentypeFullFont>,
  plainRegular: Set<string>,
): void {
  registerOne(name, font, style, measurerFonts, resolverFonts, plainRegular);

  // 逆引きで PPTX フォント名も登録
  const pptxNames = reverseMap.get(name);
  if (pptxNames) {
    for (const pptxName of pptxNames) {
      registerOne(pptxName, font, style, measurerFonts, resolverFonts, plainRegular);
    }
  }
}

/**
 * 1 つのフォント名についてスタイル修飾キー + 素のファミリ名キーを登録する。
 * - 太字/斜体フェイスは "Family bi" 形式の修飾キーに登録 (先勝ち)。
 * - 素のファミリ名キーは Regular フェイスを優先する。先に非 Regular で
 *   暫定登録されていても、後から Regular が来たら上書きする。これにより
 *   ディレクトリの走査順 (アルファベット順で Bold Italic が先に来る等) に
 *   左右されず、通常テキストが必ず Regular フェイスで描画される。
 */
function registerOne(
  name: string,
  font: OpentypeFontWithNames,
  style: FontFace,
  measurerFonts: Map<string, OpentypeFont>,
  resolverFonts: Map<string, OpentypeFullFont>,
  plainRegular: Set<string>,
): void {
  const fullFont = font as unknown as OpentypeFullFont;
  const isRegular = !style.bold && !style.italic;

  if (!isRegular) {
    const key = fontStyleKey(name, style.bold, style.italic);
    if (!measurerFonts.has(key)) {
      measurerFonts.set(key, font);
      resolverFonts.set(key, fullFont);
    }
  }

  const plainUnset = !measurerFonts.has(name);
  const plainUpgrade = isRegular && !plainRegular.has(name);
  if (plainUnset || plainUpgrade) {
    measurerFonts.set(name, font);
    resolverFonts.set(name, fullFont);
    if (isRegular) plainRegular.add(name);
  }
}

/**
 * フォントの names テーブルからフォント名のセットを収集する。
 * fontFamily と preferredFamily の両方を含める。
 * Variable Font では fontFamily が "Noto Sans JP Thin" のように
 * インスタンス名になるため、preferredFamily ("Noto Sans JP") も登録する。
 */
function collectFontNames(font: OpentypeFontWithNames): Set<string> {
  const names = new Set<string>();
  if (font.names.fontFamily) {
    for (const name of Object.values(font.names.fontFamily)) {
      names.add(name);
    }
  }
  if (font.names.preferredFamily) {
    for (const name of Object.values(font.names.preferredFamily)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * キャッシュキーを生成する。fontDirs と fontMapping の組み合わせで一意に識別する。
 */
function buildCacheKey(
  additionalFontDirs?: string[],
  fontMapping?: FontMapping,
  skipSystemFonts = false,
): string {
  const dirsKey = additionalFontDirs ? [...additionalFontDirs].sort().join("\0") : "";
  const mappingKey = fontMapping
    ? JSON.stringify(fontMapping, Object.keys(fontMapping).sort())
    : "";
  return `${dirsKey}\n${mappingKey}\n${skipSystemFonts}`;
}

/** パース済み Font オブジェクトのキャッシュ */
let cachedSetup: OpentypeSetup | null = null;
let cachedSetupKey: string | null = null;

/**
 * フォントオブジェクトキャッシュをクリアする。
 * 通常は呼び出す必要はないが、フォントのインストール/アンインストール後に
 * 強制的に再読み込みしたい場合に使用する。
 */
export function clearFontCache(): void {
  cachedSetup = null;
  cachedSetupKey = null;
}

/**
 * システムフォント + 追加ディレクトリから OpentypeTextMeasurer と TextPathFontResolver を構築する。
 *
 * 1. collectFontFilePaths() でフォントファイルパスを収集
 * 2. 各ファイルを readFile + opentype.parse でパース
 * 3. フォント名をキーとしてマップに登録（逆引きマッピング含む）
 *
 * パース済みの Font オブジェクトはモジュールレベルでキャッシュされ、
 * 同じ fontDirs / fontMapping での 2 回目以降の呼び出しではキャッシュを返す。
 */
export async function createOpentypeSetupFromSystem(
  additionalFontDirs?: string[],
  fontMapping?: FontMapping,
  skipSystemFonts = false,
): Promise<OpentypeSetup | null> {
  const key = buildCacheKey(additionalFontDirs, fontMapping, skipSystemFonts);
  if (cachedSetup && cachedSetupKey === key) {
    return cachedSetup;
  }

  const opentype = await tryLoadOpentype();
  if (!opentype) return null;

  const fontFilePaths = collectFontFilePaths(additionalFontDirs, skipSystemFonts);
  if (fontFilePaths.length === 0) return null;

  const mapping = createFontMapping(fontMapping);
  const reverseMap = buildReverseMapping(mapping);
  const measurerFonts = new Map<string, OpentypeFont>();
  const resolverFonts = new Map<string, OpentypeFullFont>();
  const plainRegular = new Set<string>();
  let firstMeasurerFont: OpentypeFont | null = null;
  let firstResolverFont: OpentypeFullFont | null = null;

  for (const filePath of fontFilePaths) {
    try {
      const data = await readFile(filePath);
      const arrayBuffer = toArrayBuffer(data);
      const fonts = parseFontBuffer(arrayBuffer, opentype);

      for (const font of fonts) {
        if (!firstMeasurerFont) firstMeasurerFont = font;
        if (!firstResolverFont) firstResolverFont = font as unknown as OpentypeFullFont;

        const style = getFontStyle(font);
        // names テーブルからフォント名を取得して登録
        for (const name of collectFontNames(font)) {
          registerFont(name, font, style, reverseMap, measurerFonts, resolverFonts, plainRegular);
        }
      }
    } catch {
      // パース失敗のフォントはスキップ
    }
  }

  if (measurerFonts.size === 0 && !firstMeasurerFont) return null;

  const measurer = new OpentypeTextMeasurer(measurerFonts, firstMeasurerFont ?? undefined);
  const fontResolver = new DefaultTextPathFontResolver(
    resolverFonts,
    firstResolverFont ?? undefined,
  );

  const setup = { measurer, fontResolver };
  cachedSetup = setup;
  cachedSetupKey = key;

  return setup;
}
