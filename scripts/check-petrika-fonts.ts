import { readFileSync, writeFileSync } from "node:fs";

import { unzipSync } from "fflate";

import { convertPptxToSvg } from "../src/converter.js";
import { collectEmbeddedFontBuffers } from "../src/font/embedded-font-loader.js";
import { createFontMapping } from "../src/font/font-mapping.js";
import { collectUsedFonts } from "../src/index.js";
import { parsePptxData } from "../src/pptx-data-parser.js";

const pptx = readFileSync("samples/petrika.pptx");
console.log("USED FONTS:", JSON.stringify(collectUsedFonts(pptx), null, 2));

const zip = unzipSync(new Uint8Array(pptx));
const fontFiles = Object.keys(zip).filter((k) => k.includes("font") || k.includes("fntdata"));
console.log("FONT FILES:", fontFiles);

const data = parsePptxData(pptx);
const embedded = collectEmbeddedFontBuffers(data.archive);
console.log(
  "EMBEDDED BUFFERS:",
  embedded.map((f) => ({
    family: f.family,
    weight: f.weight,
    style: f.style,
    bytes: f.buffer.length,
  })),
);

async function main() {
  const svg1 = await convertPptxToSvg(pptx, { logLevel: "warn", slides: [1] });
  writeFileSync("/tmp/petrika-default.svg", svg1[0].svg);
  const notdef1 = (svg1[0].svg.match(/&#x0;/g) ?? []).length;
  console.log("default render: notdef count", notdef1);

  const svg2 = await convertPptxToSvg(pptx, {
    logLevel: "warn",
    slides: [1],
    fontDirs: ["/Users/ssneg/brand-fonts"],
    fontMapping: createFontMapping({
      Aptos: "Figtree",
      "Aptos Display": "Figtree",
      "Corbel Light": "Figtree",
    }),
  });
  writeFileSync("/tmp/petrika-figtree.svg", svg2[0].svg);
  const notdef2 = (svg2[0].svg.match(/&#x0;/g) ?? []).length;
  console.log("figtree mapping render: notdef count", notdef2);
}

main().catch(console.error);
