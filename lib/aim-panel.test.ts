import { describe, expect, it } from "vitest";

import { nodeSummaryToAimPanel, type ElementDetail } from "./aim-panel";

const baseSummary: ElementDetail = {
  id: "o1",
  objectType: "asset",
  route: "node",
  name: "VZT jednotka",
  objectRef: "VZT-001",
  ifcType: "IfcUnitaryEquipment",
  predefinedType: null,
  userDefinedType: null,
  type: null,
  documents: [
    { id: "d1", name: "Manuál", objectRef: null, role: "manual", isDrawing: false },
  ],
  counts: { classifications: 2, occurrences: 0 },
};

describe("nodeSummaryToAimPanel (v2, D-076)", () => {
  it("mapuje v2 sekcie: zodpovednosti, capture súhrn, históriu GUID", () => {
    const detail: ElementDetail = {
      ...baseSummary,
      responsibilities: [
        {
          actorId: "p1",
          actorType: "person",
          actorName: "Ján Kováč",
          actorRef: null,
          role: "maintainer",
          validFrom: null,
          validUntil: null,
          org: { id: "org1", name: "Servis s.r.o." },
        },
      ],
      guidHistory: [
        {
          id: "h1",
          ifcGuid: "GUID-A",
          validFrom: "2026-07-12T09:31:00Z",
          validUntil: null,
          source: "etl",
          active: true,
        },
      ],
      captures: { spaceId: "s1", spaceName: "Miestnosť 201", count: 3 },
    };

    const panel = nodeSummaryToAimPanel(detail, "GUID-A");

    expect(panel.version).toBe(2);
    expect(panel.responsibilities).toEqual([
      { name: "Ján Kováč", role: "maintainer", org: "Servis s.r.o.", href: "/node/p1" },
    ]);
    expect(panel.captures).toEqual({ count: 3, href: "/ifc?captures=s1" });
    expect(panel.history).toEqual([
      { guid: "GUID-A", validFrom: "2026-07-12", validUntil: undefined, active: true },
    ]);
    // Akcia Reality Capture ostáva (parita s D-073).
    expect(panel.actions?.some((a) => a.label === "Reality Capture (3)")).toBe(true);
  });

  it("bez obohatenia vracia panel bez v2 sekcií (spätná kompatibilita)", () => {
    const panel = nodeSummaryToAimPanel(baseSummary, "GUID-A");
    expect(panel.version).toBe(2);
    expect(panel.responsibilities).toBeUndefined();
    expect(panel.captures).toBeUndefined();
    expect(panel.history).toBeUndefined();
    expect(panel.title).toBe("VZT jednotka");
    expect(panel.documents).toHaveLength(1);
    expect(panel.actions?.[0]).toEqual({
      label: "Otvoriť celý detail",
      href: "/node/o1",
      primary: true,
    });
  });

  it("explicitný captures parameter má prednosť pred detail.captures", () => {
    const panel = nodeSummaryToAimPanel(
      { ...baseSummary, captures: { spaceId: "sX", spaceName: null, count: 1 } },
      "GUID-A",
      { spaceId: "s1", spaceName: null, count: 5 }
    );
    expect(panel.captures).toEqual({ count: 5, href: "/ifc?captures=s1" });
  });
});
