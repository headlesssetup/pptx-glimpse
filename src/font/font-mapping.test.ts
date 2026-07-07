import { describe, expect, it } from "vitest";

import {
  buildFontMappingSuggestion,
  createFontMapping,
  DEFAULT_FONT_MAPPING,
  type FontMapping,
  formatFontNotFoundMessage,
  getMappedFont,
} from "./font-mapping.js";

describe("DEFAULT_FONT_MAPPING", () => {
  it("デフォルトマッピングは空", () => {
    expect(DEFAULT_FONT_MAPPING).toEqual({});
  });
});

describe("createFontMapping", () => {
  it("ユーザーマッピングなしで空オブジェクトを返す", () => {
    expect(createFontMapping()).toEqual({});
  });

  it("ユーザーマッピングをそのまま返す", () => {
    const mapping = createFontMapping({ Calibri: "Carlito", Arial: "Arimo" });
    expect(mapping).toEqual({ Calibri: "Carlito", Arial: "Arimo" });
  });

  it("ユーザーマッピングで新しいエントリを追加できる", () => {
    const mapping = createFontMapping({ "My Custom Font": "Noto Sans" });
    expect(mapping).toEqual({ "My Custom Font": "Noto Sans" });
  });
});

describe("getMappedFont", () => {
  const mapping: FontMapping = {
    Calibri: "Carlito",
    Arial: "Arimo",
    "MS Gothic": "Noto Sans JP",
  };

  it("完全一致でマッピングを返す", () => {
    expect(getMappedFont("Calibri", mapping)).toBe("Carlito");
    expect(getMappedFont("Arial", mapping)).toBe("Arimo");
  });

  it("大文字小文字を無視してマッチする", () => {
    expect(getMappedFont("calibri", mapping)).toBe("Carlito");
    expect(getMappedFont("ARIAL", mapping)).toBe("Arimo");
    expect(getMappedFont("ms gothic", mapping)).toBe("Noto Sans JP");
  });

  it("マッピングに存在しないフォントは null を返す", () => {
    expect(getMappedFont("Unknown Font", mapping)).toBeNull();
    expect(getMappedFont("Aptos", mapping)).toBeNull();
  });

  it("null または undefined は null を返す", () => {
    expect(getMappedFont(null, mapping)).toBeNull();
    expect(getMappedFont(undefined, mapping)).toBeNull();
  });

  it("全角英数字を半角に正規化してマッチする", () => {
    const jpMapping: FontMapping = { "MS Pゴシック": "Noto Sans JP" };
    expect(getMappedFont("ＭＳ Ｐゴシック", jpMapping)).toBe("Noto Sans JP");
    expect(getMappedFont("ＭＳ\u3000Ｐゴシック", jpMapping)).toBe("Noto Sans JP");
  });
});

describe("buildFontMappingSuggestion", () => {
  it("未解決フォントごとにプレースホルダを生成する", () => {
    expect(buildFontMappingSuggestion(["Aptos", "Corbel Light"])).toEqual({
      Aptos: "YourSubstitute",
      "Corbel Light": "YourSubstitute",
    });
  });
});

describe("formatFontNotFoundMessage", () => {
  it("fontMapping の設定方法を含む", () => {
    const message = formatFontNotFoundMessage("Aptos");
    expect(message).toContain("Aptos");
    expect(message).toContain("fontMapping");
    expect(message).toContain("Corbel Light");
  });
});
