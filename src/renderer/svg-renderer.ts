import type { SlideSize } from "../model/presentation.js";
import type { GroupElement, SlideElement } from "../model/shape.js";
import type { Slide } from "../model/slide.js";
import { emuToPixels } from "../utils/emu.js";
import { renderChart } from "./chart-renderer.js";
import { renderFillAttrs } from "./fill-renderer.js";
import { renderImage } from "./image-renderer.js";
import type { RenderResult } from "./render-result.js";
import { renderConnector, renderShape } from "./shape-renderer.js";
import { renderTable } from "./table-renderer.js";

// SVG 1.1 (W3C) で出力。CSS クラスは使わずインライン属性のみ使用する。
// 理由: sharp (内部で librsvg を使用) が CSS セレクタを正しく解釈しないため。

/**
 * アニメーションのビルドステップを描画する際の表示状態。
 * - animatedIds: スライド内でアニメーション対象になっている全図形の id
 * - visibleIds: このフレームで表示されている図形の id
 */
interface RenderFrame {
  visibleIds: Set<string>;
  animatedIds: Set<string>;
}

// 図形がこのフレームで表示されるか判定する。
// id を持たない / アニメーション対象でない図形は常に表示。
// アニメーション対象の図形は visibleIds に含まれるときだけ表示。
function isElementVisible(element: SlideElement, frame: RenderFrame): boolean {
  const id = "id" in element ? element.id : undefined;
  if (id === undefined) return true;
  if (!frame.animatedIds.has(id)) return true;
  return frame.visibleIds.has(id);
}

export function renderSlideToSvg(slide: Slide, slideSize: SlideSize, frame?: RenderFrame): string {
  const width = emuToPixels(slideSize.width);
  const height = emuToPixels(slideSize.height);

  const parts: string[] = [];
  const defs: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );

  // Background
  if (slide.background?.fill?.type === "image") {
    const bg = slide.background.fill;
    parts.push(
      `<image href="data:${bg.mimeType};base64,${bg.imageData}" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
    );
  } else if (slide.background?.fill) {
    const fillResult = renderFillAttrs(slide.background.fill);
    if (fillResult.defs) defs.push(fillResult.defs);
    parts.push(`<rect width="${width}" height="${height}" ${fillResult.attrs}/>`);
  } else {
    parts.push(`<rect width="${width}" height="${height}" fill="#FFFFFF"/>`);
  }

  // Elements
  for (const element of slide.elements) {
    if (frame && !isElementVisible(element, frame)) continue;
    const result = renderElement(element, frame);
    if (result) {
      parts.push(result.content);
      defs.push(...result.defs);
    }
  }

  // Insert defs if any
  if (defs.length > 0) {
    parts.splice(1, 0, `<defs>${defs.join("")}</defs>`);
  }

  parts.push("</svg>");
  return parts.join("");
}

/**
 * クリックアニメーションのビルドステップを順に適用し、各フレームの SVG を返す。
 * 戻り値[0] は初期状態 (entrance 前)、[i] は i 回目のクリック後の状態。
 * slide.buildSteps が無い場合は全要素を描画した単一フレームを返す。
 */
export function renderSlideToSvgFrames(slide: Slide, slideSize: SlideSize): string[] {
  const steps = slide.buildSteps;
  if (!steps || steps.length === 0) {
    return [renderSlideToSvg(slide, slideSize)];
  }

  // アニメーション対象の全 id と、entrance で出現する id を集計
  const animatedIds = new Set<string>();
  const everRevealed = new Set<string>();
  for (const step of steps) {
    for (const id of step.revealedIds) {
      animatedIds.add(id);
      everRevealed.add(id);
    }
    for (const id of step.hiddenIds) animatedIds.add(id);
  }

  // 初期表示: entrance を持たない (exit のみの) 図形は最初から表示されている
  const visibleIds = new Set<string>();
  for (const id of animatedIds) {
    if (!everRevealed.has(id)) visibleIds.add(id);
  }

  const frames: string[] = [];
  frames.push(renderSlideToSvg(slide, slideSize, { visibleIds: new Set(visibleIds), animatedIds }));

  for (const step of steps) {
    for (const id of step.revealedIds) visibleIds.add(id);
    for (const id of step.hiddenIds) visibleIds.delete(id);
    frames.push(
      renderSlideToSvg(slide, slideSize, { visibleIds: new Set(visibleIds), animatedIds }),
    );
  }

  return frames;
}

function renderElement(element: SlideElement, frame?: RenderFrame): RenderResult | null {
  let result: RenderResult | null = null;
  switch (element.type) {
    case "shape":
      result = renderShape(element);
      break;
    case "image":
      result = renderImage(element);
      break;
    case "connector":
      result = renderConnector(element);
      break;
    case "group":
      result = renderGroup(element, frame);
      break;
    case "chart":
      result = renderChart(element);
      break;
    case "table":
      result = renderTable(element);
      break;
    default:
      return null;
  }

  if (result && "altText" in element && element.altText) {
    result = { ...result, content: addAriaLabel(result.content, element.altText) };
  }

  if (result && "hyperlink" in element && element.hyperlink) {
    const href = escapeXmlAttr(element.hyperlink.url);
    result = { ...result, content: `<a href="${href}">${result.content}</a>` };
  }

  return result;
}

function addAriaLabel(svgFragment: string, altText: string): string {
  const escaped = altText
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return svgFragment.replace(/^<(g|image|path)\b/, `<$1 role="img" aria-label="${escaped}"`);
}

function renderGroup(group: GroupElement, frame?: RenderFrame): RenderResult {
  const x = emuToPixels(group.transform.offsetX);
  const y = emuToPixels(group.transform.offsetY);
  const w = emuToPixels(group.transform.extentWidth);
  const h = emuToPixels(group.transform.extentHeight);
  const chW = emuToPixels(group.childTransform.extentWidth);
  const chH = emuToPixels(group.childTransform.extentHeight);
  const chX = emuToPixels(group.childTransform.offsetX);
  const chY = emuToPixels(group.childTransform.offsetY);

  const scaleX = chW !== 0 ? w / chW : 1;
  const scaleY = chH !== 0 ? h / chH : 1;

  const transformParts: string[] = [];
  transformParts.push(`translate(${x}, ${y})`);

  if (group.transform.rotation !== 0) {
    transformParts.push(`rotate(${group.transform.rotation}, ${w / 2}, ${h / 2})`);
  }

  if (group.transform.flipH || group.transform.flipV) {
    const sx = group.transform.flipH ? -1 : 1;
    const sy = group.transform.flipV ? -1 : 1;
    transformParts.push(
      `translate(${group.transform.flipH ? w : 0}, ${group.transform.flipV ? h : 0})`,
    );
    transformParts.push(`scale(${sx}, ${sy})`);
  }

  transformParts.push(`scale(${scaleX}, ${scaleY})`);
  transformParts.push(`translate(${-chX}, ${-chY})`);

  const parts: string[] = [];
  const defs: string[] = [];
  parts.push(`<g transform="${transformParts.join(" ")}">`);

  for (const child of group.children) {
    if (frame && !isElementVisible(child, frame)) continue;
    const childResult = renderElement(child, frame);
    if (childResult) {
      parts.push(childResult.content);
      defs.push(...childResult.defs);
    }
  }

  parts.push("</g>");
  return { content: parts.join(""), defs };
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
