import type { Fill, GradientFill, PatternFill } from "../model/fill.js";
import type { ArrowEndpoint, ArrowSize, Outline } from "../model/line.js";
import type { Geometry } from "../model/shape.js";
import { emuToPixels } from "../utils/emu.js";

interface FillAttrs {
  attrs: string;
  defs: string;
}

export function renderFillAttrs(fill: Fill | null): FillAttrs {
  if (!fill || fill.type === "none") {
    return { attrs: `fill="none"`, defs: "" };
  }

  if (fill.type === "solid") {
    const alphaAttr = fill.color.alpha < 1 ? ` fill-opacity="${fill.color.alpha}"` : "";
    return { attrs: `fill="${fill.color.hex}"${alphaAttr}`, defs: "" };
  }

  if (fill.type === "gradient") {
    const result = renderGradientDefs(fill);
    return { attrs: `fill="${result.ref}"`, defs: result.defs };
  }

  if (fill.type === "image") {
    if (fill.mimeType === "image/emf" || fill.mimeType === "image/wmf") {
      return { attrs: `fill="#E0E0E0"`, defs: "" };
    }

    const id = `imgfill-${crypto.randomUUID()}`;

    if (fill.tile) {
      const t = fill.tile;
      const scalePct = (v: number) => `${v * 100}%`;
      const defs = `<pattern id="${id}" patternUnits="objectBoundingBox" width="${scalePct(t.sx)}" height="${scalePct(t.sy)}"><image href="data:${fill.mimeType};base64,${fill.imageData}" width="100%" height="100%" preserveAspectRatio="none"/></pattern>`;
      return { attrs: `fill="url(#${id})"`, defs };
    }

    const defs = `<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="data:${fill.mimeType};base64,${fill.imageData}" width="1" height="1" preserveAspectRatio="none"/></pattern>`;
    return { attrs: `fill="url(#${id})"`, defs };
  }

  if (fill.type === "pattern") {
    return renderPatternFill(fill);
  }

  return { attrs: `fill="none"`, defs: "" };
}

export function renderOutlineAttrs(outline: Outline | null): FillAttrs {
  if (!outline) return { attrs: `stroke="none"`, defs: "" };

  const widthPx = emuToPixels(outline.width);
  const parts: string[] = [`stroke-width="${widthPx}"`];
  let defs = "";

  if (outline.fill) {
    if (outline.fill.type === "solid") {
      parts.push(`stroke="${outline.fill.color.hex}"`);
      if (outline.fill.color.alpha < 1) {
        parts.push(`stroke-opacity="${outline.fill.color.alpha}"`);
      }
    } else if (outline.fill.type === "gradient") {
      const gradResult = renderGradientDefs(outline.fill);
      parts.push(`stroke="${gradResult.ref}"`);
      defs = gradResult.defs;
    }
  } else {
    parts.push(`stroke="none"`);
  }

  if (outline.customDash && outline.customDash.length > 0) {
    const dashArray = outline.customDash.map((v) => v * widthPx).join(" ");
    parts.push(`stroke-dasharray="${dashArray}"`);
  } else if (outline.dashStyle !== "solid") {
    const dashArray = getDashArray(outline.dashStyle, widthPx);
    if (dashArray) {
      parts.push(`stroke-dasharray="${dashArray}"`);
    }
  }

  if (outline.lineCap) {
    parts.push(`stroke-linecap="${outline.lineCap}"`);
  }

  if (outline.lineJoin) {
    parts.push(`stroke-linejoin="${outline.lineJoin}"`);
  }

  return { attrs: parts.join(" "), defs };
}

function renderGradientDefs(fill: GradientFill): { ref: string; defs: string } {
  const id = `grad-${crypto.randomUUID()}`;

  const stops = fill.stops
    .map((s) => {
      const opacityAttr = s.color.alpha < 1 ? ` stop-opacity="${s.color.alpha}"` : "";
      return `<stop offset="${s.position * 100}%" stop-color="${s.color.hex}"${opacityAttr}/>`;
    })
    .join("");

  if (fill.gradientType === "radial") {
    const cx = (fill.centerX ?? 0.5) * 100;
    const cy = (fill.centerY ?? 0.5) * 100;
    const dx = Math.max(cx, 100 - cx);
    const dy = Math.max(cy, 100 - cy);
    const r = Math.sqrt(dx * dx + dy * dy);
    const defs = `<radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="${r}%">${stops}</radialGradient>`;
    return { ref: `url(#${id})`, defs };
  }

  const angle = fill.angle;
  const rad = (angle * Math.PI) / 180;
  const x1 = 50 - Math.cos(rad) * 50;
  const y1 = 50 - Math.sin(rad) * 50;
  const x2 = 50 + Math.cos(rad) * 50;
  const y2 = 50 + Math.sin(rad) * 50;
  const defs = `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`;
  return { ref: `url(#${id})`, defs };
}

function getDashArray(style: string, w: number): string | null {
  const patterns: Record<string, number[]> = {
    dash: [4, 3],
    dot: [1, 3],
    dashDot: [4, 3, 1, 3],
    lgDash: [8, 3],
    lgDashDot: [8, 3, 1, 3],
    sysDash: [3, 1],
    sysDot: [1, 1],
  };

  const pattern = patterns[style];
  if (!pattern) return null;
  return pattern.map((v) => v * w).join(" ");
}

function renderPatternFill(fill: PatternFill): FillAttrs {
  const id = `patt-${crypto.randomUUID()}`;
  const fg = fill.foregroundColor.hex;
  const bg = fill.backgroundColor.hex;
  const fgAlpha = fill.foregroundColor.alpha < 1 ? ` opacity="${fill.foregroundColor.alpha}"` : "";

  const content = getPatternContent(fill.preset, fg, fgAlpha);
  if (!content) {
    const alphaAttr =
      fill.foregroundColor.alpha < 1 ? ` fill-opacity="${fill.foregroundColor.alpha}"` : "";
    return { attrs: `fill="${fg}"${alphaAttr}`, defs: "" };
  }

  const bgAlpha =
    fill.backgroundColor.alpha < 1 ? ` fill-opacity="${fill.backgroundColor.alpha}"` : "";
  const defs = `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${content.size}" height="${content.size}"><rect width="${content.size}" height="${content.size}" fill="${bg}"${bgAlpha}/>${content.svg}</pattern>`;
  return { attrs: `fill="url(#${id})"`, defs };
}

interface PatternContent {
  svg: string;
  size: number;
}

function getPatternContent(preset: string, fg: string, fgAlpha: string): PatternContent | null {
  const s = 8;
  const sw = 1;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${fg}" stroke-width="${sw}"${fgAlpha}/>`;

  switch (preset) {
    case "ltHorz":
      return { svg: line(0, 4, 8, 4), size: s };
    case "ltVert":
      return { svg: line(4, 0, 4, 8), size: s };
    case "ltDnDiag":
      return { svg: line(0, 0, 8, 8), size: s };
    case "ltUpDiag":
      return { svg: line(0, 8, 8, 0), size: s };
    case "dkHorz":
      return {
        svg: line(0, 2, 8, 2) + line(0, 6, 8, 6),
        size: s,
      };
    case "dkVert":
      return {
        svg: line(2, 0, 2, 8) + line(6, 0, 6, 8),
        size: s,
      };
    case "dkDnDiag":
      return {
        svg: line(0, 0, 8, 8) + line(-4, 0, 4, 8),
        size: s,
      };
    case "dkUpDiag":
      return {
        svg: line(0, 8, 8, 0) + line(4, 8, 12, 0),
        size: s,
      };
    case "horz":
      return { svg: line(0, 4, 8, 4), size: s };
    case "vert":
      return { svg: line(4, 0, 4, 8), size: s };
    case "dnDiag":
      return { svg: line(0, 0, 8, 8), size: s };
    case "upDiag":
      return { svg: line(0, 8, 8, 0), size: s };
    case "cross":
    case "smGrid":
      return {
        svg: line(0, 4, 8, 4) + line(4, 0, 4, 8),
        size: s,
      };
    case "lgGrid":
      return {
        svg: line(0, 0, 16, 0) + line(0, 0, 0, 16),
        size: 16,
      };
    case "diagCross":
      return {
        svg: line(0, 0, 8, 8) + line(0, 8, 8, 0),
        size: s,
      };
    case "pct5":
      return {
        svg: `<rect x="0" y="0" width="1" height="1" fill="${fg}"${fgAlpha}/>`,
        size: s,
      };
    case "pct10":
      return {
        svg: `<rect x="0" y="0" width="1" height="1" fill="${fg}"${fgAlpha}/><rect x="4" y="4" width="1" height="1" fill="${fg}"${fgAlpha}/>`,
        size: s,
      };
    case "pct20":
      return {
        svg: `<rect x="0" y="0" width="2" height="2" fill="${fg}"${fgAlpha}/><rect x="4" y="4" width="2" height="2" fill="${fg}"${fgAlpha}/>`,
        size: s,
      };
    case "pct25":
      return {
        svg: `<rect x="0" y="0" width="2" height="2" fill="${fg}"${fgAlpha}/><rect x="4" y="0" width="2" height="2" fill="${fg}"${fgAlpha}/><rect x="2" y="4" width="2" height="2" fill="${fg}"${fgAlpha}/><rect x="6" y="4" width="2" height="2" fill="${fg}"${fgAlpha}/>`,
        size: s,
      };
    case "pct30":
    case "pct40":
    case "pct50":
    case "pct60":
    case "pct70":
    case "pct75":
    case "pct80":
    case "pct90": {
      const pctVal = parseInt(preset.replace("pct", ""), 10);
      const alpha = pctVal / 100;
      return {
        svg: `<rect width="${s}" height="${s}" fill="${fg}" opacity="${alpha}"${fgAlpha}/>`,
        size: s,
      };
    }
    default:
      return null;
  }
}

// --- Arrow endpoint rendering ---

const ARROW_LENGTH_MULT: Record<ArrowSize, number> = { sm: 2.0, med: 3.0, lg: 5.0 };
const ARROW_WIDTH_MULT: Record<ArrowSize, number> = { sm: 2.0, med: 3.0, lg: 5.0 };
const OPEN_ARROW_LENGTH_MULT: Record<ArrowSize, number> = { sm: 2.5, med: 3.5, lg: 5.5 };
const OPEN_ARROW_WIDTH_MULT: Record<ArrowSize, number> = { sm: 2.5, med: 3.5, lg: 5.5 };
// LibreOffice uses max(lineWidth, 0.7mm) as the base for arrow scaling.
const MIN_ARROW_BASE_PX = emuToPixels(25200);

interface ArrowDimensions {
  length: number;
  width: number;
}

function arrowBasePx(strokeWidthPx: number): number {
  return Math.max(strokeWidthPx, MIN_ARROW_BASE_PX);
}

function arrowDimensions(endpoint: ArrowEndpoint, strokeWidthPx: number): ArrowDimensions {
  const base = arrowBasePx(strokeWidthPx);
  const isOpenArrow = endpoint.type === "arrow";
  return {
    length:
      (isOpenArrow ? OPEN_ARROW_LENGTH_MULT : ARROW_LENGTH_MULT)[endpoint.length] * base,
    width: (isOpenArrow ? OPEN_ARROW_WIDTH_MULT : ARROW_WIDTH_MULT)[endpoint.width] * base,
  };
}

function outlineStrokeColor(outline: Outline): { color: string; alpha: number } {
  if (outline.fill?.type === "solid") {
    return { color: outline.fill.color.hex, alpha: outline.fill.color.alpha };
  }
  if (outline.fill?.type === "gradient" && outline.fill.stops.length > 0) {
    return {
      color: outline.fill.stops[0].color.hex,
      alpha: outline.fill.stops[0].color.alpha,
    };
  }
  return { color: "#000000", alpha: 1 };
}

function renderArrowDecoration(
  anchorX: number,
  anchorY: number,
  dirX: number,
  dirY: number,
  perpX: number,
  perpY: number,
  endpoint: ArrowEndpoint,
  dims: ArrowDimensions,
  color: string,
  alpha: number,
): string | null {
  const alphaAttr = alpha < 1 ? ` opacity="${alpha}"` : "";
  const tipX = anchorX + dirX * dims.length;
  const tipY = anchorY + dirY * dims.length;
  const baseX = anchorX;
  const baseY = anchorY;
  const halfW = dims.width / 2;
  const leftX = baseX + perpX * halfW;
  const leftY = baseY + perpY * halfW;
  const rightX = baseX - perpX * halfW;
  const rightY = baseY - perpY * halfW;

  switch (endpoint.type) {
    case "triangle":
      return `<polygon points="${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}" fill="${color}"${alphaAttr}/>`;
    case "stealth": {
      const notchX = baseX + dirX * dims.length * 0.3;
      const notchY = baseY + dirY * dims.length * 0.3;
      return `<polygon points="${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY} ${notchX},${notchY}" fill="${color}"${alphaAttr}/>`;
    }
    case "diamond": {
      const midX = anchorX + dirX * (dims.length / 2);
      const midY = anchorY + dirY * (dims.length / 2);
      const farX = anchorX + dirX * dims.length;
      const farY = anchorY + dirY * dims.length;
      return `<polygon points="${anchorX},${anchorY} ${leftX},${leftY} ${farX},${farY} ${rightX},${rightY}" fill="${color}"${alphaAttr}/>`;
    }
    case "oval": {
      const cx = midpoint(anchorX, tipX);
      const cy = midpoint(anchorY, tipY);
      const angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${dims.width / 2}" ry="${dims.length / 2}" fill="${color}"${alphaAttr} transform="rotate(${angle} ${cx} ${cy})"/>`;
    }
    case "arrow":
      return `<polyline points="${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}" fill="none" stroke="${color}" stroke-width="1"${alphaAttr}/>`;
    default:
      return null;
  }
}

function midpoint(a: number, b: number): number {
  return (a + b) / 2;
}

export function renderLineWithArrowEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  outline: Outline | null,
): string {
  if (!outline) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="none" fill="none"/>`;
  }

  const strokeAttrs = renderOutlineAttrs(outline).attrs;
  const strokeWidthPx = emuToPixels(outline.width);
  const { color, alpha } = outlineStrokeColor(outline);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pathLen = Math.hypot(dx, dy);

  if (pathLen === 0) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${strokeAttrs} fill="none"/>`;
  }

  const ux = dx / pathLen;
  const uy = dy / pathLen;
  const perpX = -uy;
  const perpY = ux;

  let lineX1 = x1;
  let lineY1 = y1;
  let lineX2 = x2;
  let lineY2 = y2;
  const decorations: string[] = [];

  if (outline.headEnd) {
    const dims = arrowDimensions(outline.headEnd, strokeWidthPx);
    const baseX = x1 + ux * dims.length;
    const baseY = y1 + uy * dims.length;
    lineX1 = baseX;
    lineY1 = baseY;
    const deco = renderArrowDecoration(
      baseX,
      baseY,
      -ux,
      -uy,
      perpX,
      perpY,
      outline.headEnd,
      dims,
      color,
      alpha,
    );
    if (deco) decorations.push(deco);
  }

  if (outline.tailEnd) {
    const dims = arrowDimensions(outline.tailEnd, strokeWidthPx);
    const baseX = x2 - ux * dims.length;
    const baseY = y2 - uy * dims.length;
    lineX2 = baseX;
    lineY2 = baseY;
    const deco = renderArrowDecoration(
      baseX,
      baseY,
      ux,
      uy,
      perpX,
      perpY,
      outline.tailEnd,
      dims,
      color,
      alpha,
    );
    if (deco) decorations.push(deco);
  }

  return [
    `<line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY2}" ${strokeAttrs} fill="none"/>`,
    ...decorations,
  ].join("");
}

export function isStraightConnectorGeometry(geometry: Geometry): boolean {
  return geometry.type === "preset" && geometry.preset === "straightConnector1";
}
