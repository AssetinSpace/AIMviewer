# RoomPlan → IFC experiment (D-078)

**Proof of concept:** an iPhone LiDAR room scan (Apple RoomPlan) converted into a
minimal valid IFC4 file that our existing stack (IfcOpenShell + web-ifc) can load.
**Throwaway/exploratory code** — isolated in `experiments/`, no contact with the AIM
Viewer data model, bitemporal fact tables or production DB. Decision record: D-078
in `../../DECISIONS.md`.

```
converter/     Track A — CapturedRoom JSON → IFC4 (Python, ifcopenshell)  ✅ tested headless
ios-scanner/   Track B — SwiftUI RoomPlan scanner producing that JSON     ⚠️ untested scaffold
```

## Quick start (Track A)

```bash
pip install ifcopenshell                      # tested with 0.8.5, Python 3.11
cd converter
python3 test_roundtrip.py                     # 3 fixtures → IFC → reparse → assert; log: test_output.log
python3 roomplan_to_ifc.py fixtures/room_simple.json -o out/demo.ifc   # single file
npm install && node webifc_check.mjs          # optional: web-ifc parser smoke check
```

Committed proof: [`converter/test_output.log`](converter/test_output.log) (roundtrip
PASS) and [`converter/webifc_output.log`](converter/webifc_output.log) (web-ifc PASS).

## JSON schema reference

Apple publishes no JSON Schema for `CapturedRoom` — only Swift `Codable` structs.
The reverse-engineered reference (encoding rules, field tables, coordinate system,
the ~16-category object catalog) lives in
[`converter/ROOMPLAN_SCHEMA.md`](converter/ROOMPLAN_SCHEMA.md). Synthetic fixtures
matching it are in `converter/fixtures/` (regenerable via `make_fixtures.py`):
`room_simple` (4 walls + door + window), `room_with_furniture` (+ table, 2 chairs,
sofa), `room_l_shaped` (6-wall L footprint).

## Mapping decisions (RoomPlan → IFC4)

| RoomPlan | IFC | Notes |
|---|---|---|
| capture | `IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey` | fixed single-storey hierarchy |
| wall extents (plan bbox) | `IfcSpace` (aggregated to storey) | axis-aligned bbox of wall centerlines |
| `walls[]` | `IfcWall` | extruded rectangle: width × nominal **0.10 m** thickness × height |
| `doors[]` | `IfcDoor` | standalone box at own transform, 0.05 m leaf; `OverallWidth/Height` set |
| `windows[]` | `IfcWindow` | same as doors (sill height falls out of `center.y − h/2`) |
| `objects[]` | `IfcFurnishingElement` | oriented bounding box; category kept in `Name`/`Description` |
| `openings[]`, `floors[]`, `sections[]` | *ignored* | space footprint derives from walls instead |
| identifier + confidence | pset `AIM_RoomPlanCapture` | provenance on every element |

Coordinates: ARKit is Y-up right-handed, IFC is Z-up → `(x, y, z) → (x, −z, y)`.
RoomPlan transforms position element **centers**; base elevation = `center.y − h/2`.
Placement = `IfcLocalPlacement` chain (site→building→storey→element) with plan
rotation from the transform's local X column; geometry = `IfcExtrudedAreaSolid`
(SweptSolid), meters, full `IfcOwnerHistory` + SI unit assignment.

## Known limitations

- **Rectangular-wall assumption** — every surface is a straight extruded box;
  `curve`/`polygonCorners` (curved & non-rect walls) are ignored.
- **Nominal wall thickness** (0.10 m) — RoomPlan surfaces are zero-thickness planes.
- **Doors/windows don't cut the wall** — standalone elements overlapping the wall
  body; no `IfcOpeningElement`/`IfcRelVoidsElement`/`IfcRelFillsElement`.
- **Space is a plan bounding box** — over-covers non-convex rooms (L-shape).
- **Furniture = 16-category bounding boxes** — no meshes; sanitary/appliance
  categories are not yet split into finer IFC classes (`IfcSanitaryTerminal`…).
- **RoomPlan accuracy is approximate, not survey-grade** (±cm, rectangle-snapped).
- **Schema is reverse-engineered** — flat-16 column-major transforms per community
  samples (converter also accepts nested 4×4); re-verify against a real device
  export, fields flagged ⚠️ in the schema doc.

## Stretch goals (not blockers)

Proper opening voids, multi-room/multi-storey merge, `floors[]`-driven space
footprints, finer object→IFC class mapping, direct ETL ingestion into AIM.
Out of scope for the MVP: any backend/upload service, AIM Viewer integration.
