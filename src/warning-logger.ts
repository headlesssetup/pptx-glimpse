export type LogLevel = "off" | "warn" | "debug";

export interface WarningEntry {
  /** The feature key, e.g. "sp.style", "bodyPr@vert" */
  feature: string;
  /** Human-readable description */
  message: string;
  /** Location context, e.g. "Slide 1" */
  context?: string;
}

export interface WarningSummary {
  totalCount: number;
  features: { feature: string; message: string; count: number }[];
}

const PREFIX = "[pptx-glimpse]";

let currentLevel: LogLevel = "off";
let entries: WarningEntry[] = [];
const featureCounts = new Map<string, { message: string; count: number }>();
// 直近の変換の警告。flushWarnings 後も getWarningEntries / getWarningSummary で
// 参照できるように保持する (変換 API は終了時に必ず flush するため)。
let lastFlushedEntries: WarningEntry[] = [];
let lastFlushedSummary: WarningSummary | null = null;

export function initWarningLogger(level: LogLevel): void {
  currentLevel = level;
  entries = [];
  featureCounts.clear();
  lastFlushedEntries = [];
  lastFlushedSummary = null;
}

export function warn(feature: string, message: string, context?: string): void {
  if (currentLevel === "off") return;

  entries.push({ feature, message, ...(context !== undefined && { context }) });

  const existing = featureCounts.get(feature);
  if (existing) {
    existing.count++;
  } else {
    featureCounts.set(feature, { message, count: 1 });
  }

  if (currentLevel === "debug") {
    const ctx = context ? ` (${context})` : "";
    console.warn(`${PREFIX} SKIP: ${feature} - ${message}${ctx}`);
  }
}

export function debug(feature: string, message: string, context?: string): void {
  if (currentLevel !== "debug") return;

  entries.push({ feature, message, ...(context !== undefined && { context }) });

  const existing = featureCounts.get(feature);
  if (existing) {
    existing.count++;
  } else {
    featureCounts.set(feature, { message, count: 1 });
  }

  const ctx = context ? ` (${context})` : "";
  console.warn(`${PREFIX} DEBUG: ${feature} - ${message}${ctx}`);
}

export function getWarningSummary(): WarningSummary {
  if (entries.length === 0 && lastFlushedSummary) {
    return lastFlushedSummary;
  }
  const features: WarningSummary["features"] = [];
  for (const [feature, { message, count }] of featureCounts) {
    features.push({ feature, message, count });
  }
  return { totalCount: entries.length, features };
}

export function flushWarnings(): WarningSummary {
  const summary = getWarningSummary();

  if (currentLevel !== "off" && summary.features.length > 0) {
    console.warn(`${PREFIX} Summary: ${summary.features.length} unsupported feature(s) detected`);
    for (const { feature, count } of summary.features) {
      console.warn(`  - ${feature}: ${count} occurrence(s)`);
    }
  }

  lastFlushedEntries = entries;
  lastFlushedSummary = summary;
  entries = [];
  featureCounts.clear();

  return summary;
}

export function getWarningEntries(): readonly WarningEntry[] {
  return entries.length > 0 ? entries : lastFlushedEntries;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}
