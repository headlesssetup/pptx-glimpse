/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. Ported from libeot (https://github.com/umanwizard/libeot),
 * Copyright (c) 2013 Brennan T. Vincent; portions originally Monotype Imaging.
 * See ./NOTICE for details (including patent information). */

import { AdaptiveHuffman } from "./ahuff.js";
import { BitReader, MtxError } from "./bit-reader.js";

// libeot lzcomp.c の DECOMPRESS パスの移植。

const LEN_WIDTH = 3;
const DIST_WIDTH = 3;
const BIT_RANGE = LEN_WIDTH - 1; // 2
const LEN_MIN = 2;
const DIST_MIN = 1;
const MAX_2BYTE_DIST = 512;
const PRELOAD_SIZE = 2 * 32 * 96 + 4 * 256; // 7168

// RUNLENGTHCOMP の状態
const ST_NORMAL = 0;
const ST_SEEN_ESCAPE = 1;
const ST_NEED_BYTE = 2;
const ST_INITIAL = 100;

/** libeot InitializeModel(false): ptr1 先頭の preLoad パターンを埋める。 */
function fillPreload(buf: Uint8Array): void {
  let i = 0;
  for (let k = 0; k < 32; k++) {
    for (let j = 0; j < 96; j++) {
      buf[i++] = k;
      buf[i++] = j;
    }
  }
  let j = 0;
  while (i < PRELOAD_SIZE && j < 256) {
    buf[i++] = j;
    buf[i++] = j;
    buf[i++] = j;
    buf[i++] = j;
    j++;
  }
}

/** libeot SetDistRange: out_len からシンボル範囲を決める。 */
function setDistRange(length: number): { numDistRanges: number; dup2: number; numSyms: number } {
  let numDistRanges = 1;
  let distMax = DIST_MIN + (1 << (DIST_WIDTH * numDistRanges)) - 1;
  while (distMax < length) {
    numDistRanges++;
    distMax = DIST_MIN + Math.pow(2, DIST_WIDTH * numDistRanges) - 1;
  }
  const dup2 = 256 + (1 << LEN_WIDTH) * numDistRanges;
  const numSyms = dup2 + 3; // DUP6 + 1
  return { numDistRanges, dup2, numSyms };
}

/** RLE (RUNLENGTHCOMP) のデコード側。append-only で out に書き出す。 */
class RunLength {
  private state = ST_INITIAL;
  private escape = 0;
  private count = 0;

  saveBytes(value: number, out: number[]): void {
    if (this.state === ST_NORMAL) {
      if (value === this.escape) {
        this.state = ST_SEEN_ESCAPE;
      } else {
        out.push(value);
      }
    } else if (this.state === ST_SEEN_ESCAPE) {
      this.count = value;
      if (value === 0) {
        out.push(this.escape);
        this.state = ST_NORMAL;
      } else {
        this.state = ST_NEED_BYTE;
      }
    } else if (this.state === ST_NEED_BYTE) {
      for (let i = this.count; i > 0; i--) out.push(value);
      this.state = ST_NORMAL;
    } else {
      // ST_INITIAL: 最初のバイトはエスケープ文字として消費される
      this.escape = value;
      this.state = ST_NORMAL;
    }
  }
}

/** 1 ブロックを LZCOMP で展開する (MTX_LZCOMP_UnPackMemory + Decode)。 */
function decompressBlock(data: Uint8Array, version: number): Uint8Array {
  const bio = new BitReader(data);

  const usingRunLength = version === 1 ? false : bio.inputBit() !== 0;

  const distEcoder = new AdaptiveHuffman(bio, 1 << DIST_WIDTH);
  const lenEcoder = new AdaptiveHuffman(bio, 1 << LEN_WIDTH);

  const outLen = bio.readValue(24);
  const { dup2, numSyms } = setDistRange(outLen);
  const dup4 = dup2 + 1;
  const dup6 = dup2 + 2;

  const symEcoder = new AdaptiveHuffman(bio, numSyms);

  // ptr1: 先頭 PRELOAD_SIZE は preLoad パターン、その後ろに LZ 展開結果。
  const buf = new Uint8Array(outLen + PRELOAD_SIZE);
  fillPreload(buf);
  const P = PRELOAD_SIZE;

  const out: number[] = [];
  const rl = usingRunLength ? new RunLength() : null;
  const emit = (v: number): void => {
    if (rl) rl.saveBytes(v, out);
    else out.push(v);
  };

  // DecodeLength: symbol から長さと numDistRanges を求める
  let numDistRangesOut = 0;
  const decodeLength = (symbol: number): number => {
    const mask = 1 << BIT_RANGE; // 4
    let firstTime = true;
    let value = 0;
    let bits: number;
    let done: boolean;
    do {
      if (firstTime) {
        bits = symbol - 256;
        firstTime = false;
        numDistRangesOut = ((bits / (1 << LEN_WIDTH)) | 0) + 1;
        bits = bits % (1 << LEN_WIDTH);
      } else {
        bits = lenEcoder.readSymbol();
      }
      done = (bits & mask) === 0;
      bits &= ~mask;
      value = (value << BIT_RANGE) | bits;
    } while (!done);
    return value + LEN_MIN;
  };

  // DecodeDistance2
  const decodeDistance = (distRanges: number): number => {
    let value = 0;
    for (let i = distRanges; i > 0; i--) {
      const bits = distEcoder.readSymbol();
      value = (value << DIST_WIDTH) | bits;
    }
    return value + DIST_MIN;
  };

  let pos = 0;
  while (pos < outLen) {
    const symbol = symEcoder.readSymbol();
    let value: number;
    if (symbol < 256) {
      value = symbol;
    } else if (symbol === dup2) {
      value = buf[P + pos - 2];
    } else if (symbol === dup4) {
      value = buf[P + pos - 4];
    } else if (symbol === dup6) {
      value = buf[P + pos - 6];
    } else {
      // コピーアイテム
      const length = decodeLength(symbol);
      let len = length;
      const distance = decodeDistance(numDistRangesOut);
      if (distance >= MAX_2BYTE_DIST) len++;
      const start = pos - distance - len + 1;
      for (let j = 0; j < len; j++) {
        const v = buf[P + start + j];
        buf[P + pos] = v;
        pos++;
        emit(v);
      }
      continue;
    }
    buf[P + pos] = value;
    pos++;
    emit(value);
  }

  if (pos !== outLen) throw new MtxError("lzcomp: output length mismatch");
  return Uint8Array.from(out);
}

function u24BE(d: Uint8Array, o: number): number {
  return (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
}

/**
 * MTX ブロック (version + copyLimit + 3 つの LZCOMP ブロック) を展開し、
 * 3 つの CTF バッファを返す。libeot unpackMtx 相当。
 */
export function unpackMtx(data: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] {
  if (data.length < 10) throw new MtxError("MTX: data too short");
  const version = data[0];
  // data[1..3] = copyLimit (未使用), data[4..6]=offsets[1], data[7..9]=offsets[2]
  const offsets = [10, u24BE(data, 4), u24BE(data, 7)];
  const sizes = [offsets[1] - offsets[0], offsets[2] - offsets[1], data.length - offsets[2]];

  const out: Uint8Array[] = [];
  for (let i = 0; i < 3; i++) {
    if (offsets[i] < 0 || sizes[i] < 0 || offsets[i] + sizes[i] > data.length) {
      throw new MtxError("MTX: bad block offsets");
    }
    const block = data.subarray(offsets[i], offsets[i] + sizes[i]);
    out.push(decompressBlock(block, version));
  }
  return [out[0], out[1], out[2]];
}
