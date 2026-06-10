/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. Ported from libeot (https://github.com/umanwizard/libeot),
 * Copyright (c) 2013 Brennan T. Vincent; portions originally Monotype Imaging.
 * See ./NOTICE for details (including patent information). */

import { MtxError } from "./bit-reader.js";

const NBIT_MASKS = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];

/**
 * libeot util/stream.c の移植。ビッグエンディアンの読み書き、シーク、
 * 予約付き書き込みバッファ、ビット単位読み取りをサポートする。
 * エラー時は MtxError を投げる (libeot のエラー列挙を例外に置き換え)。
 */
export class Stream {
  buf: Uint8Array;
  size: number;
  reserved: number;
  pos = 0;
  bitPos = 0;

  constructor(buf: Uint8Array | null, size: number, reserved?: number) {
    this.buf = buf ?? new Uint8Array(0);
    this.size = size;
    this.reserved = reserved ?? size;
  }

  private chkByte(): void {
    if (this.bitPos !== 0) throw new MtxError("stream: off byte boundary");
  }
  private fixSize(): void {
    if (this.pos > this.size) this.size = this.pos;
  }
  private chkRes(n: number): void {
    if (this.pos + n > this.reserved) throw new MtxError("stream: out of reserved space");
  }

  readU8(): number {
    this.chkByte();
    if (this.pos >= this.size) throw new MtxError("stream: not enough data");
    return this.buf[this.pos++];
  }
  readU16(): number {
    this.chkByte();
    if (this.pos + 2 > this.size) throw new MtxError("stream: not enough data");
    const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1];
    this.pos += 2;
    return v;
  }
  readU24(): number {
    this.chkByte();
    if (this.pos + 3 > this.size) throw new MtxError("stream: not enough data");
    const v = (this.buf[this.pos] << 16) | (this.buf[this.pos + 1] << 8) | this.buf[this.pos + 2];
    this.pos += 3;
    return v >>> 0;
  }
  readU32(): number {
    this.chkByte();
    if (this.pos + 4 > this.size) throw new MtxError("stream: not enough data");
    const v =
      ((this.buf[this.pos] << 24) |
        (this.buf[this.pos + 1] << 16) |
        (this.buf[this.pos + 2] << 8) |
        this.buf[this.pos + 3]) >>>
      0;
    this.pos += 4;
    return v;
  }
  readS16(): number {
    return (this.readU16() << 16) >> 16;
  }
  peekU8(): number {
    const v = this.readU8();
    this.pos--;
    return v;
  }

  seekRelative(offset: number): void {
    this.chkByte();
    const np = this.pos + offset;
    if (np < 0) throw new MtxError("stream: negative seek");
    if (np > this.size) throw new MtxError("stream: seek past eos");
    this.pos = np;
  }
  seekRelativeThroughReserve(offset: number): void {
    this.chkByte();
    const np = this.pos + offset;
    if (np < 0) throw new MtxError("stream: negative seek");
    if (np > this.reserved) throw new MtxError("stream: seek past reserve");
    this.pos = np;
  }
  seekAbsolute(pos: number): void {
    this.chkByte();
    if (pos > this.size) throw new MtxError("stream: seek past eos");
    this.pos = pos;
  }
  seekAbsoluteThroughReserve(pos: number): void {
    this.chkByte();
    if (pos > this.reserved) throw new MtxError("stream: seek past reserve");
    this.pos = pos;
  }

  reserve(toReserve: number): void {
    if (this.reserved >= toReserve) return;
    const nb = new Uint8Array(toReserve);
    nb.set(this.buf.subarray(0, this.size));
    this.buf = nb;
    this.reserved = toReserve;
  }

  writeU8(v: number): void {
    this.chkByte();
    this.chkRes(1);
    this.buf[this.pos++] = v & 0xff;
    this.fixSize();
  }
  writeU16(v: number): void {
    this.chkByte();
    this.chkRes(2);
    this.buf[this.pos++] = (v >> 8) & 0xff;
    this.buf[this.pos++] = v & 0xff;
    this.fixSize();
  }
  writeU24(v: number): void {
    this.chkByte();
    if (v & 0xff000000) throw new MtxError("stream: u24 out of bounds");
    this.chkRes(3);
    this.buf[this.pos++] = (v >> 16) & 0xff;
    this.buf[this.pos++] = (v >> 8) & 0xff;
    this.buf[this.pos++] = v & 0xff;
    this.fixSize();
  }
  writeU32(v: number): void {
    this.chkByte();
    this.chkRes(4);
    this.buf[this.pos++] = (v >>> 24) & 0xff;
    this.buf[this.pos++] = (v >>> 16) & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
    this.buf[this.pos++] = v & 0xff;
    this.fixSize();
  }
  writeS16(v: number): void {
    this.writeU16(v & 0xffff);
  }

  /** in (this) から out へ length バイトコピーする。 */
  copyTo(out: Stream, length: number): void {
    this.chkByte();
    out.chkByte();
    if (this.pos + length > this.size) throw new MtxError("stream: not enough data");
    if (out.pos + length > out.reserved) throw new MtxError("stream: out of reserved space");
    out.buf.set(this.buf.subarray(this.pos, this.pos + length), out.pos);
    out.pos += length;
    this.pos += length;
    out.fixSize();
  }

  /** n ビット (最大 32) を MSB ファーストで読む。 */
  readNBits(n: number): number {
    if (n > 32) throw new MtxError("stream: nbits out of bounds");
    let out = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.size) throw new MtxError("stream: not enough data");
      const bitSet = (this.buf[this.pos] & NBIT_MASKS[this.bitPos]) > 0;
      out |= (bitSet ? 1 : 0) << (n - i - 1);
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.pos++;
      }
    }
    return out >>> 0;
  }

  /** 残りを 4 バイト単位で読む。末尾は 0 詰め。データが無ければ null。 */
  readRestAsU32(): number | null {
    if (this.pos >= this.size) return null;
    switch (this.size - this.pos) {
      case 1:
        return (this.readU8() << 24) >>> 0;
      case 2:
        return (this.readU16() << 16) >>> 0;
      case 3:
        return (this.readU24() << 8) >>> 0;
      default:
        return this.readU32();
    }
  }

  /** [beginPos, endPos) の 32bit チェックサム。 */
  checkSum32(beginPos: number, endPos: number): number {
    if (beginPos > endPos) throw new MtxError("stream: checksum bounds");
    if (endPos > this.size) throw new MtxError("stream: not enough data");
    const slice = new Stream(this.buf.subarray(beginPos, endPos), endPos - beginPos);
    let out = 0;
    for (;;) {
      const chunk = slice.readRestAsU32();
      if (chunk === null) break;
      out = (out + chunk) >>> 0;
    }
    return out >>> 0;
  }
}
