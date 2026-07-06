"use client";

import { zipSync } from "fflate";
import { useCallback, useState } from "react";

import { svgToPngBlob, triggerDownload } from "@/lib/download";
import type { Frame } from "@/lib/frames";
import { frameFileName } from "@/lib/frames";

import { DropZone } from "./DropZone";
import { SlideViewer } from "./SlideViewer";
import { ThumbnailStrip } from "./ThumbnailStrip";

type Phase = "upload" | "loading" | "viewing" | "error";

export function UploadViewer() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [animationSteps, setAnimationSteps] = useState(false);
  const [deckName, setDeckName] = useState("slides");
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [fontWarnings, setFontWarnings] = useState<string[]>([]);

  const handleFile = useCallback(
    async (file: File) => {
      setPhase("loading");

      try {
        const formData = new FormData();
        formData.append("file", file);
        if (animationSteps) formData.append("animationSteps", "1");

        const res = await fetch("/api/convert", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Conversion failed");
        }

        setDeckName(file.name.replace(/\.pptx$/i, "") || "slides");
        setFrames(data.slides);
        setFontWarnings(Array.isArray(data.fontWarnings) ? data.fontWarnings : []);
        setCurrentIndex(0);
        setDownloadError("");
        setPhase("viewing");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [animationSteps],
  );

  const handleNavigate = useCallback(
    (index: number) => {
      if (index >= 0 && index < frames.length) {
        setCurrentIndex(index);
      }
    },
    [frames.length],
  );

  const handleReset = useCallback(() => {
    setFrames([]);
    setCurrentIndex(0);
    setDownloadError("");
    setPhase("upload");
  }, []);

  const downloadCurrent = useCallback(
    async (format: "png" | "svg") => {
      const frame = frames[currentIndex];
      if (!frame) return;
      setDownloadError("");
      try {
        if (format === "svg") {
          const blob = new Blob([frame.svg], { type: "image/svg+xml;charset=utf-8" });
          triggerDownload(blob, frameFileName(frame, "svg"));
        } else {
          triggerDownload(await svgToPngBlob(frame.svg), frameFileName(frame, "png"));
        }
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : String(err));
      }
    },
    [frames, currentIndex],
  );

  const downloadAll = useCallback(async () => {
    if (zipProgress !== null) return;
    setDownloadError("");
    setZipProgress(0);
    try {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < frames.length; i++) {
        setZipProgress(i + 1);
        const blob = await svgToPngBlob(frames[i].svg);
        files[frameFileName(frames[i], "png")] = new Uint8Array(await blob.arrayBuffer());
      }
      // PNG data is already compressed — store entries instead of re-deflating.
      const zipped = zipSync(files, { level: 0 });
      const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
      triggerDownload(blob, `${deckName}.zip`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setZipProgress(null);
    }
  }, [frames, deckName, zipProgress]);

  const optionsRow = (
    <div className="options-row">
      <label className="option">
        <input
          type="checkbox"
          checked={animationSteps}
          onChange={(e) => setAnimationSteps(e.target.checked)}
        />
        Render click-animation steps as separate frames
      </label>
    </div>
  );

  if (phase === "loading") {
    return (
      <div className="loading">
        <p>Converting...</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <>
        <div className="error">Error: {errorMessage}</div>
        {optionsRow}
        <DropZone onFile={handleFile} />
      </>
    );
  }

  if (phase === "viewing") {
    return (
      <>
        {fontWarnings.length > 0 && (
          <div className="font-warnings">
            <strong>Fonts are not faithful — this deck does not carry its fonts.</strong>
            <ul>
              {fontWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <p>
              For an exact match, re-save the deck in PowerPoint with{" "}
              <em>File → Options → Save → “Embed fonts in the file”</em> (choose “Embed all
              characters”) and upload it again. Alternatively, install the fonts on this server
              (see <code>PPTX_GLIMPSE_FONT_DIRS</code>).
            </p>
          </div>
        )}
        <div className="toolbar">
          <button onClick={() => downloadCurrent("png")}>Download PNG</button>
          <button onClick={() => downloadCurrent("svg")}>Download SVG</button>
          <button onClick={downloadAll} disabled={zipProgress !== null}>
            {zipProgress !== null
              ? `Preparing… ${zipProgress}/${frames.length}`
              : `Download all (${frames.length}) as ZIP`}
          </button>
          <button className="secondary" onClick={handleReset}>
            Convert another file
          </button>
        </div>
        {downloadError && <div className="toolbar-error">Download failed: {downloadError}</div>}
        <SlideViewer frames={frames} currentIndex={currentIndex} onNavigate={handleNavigate} />
        <ThumbnailStrip frames={frames} currentIndex={currentIndex} onSelect={handleNavigate} />
      </>
    );
  }

  return (
    <>
      {optionsRow}
      <DropZone onFile={handleFile} />
    </>
  );
}
