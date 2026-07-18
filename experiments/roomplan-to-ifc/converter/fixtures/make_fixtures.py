#!/usr/bin/env python3
"""Generate synthetic CapturedRoom JSON fixtures (see ../ROOMPLAN_SCHEMA.md).

These stand in for real iPhone LiDAR exports until hardware testing is possible.
Run from this directory: python3 make_fixtures.py
Deterministic output (uuid5 from names) so regeneration never churns git diffs.
"""
import json
import math
import uuid
from pathlib import Path

NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # uuid5 namespace (DNS, arbitrary)


def uid(name: str) -> str:
    return str(uuid.uuid5(NS, name)).upper()


def transform(cx: float, cy: float, cz: float, yaw_deg: float = 0.0) -> list:
    """Column-major flat 16-float simd_float4x4: rotation about world +Y, then translate.

    Column 0 = local X (width dir), column 1 = local Y (up), column 2 = local Z (normal).
    """
    t = math.radians(yaw_deg)
    c, s = math.cos(t), math.sin(t)
    cols = [
        [c, 0.0, -s, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [s, 0.0, c, 0.0],
        [cx, cy, cz, 1.0],
    ]
    return [round(v, 6) for col in cols for v in col]


def surface(name, category, w, h, cx, cy, cz, yaw=0.0, parent=None, confidence="high"):
    return {
        "identifier": uid(name),
        "parentIdentifier": parent,
        "category": category,
        "confidence": {confidence: {}},
        "dimensions": [w, h, 0.0],
        "transform": transform(cx, cy, cz, yaw),
        "curve": None,
        "polygonCorners": [],
        "completedEdges": [],
        "story": 1,
    }


def obj(name, category, dx, dy, dz, cx, cz, yaw=0.0, confidence="medium"):
    return {
        "identifier": uid(name),
        "parentIdentifier": None,
        "category": {category: {}},
        "confidence": {confidence: {}},
        "dimensions": [dx, dy, dz],
        "transform": transform(cx, dy / 2.0, cz, yaw),  # box center sits at half height
        "attributes": {},
        "story": 1,
    }


def wall_ring(prefix, corners_xz, height):
    """Closed wall loop from plan corners (x, z). Wall local X runs corner_i -> corner_i+1."""
    walls = []
    n = len(corners_xz)
    for i in range(n):
        (x1, z1), (x2, z2) = corners_xz[i], corners_xz[(i + 1) % n]
        width = math.hypot(x2 - x1, z2 - z1)
        cx, cz = (x1 + x2) / 2.0, (z1 + z2) / 2.0
        # yaw such that R_y(yaw) maps +X to the edge direction: dir = (cos yaw, 0, -sin yaw)
        yaw = math.degrees(math.atan2(-(z2 - z1), x2 - x1))
        walls.append(surface(f"{prefix}-wall-{i}", {"wall": {}}, width, height, cx, height / 2.0, cz, yaw))
    return walls


def room(name, walls, doors=(), windows=(), openings=(), floors=(), objects=(), sections=()):
    return {
        "version": 2,
        "identifier": uid(name),
        "story": 1,
        "walls": list(walls),
        "doors": list(doors),
        "windows": list(windows),
        "openings": list(openings),
        "floors": list(floors),
        "objects": list(objects),
        "sections": list(sections),
    }


def simple_walls(prefix):
    # 4 m (X) x 3 m (Z) rectangle centered on origin, walls 2.5 m high
    return wall_ring(prefix, [(-2, -1.5), (2, -1.5), (2, 1.5), (-2, 1.5)], 2.5)


def floor_surface(name, w, length, cx=0.0, cz=0.0):
    # Horizontal plane: local X = world X, local Y = world -Z, local Z (normal) = world +Y
    s = surface(name, {"floor": {}}, w, length, cx, 0.0, cz)
    s["transform"] = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, cx, 0.0, cz, 1]
    return s


def main():
    out = Path(__file__).parent

    # --- room_simple: 4 walls + 1 door + 1 window ---------------------------------
    walls = simple_walls("simple")
    door = surface("simple-door", {"door": {"isOpen": False}}, 0.9, 2.0,
                   1.0, 1.0, -1.5, yaw=0.0, parent=walls[0]["identifier"])
    window = surface("simple-window", {"window": {}}, 1.2, 1.0,
                     -0.5, 1.5, 1.5, yaw=180.0, parent=walls[2]["identifier"])
    fixtures = {
        "room_simple.json": room("simple", walls, doors=[door], windows=[window],
                                 floors=[floor_surface("simple-floor", 4.0, 3.0)]),
    }

    # --- room_with_furniture: same shell + table, 2 chairs, sofa ------------------
    walls = simple_walls("furn")
    door = surface("furn-door", {"door": {"isOpen": True}}, 0.9, 2.0,
                   1.0, 1.0, -1.5, yaw=0.0, parent=walls[0]["identifier"])
    window = surface("furn-window", {"window": {}}, 1.2, 1.0,
                     -0.5, 1.5, 1.5, yaw=180.0, parent=walls[2]["identifier"])
    objects = [
        obj("furn-table", "table", 1.6, 0.74, 0.9, 0.2, -0.2, yaw=0.0),
        obj("furn-chair-1", "chair", 0.45, 0.85, 0.45, 0.2, -0.9, yaw=0.0, confidence="high"),
        obj("furn-chair-2", "chair", 0.45, 0.85, 0.45, 0.2, 0.5, yaw=180.0, confidence="low"),
        obj("furn-sofa", "sofa", 2.0, 0.8, 0.9, -1.2, 0.85, yaw=12.0),
    ]
    fixtures["room_with_furniture.json"] = room(
        "furn", walls, doors=[door], windows=[window],
        floors=[floor_surface("furn-floor", 4.0, 3.0)], objects=objects,
        sections=[{"center": [0.0, 1.25, 0.0], "label": "livingRoom"}])

    # --- room_l_shaped: 6-wall L footprint (4x3 main + 2x2 annex) -----------------
    corners = [(0, 0), (4, 0), (4, 3), (2, 3), (2, 5), (0, 5)]
    walls = wall_ring("lshape", corners, 2.4)
    door = surface("lshape-door", {"door": {"isOpen": False}}, 0.9, 2.0,
                   1.2, 1.0, 0.0, yaw=0.0, parent=walls[0]["identifier"])
    fixtures["room_l_shaped.json"] = room("lshape", walls, doors=[door])

    for fname, data in fixtures.items():
        (out / fname).write_text(json.dumps(data, indent=2) + "\n")
        print(f"wrote {fname}: {len(data['walls'])} walls, {len(data['doors'])} doors, "
              f"{len(data['windows'])} windows, {len(data['objects'])} objects")


if __name__ == "__main__":
    main()
