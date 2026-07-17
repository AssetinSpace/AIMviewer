import { describe, expect, it } from "vitest";

import { buildDecorations } from "./decoration-counts";

describe("buildDecorations", () => {
  const guidMap = { G1: "o1", G2: "o2", G3: "o3" };

  it("agreguje počty per GUID podľa typu väzby", () => {
    const out = buildDecorations(
      guidMap,
      ["o1", "o1", "o2"], // dokumenty
      ["o1"], // zodpovednosti
      ["o3", "o3"] // snímky (priestor)
    );
    expect(out).toEqual({
      G1: { d: 2, r: 1 },
      G2: { d: 1 },
      G3: { c: 2 },
    });
  });

  it("objekty bez GUID ticho vynechá", () => {
    const out = buildDecorations(guidMap, ["neznamy"], [], []);
    expect(out).toEqual({});
  });

  it("prázdne vstupy → prázdna mapa", () => {
    expect(buildDecorations(guidMap, [], [], [])).toEqual({});
    expect(buildDecorations({}, ["o1"], ["o1"], ["o1"])).toEqual({});
  });
});
