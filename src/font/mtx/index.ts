/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. Ported from libeot (https://github.com/umanwizard/libeot),
 * Copyright (c) 2013 Brennan T. Vincent; portions originally Monotype Imaging.
 * See ./NOTICE for details (including patent information). */

import { ctfToTtf } from "./ctf.js";
import { unpackMtx } from "./lzcomp.js";

/**
 * MicroType Express 圧縮されたフォントデータ (EOT のフォントデータ部、
 * XOR 復号済み) を生の TTF/OTF に展開する。libeot の
 * unpackMtx → parseCTF → dumpContainer に相当する。
 */
export function decodeMtx(fontData: Uint8Array): Uint8Array {
  const ctfBuffers = unpackMtx(fontData);
  return ctfToTtf(ctfBuffers);
}
