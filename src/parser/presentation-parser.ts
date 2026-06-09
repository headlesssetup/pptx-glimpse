import type { EmbeddedFont, Protection, SlideSize } from "../model/presentation.js";
import type { DefaultTextStyle } from "../model/text.js";
import { asEmu } from "../utils/unit-types.js";
import { debug } from "../warning-logger.js";
import { parseListStyle } from "./text-style-parser.js";
import { parseXml, type XmlNode } from "./xml-parser.js";

export interface PresentationInfo {
  slideSize: SlideSize;
  slideRIds: string[];
  defaultTextStyle?: DefaultTextStyle;
  embeddedFonts?: EmbeddedFont[];
  protection?: Protection;
}

const DEFAULT_SLIDE_WIDTH = asEmu(9144000);
const DEFAULT_SLIDE_HEIGHT = asEmu(5143500);

export function parsePresentation(xml: string): PresentationInfo {
  const parsed = parseXml(xml);
  const pres = parsed.presentation as XmlNode | undefined;

  if (!pres) {
    debug("presentation.missing", `missing root element "presentation" in XML`);
    return {
      slideSize: { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT },
      slideRIds: [],
    };
  }

  const sldSz = pres.sldSz as XmlNode | undefined;
  let slideSize: SlideSize;
  if (!sldSz || sldSz["@_cx"] === undefined || sldSz["@_cy"] === undefined) {
    debug(
      "presentation.sldSz",
      `sldSz missing, using default ${DEFAULT_SLIDE_WIDTH}x${DEFAULT_SLIDE_HEIGHT} EMU`,
    );
    slideSize = { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
  } else {
    slideSize = {
      width: asEmu(Number(sldSz["@_cx"])),
      height: asEmu(Number(sldSz["@_cy"])),
    };
  }

  const sldIdLst = pres.sldIdLst as XmlNode | undefined;
  const sldIdArr = (sldIdLst?.sldId as XmlNode[] | undefined) ?? [];
  const slideRIds: string[] = sldIdArr
    .map((s) => (s["@_r:id"] as string | undefined) ?? (s["@_id"] as string | undefined))
    .filter((id): id is string => {
      if (id === undefined) {
        debug("presentation.slideRId", "undefined slide relationship ID found, skipping");
        return false;
      }
      return true;
    });

  const defaultTextStyle = parseListStyle(pres.defaultTextStyle as XmlNode);
  const embeddedFonts = parseEmbeddedFontList(pres.embeddedFontLst as XmlNode | undefined);
  const protection = parseProtection(pres.modifyVerifier as XmlNode | undefined);

  return {
    slideSize,
    slideRIds,
    defaultTextStyle,
    ...(embeddedFonts && { embeddedFonts }),
    ...(protection && { protection }),
  };
}

function parseEmbeddedFontList(node: XmlNode | undefined): EmbeddedFont[] | undefined {
  if (!node) return undefined;
  const fonts = node.embeddedFont;
  if (!fonts) return undefined;
  const fontArr = (Array.isArray(fonts) ? fonts : [fonts]) as XmlNode[];
  const result: EmbeddedFont[] = [];
  for (const f of fontArr) {
    const fontRaw = f.font;
    const fontNode = (Array.isArray(fontRaw) ? fontRaw[0] : fontRaw) as XmlNode | undefined;
    if (!fontNode) continue;
    const font: EmbeddedFont = {
      typeface: (fontNode["@_typeface"] as string | undefined) ?? "",
    };
    if (fontNode["@_panose"]) font.panose = fontNode["@_panose"] as string;
    if (fontNode["@_pitchFamily"] !== undefined)
      font.pitchFamily = Number(fontNode["@_pitchFamily"]);
    if (fontNode["@_charset"] !== undefined) font.charset = Number(fontNode["@_charset"]);

    // 各スタイルスロット (<p:regular>/<p:bold>/<p:italic>/<p:boldItalic>) の r:id を取得
    const regular = embeddedRId(f.regular as XmlNode | undefined);
    const bold = embeddedRId(f.bold as XmlNode | undefined);
    const italic = embeddedRId(f.italic as XmlNode | undefined);
    const boldItalic = embeddedRId(f.boldItalic as XmlNode | undefined);
    if (regular) font.regularRId = regular;
    if (bold) font.boldRId = bold;
    if (italic) font.italicRId = italic;
    if (boldItalic) font.boldItalicRId = boldItalic;

    result.push(font);
  }
  return result.length > 0 ? result : undefined;
}

/** <p:regular r:id="..."/> 等から関係 ID を取り出す (r: プレフィックス有無の両対応) */
function embeddedRId(node: XmlNode | undefined): string | undefined {
  if (!node) return undefined;
  return (node["@_r:id"] as string | undefined) ?? (node["@_id"] as string | undefined);
}

function parseProtection(node: XmlNode | undefined): Protection | undefined {
  if (!node) return undefined;
  const verifier: NonNullable<Protection["modifyVerifier"]> = {};
  if (node["@_algorithmName"]) verifier.algorithmName = node["@_algorithmName"] as string;
  if (node["@_hashValue"]) verifier.hashValue = node["@_hashValue"] as string;
  if (node["@_saltValue"]) verifier.saltValue = node["@_saltValue"] as string;
  if (node["@_spinCount"] !== undefined) verifier.spinCount = Number(node["@_spinCount"]);
  return { modifyVerifier: verifier };
}
