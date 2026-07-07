import { execFile } from "child_process";
import { watch } from "fs";
import { createServer } from "http";
import { basename, resolve } from "path";
import { promisify } from "util";
import { type WebSocket, WebSocketServer } from "ws";

import type { DevRenderInfo, DevRenderOutput, DevSlideSvg } from "./dev-server-render.js";

const DEFAULT_PORT = 3000;
const DEFAULT_RENDER_WIDTH = 1920;
const DEBOUNCE_MS = 300;
const WATCH_DIR = resolve("src");
const RENDER_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 50 * 1024 * 1024;

const execFileAsync = promisify(execFile);

interface RenderResult {
  slides: DevSlideSvg[];
  info: DevRenderInfo;
}

// --- Rendering via child process ---

async function renderSlides(pptxPath: string, width: number): Promise<RenderResult> {
  const workerPath = resolve("scripts/dev-server-render.ts");
  const args = ["tsx", workerPath, pptxPath, "--width", String(width)];
  const { stdout } = await execFileAsync("npx", args, {
    maxBuffer: MAX_BUFFER,
    timeout: RENDER_TIMEOUT_MS,
  });
  return JSON.parse(stdout) as DevRenderOutput;
}

// --- WebSocket ---

function broadcast(wss: WebSocketServer, data: unknown): void {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// --- File watcher ---

function watchSourceFiles(onChange: () => void): void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  watch(WATCH_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".ts")) return;
    if (filename.endsWith(".test.ts")) return;

    console.log(`Change detected: ${filename}`);

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      onChange();
    }, DEBOUNCE_MS);
  });
}

// --- HTML template ---

function generateDiagnosticsHtml(info: DevRenderInfo): string {
  const themeLines = [
    info.usedFonts.theme.majorFont && `Major: ${info.usedFonts.theme.majorFont}`,
    info.usedFonts.theme.minorFont && `Minor: ${info.usedFonts.theme.minorFont}`,
    info.usedFonts.theme.majorFontEa && `Major EA: ${info.usedFonts.theme.majorFontEa}`,
    info.usedFonts.theme.minorFontEa && `Minor EA: ${info.usedFonts.theme.minorFontEa}`,
  ].filter(Boolean);

  const fontList = info.usedFonts.fonts
    .map((font) => `<li>${escapeHtml(font)}</li>`)
    .join("");

  const missingList = info.missingFonts
    .map((font) => `<li><code>${escapeHtml(font)}</code></li>`)
    .join("");

  const mappingSuggestion =
    info.missingFonts.length > 0
      ? `<pre class="mapping-suggestion">${escapeHtml(
          JSON.stringify({ fontMapping: info.fontMappingSuggestion }, null, 2),
        )}</pre>`
      : "";

  const mappingRows = info.fontMappings
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.from)}</td><td class="arrow">→</td><td>${escapeHtml(m.to)}</td></tr>`,
    )
    .join("");

  const embeddedRows = info.embeddedFonts
    .map((font) => {
      const status = font.loaded ? "loaded" : "missing";
      return (
        `<tr class="${status}">` +
        `<td>${escapeHtml(font.typeface)}</td>` +
        `<td>${escapeHtml(font.slots.join(", "))}</td>` +
        `<td>${font.loaded ? "loaded" : "not loaded"}</td>` +
        `</tr>`
      );
    })
    .join("");

  const warningsByFeature = new Map<string, typeof info.warnings>();
  for (const entry of info.warnings) {
    const list = warningsByFeature.get(entry.feature) ?? [];
    list.push(entry);
    warningsByFeature.set(entry.feature, list);
  }

  const warningBlocks = [...warningsByFeature.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([feature, entries]) => {
      const kind = feature.startsWith("font.")
        ? "font"
        : feature.startsWith("shape.")
          ? "shape"
          : "other";
      const items = entries
        .map((entry) => {
          const ctx = entry.context ? ` <span class="ctx">(${escapeHtml(entry.context)})</span>` : "";
          return `<li>${escapeHtml(entry.message)}${ctx}</li>`;
        })
        .join("");
      return (
        `<div class="warn-group warn-${kind}">` +
        `<div class="warn-title">${escapeHtml(feature)} <span class="count">×${String(entries.length)}</span></div>` +
        `<ul>${items}</ul>` +
        `</div>`
      );
    })
    .join("");

  const warningSection =
    info.warnings.length > 0
      ? warningBlocks
      : '<p class="empty">No warnings — full fidelity (or logLevel off).</p>';

  return (
    `<section class="diag-section">` +
    `<h2>Render</h2>` +
    `<dl>` +
    `<dt>Width</dt><dd>${String(info.renderWidth)}px</dd>` +
    `<dt>Slides</dt><dd>${String(info.slideCount)}</dd>` +
    `<dt>Warnings</dt><dd>${String(info.warningSummary.totalCount)}</dd>` +
    `</dl>` +
    `</section>` +
    `<section class="diag-section">` +
    `<h2>Fonts in deck</h2>` +
    (themeLines.length > 0 ? `<div class="theme">${themeLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>` : "") +
    `<ul class="font-list">${fontList}</ul>` +
    `</section>` +
    `<section class="diag-section${info.missingFonts.length > 0 ? " diag-error" : ""}">` +
    `<h2>Missing fonts</h2>` +
    (info.missingFonts.length > 0
      ? `<p class="hint">Not embedded and not installed locally. Add <code>fontMapping</code> or install/embed these fonts.</p>` +
        `<ul class="font-list missing">${missingList}</ul>` +
        mappingSuggestion
      : '<p class="empty">All deck fonts resolved (embedded, local, or mapped).</p>') +
    `</section>` +
    `<section class="diag-section">` +
    `<h2>Configured font mappings</h2>` +
    (info.fontMappings.length > 0
      ? `<table class="diag-table"><tbody>${mappingRows}</tbody></table>`
      : '<p class="empty">No fontMapping configured for fonts in this deck.</p>') +
    `</section>` +
    `<section class="diag-section">` +
    `<h2>Embedded fonts</h2>` +
    (info.embeddedFonts.length > 0
      ? `<table class="diag-table"><thead><tr><th>Typeface</th><th>Slots</th><th>Status</th></tr></thead><tbody>${embeddedRows}</tbody></table>`
      : '<p class="empty">No embedded fonts in this deck.</p>') +
    `</section>` +
    `<section class="diag-section">` +
    `<h2>Render log</h2>` +
    `<p class="hint">Skipped features, fallbacks, and substitutions from the last render.</p>` +
    `<div class="warn-list">${warningSection}</div>` +
    `</section>`
  );
}

function generateHtml(
  slides: DevSlideSvg[],
  pptxName: string,
  renderWidth: number,
  info: DevRenderInfo,
): string {
  const slideContainerStyle =
    renderWidth !== undefined
      ? `width: ${String(renderWidth)}px; max-width: none;`
      : "max-width: 100%; max-height: 100%;";
  const thumbnailsHtml = slides
    .map(
      (s, i) =>
        `<div class="thumbnail${i === 0 ? " active" : ""}" data-index="${i}">` +
        `<div class="thumb-label">Slide ${String(s.slideNumber)}</div>` +
        `<div class="thumb-svg">${s.svg}</div>` +
        `</div>`,
    )
    .join("");

  const firstSvg = slides.length > 0 ? slides[0].svg : "<p>No slides</p>";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>pptx-glimpse dev - ${escapeHtml(pptxName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
    }
    #header {
      padding: 12px 20px;
      background: #16213e;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #header h1 { font-size: 14px; font-weight: 600; color: #a0a0c0; }
    #status { font-size: 12px; color: #4caf50; }
    #status.rendering { color: #ff9800; }
    #status.error { color: #f44336; }
    #main { display: flex; height: calc(100vh - 48px); }
    #sidebar {
      width: 180px;
      flex-shrink: 0;
      overflow-y: auto;
      background: #16213e;
      padding: 8px;
      border-right: 1px solid #2a2a4a;
    }
    .thumbnail {
      margin-bottom: 8px;
      padding: 4px;
      border: 2px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      background: #fff;
    }
    .thumbnail.active { border-color: #4472c4; }
    .thumbnail:hover { border-color: #6090d0; }
    .thumb-label {
      font-size: 10px;
      color: #888;
      text-align: center;
      padding: 2px 0;
      background: #16213e;
    }
    .thumb-svg svg { width: 100%; height: auto; display: block; }
    #viewer {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: auto;
    }
    #diagnostics {
      width: 340px;
      flex-shrink: 0;
      overflow-y: auto;
      background: #12122a;
      border-left: 1px solid #2a2a4a;
      padding: 12px 14px;
      font-size: 11px;
      line-height: 1.45;
    }
    #diagnostics h2 {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #8a8ab8;
      margin: 0 0 8px;
    }
    .diag-section {
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid #2a2a4a;
    }
    .diag-section:last-child { border-bottom: none; margin-bottom: 0; }
    #diagnostics dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 2px 10px;
    }
    #diagnostics dt { color: #666; }
    #diagnostics dd { color: #d0d0e8; margin: 0; }
    .theme { color: #888; margin-bottom: 6px; }
    .font-list { padding-left: 16px; color: #c8c8e0; }
    .font-list li { margin-bottom: 2px; }
    .diag-table { width: 100%; border-collapse: collapse; }
    .diag-table th, .diag-table td {
      text-align: left;
      padding: 3px 4px;
      vertical-align: top;
      border-bottom: 1px solid #22223d;
    }
    .diag-table th { color: #666; font-weight: 600; }
    .diag-table .arrow { color: #4472c4; width: 16px; text-align: center; }
    .diag-table tr.missing td { color: #f44336; }
    .diag-table tr.loaded td:last-child { color: #4caf50; }
    .diag-section.diag-error h2 { color: #f87171; }
    .mapping-suggestion {
      margin-top: 8px;
      padding: 10px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      font-size: 11px;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .font-list.missing li { color: #f87171; }
    .hint { color: #555; margin-bottom: 8px; }
    .warn-list { display: flex; flex-direction: column; gap: 8px; }
    .warn-group {
      background: #1a1a32;
      border-radius: 4px;
      padding: 8px;
      border-left: 3px solid #555;
    }
    .warn-group.warn-font { border-left-color: #ff9800; }
    .warn-group.warn-shape { border-left-color: #9c27b0; }
    .warn-group.warn-other { border-left-color: #607d8b; }
    .warn-title { font-weight: 600; color: #b0b0d0; margin-bottom: 4px; }
    .warn-title .count { color: #666; font-weight: 400; }
    .warn-group ul { padding-left: 16px; color: #999; }
    .warn-group li { margin-bottom: 2px; }
    .warn-group .ctx { color: #666; }
    #slide-container {
      background: #fff;
      border-radius: 4px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      ${slideContainerStyle}
    }
    #slide-container svg { display: block; width: 100%; height: auto; }
    #info {
      padding: 4px 20px;
      background: #16213e;
      font-size: 11px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="header">
    <h1>pptx-glimpse dev &mdash; ${escapeHtml(pptxName)}</h1>
    <span id="status">Connected</span>
  </div>
  <div id="main">
    <div id="sidebar">${thumbnailsHtml}</div>
    <div id="viewer">
      <div id="slide-container">${firstSvg}</div>
    </div>
    <aside id="diagnostics">${generateDiagnosticsHtml(info)}</aside>
  </div>
  <div id="info">Slide 1 / ${String(slides.length)}</div>
  <script>
    var currentIndex = 0;
    var slideCount = ${String(slides.length)};

    function selectSlide(index) {
      currentIndex = index;
      var thumbs = document.querySelectorAll(".thumbnail");
      for (var i = 0; i < thumbs.length; i++) {
        if (i === index) {
          thumbs[i].classList.add("active");
        } else {
          thumbs[i].classList.remove("active");
        }
      }
      var thumb = thumbs[index];
      var svgHtml = thumb.querySelector(".thumb-svg").innerHTML;
      document.getElementById("slide-container").innerHTML = svgHtml;
      var svg = document.querySelector("#slide-container svg");
      if (svg) {
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "auto";
      }
      document.getElementById("info").textContent =
        "Slide " + (index + 1) + " / " + slideCount;
    }

    // Click handlers for thumbnails
    var thumbs = document.querySelectorAll(".thumbnail");
    for (var i = 0; i < thumbs.length; i++) {
      (function (idx) {
        thumbs[idx].addEventListener("click", function () {
          selectSlide(idx);
        });
      })(i);
    }

    // WebSocket for live reload
    function connect() {
      var ws = new WebSocket("ws://" + location.host);
      var status = document.getElementById("status");

      ws.onopen = function () {
        status.textContent = "Connected";
        status.className = "";
      };
      ws.onclose = function () {
        status.textContent = "Disconnected - reconnecting...";
        status.className = "error";
        setTimeout(connect, 2000);
      };
      ws.onmessage = function (event) {
        var data = JSON.parse(event.data);
        if (data.type === "rendering") {
          status.textContent = "Re-rendering...";
          status.className = "rendering";
        } else if (data.type === "reload") {
          status.textContent = "Updating...";
          status.className = "rendering";
          location.reload();
        } else if (data.type === "error") {
          status.textContent = "Error: " + data.message;
          status.className = "error";
        }
      };
    }
    connect();

    // Initial: resize the main SVG
    (function () {
      var svg = document.querySelector("#slide-container svg");
      if (svg) {
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "auto";
      }
    })();

    // Keyboard navigation
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft" && currentIndex > 0) selectSlide(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < slideCount - 1)
        selectSlide(currentIndex + 1);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Main ---

function parseWidthArg(argv: string[]): number | undefined {
  const idx = argv.indexOf("--width");
  if (idx === -1) return undefined;
  const value = Number(argv[idx + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const pptxPath = process.argv[2];
  if (!pptxPath || pptxPath.startsWith("--")) {
    console.error(
      "Usage: pnpm run dev <pptx-file> [--port <port>] [--width <pixels>]",
    );
    console.error(`Default render width: ${String(DEFAULT_RENDER_WIDTH)}px`);
    process.exit(1);
  }

  const portArgIdx = process.argv.indexOf("--port");
  const port = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : DEFAULT_PORT;
  const width = parseWidthArg(process.argv) ?? DEFAULT_RENDER_WIDTH;

  const resolvedPath = resolve(pptxPath);
  const pptxName = basename(resolvedPath);

  console.log(`Loading: ${resolvedPath}`);
  console.log(`Render width: ${String(width)}px`);

  const renderResult = await renderSlides(resolvedPath, width);
  let slides = renderResult.slides;
  let renderInfo = renderResult.info;
  console.log(`Rendered ${String(slides.length)} slide(s)`);
  console.log(`Warnings: ${String(renderInfo.warningSummary.totalCount)}`);

  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(generateHtml(slides, pptxName, width, renderInfo));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (_ws: WebSocket) => {
    console.log("Browser connected");
  });

  server.listen(port, () => {
    console.log(`Dev server running at http://localhost:${String(port)}`);
    console.log(`Watching: ${WATCH_DIR}`);
  });

  let rendering = false;

  watchSourceFiles(() => {
    if (rendering) return;
    rendering = true;

    console.log("Re-rendering...");
    broadcast(wss, { type: "rendering" });

    renderSlides(resolvedPath, width)
      .then((result) => {
        slides = result.slides;
        renderInfo = result.info;
        console.log(`Re-rendered ${String(slides.length)} slide(s)`);
        console.log(`Warnings: ${String(renderInfo.warningSummary.totalCount)}`);
        broadcast(wss, { type: "reload" });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Render error: ${message}`);
        broadcast(wss, { type: "error", message });
      })
      .finally(() => {
        rendering = false;
      });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
