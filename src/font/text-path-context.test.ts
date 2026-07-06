import { afterEach, describe, expect, it, vi } from "vitest";

import { getWarningEntries, initWarningLogger } from "../warning-logger.js";
import { resetFontMapping, setFontMapping } from "./font-mapping-context.js";
import type { OpentypeFullFont } from "./text-path-context.js";
import {
  DefaultTextPathFontResolver,
  fontStyleKey,
  fontStyleVariants,
  getTextPathFontResolver,
  orderFallbackPool,
  resetTextPathFontResolver,
  setTextPathFontResolver,
} from "./text-path-context.js";

function createMockFont(name: string): OpentypeFullFont {
  return {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    getPath: (_text: string, _x: number, _y: number, _fontSize: number) => ({
      toPathData: () => `M0 0 L10 10 /* ${name} */`,
    }),
    getAdvanceWidth: (text: string, fontSize: number) => text.length * fontSize * 0.6,
  };
}

describe("TextPathFontResolver context", () => {
  afterEach(() => {
    resetTextPathFontResolver();
  });

  it("初期状態では null を返す", () => {
    expect(getTextPathFontResolver()).toBeNull();
  });

  it("set 後に get で取得できる", () => {
    const fonts = new Map([["Arial", createMockFont("Arial")]]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    setTextPathFontResolver(resolver);
    expect(getTextPathFontResolver()).toBe(resolver);
  });

  it("reset 後に null に戻る", () => {
    const fonts = new Map([["Arial", createMockFont("Arial")]]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    setTextPathFontResolver(resolver);
    resetTextPathFontResolver();
    expect(getTextPathFontResolver()).toBeNull();
  });
});

describe("DefaultTextPathFontResolver", () => {
  it("fontFamily でフォントを解決する", () => {
    const arialFont = createMockFont("Arial");
    const fonts = new Map([["Arial", arialFont]]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Arial", null)).toBe(arialFont);
  });

  it("fontFamily が見つからなければ fontFamilyEa で解決する", () => {
    const notoFont = createMockFont("Noto Sans JP");
    const fonts = new Map([["Noto Sans JP", notoFont]]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Unknown", "Noto Sans JP")).toBe(notoFont);
  });

  it("どちらも見つからなければ defaultFont にフォールバック", () => {
    const defaultFont = createMockFont("Default");
    const fonts = new Map<string, OpentypeFullFont>();
    const resolver = new DefaultTextPathFontResolver(fonts, defaultFont);
    expect(resolver.resolveFont("Unknown", "AlsoUnknown")).toBe(defaultFont);
  });

  it("どれもなければ null を返す", () => {
    const fonts = new Map<string, OpentypeFullFont>();
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Unknown", null)).toBeNull();
  });

  it("fontFamily が null の場合は fontFamilyEa を試みる", () => {
    const notoFont = createMockFont("Noto Sans JP");
    const fonts = new Map([["Noto Sans JP", notoFont]]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont(null, "Noto Sans JP")).toBe(notoFont);
  });
});

describe("fontStyleKey / fontStyleVariants", () => {
  it("Regular はファミリ名そのもの", () => {
    expect(fontStyleKey("Arial", false, false)).toBe("Arial");
  });

  it("太字/斜体はサフィックス付き", () => {
    expect(fontStyleKey("Arial", true, false)).toBe("Arial b");
    expect(fontStyleKey("Arial", false, true)).toBe("Arial i");
    expect(fontStyleKey("Arial", true, true)).toBe("Arial bi");
  });

  it("優先順は 完全一致 → 太字 → 斜体 → Regular", () => {
    expect(fontStyleVariants(true, true)).toEqual([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(fontStyleVariants(false, false)).toEqual([[false, false]]);
  });
});

describe("DefaultTextPathFontResolver 太字/斜体フェイス選択", () => {
  function buildResolver() {
    const regular = createMockFont("Arial-Regular");
    const bold = createMockFont("Arial-Bold");
    const italic = createMockFont("Arial-Italic");
    const boldItalic = createMockFont("Arial-BoldItalic");
    const fonts = new Map<string, OpentypeFullFont>([
      [fontStyleKey("Arial", false, false), regular],
      [fontStyleKey("Arial", true, false), bold],
      [fontStyleKey("Arial", false, true), italic],
      [fontStyleKey("Arial", true, true), boldItalic],
    ]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    return { resolver, regular, bold, italic, boldItalic };
  }

  it("通常テキストは Regular フェイス", () => {
    const { resolver, regular } = buildResolver();
    expect(resolver.resolveFont("Arial", null)).toBe(regular);
    expect(resolver.resolveFont("Arial", null, null, {})).toBe(regular);
  });

  it("太字・斜体・太字斜体で対応フェイスを返す", () => {
    const { resolver, bold, italic, boldItalic } = buildResolver();
    expect(resolver.resolveFont("Arial", null, null, { bold: true })).toBe(bold);
    expect(resolver.resolveFont("Arial", null, null, { italic: true })).toBe(italic);
    expect(resolver.resolveFont("Arial", null, null, { bold: true, italic: true })).toBe(
      boldItalic,
    );
  });

  it("対応フェイスが無ければ近いフェイスにフォールバックする", () => {
    const regular = createMockFont("Reg");
    const bold = createMockFont("Bold");
    // Italic / BoldItalic フェイスは登録しない
    const fonts = new Map<string, OpentypeFullFont>([
      [fontStyleKey("Arial", false, false), regular],
      [fontStyleKey("Arial", true, false), bold],
    ]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    // 太字斜体 → 太字 にフォールバック
    expect(resolver.resolveFont("Arial", null, null, { bold: true, italic: true })).toBe(bold);
    // 斜体のみ → Regular にフォールバック
    expect(resolver.resolveFont("Arial", null, null, { italic: true })).toBe(regular);
  });
});

describe("DefaultTextPathFontResolver CJK フォールバック", () => {
  afterEach(() => {
    resetFontMapping();
    vi.restoreAllMocks();
  });

  it("マッピング先が見つからない場合に CJK フォールバックチェーンを試行する", async () => {
    // Linux CI ではフォールバックチェーンが空のため、macOS 相当の値をモックする
    const mod = await import("./cjk-font-fallback.js");
    vi.spyOn(mod, "getCjkFallbackFonts").mockReturnValue([
      "Hiragino Sans",
      "Hiragino Kaku Gothic ProN",
    ]);

    const hiraginoFont = createMockFont("Hiragino Sans");
    const fonts = new Map([["Hiragino Sans", hiraginoFont]]);
    setFontMapping({ Meiryo: "Noto Sans JP" });
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Meiryo", null)).toBe(hiraginoFont);
  });

  it("CJK フォールバックチェーンの2番目のフォントを返す", async () => {
    // Linux CI ではフォールバックチェーンが空のため、macOS 相当の値をモックする
    const mod = await import("./cjk-font-fallback.js");
    vi.spyOn(mod, "getCjkFallbackFonts").mockReturnValue([
      "Hiragino Sans",
      "Hiragino Kaku Gothic ProN",
    ]);

    const kakuFont = createMockFont("Hiragino Kaku Gothic ProN");
    const fonts = new Map([["Hiragino Kaku Gothic ProN", kakuFont]]);
    setFontMapping({ Meiryo: "Noto Sans JP" });
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Meiryo", null)).toBe(kakuFont);
  });
});

describe("DefaultTextPathFontResolver font.notFound 警告", () => {
  afterEach(() => {
    resetFontMapping();
    initWarningLogger("off");
  });

  it("フォントが見つからない場合に font.notFound 警告を出す", () => {
    initWarningLogger("warn");
    const fonts = new Map<string, OpentypeFullFont>();
    const resolver = new DefaultTextPathFontResolver(fonts);
    resolver.resolveFont("UnknownFont", null);
    const entries = getWarningEntries();
    expect(entries.some((e) => e.feature === "font.notFound")).toBe(true);
    expect(entries.some((e) => e.message.includes("UnknownFont"))).toBe(true);
  });

  it("同じフォント名の警告は重複しない", () => {
    initWarningLogger("warn");
    const fonts = new Map<string, OpentypeFullFont>();
    const resolver = new DefaultTextPathFontResolver(fonts);
    resolver.resolveFont("UnknownFont", null);
    resolver.resolveFont("UnknownFont", null);
    const entries = getWarningEntries().filter(
      (e) => e.feature === "font.notFound" && e.message.includes("UnknownFont"),
    );
    expect(entries).toHaveLength(1);
  });

  it("フォントが見つかった場合は警告を出さない", () => {
    initWarningLogger("warn");
    const arialFont = createMockFont("Arial");
    const fonts = new Map([["Arial", arialFont]]);
    const resolver = new DefaultTextPathFontResolver(fonts);
    resolver.resolveFont("Arial", null);
    const entries = getWarningEntries().filter((e) => e.feature === "font.notFound");
    expect(entries).toHaveLength(0);
  });
});

describe("DefaultTextPathFontResolver グリフカバレッジフォールバック", () => {
  /** 指定した文字集合のみグリフを持つモックフォントを作る */
  function createCoverageFont(name: string, coveredChars: string): OpentypeFullFont {
    const covered = new Set(coveredChars);
    return {
      ...createMockFont(name),
      charToGlyphIndex: (char: string) => (covered.has(char) ? 1 : 0),
    };
  }

  const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:";
  const LATVIAN = `${LATIN}ļēāšņī`;

  it("解決したフォントが全グリフを持つ場合はそのまま使う", () => {
    const arial = createCoverageFont("Arial", LATVIAN);
    const fonts = new Map([["Arial", arial]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "Arial", bold: false, italic: false, font: arial },
    ]);
    expect(resolver.resolveFont("Arial", null, undefined, undefined, "Ceļš")).toBe(arial);
  });

  it("解決したフォントにグリフが無い場合はカバーするフォントにフォールバック", () => {
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const wide = createCoverageFont("WideFont", LATVIAN);
    const fonts = new Map([
      ["NarrowFont", narrow],
      ["WideFont", wide],
    ]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "NarrowFont", bold: false, italic: false, font: narrow },
      { name: "WideFont", bold: false, italic: false, font: wide },
    ]);
    expect(resolver.resolveFont("NarrowFont", null, undefined, undefined, "Ceļš")).toBe(wide);
    // ASCII のみのテキストは従来どおり NarrowFont
    expect(resolver.resolveFont("NarrowFont", null, undefined, undefined, "Hello")).toBe(narrow);
  });

  it("defaultFont にグリフが無い場合もプールからフォールバック", () => {
    const narrow = createCoverageFont("NarrowDefault", LATIN);
    const wide = createCoverageFont("WideFont", LATVIAN);
    const fonts = new Map([["WideFont", wide]]);
    const resolver = new DefaultTextPathFontResolver(fonts, narrow, [
      { name: "NarrowDefault", bold: false, italic: false, font: narrow },
      { name: "WideFont", bold: false, italic: false, font: wide },
    ]);
    expect(resolver.resolveFont("MissingFamily", null, undefined, undefined, "stāsts")).toBe(wide);
  });

  it("フォールバックは同一ファミリ内で要求スタイルのフェイスを選ぶ", () => {
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const wideRegular = createCoverageFont("Wide/Regular", LATVIAN);
    const wideBold = createCoverageFont("Wide/Bold", LATVIAN);
    const fonts = new Map([["NarrowFont", narrow]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "NarrowFont", bold: false, italic: false, font: narrow },
      { name: "Wide", bold: false, italic: false, font: wideRegular },
      { name: "Wide", bold: true, italic: false, font: wideBold },
    ]);
    expect(resolver.resolveFont("NarrowFont", null, undefined, { bold: true }, "Ceļš")).toBe(
      wideBold,
    );
    expect(resolver.resolveFont("NarrowFont", null, undefined, undefined, "Ceļš")).toBe(
      wideRegular,
    );
  });

  it("スタイル違いのランが別ファミリへ散らばらない (Regular フェイスを持つファミリに固定)", () => {
    // Italic のみのファミリがプール先頭にあっても、Regular を持つファミリへ揃える
    const thinItalic = createCoverageFont("ThinItalic", LATVIAN);
    const wideRegular = createCoverageFont("Wide/Regular", LATVIAN);
    const wideItalic = createCoverageFont("Wide/Italic", LATVIAN);
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const fonts = new Map([["NarrowFont", narrow]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "NarrowFont", bold: false, italic: false, font: narrow },
      { name: "ThinItalic", bold: false, italic: true, font: thinItalic },
      { name: "Wide", bold: false, italic: false, font: wideRegular },
      { name: "Wide", bold: false, italic: true, font: wideItalic },
    ]);
    expect(resolver.resolveFont("NarrowFont", null, undefined, undefined, "Ceļš")).toBe(
      wideRegular,
    );
    expect(resolver.resolveFont("NarrowFont", null, undefined, { italic: true }, "Ceļš")).toBe(
      wideItalic,
    );
  });

  it("Regular を持つファミリが無ければ任意のフェイスでカバーするファミリを使う", () => {
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const onlyItalic = createCoverageFont("OnlyItalic", LATVIAN);
    const fonts = new Map([["NarrowFont", narrow]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "NarrowFont", bold: false, italic: false, font: narrow },
      { name: "OnlyItalic", bold: false, italic: true, font: onlyItalic },
    ]);
    expect(resolver.resolveFont("NarrowFont", null, undefined, { italic: true }, "Ceļš")).toBe(
      onlyItalic,
    );
  });

  it("どのフォントもカバーしない場合は従来どおり優先候補を返す", () => {
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const fonts = new Map([["NarrowFont", narrow]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "NarrowFont", bold: false, italic: false, font: narrow },
    ]);
    expect(resolver.resolveFont("NarrowFont", null, undefined, undefined, "Ceļš")).toBe(narrow);
  });

  it("text 未指定なら従来動作 (カバレッジ判定なし)", () => {
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const wide = createCoverageFont("WideFont", LATVIAN);
    const fonts = new Map([["NarrowFont", narrow]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "WideFont", bold: false, italic: false, font: wide },
    ]);
    expect(resolver.resolveFont("NarrowFont", null)).toBe(narrow);
  });

  it("charToGlyphIndex を持たないフォントは判定不能として従来動作", () => {
    const plain = createMockFont("PlainFont");
    const wide = createCoverageFont("WideFont", LATVIAN);
    const fonts = new Map([["PlainFont", plain]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "WideFont", bold: false, italic: false, font: wide },
    ]);
    expect(resolver.resolveFont("PlainFont", null, undefined, undefined, "Ceļš")).toBe(plain);
  });

  it("空白のみのテキストではフォールバックしない", () => {
    const narrow = createCoverageFont("NarrowFont", "");
    const fonts = new Map([["NarrowFont", narrow]]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, []);
    expect(resolver.resolveFont("NarrowFont", null, undefined, undefined, "  \t ")).toBe(narrow);
  });

  it("フォールバック時に font.missingGlyphs の警告を出す", () => {
    initWarningLogger("warn");
    const narrow = createCoverageFont("NarrowFont", LATIN);
    const wide = createCoverageFont("WideFont", LATVIAN);
    const fonts = new Map([
      ["NarrowFont", narrow],
      ["WideFont", wide],
    ]);
    const resolver = new DefaultTextPathFontResolver(fonts, undefined, [
      { name: "WideFont", bold: false, italic: false, font: wide },
    ]);
    resolver.resolveFont("NarrowFont", null, undefined, undefined, "Ceļš");
    resolver.resolveFont("NarrowFont", null, undefined, undefined, "Ceļš");
    const entries = getWarningEntries().filter((e) => e.feature === "font.missingGlyphs");
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain("ļ");
    expect(entries[0].message).toContain("WideFont");
  });
});

describe("orderFallbackPool", () => {
  const font = () => createMockFont("f");

  it("優先ファミリをスキャン順より前に並べる", () => {
    const pool = [
      { name: "Random First", bold: false, italic: false, font: font() },
      { name: "DejaVu Sans", bold: false, italic: false, font: font() },
      { name: "Carlito", bold: false, italic: false, font: font() },
    ];
    const ordered = orderFallbackPool(pool);
    expect(ordered.map((f) => f.name)).toEqual(["Carlito", "DejaVu Sans", "Random First"]);
  });

  it("埋め込みフォントは優先ファミリよりさらに前", () => {
    const pool = [
      { name: "Carlito", bold: false, italic: false, font: font() },
      { name: "Corporate Embedded", bold: false, italic: false, font: font(), embedded: true },
    ];
    const ordered = orderFallbackPool(pool);
    expect(ordered.map((f) => f.name)).toEqual(["Corporate Embedded", "Carlito"]);
  });

  it("同一ファミリのフェイスは隣接を保つ", () => {
    const pool = [
      { name: "Liberation Sans", bold: false, italic: false, font: font() },
      { name: "Other", bold: false, italic: false, font: font() },
      { name: "Liberation Sans", bold: true, italic: false, font: font() },
    ];
    const ordered = orderFallbackPool(pool);
    expect(ordered.map((f) => `${f.name}${f.bold ? " b" : ""}`)).toEqual([
      "Liberation Sans",
      "Liberation Sans b",
      "Other",
    ]);
  });
});

describe("実フォント優先", () => {
  afterEach(() => {
    resetFontMapping();
  });

  it("実フォントがインストールされていればマッピングより優先される", () => {
    // Aptos → Carlito のマッピングがあっても、本物の Aptos があればそれを使う
    const aptos = createMockFont("Aptos");
    const carlito = createMockFont("Carlito");
    const fonts = new Map([
      ["Aptos", aptos],
      ["Carlito", carlito],
    ]);
    setFontMapping({ Aptos: "Carlito" });
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Aptos", null)).toBe(aptos);
  });

  it("実フォントの Bold フェイスもマッピングより優先される", () => {
    const aptosBold = createMockFont("Aptos-Bold");
    const carlito = createMockFont("Carlito");
    const fonts = new Map([
      [fontStyleKey("Aptos", true, false), aptosBold],
      ["Carlito", carlito],
    ]);
    setFontMapping({ Aptos: "Carlito" });
    const resolver = new DefaultTextPathFontResolver(fonts);
    expect(resolver.resolveFont("Aptos", null, null, { bold: true })).toBe(aptosBold);
  });
});
