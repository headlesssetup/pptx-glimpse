import type { BuildStep } from "../model/slide.js";
import type { XmlNode } from "./xml-parser.js";
import { parseXml } from "./xml-parser.js";

// PowerPoint のクリックアニメーション (p:timing) を解析し、ビルドステップ列に変換する。
//
// 対応範囲: メインシーケンス (nodeType="mainSeq") 配下の、クリックで進行する
//   entrance (presetClass="entr") / exit (presetClass="exit") 効果のみ。
//   emphasis / motion path / メディア等は視覚的な表示・非表示を伴わないため無視する。
//
// timing ツリーのおおまかな構造:
//   timing > tnLst > par > cTn(tmRoot) > childTnLst > seq > cTn(mainSeq)
//     > childTnLst > par(クリックグループ)* > ... > cTn(presetClass を持つ効果)
//       > ... > cBhvr > tgtEl > spTgt[@spid]
//
// mainSeq の childTnLst 直下の各 par が「クリック 1 回」に対応する。

/**
 * スライド XML からクリックアニメーションのビルドステップ列を抽出する。
 * timing 要素が無い、または mainSeq が無い場合は null を返す
 * (呼び出し側は単一フレームにフォールバックする)。
 */
export function parseTiming(slideXml: string): BuildStep[] | null {
  const parsed = parseXml(slideXml);
  const sld = parsed.sld as XmlNode | undefined;
  const timing = sld?.timing as XmlNode | undefined;
  if (!timing) return null;

  const mainSeq = findNodeWithAttr(timing, "@_nodeType", "mainSeq");
  if (!mainSeq) return null;

  const childTnLst = mainSeq.childTnLst as XmlNode | undefined;
  const clickGroups = asArray(childTnLst?.par);
  if (clickGroups.length === 0) return null;

  const steps: BuildStep[] = [];
  for (const clickGroup of clickGroups) {
    const revealed = new Set<string>();
    const hidden = new Set<string>();

    // クリックグループ内のすべての効果ノード (presetClass を持つ cTn) を収集
    const effects: XmlNode[] = [];
    collectPresetEffects(clickGroup, effects);

    for (const effect of effects) {
      const presetClass = effect["@_presetClass"];
      if (presetClass !== "entr" && presetClass !== "exit") continue;

      const spids = new Set<string>();
      collectSpids(effect, spids);
      const target = presetClass === "entr" ? revealed : hidden;
      for (const spid of spids) target.add(spid);
    }

    // 表示・非表示の変化が無いクリック (emphasis のみ等) はフレームを生まないため省く
    if (revealed.size === 0 && hidden.size === 0) continue;
    steps.push({ revealedIds: [...revealed], hiddenIds: [...hidden] });
  }

  return steps.length > 0 ? steps : null;
}

/** 指定属性が指定値に一致する最初のノード (オブジェクト) を深さ優先で探索する */
function findNodeWithAttr(node: unknown, attr: string, value: string): XmlNode | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNodeWithAttr(item, attr, value);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as XmlNode;
    if (obj[attr] === value) return obj;
    for (const child of Object.values(obj)) {
      const found = findNodeWithAttr(child, attr, value);
      if (found) return found;
    }
  }
  return null;
}

/** presetClass 属性を持つ cTn ノードをすべて収集する */
function collectPresetEffects(node: unknown, out: XmlNode[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPresetEffects(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as XmlNode;
    if (obj["@_presetClass"] !== undefined) out.push(obj);
    for (const child of Object.values(obj)) collectPresetEffects(child, out);
  }
}

/** ノード配下のすべての spTgt/@spid を収集する */
function collectSpids(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSpids(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as XmlNode;
    for (const spTgt of asArray(obj.spTgt)) {
      const spid = spTgt["@_spid"];
      if (typeof spid === "string" || typeof spid === "number") out.add(String(spid));
    }
    for (const child of Object.values(obj)) collectSpids(child, out);
  }
}

/** 単一オブジェクト・配列・undefined を常に配列に正規化する */
function asArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value as XmlNode[];
  if (value && typeof value === "object") return [value as XmlNode];
  return [];
}
