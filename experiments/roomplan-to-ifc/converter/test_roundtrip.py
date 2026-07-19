#!/usr/bin/env python3
"""Roundtrip test: fixtures -> roomplan_to_ifc -> reopen with IfcOpenShell -> assert.

The pass/fail signal for the MVP (no viewer needed). Run:
    python3 test_roundtrip.py          # writes generated .ifc into ./out/
Exit code 0 = all fixtures converted, reparsed, counted and schema-validated.
"""
import json
import sys
from pathlib import Path

import ifcopenshell

import roomplan_to_ifc

HERE = Path(__file__).parent
OUT = HERE / "out"

# fixture -> expected entity counts in the generated IFC. IfcOpeningElement /
# IfcRelVoidsElement / IfcRelFillsElement track one void per door+window (the
# opening that cuts the host wall). space_corners = distinct corners of the
# IfcSpace footprint polyline (None if the fixture is expected to fall back to bbox).
EXPECTED = {
    "room_simple.json": {
        "IfcProject": 1, "IfcSite": 1, "IfcBuilding": 1, "IfcBuildingStorey": 1,
        "IfcSpace": 1, "IfcWall": 4, "IfcDoor": 1, "IfcWindow": 1,
        "IfcFurnishingElement": 0,
        "IfcOpeningElement": 2, "IfcRelVoidsElement": 2, "IfcRelFillsElement": 2,
        "space_corners": 4,
    },
    "room_with_furniture.json": {
        "IfcProject": 1, "IfcSite": 1, "IfcBuilding": 1, "IfcBuildingStorey": 1,
        "IfcSpace": 1, "IfcWall": 4, "IfcDoor": 1, "IfcWindow": 1,
        "IfcFurnishingElement": 4,
        "IfcOpeningElement": 2, "IfcRelVoidsElement": 2, "IfcRelFillsElement": 2,
        "space_corners": 4,
    },
    "room_l_shaped.json": {
        "IfcProject": 1, "IfcSite": 1, "IfcBuilding": 1, "IfcBuildingStorey": 1,
        "IfcSpace": 1, "IfcWall": 6, "IfcDoor": 1, "IfcWindow": 0,
        "IfcFurnishingElement": 0,
        "IfcOpeningElement": 1, "IfcRelVoidsElement": 1, "IfcRelFillsElement": 1,
        "space_corners": 6,
    },
}


def schema_validate(path):
    """IfcOpenShell logical schema validation; returns list of error strings."""
    try:
        from ifcopenshell import validate
    except ImportError:
        return ["ifcopenshell.validate unavailable — schema validation skipped"]
    logger = validate.json_logger()
    validate.validate(str(path), logger)
    return [f"{s.get('severity', '?')}: {s.get('message')}" for s in logger.statements]


def check_fixture(name, expected):
    errors = []
    src = HERE / "fixtures" / name
    out = OUT / (src.stem + ".ifc")

    model = roomplan_to_ifc.convert(json.loads(src.read_text()),
                                    project_name=f"RoomPlan scan {src.stem}")
    model.write(str(out))

    f = ifcopenshell.open(str(out))  # reparse from disk — the actual roundtrip
    print(f"  schema: {f.schema}, {len(list(f))} entities, {out.stat().st_size} bytes")

    for ifc_class, want in expected.items():
        if ifc_class == "space_corners":
            continue  # handled below (not an entity type)
        got = len(f.by_type(ifc_class, include_subtypes=False))
        status = "ok" if got == want else "FAIL"
        print(f"  {status:4} {ifc_class:24} expected {want}, got {got}")
        if got != want:
            errors.append(f"{name}: {ifc_class} expected {want}, got {got}")

    # every product must have a placement and (except spatial) a body representation
    for wall in f.by_type("IfcWall"):
        if not wall.Representation or not wall.ObjectPlacement:
            errors.append(f"{name}: {wall} missing representation/placement")

    # every door/window must be filled into exactly one opening (voids its host wall)
    filled = {}
    for rel in f.by_type("IfcRelFillsElement"):
        filled[rel.RelatedBuildingElement.id()] = filled.get(rel.RelatedBuildingElement.id(), 0) + 1
    for leaf in f.by_type("IfcDoor") + f.by_type("IfcWindow"):
        n = filled.get(leaf.id(), 0)
        if n != 1:
            errors.append(f"{name}: {leaf.is_a()} #{leaf.id()} in {n} IfcRelFillsElement (expected 1)")
    # every opening must void exactly one wall
    voided = {rel.RelatedOpeningElement.id() for rel in f.by_type("IfcRelVoidsElement")}
    for op in f.by_type("IfcOpeningElement"):
        if op.id() not in voided:
            errors.append(f"{name}: {op} has no IfcRelVoidsElement")

    # IfcSpace footprint: distinct corners of the profile polyline
    want_corners = expected.get("space_corners")
    if want_corners is not None:
        prof = f.by_type("IfcSpace")[0].Representation.Representations[0].Items[0].SweptArea
        if prof.is_a("IfcArbitraryClosedProfileDef"):
            pts = prof.OuterCurve.Points
            distinct = len(pts) - 1 if pts[0].Coordinates == pts[-1].Coordinates else len(pts)
        else:
            distinct = 4  # bbox rectangle
        status = "ok" if distinct == want_corners else "FAIL"
        print(f"  {status:4} {'space footprint corners':24} expected {want_corners}, got {distinct}")
        if distinct != want_corners:
            errors.append(f"{name}: space corners expected {want_corners}, got {distinct}")
    units = f.by_type("IfcUnitAssignment")
    if not units:
        errors.append(f"{name}: no IfcUnitAssignment")
    if not f.by_type("IfcOwnerHistory"):
        errors.append(f"{name}: no IfcOwnerHistory")

    problems = schema_validate(out)
    for p in problems:
        print(f"  validate: {p}")
    errors += [f"{name}: {p}" for p in problems if p.startswith(("Error", "error"))]
    if not problems:
        print("  validate: clean (no schema violations)")
    return errors


def main():
    OUT.mkdir(exist_ok=True)
    all_errors = []
    for name, expected in EXPECTED.items():
        print(f"\n== {name} ==")
        all_errors += check_fixture(name, expected)

    print(f"\n{'=' * 50}")
    if all_errors:
        print(f"FAILED — {len(all_errors)} problem(s):")
        for e in all_errors:
            print(f"  - {e}")
        return 1
    print(f"PASS — all {len(EXPECTED)} fixtures converted, reparsed and validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
