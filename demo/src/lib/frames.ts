export interface Frame {
  slideNumber: number;
  svg: string;
  /** Build step number when animation steps are enabled (0 = initial state) */
  stepIndex?: number;
}

export function frameFileName(frame: Frame, ext: "png" | "svg"): string {
  const slide = String(frame.slideNumber).padStart(2, "0");
  const step =
    frame.stepIndex !== undefined ? `-step-${String(frame.stepIndex).padStart(2, "0")}` : "";
  return `slide-${slide}${step}.${ext}`;
}

export function frameLabel(frame: Frame): string {
  return frame.stepIndex !== undefined
    ? `Slide ${frame.slideNumber} · Step ${frame.stepIndex}`
    : `Slide ${frame.slideNumber}`;
}
