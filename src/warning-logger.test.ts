import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  debug,
  flushWarnings,
  getLogLevel,
  getWarningEntries,
  getWarningSummary,
  initWarningLogger,
  warn,
} from "./warning-logger.js";

describe("warning-logger", () => {
  beforeEach(() => {
    initWarningLogger("off");
    vi.restoreAllMocks();
  });

  describe("initWarningLogger", () => {
    it("sets the log level", () => {
      initWarningLogger("warn");
      expect(getLogLevel()).toBe("warn");

      initWarningLogger("debug");
      expect(getLogLevel()).toBe("debug");

      initWarningLogger("off");
      expect(getLogLevel()).toBe("off");
    });

    it("resets entries on re-initialization", () => {
      initWarningLogger("warn");
      warn("sp.style", "test");
      expect(getWarningEntries()).toHaveLength(1);

      initWarningLogger("warn");
      expect(getWarningEntries()).toHaveLength(0);
    });
  });

  describe('level "off"', () => {
    it("warn() is a no-op", () => {
      initWarningLogger("off");
      warn("sp.style", "test");
      expect(getWarningEntries()).toHaveLength(0);
      expect(getWarningSummary().totalCount).toBe(0);
    });

    it("debug() is a no-op", () => {
      initWarningLogger("off");
      debug("parse.error", "test");
      expect(getWarningEntries()).toHaveLength(0);
    });
  });

  describe('level "warn"', () => {
    beforeEach(() => {
      initWarningLogger("warn");
    });

    it("warn() records entries", () => {
      warn("sp.style", "style references not implemented");
      expect(getWarningEntries()).toHaveLength(1);
      expect(getWarningEntries()[0]).toEqual({
        feature: "sp.style",
        message: "style references not implemented",
      });
    });

    it("warn() records context when provided", () => {
      warn("sp.style", "style references not implemented", "Slide 1");
      expect(getWarningEntries()[0]).toEqual({
        feature: "sp.style",
        message: "style references not implemented",
        context: "Slide 1",
      });
    });

    it("debug() is a no-op at warn level", () => {
      debug("parse.error", "test");
      expect(getWarningEntries()).toHaveLength(0);
    });

    it("does not emit console.warn for individual warnings", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warn("sp.style", "test");
      expect(spy).not.toHaveBeenCalled();
    });

    it("deduplicates feature counts", () => {
      warn("sp.style", "style references not implemented", "Slide 1");
      warn("sp.style", "style references not implemented", "Slide 2");
      warn("sp.style", "style references not implemented", "Slide 3");
      warn("ln.headEnd", "arrow heads not implemented");

      const summary = getWarningSummary();
      expect(summary.totalCount).toBe(4);
      expect(summary.features).toHaveLength(2);
      expect(summary.features[0]).toEqual({
        feature: "sp.style",
        message: "style references not implemented",
        count: 3,
      });
      expect(summary.features[1]).toEqual({
        feature: "ln.headEnd",
        message: "arrow heads not implemented",
        count: 1,
      });
    });
  });

  describe('level "debug"', () => {
    beforeEach(() => {
      initWarningLogger("debug");
    });

    it("warn() records entries and emits console.warn", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warn("sp.style", "style references not implemented");
      expect(getWarningEntries()).toHaveLength(1);
      expect(spy).toHaveBeenCalledWith(
        "[pptx-glimpse] SKIP: sp.style - style references not implemented",
      );
    });

    it("warn() includes context in console output", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      warn("sp.style", "style references not implemented", "Slide 1");
      expect(spy).toHaveBeenCalledWith(
        "[pptx-glimpse] SKIP: sp.style - style references not implemented (Slide 1)",
      );
    });

    it("debug() records entries and emits console.warn", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      debug("parse.error", "missing root element");
      expect(getWarningEntries()).toHaveLength(1);
      expect(spy).toHaveBeenCalledWith("[pptx-glimpse] DEBUG: parse.error - missing root element");
    });
  });

  describe("flushWarnings", () => {
    it("outputs summary to console.warn and resets state", () => {
      initWarningLogger("warn");
      warn("sp.style", "style references not implemented");
      warn("sp.style", "style references not implemented");
      warn("ln.headEnd", "arrow heads not implemented");

      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const summary = flushWarnings();

      expect(summary.totalCount).toBe(3);
      expect(summary.features).toHaveLength(2);

      expect(spy).toHaveBeenCalledWith("[pptx-glimpse] Summary: 2 unsupported feature(s) detected");
      expect(spy).toHaveBeenCalledWith("  - sp.style: 2 occurrence(s)");
      expect(spy).toHaveBeenCalledWith("  - ln.headEnd: 1 occurrence(s)");

      // 直近の変換の警告は flush 後も参照できる (次の initWarningLogger でクリア)
      expect(getWarningEntries()).toHaveLength(3);
      expect(getWarningSummary().totalCount).toBe(3);
    });

    it("does not output when level is off", () => {
      initWarningLogger("off");
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const summary = flushWarnings();
      expect(summary.features).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it("does not output when no warnings were recorded", () => {
      initWarningLogger("warn");
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const summary = flushWarnings();
      expect(summary.features).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe("flush 後の警告参照", () => {
  it("flushWarnings 後も直近の変換の警告を取得できる", () => {
    initWarningLogger("warn");
    warn("font.notFound", 'Font not found: "Aptos"');
    flushWarnings();
    expect(getWarningEntries()).toHaveLength(1);
    expect(getWarningEntries()[0].message).toContain("Aptos");
    expect(getWarningSummary().totalCount).toBe(1);
  });

  it("initWarningLogger で直近の警告もクリアされる", () => {
    initWarningLogger("warn");
    warn("font.notFound", 'Font not found: "Aptos"');
    flushWarnings();
    initWarningLogger("warn");
    expect(getWarningEntries()).toHaveLength(0);
    expect(getWarningSummary().totalCount).toBe(0);
  });
});
