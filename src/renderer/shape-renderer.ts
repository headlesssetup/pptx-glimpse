import type { ConnectorElement, ShapeElement } from "../model/shape.js";
import { emuToPixels } from "../utils/emu.js";
import { renderEffects } from "./effect-renderer.js";
import {
  isStraightConnectorGeometry,
  renderFillAttrs,
  renderLineWithArrowEndpoints,
  renderOutlineAttrs,
} from "./fill-renderer.js";
import { renderGeometry } from "./geometry/index.js";
import type { RenderResult } from "./render-result.js";
import { computeSpAutofitHeight, renderTextBody } from "./text-renderer.js";
import { buildTransformAttr } from "./transform.js";

export function renderShape(shape: ShapeElement): RenderResult {
  const { transform, geometry, fill, outline, textBody, effects } = shape;

  // spAutofit: テキスト量に応じて図形の高さを拡大
  let effectiveTransform = transform;
  if (textBody?.bodyProperties.autoFit === "spAutofit") {
    const requiredHeightEmu = computeSpAutofitHeight(textBody, transform);
    if (requiredHeightEmu !== null) {
      effectiveTransform = { ...transform, extentHeight: requiredHeightEmu };
    }
  }

  const w = emuToPixels(effectiveTransform.extentWidth);
  const h = emuToPixels(effectiveTransform.extentHeight);

  const transformAttr = buildTransformAttr(effectiveTransform);
  const fillResult = renderFillAttrs(fill);
  const outlineResult = renderOutlineAttrs(outline);
  const effectResult = renderEffects(effects);

  const geometrySvg = renderGeometry(geometry, w, h);

  const defs: string[] = [];
  if (fillResult.defs) defs.push(fillResult.defs);
  if (outlineResult.defs) defs.push(outlineResult.defs);
  if (effectResult.filterDefs) defs.push(effectResult.filterDefs);

  const parts: string[] = [];
  const filterAttr = effectResult.filterAttr ? ` ${effectResult.filterAttr}` : "";
  parts.push(`<g transform="${transformAttr}"${filterAttr}>`);

  if (geometrySvg) {
    // Apply fill/stroke to the geometry element
    const styledGeometry = geometrySvg.replace(
      /^<(\w+)/,
      `<$1 ${fillResult.attrs} ${outlineResult.attrs}`,
    );
    parts.push(styledGeometry);
  }

  if (textBody) {
    const textSvg = renderTextBody(textBody, effectiveTransform);
    if (textSvg) {
      parts.push(textSvg);
    }
  }

  parts.push("</g>");
  return { content: parts.join(""), defs };
}

export function renderConnector(connector: ConnectorElement): RenderResult {
  const { transform, geometry, outline, effects } = connector;
  const w = emuToPixels(transform.extentWidth);
  const h = emuToPixels(transform.extentHeight);
  const transformAttr = buildTransformAttr(transform);
  const outlineResult = renderOutlineAttrs(outline);
  const effectResult = renderEffects(effects);

  const defs: string[] = [];
  if (outlineResult.defs) defs.push(outlineResult.defs);
  if (effectResult.filterDefs) defs.push(effectResult.filterDefs);

  const parts: string[] = [];
  const filterAttr = effectResult.filterAttr ? ` ${effectResult.filterAttr}` : "";
  const hasArrowEndpoints = outline?.headEnd || outline?.tailEnd;
  const useLineArrows = hasArrowEndpoints && isStraightConnectorGeometry(geometry);
  const geometrySvg = renderGeometry(geometry, w, h);
  const connectorSvg = useLineArrows
    ? renderLineWithArrowEndpoints(0, 0, w, h, outline)
    : (geometrySvg?.replace(/^<(\w+)/, `<$1 ${outlineResult.attrs} fill="none"`) ??
      `<line x1="0" y1="0" x2="${w}" y2="${h}" ${outlineResult.attrs} fill="none"/>`);

  parts.push(`<g transform="${transformAttr}"${filterAttr}>`);
  parts.push(connectorSvg);
  parts.push("</g>");
  return { content: parts.join(""), defs };
}
