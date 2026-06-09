import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { readPptx } from "../parser/pptx-reader.js";
import { collectEmbeddedFontBuffers } from "./embedded-font-loader.js";

/** opentype.js で最小の TTF バイナリを生成する */
async function makeTtf(familyName: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const opentype: {
    Glyph: new (opts: Record<string, unknown>) => unknown;
    Path: new () => {
      moveTo(x: number, y: number): void;
      lineTo(x: number, y: number): void;
      close(): void;
    };
    Font: new (opts: Record<string, unknown>) => { toArrayBuffer(): ArrayBuffer };
  } = await import("opentype.js");
  const notdef = new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 650,
    path: new opentype.Path(),
  });
  const p = new opentype.Path();
  p.moveTo(0, 0);
  p.lineTo(300, 800);
  p.lineTo(600, 0);
  p.close();
  const a = new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: p });
  const font = new opentype.Font({
    familyName,
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, a],
  });
  return new Uint8Array(font.toArrayBuffer());
}

async function buildPptx(opts: { withEmbedded: boolean }): Promise<Uint8Array> {
  const zip = new JSZip();
  const embeddedFontLst = opts.withEmbedded
    ? `<p:embeddedFontLst>
         <p:embeddedFont>
           <p:font typeface="EmbeddedTest"/>
           <p:regular r:id="rIdFont"/>
         </p:embeddedFont>
       </p:embeddedFontLst>`
    : "";
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0"?>
     <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
       <p:sldSz cx="9144000" cy="5143500"/>
       ${embeddedFontLst}
     </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rIdFont" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.fntdata"/>
     </Relationships>`,
  );
  if (opts.withEmbedded) {
    zip.file("ppt/fonts/font1.fntdata", await makeTtf("EmbeddedTest"));
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("collectEmbeddedFontBuffers", () => {
  it("extracts embedded font binaries keyed by typeface", async () => {
    const archive = readPptx(await buildPptx({ withEmbedded: true }));
    const buffers = collectEmbeddedFontBuffers(archive);

    expect(buffers).toHaveLength(1);
    expect(buffers[0].name).toBe("EmbeddedTest");
    expect(buffers[0].data.length).toBeGreaterThan(0);
  });

  it("returns an empty array when the deck has no embedded fonts", async () => {
    const archive = readPptx(await buildPptx({ withEmbedded: false }));
    expect(collectEmbeddedFontBuffers(archive)).toEqual([]);
  });
});
