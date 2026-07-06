"use client";

import { useEffect } from "react";

import type { Frame } from "@/lib/frames";
import { frameLabel } from "@/lib/frames";

export function SlideViewer({
  frames,
  currentIndex,
  onNavigate,
}: {
  frames: Frame[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight") onNavigate(currentIndex + 1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, onNavigate]);

  const frame = frames[currentIndex];
  const hasSteps = frame.stepIndex !== undefined;

  return (
    <>
      <div className="slide-nav">
        <button disabled={currentIndex === 0} onClick={() => onNavigate(currentIndex - 1)}>
          &laquo; Prev
        </button>
        <span>
          {hasSteps
            ? `Frame ${currentIndex + 1} / ${frames.length} — ${frameLabel(frame)}`
            : `Slide ${currentIndex + 1} / ${frames.length}`}
        </span>
        <button
          disabled={currentIndex === frames.length - 1}
          onClick={() => onNavigate(currentIndex + 1)}
        >
          Next &raquo;
        </button>
      </div>
      <div className="slide-container" dangerouslySetInnerHTML={{ __html: frame.svg }} />
    </>
  );
}
