import { readFileSync, writeFileSync } from "node:fs";

import { convertPptxToPng } from "../src/converter.js";
import { createFontMapping } from "../src/font/font-mapping.js";

const pptx = readFileSync("samples/petrika.pptx");

const defaultPng = await convertPptxToPng(pptx, { slides: [1], logLevel: "warn" });
writeFileSync("/tmp/petrika-default.png", defaultPng[0].png);

const mappedPng = await convertPptxToPng(pptx, {
  slides: [1],
  logLevel: "warn",
  fontDirs: ["/Users/ssneg/brand-fonts"],
  fontMapping: createFontMapping({
    Aptos: "Figtree",
    "Aptos Display": "Figtree",
    "Corbel Light": "Figtree",
  }),
});
writeFileSync("/tmp/petrika-figtree.png", mappedPng[0].png);

console.log("wrote /tmp/petrika-default.png and /tmp/petrika-figtree.png");
