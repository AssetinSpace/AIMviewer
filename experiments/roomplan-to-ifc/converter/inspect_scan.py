#!/usr/bin/env python3
"""Inspect a real LiDAR scan export and report its structure.

For the no-Mac path (D-078 follow-up): you scan with an off-the-shelf App Store
app (Polycam / Scaniverse / …) instead of building the Swift app, then hand the
export here so the converter can be adapted to that exact format — no guessing.

Supported inputs:
  *.usd / *.usda / *.usdc / *.usdz  — via usd-core (pxr). Best case: a RoomPlan-
      based app keeps walls/doors/windows/objects as separate named prims.
  *.obj / *.ply / *.glb / *.gltf / *.stl — via trimesh. Raw mesh (no wall/opening
      structure); reported so we know a segmentation step would be needed.
  *.json — assumed Apple CapturedRoom; delegates to the existing schema.

Usage: python3 inspect_scan.py <scan-file>
Prints a structure report; writes nothing. Share the output (or the file) so the
converter's input adapter can be written against real data.
"""
import json
import sys
from pathlib import Path


def inspect_usd(path):
    from pxr import Usd, UsdGeom, Gf

    stage = Usd.Stage.Open(str(path))
    if stage is None:
        print(f"  could not open USD stage: {path}")
        return
    print(f"  USD stage: {path.name}")
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage)
    print(f"  upAxis={up}  metersPerUnit={mpu}")

    # tally prim types and surface anything that looks like a room element
    type_counts, named = {}, []
    keywords = ("wall", "door", "window", "opening", "floor", "object",
                "chair", "table", "sofa", "storage", "sink")
    for prim in stage.Traverse():
        tname = prim.GetTypeName() or "(untyped)"
        type_counts[tname] = type_counts.get(tname, 0) + 1
        pname = prim.GetName().lower()
        path_str = str(prim.GetPath()).lower()
        if any(k in pname or k in path_str for k in keywords):
            entry = {"path": str(prim.GetPath()), "type": str(tname)}
            # bounding box (local, all purposes) — gives dimensions when present
            try:
                bbox = UsdGeom.Imageable(prim).ComputeWorldBound(
                    Usd.TimeCode.Default(), UsdGeom.Tokens.default_)
                rng = bbox.ComputeAlignedRange()
                if not rng.IsEmpty():
                    size = rng.GetSize()
                    entry["size"] = [round(size[0], 3), round(size[1], 3), round(size[2], 3)]
            except Exception:
                pass
            named.append(entry)

    print("  prim types:")
    for t, n in sorted(type_counts.items(), key=lambda kv: -kv[1]):
        print(f"    {n:4}  {t}")
    if named:
        print(f"  room-like prims ({len(named)}):")
        for e in named[:60]:
            sz = f"  size={e['size']}" if "size" in e else ""
            print(f"    {e['type']:14} {e['path']}{sz}")
        if len(named) > 60:
            print(f"    … +{len(named) - 60} more")
    else:
        print("  no prims matched wall/door/window/object keywords — likely a fused mesh")
        print("  (parametric room structure not preserved; would need plane segmentation)")


def inspect_mesh(path):
    import trimesh

    scene = trimesh.load(str(path))
    print(f"  mesh file: {path.name}")
    if isinstance(scene, trimesh.Scene):
        print(f"  scene with {len(scene.geometry)} geometr(y/ies); "
              f"bounds={scene.bounds.tolist() if scene.bounds is not None else '?'}")
        for name, geom in list(scene.geometry.items())[:60]:
            print(f"    {name}: {len(geom.vertices)} verts, {len(geom.faces)} faces")
    else:
        print(f"  single mesh: {len(scene.vertices)} verts, {len(scene.faces)} faces, "
              f"watertight={scene.is_watertight}")
    print("  NOTE: a raw mesh has no labelled walls/doors/windows — converting it to")
    print("  IFC walls needs plane segmentation (a separate, larger step, not MVP).")


def inspect_json(path):
    data = json.loads(path.read_text())
    print(f"  JSON: {path.name}")
    keys = ("walls", "doors", "windows", "openings", "floors", "objects", "sections")
    if any(k in data for k in keys):
        print("  looks like Apple CapturedRoom — feed directly to roomplan_to_ifc.py:")
        for k in keys:
            if k in data:
                print(f"    {k}: {len(data[k])}")
        print("  top-level keys:", ", ".join(sorted(data.keys())))
    else:
        print("  unrecognized JSON. Top-level keys:", ", ".join(sorted(data.keys()))[:200])


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"no such file: {path}")
        return 1
    ext = path.suffix.lower()
    print(f"Inspecting {path}  ({path.stat().st_size} bytes)")
    if ext in (".usd", ".usda", ".usdc", ".usdz"):
        inspect_usd(path)
    elif ext in (".obj", ".ply", ".glb", ".gltf", ".stl"):
        inspect_mesh(path)
    elif ext == ".json":
        inspect_json(path)
    else:
        print(f"  unsupported extension {ext!r} — supported: usd(z), obj/ply/glb/gltf/stl, json")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
