import { join } from "path";

import { compareImages } from "./compare-utils.js";
import {
  BASELINES_DIR,
  deckName,
  DIFFS_DIR,
  framePaths,
  listSamplePptx,
  MISMATCH_TOLERANCE,
  PIXEL_THRESHOLD,
  renderDeck,
  writePngFrames,
} from "./sample-utils.js";

async function updateBaselines(filter?: string, steps = false, width?: number): Promise<void> {
  const decks = listSamplePptx(filter);
  if (decks.length === 0) {
    console.error("No samples found in samples/");
    process.exit(1);
  }

  for (const pptxPath of decks) {
    const name = deckName(pptxPath);
    const outDir = join(BASELINES_DIR, name);
    console.log(`Updating baselines: ${name}`);
    const frames = await renderDeck(pptxPath, { steps, width });
    writePngFrames(frames, outDir);
    console.log(`  ${frames.length} frame(s) → ${outDir}`);
  }
}

async function checkAgainstBaselines(
  filter?: string,
  steps = false,
  width?: number,
): Promise<void> {
  const decks = listSamplePptx(filter);
  if (decks.length === 0) {
    console.error("No samples found in samples/");
    process.exit(1);
  }

  let failures = 0;

  for (const pptxPath of decks) {
    const name = deckName(pptxPath);
    console.log(`Checking: ${name}`);
    const frames = await renderDeck(pptxPath, { steps, width });

    for (const frame of frames) {
      const fileName = framePaths(name, [frame])[0];
      const diffPath = join(DIFFS_DIR, name, fileName.actual.replace(".png", "-diff.png"));

      try {
        const result = await compareImages(frame.png, fileName.baseline, diffPath, {
          pixelThreshold: PIXEL_THRESHOLD,
          mismatchTolerance: MISMATCH_TOLERANCE,
        });

        const label =
          frame.stepIndex !== undefined
            ? `slide ${frame.slideNumber} step ${frame.stepIndex}`
            : `slide ${frame.slideNumber}`;

        if (result.passed) {
          console.log(`  ✓ ${label}`);
        } else {
          failures++;
          console.log(
            `  ✗ ${label}: ${(result.mismatchPercentage * 100).toFixed(2)}% mismatch → ${diffPath}`,
          );
        }
      } catch (err) {
        failures++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ missing baseline for ${fileName.actual}: ${msg}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

function printUsage(): void {
  console.error(
    "Usage: tsx scripts/check-samples.ts <update|check> [deck.pptx] [--steps] [--width N]",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode !== "update" && mode !== "check") {
    printUsage();
    process.exit(1);
  }

  let filter: string | undefined;
  let steps = false;
  let width: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--steps") {
      steps = true;
    } else if (arg === "--width" && args[i + 1]) {
      width = Number(args[++i]);
    } else if (!arg.startsWith("--")) {
      filter = arg;
    }
  }

  if (mode === "update") {
    await updateBaselines(filter, steps, width);
  } else {
    await checkAgainstBaselines(filter, steps, width);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
