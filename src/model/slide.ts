import type { Fill } from "./fill.js";
import type { SlideElement } from "./shape.js";

export interface Slide {
  slideNumber: number;
  background: Background | null;
  elements: SlideElement[];
  showMasterSp: boolean;
  /**
   * クリックで進行するアニメーションのビルドステップ (p:timing の mainSeq 由来)。
   * undefined はクリックアニメーションが無いことを表す。
   */
  buildSteps?: BuildStep[];
}

/**
 * クリック 1 回で進行するアニメーションの 1 ステップ。
 * 配列のインデックス (0 始まり) が何回目のクリックかに対応する。
 */
export interface BuildStep {
  /** entrance: このクリックで表示される図形 (cNvPr/@id) */
  revealedIds: string[];
  /** exit: このクリックで非表示になる図形 (cNvPr/@id) */
  hiddenIds: string[];
}

export interface Background {
  fill: Fill | null;
}
