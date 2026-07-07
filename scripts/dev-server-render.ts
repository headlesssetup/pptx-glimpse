import { readFileSync } from "fs";

import { convertPptxToSvg, collectUsedFonts } from "../src/index.js";
import {
  buildFontMappingSuggestion,
  createFontMapping,
  getMappedFont,
  type FontMapping,
} from "../src/font/font-mapping.js";
import { unwrapEmbeddedFontData } from "../src/font/eot.js";
import { parseRelationships, resolveRelationshipTarget } from "../src/parser/relationship-parser.js";
import type { PptxArchive } from "../src/parser/pptx-reader.js";
import type { EmbeddedFont } from "../src/model/presentation.js";
import { parsePptxData } from "../src/pptx-data-parser.js";
import {
  getWarningEntries,
  getWarningSummary,
  type WarningEntry,
} from "../src/warning-logger.js";

const DEFAULT_RENDER_WIDTH = 1920;
const FONT_NOT_FOUND_RE = /Font not found: "([^"]+)"/;

export interface DevSlideSvg {
  slideNumber: number;
  svg: string;
}

export interface DevFontMapping {
  from: string;
  to: string;
}

export interface DevEmbeddedFont {
  typeface: string;
  slots: string[];
  loaded: boolean;
}

export interface DevRenderInfo {
  renderWidth: number;
  slideCount: number;
  usedFonts: ReturnType<typeof collectUsedFonts>;
  /** ユーザーが指定した fontMapping のうち、このデッキで使われているもの */
  fontMappings: DevFontMapping[];
  /** 埋め込み・ローカル・マッピングのいずれでも解決できなかったフォント */
  missingFonts: string[];
  /** missingFonts 向けの fontMapping 設定例 */
  fontMappingSuggestion: FontMapping;
  embeddedFonts: DevEmbeddedFont[];
  warnings: WarningEntry[];
  warningSummary: ReturnType<typeof getWarningSummary>;
}

export interface DevRenderOutput {
  slides: DevSlideSvg[];
  info: DevRenderInfo;
}

function parseWidthArg(argv: string[]): number | undefined {
  const idx = argv.indexOf("--width");
  if (idx === -1) return undefined;
  const value = Number(argv[idx + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function scaleSvgToWidth(svg: string, targetWidth: number): string {
  const widthMatch = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/);
  const heightMatch = svg.match(/\bheight="(\d+(?:\.\d+)?)"/);
  if (!widthMatch || !heightMatch) return svg;

  const currentWidth = Number(widthMatch[1]);
  const currentHeight = Number(heightMatch[1]);
  if (!Number.isFinite(currentWidth) || currentWidth <= 0) return svg;

  const targetHeight = Math.round((currentHeight * targetWidth) / currentWidth);
  return svg
    .replace(/\bwidth="\d+(?:\.\d+)?"/, `width="${String(targetWidth)}"`)
    .replace(/\bheight="\d+(?:\.\d+)?"/, `height="${String(targetHeight)}"`);
}

function collectConfiguredFontMappings(
  usedFontNames: string[],
  mapping: FontMapping,
): DevFontMapping[] {
  const out: DevFontMapping[] = [];
  for (const from of usedFontNames) {
    const to = getMappedFont(from, mapping);
    if (to && to !== from) {
      out.push({ from, to });
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

function collectMissingFonts(warnings: readonly WarningEntry[]): string[] {
  const missing = new Set<string>();
  for (const entry of warnings) {
    if (entry.feature !== "font.notFound") continue;
    const match = FONT_NOT_FOUND_RE.exec(entry.message);
    if (match) missing.add(match[1]);
  }
  return [...missing].sort();
}

function isEmbeddedSlotDecoded(archive: PptxArchive, rId: string | undefined): boolean {
  if (!rId) return false;
  const relsXml = archive.files.get("ppt/_rels/presentation.xml.rels");
  if (!relsXml) return false;
  const rels = parseRelationships(relsXml);
  const rel = rels.get(rId);
  if (!rel) return false;
  const path = resolveRelationshipTarget("ppt/presentation.xml", rel.target);
  const raw = archive.media.get(path);
  if (!raw || raw.length === 0) return false;
  const data = unwrapEmbeddedFontData(raw);
  return data !== null && data.length > 0;
}

function collectEmbeddedFontInfo(
  archive: PptxArchive,
  presEmbedded: EmbeddedFont[] | undefined,
): DevEmbeddedFont[] {
  if (!presEmbedded || presEmbedded.length === 0) return [];

  return presEmbedded.map((font) => {
    const slots: string[] = [];
    if (font.regularRId) slots.push("regular");
    if (font.boldRId) slots.push("bold");
    if (font.italicRId) slots.push("italic");
    if (font.boldItalicRId) slots.push("boldItalic");
    const rIds = [font.regularRId, font.boldRId, font.italicRId, font.boldItalicRId];
    return {
      typeface: font.typeface,
      slots,
      loaded: rIds.some((rId) => isEmbeddedSlotDecoded(archive, rId)),
    };
  });
}

async function main(): Promise<void> {
  const pptxPath = process.argv[2];
  if (!pptxPath) {
    process.exit(1);
  }

  const width = parseWidthArg(process.argv) ?? DEFAULT_RENDER_WIDTH;
  const input = readFileSync(pptxPath);
  const usedFonts = collectUsedFonts(input);
  const data = parsePptxData(input);
  const userFontMapping = createFontMapping();

  const slides = await convertPptxToSvg(input, { logLevel: "debug", fontMapping: userFontMapping });
  const scaledSlides = slides.map((slide) => ({
    slideNumber: slide.slideNumber,
    svg: scaleSvgToWidth(slide.svg, width),
  }));

  const embeddedFonts = collectEmbeddedFontInfo(data.archive, data.presInfo.embeddedFonts);
  const warnings = [...getWarningEntries()];
  const missingFonts = collectMissingFonts(warnings);

  const output: DevRenderOutput = {
    slides: scaledSlides,
    info: {
      renderWidth: width,
      slideCount: scaledSlides.length,
      usedFonts,
      fontMappings: collectConfiguredFontMappings(usedFonts.fonts, userFontMapping),
      missingFonts,
      fontMappingSuggestion: buildFontMappingSuggestion(missingFonts),
      embeddedFonts,
      warnings,
      warningSummary: getWarningSummary(),
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
