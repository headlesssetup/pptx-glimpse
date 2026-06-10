/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. Ported from libeot (https://github.com/umanwizard/libeot),
 * Copyright (c) 2013 Brennan T. Vincent; portions originally Monotype Imaging.
 * See ./NOTICE for details (including patent information). */

/** MTX デコード中に入力を読み切ったときに投げる。 */
export class MtxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MtxError";
  }
}

/**
 * libeot BITIO の読み取り側 (MTX_BITIO_input_bit / ReadValue) の移植。
 * バイト列から MSB ファーストでビットを読む。
 */
export class BitReader {
  private readonly bytes: Uint8Array;
  private memIndex = 0;
  private inputBitCount = 0; // C: unsigned short
  private inputBitBuffer = 0; // C: unsigned short

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** 1 ビット読む。返り値は 0 または非 0 (0x100)。 */
  inputBit(): number {
    // C は input_bit_count-- を常に行い、デクリメント前の値が 0 ならバイトを補充する。
    if (this.inputBitCount === 0) {
      const b = this.bytes[this.memIndex];
      this.memIndex++;
      if (this.memIndex > this.bytes.length) {
        throw new MtxError("BITIO: end of input");
      }
      this.inputBitBuffer = b ?? 0;
      this.inputBitCount = 7;
    } else {
      this.inputBitCount--;
    }
    this.inputBitBuffer = (this.inputBitBuffer << 1) & 0xffff;
    return this.inputBitBuffer & 0x100;
  }

  /** numberOfBits ビットを MSB ファーストで読み、符号なし整数として返す。 */
  readValue(numberOfBits: number): number {
    let value = 0;
    for (let i = numberOfBits - 1; i >= 0; i--) {
      value <<= 1;
      if (this.inputBit()) value |= 1;
    }
    return value >>> 0;
  }
}

/** 正の整数 x を表すのに必要なビット数 (libeot MTX_AHUFF_BitsUsed と同値)。 */
export function bitsUsed(x: number): number {
  if (x <= 0) return 1; // C は x==0 で 1 を返す
  return 32 - Math.clz32(x);
}
