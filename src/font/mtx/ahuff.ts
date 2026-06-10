/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. Ported from libeot (https://github.com/umanwizard/libeot),
 * Copyright (c) 2013 Brennan T. Vincent; portions originally Monotype Imaging.
 * See ./NOTICE for details (including patent information). */

import { type BitReader, bitsUsed } from "./bit-reader.js";

const ROOT = 1;

/**
 * libeot AHUFF (適応型ハフマン) のデコード側の移植。
 * ツリーは struct-of-arrays で保持する。インデックス 1 が ROOT、
 * 内部ノードは 1..range-1、葉は range..2*range-1。
 */
export class AdaptiveHuffman {
  private readonly bio: BitReader;
  // ツリー (長さ 2*range)
  private readonly up: Int32Array;
  private readonly left: Int32Array;
  private readonly right: Int32Array;
  private readonly code: Int32Array;
  private readonly weight: Int32Array;
  private readonly symbolIndex: Int32Array; // 長さ range

  constructor(bio: BitReader, rangeIn: number) {
    this.bio = bio;
    const range = rangeIn;

    let bitCount2 = 0;
    if (rangeIn > 256 && rangeIn < 512) {
      const r = rangeIn - 256;
      bitCount2 = bitsUsed(r - 1) + 1;
    }

    const n = 2 * range;
    this.up = new Int32Array(n);
    this.left = new Int32Array(n);
    this.right = new Int32Array(n);
    this.code = new Int32Array(n);
    this.weight = new Int32Array(n);
    this.symbolIndex = new Int32Array(range);

    // ツリー初期化
    for (let i = 2; i < n; i++) {
      this.up[i] = i >> 1; // 整数除算
      this.weight[i] = 1;
    }
    for (let i = 1; i < range; i++) {
      this.left[i] = 2 * i;
      this.right[i] = 2 * i + 1;
    }
    for (let i = 0; i < range; i++) {
      this.code[i] = -1;
      this.code[range + i] = i;
      this.left[range + i] = -1;
      this.right[range + i] = -1;
      this.symbolIndex[i] = range + i;
    }

    this.initWeight(ROOT);

    // 初期重みの設定 (libeot のコンストラクタと同じ手順)
    if (bitCount2 !== 0) {
      this.updateWeight(this.symbolIndex[256]);
      this.updateWeight(this.symbolIndex[257]);
      for (let i = 0; i < 12; i++) this.updateWeight(this.symbolIndex[range - 3]);
      for (let i = 0; i < 6; i++) this.updateWeight(this.symbolIndex[range - 2]);
    } else {
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < range; i++) this.updateWeight(this.symbolIndex[i]);
      }
    }
  }

  /** 子の重みの和を内部ノードに設定する (再帰)。 */
  private initWeight(a: number): number {
    if (this.code[a] < 0) {
      this.weight[a] = this.initWeight(this.left[a]) + this.initWeight(this.right[a]);
    }
    return this.weight[a];
  }

  /** ノード a と b を入れ替える (up は不変)。 */
  private swapNodes(a: number, b: number): void {
    // libeot はノード全体を swap した後 up を元に戻す → 実質 up は不変。
    // よって left/right/code/weight のみ入れ替える。
    swap(this.left, a, b);
    swap(this.right, a, b);
    swap(this.code, a, b);
    swap(this.weight, a, b);

    const codeA = this.code[a];
    if (codeA < 0) {
      this.up[this.left[a]] = a;
      this.up[this.right[a]] = a;
    } else {
      this.symbolIndex[codeA] = a;
    }
    const codeB = this.code[b];
    if (codeB < 0) {
      this.up[this.left[b]] = b;
      this.up[this.right[b]] = b;
    } else {
      this.symbolIndex[codeB] = b;
    }
  }

  /** インデックス a とその祖先の重みを更新する (兄弟規則を維持)。 */
  private updateWeight(aIn: number): void {
    let a = aIn;
    for (; a !== ROOT; a = this.up[a]) {
      let weightA = this.weight[a];
      let b = a - 1;
      if (this.weight[b] === weightA) {
        do {
          b--;
        } while (this.weight[b] === weightA);
        b++;
        if (b > ROOT) {
          this.swapNodes(a, b);
          a = b;
        }
      }
      weightA = weightA + 1;
      this.weight[a] = weightA;
    }
    // a === ROOT
    this.weight[a] = this.weight[a] + 1;
  }

  /** 1 シンボルを読み取る。 */
  readSymbol(): number {
    let a = ROOT;
    let symbol: number;
    do {
      a = this.bio.inputBit() ? this.right[a] : this.left[a];
      symbol = this.code[a];
    } while (symbol < 0);
    this.updateWeight(a);
    return symbol;
  }
}

function swap(arr: Int32Array, a: number, b: number): void {
  const t = arr[a];
  arr[a] = arr[b];
  arr[b] = t;
}
