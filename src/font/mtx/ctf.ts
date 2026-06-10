/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. Ported from libeot (https://github.com/umanwizard/libeot),
 * Copyright (c) 2013 Brennan T. Vincent; portions originally Monotype Imaging.
 * See ./NOTICE for details (including patent information). */

import { MtxError } from "./bit-reader.js";
import { Stream } from "./stream.js";
import { TRIPLET_ENCODINGS } from "./triplet.js";

// libeot ctf/parseCTF.c + SFNTContainer.c + parseTTF.c の移植。
// 3 つの展開済み CTF ストリームから sfnt (TTF) を再構築する。

const toI16 = (x: number): number => (x << 16) >> 16;

interface SFNTTable {
  tag: string;
  buf: Uint8Array | null;
  bufSize: number;
  offset: number;
  checksum: number;
}

// ---- 255UShort / 255Short (http://www.w3.org/Submission/MTX/) ----

function read255UShort(s: Stream): number {
  const code = s.readU8();
  switch (code) {
    case 253:
      return s.readU16();
    case 255:
      return 253 + s.readU8();
    case 254:
      return 506 + s.readU8();
    default:
      return code;
  }
}

function read255Short(s: Stream): number {
  let code = s.readU8();
  if (code === 253) return s.readS16();
  let sign = 1;
  if (code === 250) {
    sign = -1;
    code = s.readU8();
  }
  let out: number;
  switch (code) {
    case 255:
      out = 250 + s.readU8();
      break;
    case 254:
      out = 500 + s.readU8();
      break;
    default:
      out = code;
  }
  return toI16(out * sign);
}

// ---- Push instruction (HopCode) decoding ----

const enum PushType {
  BYTE,
  SHORT,
}
const NPUSHB = 0x40;
const NPUSHW = 0x41;
const PUSHB = 0xb0;
const PUSHW = 0xb8;

class PushDecoder {
  private lastRead = PushType.BYTE;
  private count = 0;
  private dataIndex = 0;
  private readonly data: Int16Array;

  constructor(
    private readonly out: Stream,
    capacity: number,
  ) {
    this.data = new Int16Array(capacity);
  }

  private dump(): void {
    if (this.count > 0) {
      if (this.count < 8) {
        const op = (this.lastRead === PushType.BYTE ? PUSHB : PUSHW) | (this.count - 1);
        this.out.writeU8(op);
      } else {
        this.out.writeU8(this.lastRead === PushType.BYTE ? NPUSHB : NPUSHW);
        this.out.writeU8(this.count);
      }
      for (let i = 0; i < this.count; i++) {
        const d = this.data[this.dataIndex - this.count + i];
        if (this.lastRead === PushType.BYTE) this.out.writeU8(d & 0xff);
        else this.out.writeS16(d);
      }
    }
  }

  put(value: number): void {
    const newType = value >= 0 && value < 256 ? PushType.BYTE : PushType.SHORT;
    if (newType !== this.lastRead || this.count === 255) {
      this.dump();
      this.lastRead = newType;
      this.count = 0;
    }
    this.data[this.dataIndex++] = value;
    this.count++;
  }

  finish(): void {
    this.dump();
  }

  prevPrev(): number {
    if (this.dataIndex < 2) throw new MtxError("ctf: corrupt hopcode data");
    return this.data[this.dataIndex - 2];
  }
}

function decodePushInstructions(sIn: Stream, out: Stream, pushCount: number): void {
  let remaining = pushCount;
  const pd = new PushDecoder(out, pushCount);
  while (remaining > 0) {
    const code = sIn.peekU8();
    if (code === 0xfb) {
      // A B 0xFB C -> A B A C A
      if (remaining < 3) throw new MtxError("ctf: corrupt hopcode data");
      remaining -= 3;
      const prev = pd.prevPrev();
      sIn.readU8();
      pd.put(prev);
      pd.put(read255Short(sIn));
      pd.put(prev);
    } else if (code === 0xfc) {
      // A B 0xFC C D -> A B A C A D A
      if (remaining < 5) throw new MtxError("ctf: corrupt hopcode data");
      remaining -= 5;
      const prev = pd.prevPrev();
      sIn.readU8();
      pd.put(prev);
      pd.put(read255Short(sIn));
      pd.put(prev);
      pd.put(read255Short(sIn));
      pd.put(prev);
    } else {
      pd.put(read255Short(sIn));
      remaining--;
    }
  }
  pd.finish();
}

// ---- glyf reconstruction ----

function makeFlags(x: number, y: number, onCurve: boolean, firstTime: boolean): number {
  const FLG_ON_CURVE = 0x01;
  const FLG_X_SHORT = 0x02;
  const FLG_Y_SHORT = 0x04;
  const FLG_X_SAME = 0x10;
  const FLG_Y_SAME = 0x20;
  let ret = 0;
  if (onCurve) ret |= FLG_ON_CURVE;
  if (!firstTime && x === 0) {
    ret |= FLG_X_SAME;
  } else if (-256 < x && x < 0) {
    ret |= FLG_X_SHORT;
  } else if (0 <= x && x < 256) {
    ret |= FLG_X_SHORT | FLG_X_SAME;
  }
  if (!firstTime && y === 0) {
    ret |= FLG_Y_SAME;
  } else if (-256 < y && y < 0) {
    ret |= FLG_Y_SHORT;
  } else if (0 <= y && y < 256) {
    ret |= FLG_Y_SHORT | FLG_Y_SAME;
  }
  return ret;
}

function decodeSimpleGlyph(
  numContours: number,
  streams: Stream[],
  out: Stream,
  calculateBoundingBox: boolean,
  minXIn: number,
  minYIn: number,
  maxXIn: number,
  maxYIn: number,
): void {
  if (numContours === 0) return;
  const inS = streams[0];
  let minX = minXIn;
  let minY = minYIn;
  let maxX = maxXIn;
  let maxY = maxYIn;

  out.writeS16(numContours);
  let boundingBoxLocation = 0;
  if (calculateBoundingBox) {
    boundingBoxLocation = out.pos;
    out.seekRelativeThroughReserve(4 * 2);
    minX = 32767;
    minY = 32767;
    maxX = -32768;
    maxY = -32768;
  } else {
    out.writeS16(minX);
    out.writeS16(minY);
    out.writeS16(maxX);
    out.writeS16(maxY);
  }

  let totalPoints = 0;
  for (let i = 0; i < numContours; i++) {
    if (i === 0) totalPoints = 1;
    const pointsInContour = read255UShort(inS);
    totalPoints += pointsInContour;
    out.writeS16(toI16(totalPoints - 1));
  }

  const flags = new Uint8Array(totalPoints);
  const xCoords = new Int16Array(totalPoints);
  const yCoords = new Int16Array(totalPoints);
  for (let i = 0; i < totalPoints; i++) flags[i] = inS.readU8();

  let currX = 0;
  let currY = 0;
  for (let i = 0; i < totalPoints; i++) {
    const enc = TRIPLET_ENCODINGS[flags[i] & 0x7f];
    const moreBytes = enc[0] - 1; // byteCount - 1
    if (inS.pos + moreBytes > inS.size) throw new MtxError("ctf: corrupt glyph");
    const coords = new Stream(inS.buf.subarray(inS.pos, inS.pos + moreBytes), moreBytes);
    const dx = coords.readNBits(enc[1]); // xBits
    const dy = coords.readNBits(enc[2]); // yBits
    if (coords.pos !== coords.size || coords.bitPos !== 0) throw new MtxError("ctf: glyph bits");
    inS.seekRelative(coords.size);
    xCoords[i] = toI16(enc[5] * (dx + enc[3])); // xSign * (dx + deltaX)
    currX = (currX + xCoords[i]) >>> 0;
    yCoords[i] = toI16(enc[6] * (dy + enc[4])); // ySign * (dy + deltaY)
    currY = (currY + yCoords[i]) >>> 0;
    minX = Math.min(minX, toI16(currX));
    maxX = Math.max(maxX, toI16(currX));
    minY = Math.min(minY, toI16(currY));
    maxY = Math.max(maxY, toI16(currY));
  }

  const codeSizeLocation = out.pos;
  out.seekRelativeThroughReserve(2);
  const pushCount = read255UShort(inS);
  decodePushInstructions(streams[1], out, pushCount);
  const codeSize = read255UShort(inS);
  streams[2].copyTo(out, codeSize);
  const unpackedCodeSize = out.pos - (codeSizeLocation + 2);

  for (let i = 0; i < totalPoints; i++) {
    out.writeU8(makeFlags(xCoords[i], yCoords[i], !(flags[i] & 0x80), i === 0));
  }
  for (let i = 0; i < totalPoints; i++) {
    let x = xCoords[i];
    if (i === 0 || x !== 0) {
      if (-256 < x && x < 0) x = -x;
      if (0 <= x && x < 256) out.writeU8(x & 0xff);
      else out.writeS16(x);
    }
  }
  for (let i = 0; i < totalPoints; i++) {
    let y = yCoords[i];
    if (i === 0 || y !== 0) {
      if (-256 < y && y < 0) y = -y;
      if (0 <= y && y < 256) out.writeU8(y & 0xff);
      else out.writeS16(y);
    }
  }

  const currPos = out.pos;
  out.seekAbsoluteThroughReserve(codeSizeLocation);
  out.writeU16(unpackedCodeSize & 0xffff);
  out.seekAbsoluteThroughReserve(currPos);
  if (calculateBoundingBox) {
    const endPos = out.pos;
    out.seekAbsoluteThroughReserve(boundingBoxLocation);
    out.writeS16(minX);
    out.writeS16(minY);
    out.writeS16(maxX);
    out.writeS16(maxY);
    out.seekAbsoluteThroughReserve(endPos);
  }
}

function decodeCompositeGlyph(streams: Stream[], out: Stream): void {
  const FLG_ARGS_WORDS = 0x1;
  const FLG_HAVE_SCALE = 0x8;
  const FLG_MORE_COMPONENTS = 0x20;
  const FLG_HAVE_XY_SCALE = 0x40;
  const FLG_HAVE_2_BY_2 = 0x80;
  const FLG_HAVE_INSTR = 0x100;
  const inS = streams[0];
  out.writeS16(-1);
  out.writeS16(inS.readS16()); // minX
  out.writeS16(inS.readS16()); // minY
  out.writeS16(inS.readS16()); // maxX
  out.writeS16(inS.readS16()); // maxY
  let flags = 0;
  do {
    flags = inS.readU16();
    out.writeU16(flags);
    inS.copyTo(out, 2); // glyph index
    const argsLength = flags & FLG_ARGS_WORDS ? 4 : 2;
    inS.copyTo(out, argsLength);
    let transformBytes = 0;
    if (flags & FLG_HAVE_2_BY_2) transformBytes = 8;
    else if (flags & FLG_HAVE_XY_SCALE) transformBytes = 4;
    else if (flags & FLG_HAVE_SCALE) transformBytes = 2;
    inS.copyTo(out, transformBytes);
  } while (flags & FLG_MORE_COMPONENTS);
  if (flags & FLG_HAVE_INSTR) {
    const numInstrLocation = out.pos;
    out.seekRelativeThroughReserve(2);
    const pushCount = read255UShort(inS);
    decodePushInstructions(streams[1], out, pushCount);
    const codeSize = read255UShort(inS);
    streams[2].copyTo(out, codeSize);
    const numInstr = out.pos - (numInstrLocation + 2);
    if (numInstr > 0) {
      const currPos = out.pos;
      out.seekAbsoluteThroughReserve(numInstrLocation);
      out.writeU16(numInstr & 0xffff);
      out.seekAbsoluteThroughReserve(currPos);
    }
  }
}

function decodeGlyph(streams: Stream[], out: Stream): void {
  const inS = streams[0];
  let numContours = inS.readS16();
  let xMin = 0;
  let yMin = 0;
  let xMax = 0;
  let yMax = 0;
  let calculateBoundingBox = false;
  if (numContours < 0) {
    decodeCompositeGlyph(streams, out);
    return;
  }
  if (numContours === 0x7fff) {
    numContours = inS.readS16();
    xMin = inS.readS16();
    yMin = inS.readS16();
    xMax = inS.readS16();
    yMax = inS.readS16();
  } else {
    calculateBoundingBox = true;
  }
  decodeSimpleGlyph(numContours, streams, out, calculateBoundingBox, xMin, yMin, xMax, yMax);
}

interface HeadData {
  indexToLocFormat: number;
}
interface MaxpData {
  numGlyphs: number;
  maxPoints: number;
  maxContours: number;
  maxSizeOfInstructions: number;
}

function parseHead(tbl: SFNTTable): HeadData {
  if (tbl.bufSize < 52) throw new MtxError("ctf: malformed head table");
  const s = new Stream(tbl.buf, tbl.bufSize);
  s.seekAbsolute(50);
  return { indexToLocFormat: s.readS16() };
}

function parseMaxp(tbl: SFNTTable): MaxpData {
  const s = new Stream(tbl.buf, tbl.bufSize);
  const version = s.readU32();
  const out: MaxpData = {
    numGlyphs: s.readU16(),
    maxPoints: 0,
    maxContours: 0,
    maxSizeOfInstructions: 0,
  };
  if (version === 0x00010000) {
    out.maxPoints = s.readU16();
    out.maxContours = s.readU16();
    s.readU16(); // maxComponentPoints
    s.readU16(); // maxComponentContours
    s.readU16(); // maxZones
    s.readU16(); // maxTwilightPoints
    s.readU16(); // maxStorage
    s.readU16(); // maxFunctionDefs
    s.readU16(); // maxInstructionDefs
    s.readU16(); // maxStackElements
    out.maxSizeOfInstructions = s.readU16();
  }
  return out;
}

function ucvtReadVal(sIn: Stream, lastValue: number): number {
  const code = sIn.readU8();
  let val: number;
  if (code >= 248) val = 238 * (code - 247) + sIn.readU8();
  else if (code >= 239) val = -1 * (238 * (code - 239) + sIn.readU8());
  else if (code === 238) val = sIn.readS16();
  else val = code;
  return toI16(lastValue + val);
}

function unpackCVT(tbl: SFNTTable, sIn: Stream): void {
  sIn.seekAbsolute(tbl.offset);
  const tableLength = sIn.readU16();
  const sOut = new Stream(null, 0);
  sOut.reserve(tableLength * 2);
  let lastValue = 0;
  for (let i = 0; i < tableLength; i++) {
    lastValue = ucvtReadVal(sIn, lastValue);
    sOut.writeS16(lastValue);
  }
  tbl.buf = sOut.buf.subarray(0, sOut.size);
  tbl.bufSize = sOut.size;
}

function populateGlyfAndLoca(
  glyf: SFNTTable,
  loca: SFNTTable,
  headData: HeadData,
  maxpData: MaxpData,
  streams: Stream[],
): void {
  streams[0].seekAbsolute(glyf.offset);
  streams[1].seekAbsolute(0);
  streams[2].seekAbsolute(0);
  const maxSimpleGlyphSize =
    10 + 2 * maxpData.maxContours + 2 + maxpData.maxSizeOfInstructions + maxpData.maxPoints * 5;
  const maxCompoundGlyphSize = 26 + maxpData.maxSizeOfInstructions;
  const maxGlyphSize = Math.max(maxSimpleGlyphSize, maxCompoundGlyphSize);
  const maxTableSize = maxpData.numGlyphs * maxGlyphSize;
  const sOut = new Stream(null, 0);
  sOut.reserve(maxTableSize);
  const sLocaOut = new Stream(null, 0);
  const shortLoca = !headData.indexToLocFormat;
  if (shortLoca) {
    sLocaOut.reserve(2 * (maxpData.numGlyphs + 1));
    sLocaOut.writeU16(0);
  } else {
    sLocaOut.reserve(4 * (maxpData.numGlyphs + 1));
    sLocaOut.writeU32(0);
  }
  for (let i = 0; i < maxpData.numGlyphs; i++) {
    decodeGlyph(streams, sOut);
    if (sOut.pos % 2) sOut.writeU8(0);
    if (shortLoca) sLocaOut.writeU16((sOut.pos / 2) & 0xffff);
    else sLocaOut.writeU32(sOut.pos);
  }
  glyf.buf = sOut.buf.subarray(0, sOut.size);
  glyf.bufSize = sOut.size;
  loca.buf = sLocaOut.buf.subarray(0, sLocaOut.size);
  loca.bufSize = sLocaOut.size;
}

function loadTableFromStream(tbl: SFNTTable, s: Stream): void {
  s.seekAbsolute(tbl.offset);
  const buf = new Uint8Array(tbl.bufSize);
  const sOut = new Stream(buf, 0, tbl.bufSize);
  s.copyTo(sOut, tbl.bufSize);
  tbl.buf = buf;
}

function parseCTF(streams: Stream[]): SFNTTable[] {
  const s0 = streams[0];
  // offset table
  s0.readU32(); // scalarType
  const numTables = s0.readU16();
  s0.readU16(); // searchRange
  s0.readU16(); // entrySelector
  s0.readU16(); // rangeShift

  const tables: SFNTTable[] = [];
  for (let i = 0; i < numTables; i++) {
    let tag = "";
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(s0.readU8());
    if (tag === "hdmx" || tag === "VDMX") {
      s0.seekRelative(12); // skip checksum + offset + length
      continue;
    }
    s0.seekRelative(4); // skip checksum
    const offset = s0.readU32();
    const bufSize = s0.readU32();
    tables.push({ tag, buf: null, bufSize, offset, checksum: 0 });
  }

  let glyf: SFNTTable | null = null;
  let loca: SFNTTable | null = null;
  let maxp: SFNTTable | null = null;
  let head: SFNTTable | null = null;
  let hmtx: SFNTTable | null = null;
  for (const tbl of tables) {
    let loadTable = true;
    if (tbl.tag === "loca") {
      loca = tbl;
      loadTable = false;
    } else if (tbl.tag === "glyf") {
      glyf = tbl;
      loadTable = false;
    } else if (tbl.tag === "maxp") {
      maxp = tbl;
    } else if (tbl.tag === "head") {
      head = tbl;
    } else if (tbl.tag === "hmtx") {
      hmtx = tbl;
    } else if (tbl.tag === "cvt ") {
      unpackCVT(tbl, s0);
      loadTable = false;
    }
    if (loadTable) {
      loadTableFromStream(tbl, s0);
      if (tbl.tag === "head") {
        if (tbl.bufSize < 12) throw new MtxError("ctf: malformed head table");
        // グローバルチェックサムをゼロにする (出力で再計算しないので 0 のまま)
        for (let i = 8; i < 12; i++) tbl.buf![i] = 0;
      }
    }
  }

  if (glyf && !loca) {
    loca = { tag: "loca", buf: null, bufSize: 0, offset: 0, checksum: 0 };
    tables.push(loca);
  }
  if (!maxp) throw new MtxError("ctf: no maxp table");
  if (!head) throw new MtxError("ctf: no head table");
  if (!hmtx) throw new MtxError("ctf: no hmtx table");

  const headData = parseHead(head);
  const maxpData = parseMaxp(maxp);
  if (glyf) {
    populateGlyfAndLoca(glyf, loca!, headData, maxpData, streams);
  }
  return tables;
}

// ---- sfnt serialization (dumpContainer) ----

function maxPow2LE(n: number): number {
  let ret = 1;
  while (n > 1) {
    ret *= 2;
    n = Math.floor(n / 2);
  }
  return ret;
}
function log2Floor(n: number): number {
  let ret = 0;
  while (n > 1) {
    n = Math.floor(n / 2);
    ret++;
  }
  return ret;
}

function writeTblCheckingSum(tbl: SFNTTable, out: Stream): void {
  tbl.checksum = 0;
  tbl.offset = out.pos;
  const tblStream = new Stream(tbl.buf, tbl.bufSize);
  for (;;) {
    const chunk = tblStream.readRestAsU32();
    if (chunk === null) break;
    tbl.checksum = (tbl.checksum + chunk) >>> 0;
    out.writeU32(chunk);
  }
}

function dumpContainer(tables: SFNTTable[]): Uint8Array {
  const numTables = tables.length;
  let requiredSize = 12 + 16 * numTables;
  for (const tbl of tables) requiredSize += ((tbl.bufSize + 3) >> 2) << 2;

  const s = new Stream(null, 0);
  s.reserve(requiredSize);

  // offset table
  const searchRange = maxPow2LE(numTables) * 16;
  s.writeU32(0x00010000);
  s.writeU16(numTables);
  s.writeU16(searchRange);
  s.writeU16(log2Floor(numTables));
  s.writeU16((numTables * 16 - searchRange) & 0xffff);

  const tableDirectoryOffset = s.pos;
  s.seekRelativeThroughReserve(16 * numTables);
  for (const tbl of tables) {
    tbl.offset = s.pos;
    writeTblCheckingSum(tbl, s);
  }

  // table directory
  s.seekAbsolute(tableDirectoryOffset);
  for (const tbl of tables) {
    for (let i = 0; i < 4; i++) s.writeU8(tbl.tag.charCodeAt(i) & 0xff);
    s.writeU32(tbl.checksum);
    s.writeU32(tbl.offset);
    s.writeU32(tbl.bufSize);
  }
  // (libeot computes a global checksum but writes it to the now-detached head
  //  buffer, so the emitted file keeps checkSumAdjustment = 0 — replicate that.)

  return s.buf.subarray(0, s.size);
}

/** 3 つの CTF ストリーム (展開済み) から TTF バイト列を再構築する。 */
export function ctfToTtf(ctfBuffers: [Uint8Array, Uint8Array, Uint8Array]): Uint8Array {
  const streams = ctfBuffers.map((b) => new Stream(b, b.length));
  const tables = parseCTF(streams);
  return dumpContainer(tables);
}
