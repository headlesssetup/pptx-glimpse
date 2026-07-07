import { readFileSync, writeFileSync } from "node:fs";
import { convertPptxToPng, collectUsedFonts } from "./src/index.js";

const pptx = readFileSync("samples/fonts.pptx");

// what font names does the deck ask for?
console.log("USED:", JSON.stringify(collectUsedFonts(pptx).fonts));

const frames = await convertPptxToPng(pptx, {
  width: 1920,
  fontDirs: ["/Users/ssneg/brand-fonts"],
  useEmbeddedFonts: false,
});
for (const f of frames) {
  const name = `slide${f.slideNumber}-step${f.stepIndex ?? 0}.png`;
  writeFileSync(name, f.png);
  console.log("wrote", name);
}