import { readFileSync } from "fs";

import { convertPptxToSvg } from "../src/converter.js";

const DEFAULT_RENDER_WIDTH = 1920;

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

async function main(): Promise<void> {
  const pptxPath = process.argv[2];
  if (!pptxPath) {
    process.exit(1);
  }

  const width = parseWidthArg(process.argv) ?? DEFAULT_RENDER_WIDTH;

  const input = readFileSync(pptxPath);
  const slides = await convertPptxToSvg(input, { logLevel: "warn" });
  const output = slides.map((slide) => ({
    slideNumber: slide.slideNumber,
    svg: scaleSvgToWidth(slide.svg, width),
  }));

  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
