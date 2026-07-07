import type { FontMapping } from "../src/font/font-mapping.js";

/**
 * VRT 専用のフォントマッピング。
 * Docker 環境には Calibri / Arial 等のプロプライエタリフォントが無いため、
 * OSS 代替へ明示的にマップする。ライブラリのデフォルトには含めない。
 */
export const VRT_FONT_MAPPING: FontMapping = {
  Calibri: "Carlito",
  "Calibri Light": "Carlito",
  Aptos: "Carlito",
  "Aptos Display": "Carlito",
  "Aptos Narrow": "Carlito",
  "Aptos Light": "Carlito",
  "Aptos SemiBold": "Carlito",
  Corbel: "Carlito",
  "Corbel Light": "Carlito",
  Arial: "Arimo",
  "Times New Roman": "Tinos",
  "Courier New": "Cousine",
  Cambria: "Caladea",
  メイリオ: "Noto Sans JP",
  Meiryo: "Noto Sans JP",
  游ゴシック: "Noto Sans JP",
  "游ゴシック Light": "Noto Sans JP",
  "Yu Gothic": "Noto Sans JP",
  "Yu Gothic Light": "Noto Sans JP",
  "MS ゴシック": "Noto Sans JP",
  "MS Gothic": "Noto Sans JP",
  "MS Pゴシック": "Noto Sans JP",
  "MS PGothic": "Noto Sans JP",
  "MS 明朝": "Noto Serif CJK JP",
  "MS Mincho": "Noto Serif CJK JP",
  "MS P明朝": "Noto Serif CJK JP",
  "MS PMincho": "Noto Serif CJK JP",
  游明朝: "Noto Serif CJK JP",
  "Yu Mincho": "Noto Serif CJK JP",
};
