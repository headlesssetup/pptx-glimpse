import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";

import { convertPptxToPng, convertPptxToSvg } from "../src/converter.js";
import { frameFileName } from "./frame-utils.js";

interface CliOptions {
  filePath: string;
  outputDir: string;
  steps: boolean;
  width?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let steps = false;
  let width: number | undefined;
  let outputDir = resolve("./output");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--steps") {
      steps = true;
    } else if (arg === "--width" && argv[i + 1]) {
      width = Number(argv[++i]);
    } else if (arg === "--out" && argv[i + 1]) {
      outputDir = resolve(argv[++i]);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  const filePath = positional[0];
  if (!filePath) {
    console.error("Usage: pnpm render -- <pptx-file> [--steps] [--width 1920] [--out ./output]");
    process.exit(1);
  }

  return { filePath, outputDir, steps, width };
}

async function main(): Promise<void> {
  const { filePath, outputDir, steps, width } = parseArgs(process.argv.slice(2));
  mkdirSync(outputDir, { recursive: true });

  const input = readFileSync(filePath);
  const name = basename(filePath, ".pptx");

  console.log(`Converting: ${filePath}`);
  console.log(`Output dir: ${outputDir}`);
  if (steps) console.log("Animation steps: enabled");
  console.log("");

  const convertOptions = { logLevel: "warn" as const, animationSteps: steps, width };

  const svgResults = await convertPptxToSvg(input, convertOptions);
  const pngResults = await convertPptxToPng(input, convertOptions);

  for (const svg of svgResults) {
    const fileName = steps
      ? frameFileName({ slideNumber: svg.slideNumber, stepIndex: svg.stepIndex }, "svg")
      : `${name}-slide${svg.slideNumber}.svg`;
    const svgPath = join(outputDir, fileName);
    writeFileSync(svgPath, svg.svg);
    console.log(`  SVG: ${svgPath}`);
  }

  for (const png of pngResults) {
    const fileName = steps
      ? frameFileName({ slideNumber: png.slideNumber, stepIndex: png.stepIndex }, "png")
      : `${name}-slide${png.slideNumber}.png`;
    const pngPath = join(outputDir, fileName);
    writeFileSync(pngPath, png.png);
    console.log(`  PNG: ${pngPath} (${png.width}x${png.height})`);
  }

  console.log("");
  console.log(`Done! ${pngResults.length} frame(s) converted.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
