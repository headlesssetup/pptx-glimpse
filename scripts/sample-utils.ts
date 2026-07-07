import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";

import type { SlideImage } from "../src/converter.js";
import { convertPptxToPng } from "../src/converter.js";
import { frameFileName } from "./frame-utils.js";

export const SAMPLES_DIR = resolve("samples");
export const BASELINES_DIR = join(SAMPLES_DIR, "baselines");
export const DIFFS_DIR = resolve("output/diffs");

const PIXEL_THRESHOLD = 0;
const MISMATCH_TOLERANCE = 0;

export interface RenderOptions {
  steps?: boolean;
  width?: number;
}

export function listSamplePptx(filter?: string): string[] {
  if (!existsSync(SAMPLES_DIR)) return [];

  const files = readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".pptx") && !f.startsWith("~$"))
    .sort();

  if (!filter) return files.map((f) => join(SAMPLES_DIR, f));

  const name = basename(filter, ".pptx");
  const match = files.find(
    (f) => f === filter || f === `${name}.pptx` || basename(f, ".pptx") === name,
  );
  if (!match) {
    throw new Error(`Sample not found: ${filter}`);
  }
  return [join(SAMPLES_DIR, match)];
}

export function deckName(pptxPath: string): string {
  return basename(pptxPath, ".pptx");
}

export async function renderDeck(
  pptxPath: string,
  options: RenderOptions = {},
): Promise<SlideImage[]> {
  const input = readFileSync(pptxPath);
  return convertPptxToPng(input, {
    animationSteps: options.steps,
    width: options.width,
    logLevel: "warn",
  });
}

export function writePngFrames(frames: SlideImage[], outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const frame of frames) {
    const fileName = frameFileName(
      { slideNumber: frame.slideNumber, stepIndex: frame.stepIndex },
      "png",
    );
    writeFileSync(join(outDir, fileName), frame.png);
  }
}

export function framePaths(
  deck: string,
  frames: SlideImage[],
): { actual: string; baseline: string }[] {
  return frames.map((frame) => {
    const fileName = frameFileName(
      { slideNumber: frame.slideNumber, stepIndex: frame.stepIndex },
      "png",
    );
    return {
      actual: fileName,
      baseline: join(BASELINES_DIR, deck, fileName),
    };
  });
}

export { MISMATCH_TOLERANCE, PIXEL_THRESHOLD };
