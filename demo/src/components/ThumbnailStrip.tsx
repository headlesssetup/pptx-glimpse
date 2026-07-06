"use client";

import type { Frame } from "@/lib/frames";
import { frameLabel } from "@/lib/frames";

export function ThumbnailStrip({
  frames,
  currentIndex,
  onSelect,
}: {
  frames: Frame[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="thumbnail-strip">
      {frames.map((frame, index) => (
        <div
          key={index}
          className={`thumbnail${index === currentIndex ? " active" : ""}`}
          title={frameLabel(frame)}
          onClick={() => onSelect(index)}
        >
          <div className="thumbnail-svg" dangerouslySetInnerHTML={{ __html: frame.svg }} />
          {frame.stepIndex !== undefined && (
            <span className="thumbnail-badge">
              {frame.slideNumber}·{frame.stepIndex}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
