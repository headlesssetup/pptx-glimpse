import type { Emu } from "../utils/unit-types.js";

export interface EmbeddedFont {
  typeface: string;
  panose?: string;
  pitchFamily?: number;
  charset?: number;
  /** ppt/fonts/*.fntdata を指す関係 ID (各スタイルフェイス) */
  regularRId?: string;
  boldRId?: string;
  italicRId?: string;
  boldItalicRId?: string;
}

export interface Protection {
  modifyVerifier?: {
    algorithmName?: string;
    hashValue?: string;
    saltValue?: string;
    spinCount?: number;
  };
}

export interface SlideSize {
  width: Emu;
  height: Emu;
}
