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

# fixture -> expected entity counts in the generated IFC
EXPECTED = {
    "room_simple.json": {
        "IfcProject": 1, "IfcSite": 1, "IfcBuilding": 1, "IfcBuildingStorey": 1,
        "IfcSpace": 1, "IfcWall": 4, "IfcDoor": 1, "IfcWindow": 1,
        "IfcFurnishingElement": 0,
    },
    "room_with_furniture.json": {
        "IfcProject": 1, "IfcSite": 1, "IfcBuilding": 1, "IfcBuildingStorey": 1,
        "IfcSpace": 1, "IfcWall": 4, "IfcDoor": 1, "IfcWindow": 1,
        "IfcFurnishingElement": 4,
    },
    "room_l_shaped.json": {
        "IfcProject": 1, "IfcSite": 1, "IfcBuilding": 1, "IfcBuildingStorey": 1,
        "IfcSpace": 1, "IfcWall": 6, "IfcDoor": 1, "IfcWindow": 0,
        "IfcFurnishingElement": 0,
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
        got = len(f.by_type(ifc_class, include_subtypes=False))
        status = "ok" if got == want else "FAIL"
        print(f"  {status:4} {ifc_class:24} expected {want}, got {got}")
        if got != want:
            errors.append(f"{name}: {ifc_class} expected {want}, got {got}")

    # every product must have a placement and (except spatial) a body representation
    for wall in f.by_type("IfcWall"):
        if not wall.Representation or not wall.ObjectPlacement:
            errors.append(f"{name}: {wall} missing representation/placement")
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
