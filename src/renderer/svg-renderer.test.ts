import { describe, expect, it } from "vitest";

import type { SlideSize } from "../model/presentation.js";
import type { ShapeElement, Transform } from "../model/shape.js";
import type { Slide } from "../model/slide.js";
import { asEmu } from "../utils/unit-types.js";
import { renderSlideToSvg, renderSlideToSvgFrames } from "./svg-renderer.js";

const slideSize: SlideSize = { width: asEmu(9144000), height: asEmu(5143500) };

function makeTransform(): Transform {
  return {
    offsetX: asEmu(914400),
    offsetY: asEmu(914400),
    extentWidth: asEmu(1828800),
    extentHeight: asEmu(914400),
    rotation: 0,
    flipH: false,
    flipV: false,
  };
}

// 識別しやすいよう図形ごとに fill 色を変える
function makeShape(id: string, hex: string): ShapeElement {
  return {
    type: "shape",
    id,
    transform: makeTransform(),
    geometry: { type: "preset", preset: "rect", adjustValues: {} },
    fill: { type: "solid", color: { hex, alpha: 1 } },
    outline: null,
    textBody: null,
    effects: null,
  };
}

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    slideNumber: 1,
    background: null,
    elements: [],
    showMasterSp: true,
    ...overrides,
  };
}

describe("renderSlideToSvg with frame", () => {
  it("hides animated shapes that are not yet visible, keeps non-animated shapes", () => {
    const slide = makeSlide({
      elements: [makeShape("10", "#AAAAAA"), makeShape("20", "#BBBBBB")],
    });
    const svg = renderSlideToSvg(slide, slideSize, {
      visibleIds: new Set<string>(),
      animatedIds: new Set(["20"]),
    });
    // id 10 はアニメーション対象外 → 常に表示
    expect(svg).toContain("#AAAAAA");
    // id 20 はアニメーション対象だが visibleIds に無い → 非表示
    expect(svg).not.toContain("#BBBBBB");
  });

  it("renders all elements when no frame is given (backward compatible)", () => {
    const slide = makeSlide({
      elements: [makeShape("10", "#AAAAAA"), makeShape("20", "#BBBBBB")],
    });
    const svg = renderSlideToSvg(slide, slideSize);
    expect(svg).toContain("#AAAAAA");
    expect(svg).toContain("#BBBBBB");
  });
});

describe("renderSlideToSvgFrames", () => {
  it("returns a single frame when the slide has no build steps", () => {
    const slide = makeSlide({ elements: [makeShape("10", "#AAAAAA")] });
    const frames = renderSlideToSvgFrames(slide, slideSize);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain("#AAAAAA");
  });

  it("progressively reveals entrance shapes across frames", () => {
    const slide = makeSlide({
      elements: [
        makeShape("10", "#AAAAAA"), // アニメーション無し → 常に表示
        makeShape("20", "#BBBBBB"), // クリック1で出現
        makeShape("30", "#CCCCCC"), // クリック2で出現
      ],
      buildSteps: [
        { revealedIds: ["20"], hiddenIds: [] },
        { revealedIds: ["30"], hiddenIds: [] },
      ],
    });
    const frames = renderSlideToSvgFrames(slide, slideSize);
    expect(frames).toHaveLength(3); // 初期 + 2 クリック

    // フレーム0: 常時表示の図形のみ
    expect(frames[0]).toContain("#AAAAAA");
    expect(frames[0]).not.toContain("#BBBBBB");
    expect(frames[0]).not.toContain("#CCCCCC");

    // フレーム1: 20 が出現
    expect(frames[1]).toContain("#BBBBBB");
    expect(frames[1]).not.toContain("#CCCCCC");

    // フレーム2: 30 も出現
    expect(frames[2]).toContain("#BBBBBB");
    expect(frames[2]).toContain("#CCCCCC");
  });

  it("starts exit-only shapes visible and hides them on their click", () => {
    const slide = makeSlide({
      elements: [makeShape("20", "#BBBBBB")], // exit のみ
      buildSteps: [{ revealedIds: [], hiddenIds: ["20"] }],
    });
    const frames = renderSlideToSvgFrames(slide, slideSize);
    expect(frames).toHaveLength(2);
    // フレーム0: exit のみの図形は最初から表示
    expect(frames[0]).toContain("#BBBBBB");
    // フレーム1: クリックで非表示
    expect(frames[1]).not.toContain("#BBBBBB");
  });
});
