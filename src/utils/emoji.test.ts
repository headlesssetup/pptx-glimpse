import { describe, expect, it } from "vitest";

import {
  countEmojiGraphemes,
  isEmojiText,
  measureEmojiWidth,
  splitByEmoji,
} from "./emoji.js";

describe("splitByEmoji", () => {
  it("通常テキストのみ", () => {
    expect(splitByEmoji("Hello")).toEqual([{ text: "Hello", isEmoji: false }]);
  });

  it("絵文字のみ", () => {
    expect(splitByEmoji("👋")).toEqual([{ text: "👋", isEmoji: true }]);
  });

  it("テキストと絵文字を分割する", () => {
    expect(splitByEmoji("Hi 👋 there")).toEqual([
      { text: "Hi ", isEmoji: false },
      { text: "👋", isEmoji: true },
      { text: " there", isEmoji: false },
    ]);
  });
});

describe("isEmojiText", () => {
  it("絵文字を含む", () => {
    expect(isEmojiText("👋")).toBe(true);
  });

  it("通常テキストは false", () => {
    expect(isEmojiText("Sveiki")).toBe(false);
  });
});

describe("measureEmojiWidth", () => {
  it("1 グリフあたり fontSizePx 幅", () => {
    expect(measureEmojiWidth("👋", 48)).toBe(48);
    expect(countEmojiGraphemes("👋")).toBe(1);
  });
});
