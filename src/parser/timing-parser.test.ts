import { describe, expect, it } from "vitest";

import { parseTiming } from "./timing-parser.js";

// mainSeq の childTnLst にクリックグループ par を並べた slide XML を組み立てる。
// 各 clickGroup は「効果 (cTn[presetClass]) > set > cBhvr > tgtEl > spTgt」の入れ子。
function effect(presetClass: string, spids: string[]): string {
  const sets = spids
    .map(
      (spid) =>
        `<p:set><p:cBhvr><p:cTn dur="1"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
        `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
        `<p:to><p:strVal val="visible"/></p:to></p:set>`,
    )
    .join("");
  return (
    `<p:par><p:cTn presetClass="${presetClass}" nodeType="clickEffect">` +
    `<p:childTnLst>${sets}</p:childTnLst></p:cTn></p:par>`
  );
}

function clickGroup(effects: string): string {
  return (
    `<p:par><p:cTn fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>` +
    `<p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`
  );
}

function slideWithTiming(clickGroups: string[]): string {
  return (
    `<p:sld xmlns:p="ns" xmlns:a="ns"><p:cSld><p:spTree/></p:cSld>` +
    `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1"><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>` +
    clickGroups.join("") +
    `</p:childTnLst></p:cTn></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`
  );
}

describe("parseTiming", () => {
  it("returns null when there is no timing element", () => {
    const xml = `<p:sld xmlns:p="ns"><p:cSld><p:spTree/></p:cSld></p:sld>`;
    expect(parseTiming(xml)).toBeNull();
  });

  it("returns null when there is no mainSeq", () => {
    const xml =
      `<p:sld xmlns:p="ns"><p:cSld><p:spTree/></p:cSld>` +
      `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"/></p:par></p:tnLst></p:timing></p:sld>`;
    expect(parseTiming(xml)).toBeNull();
  });

  it("extracts one entrance step per click in order", () => {
    const xml = slideWithTiming([
      clickGroup(effect("entr", ["5"])),
      clickGroup(effect("entr", ["6"])),
      clickGroup(effect("entr", ["7"])),
    ]);
    expect(parseTiming(xml)).toEqual([
      { revealedIds: ["5"], hiddenIds: [] },
      { revealedIds: ["6"], hiddenIds: [] },
      { revealedIds: ["7"], hiddenIds: [] },
    ]);
  });

  it("classifies entrance and exit within a step", () => {
    const xml = slideWithTiming([clickGroup(effect("entr", ["5"]) + effect("exit", ["3"]))]);
    expect(parseTiming(xml)).toEqual([{ revealedIds: ["5"], hiddenIds: ["3"] }]);
  });

  it("ignores emphasis and motion-path effects", () => {
    const xml = slideWithTiming([
      clickGroup(effect("emph", ["5"])),
      clickGroup(effect("path", ["6"])),
      clickGroup(effect("entr", ["7"])),
    ]);
    // emphasis/motion produce no visibility change → only the entrance step remains
    expect(parseTiming(xml)).toEqual([{ revealedIds: ["7"], hiddenIds: [] }]);
  });

  it("collects multiple targets and dedupes within a step", () => {
    const xml = slideWithTiming([clickGroup(effect("entr", ["5", "6", "5"]))]);
    const steps = parseTiming(xml);
    expect(steps).toHaveLength(1);
    expect(steps?.[0].revealedIds.sort()).toEqual(["5", "6"]);
  });

  it("merges multiple effects in a single click group", () => {
    const xml = slideWithTiming([clickGroup(effect("entr", ["5"]) + effect("entr", ["6"]))]);
    const steps = parseTiming(xml);
    expect(steps).toHaveLength(1);
    expect(steps?.[0].revealedIds.sort()).toEqual(["5", "6"]);
  });
});
