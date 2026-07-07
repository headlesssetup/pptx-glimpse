import { join, resolve } from "path";

import { deckName, listSamplePptx, renderDeck, writePngFrames } from "./sample-utils.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let filter: string | undefined;
  let steps = false;
  let width: number | undefined;
  let outRoot = resolve("output");

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--steps") {
      steps = true;
    } else if (arg === "--width" && args[i + 1]) {
      width = Number(args[++i]);
    } else if (arg === "--out" && args[i + 1]) {
      outRoot = resolve(args[++i]);
    } else if (!arg.startsWith("--")) {
      filter = arg;
    }
  }

  const decks = listSamplePptx(filter);
  if (decks.length === 0) {
    console.error("No samples found in samples/");
    process.exit(1);
  }

  for (const pptxPath of decks) {
    const name = deckName(pptxPath);
    const outDir = join(outRoot, name);
    console.log(`Rendering ${name} → ${outDir}`);
    const frames = await renderDeck(pptxPath, { steps, width });
    writePngFrames(frames, outDir);
    console.log(`  ${frames.length} frame(s)`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
