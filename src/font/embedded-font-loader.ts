/**
 * PPTX に埋め込まれたフォント (ppt/fonts/*.fntdata) を読み込むヘルパー。
 *
 * OOXX (.pptx) の埋め込みフォントは難読化されておらず生の TTF/OTF なので、
 * opentype.js でそのままパースできる。typeface 名でフォントバッファ化して
 * フォントセットアップに渡すと、システムフォントやマッピングより優先して使える。
 */
import { type PptxArchive } from "../parser/pptx-reader.js";
import { parsePresentation } from "../parser/presentation-parser.js";
import {
  parseRelationships,
  type Relationship,
  resolveRelationshipTarget,
} from "../parser/relationship-parser.js";
import { unwrapEmbeddedFontData } from "./eot.js";
import type { FontBuffer } from "./opentype-helpers.js";

/**
 * アーカイブから埋め込みフォントのバッファ配列を収集する。
 * 埋め込みが無い場合は空配列を返す。
 *
 * 各バッファの name は presentation.xml の typeface 名。太字/斜体の判定は
 * フォントバイナリ自身の OS/2 / 名前テーブルから行うため、ここではスロット
 * (regular/bold/italic/boldItalic) を区別せず name だけ付与する。
 */
export function collectEmbeddedFontBuffers(archive: PptxArchive): FontBuffer[] {
  const presXml = archive.files.get("ppt/presentation.xml");
  if (!presXml) return [];

  const presInfo = parsePresentation(presXml);
  const embeddedFonts = presInfo.embeddedFonts;
  if (!embeddedFonts || embeddedFonts.length === 0) return [];

  const relsXml = archive.files.get("ppt/_rels/presentation.xml.rels");
  const rels = relsXml ? parseRelationships(relsXml) : new Map<string, Relationship>();

  const buffers: FontBuffer[] = [];
  for (const font of embeddedFonts) {
    if (!font.typeface) continue;
    const rIds = [font.regularRId, font.boldRId, font.italicRId, font.boldItalicRId];
    for (const rId of rIds) {
      if (!rId) continue;
      const rel = rels.get(rId);
      if (!rel) continue;
      const path = resolveRelationshipTarget("ppt/presentation.xml", rel.target);
      const raw = archive.media.get(path);
      if (!raw || raw.length === 0) continue;
      // .fntdata は EOT ラップされているため生フォントに正規化してから渡す
      const data = unwrapEmbeddedFontData(raw);
      if (data && data.length > 0) {
        buffers.push({ name: font.typeface, data });
      }
    }
  }
  return buffers;
}
