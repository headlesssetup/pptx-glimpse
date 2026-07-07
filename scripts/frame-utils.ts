export interface Frame {
  slideNumber: number;
  stepIndex?: number;
}

export function frameFileName(frame: Frame, ext: "png" | "svg"): string {
  const slide = String(frame.slideNumber).padStart(2, "0");
  const step =
    frame.stepIndex !== undefined ? `-step-${String(frame.stepIndex).padStart(2, "0")}` : "";
  return `slide-${slide}${step}.${ext}`;
}
