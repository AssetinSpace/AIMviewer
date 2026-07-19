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
| wall centerline loop | `IfcSpace` (aggregated to storey) | polyline footprint chained from wall segments; bbox fallback if the loop won't close |
| `walls[]` | `IfcWall` | extruded rectangle: width × nominal **0.10 m** thickness × height |
| `doors[]` | `IfcDoor` + `IfcOpeningElement` | leaf box (0.05 m) **cuts the host wall** via `IfcRelVoidsElement`/`IfcRelFillsElement`; `OverallWidth/Height` set |
| `windows[]` | `IfcWindow` + `IfcOpeningElement` | same voiding as doors (sill height falls out of `center.y − h/2`) |
| `objects[]` | `IfcFurnishingElement` | oriented bounding box; category kept in `Name`/`Description` |
| `parentIdentifier` | host-wall resolution | door/window → wall it voids; nearest-wall fallback when unresolved |
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
- **Space footprint chains wall centerlines** with a 5 cm endpoint tolerance — real
  scans with gaps/overlaps beyond that fall back to the bounding box (over-covers
  non-convex rooms). No wall corner mitring/joining.
- **Furniture = 16-category bounding boxes** — no meshes; sanitary/appliance
  categories are not yet split into finer IFC classes (`IfcSanitaryTerminal`…).
- **RoomPlan accuracy is approximate, not survey-grade** (±cm, rectangle-snapped).
- **Schema is reverse-engineered** — flat-16 column-major transforms per community
  samples (converter also accepts nested 4×4); re-verify against a real device
  export, fields flagged ⚠️ in the schema doc.

## ETL ingestion (proven, dry-run)

The generated IFC is ingestible by the production AIM ETL. From the repo root:

```bash
pip install -r ../../../etl/requirements.txt   # or just: ifcopenshell python-dotenv
python -m etl.main --file experiments/roomplan-to-ifc/converter/out/room_with_furniture.ifc --dry-run
```

`--dry-run` needs no `DATABASE_URL` and never writes. It stages site/building/floor/
space + 10 assets (walls, door, window, furniture); openings are correctly excluded
by the D-034 import scope filter and refs fall back to `ifc_guid` (no SNIM Assembly
Code in the synthetic Names — counted, not an error). Committed output:
[`converter/etl_dryrun.log`](converter/etl_dryrun.log). This stays a **dry-run
experiment** — no writes to the production model.

## No Mac? Off-the-shelf scanner path

Building the Track B Swift app needs Xcode (macOS). The **converter is pure Python
and needs no Mac** — so without one, capture with an off-the-shelf App Store app on a
LiDAR iPhone/iPad instead of our own app, export a standard format, and adapt the
converter's input to it. `inspect_scan.py` reports the structure of a real export so
the adapter is written against real data, not guesses:

```bash
pip install usd-core trimesh          # optional, only for inspecting scans
python3 inspect_scan.py <scan.usdz|scan.obj|scan.json>
```

- **USDZ from a RoomPlan-based app** (e.g. Polycam Spaces) is the best case — it can
  keep walls/doors/windows/objects as separate named prims, close to our JSON.
- **Raw mesh** (OBJ/PLY/GLB) has no labelled openings; converting it to IFC walls
  needs plane segmentation (a separate, larger step — not MVP).
- **Apple `CapturedRoom` JSON** feeds `roomplan_to_ifc.py` directly.

## Stretch goals (not blockers)

Multi-room/multi-storey merge, `floors[]`-driven space footprints, wall corner
joining, finer object→IFC class mapping, real (non-dry-run) ETL load. Out of scope
for the MVP: any backend/upload service, AIM Viewer integration.

**Done since the MVP:** opening voids (doors/windows cut their host wall), true
polyline space footprint for the L-shape, ETL dry-run proof.
