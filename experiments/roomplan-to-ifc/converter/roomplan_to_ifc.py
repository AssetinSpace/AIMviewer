#!/usr/bin/env python3
"""Apple RoomPlan CapturedRoom JSON -> minimal valid IFC4.

MVP experiment (D-078): proves an iPhone LiDAR scan can round-trip into the
IfcOpenShell / web-ifc stack used by AIM Viewer. Not production code.

Input schema: see ROOMPLAN_SCHEMA.md (reverse-engineered, no official spec).
Mapping decisions and limitations: see ../README.md.

Usage: python3 roomplan_to_ifc.py <captured_room.json> [-o out.ifc]
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import ifcopenshell
import ifcopenshell.guid

WALL_THICKNESS = 0.10   # m — RoomPlan surfaces are zero-thickness planes
LEAF_THICKNESS = 0.05   # m — nominal door/window leaf depth
MIN_SPACE_HEIGHT = 2.2  # m — fallback if no walls carry height

OBJECT_CATEGORY_TO_PREDEFINED = {
    # CapturedRoom.Object.Category -> IfcFurnishingElement description (MVP: all
    # furniture-like; a finer split into IfcSanitaryTerminal etc. is a stretch goal)
    "storage": "Storage", "refrigerator": "Refrigerator", "stove": "Stove",
    "bed": "Bed", "sink": "Sink", "washerDryer": "WasherDryer", "toilet": "Toilet",
    "bathtub": "Bathtub", "oven": "Oven", "dishwasher": "Dishwasher",
    "table": "Table", "sofa": "Sofa", "chair": "Chair", "fireplace": "Fireplace",
    "television": "Television", "stairs": "Stairs",
}


# --------------------------------------------------------------------------- input

def enum_case(value, default=None):
    """RoomPlan enums encode as {"caseName": {...}}; tolerate plain strings too."""
    if isinstance(value, str):
        return value, {}
    if isinstance(value, dict) and value:
        case = next(iter(value))
        return case, value[case] or {}
    return default, {}


def parse_transform(raw):
    """Accept flat 16-float column-major or nested [[4]x4] columns; return 4 columns."""
    if raw is None:
        return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    if len(raw) == 16 and not isinstance(raw[0], (list, tuple)):
        return [list(raw[i * 4:(i + 1) * 4]) for i in range(4)]
    if len(raw) == 4 and isinstance(raw[0], (list, tuple)):
        return [list(c) for c in raw]
    raise ValueError(f"unrecognized transform shape: {raw!r}")


def ar_to_ifc(v):
    """ARKit is right-handed +Y up; IFC is +Z up. (x, y, z) -> (x, -z, y)."""
    return (v[0], -v[2], v[1])


def plan_direction(cols):
    """Wall/box local +X (width direction) projected to the IFC ground plane."""
    x, y, _ = ar_to_ifc(cols[0][:3])
    length = math.hypot(x, y)
    if length < 1e-6:  # degenerate (local X vertical) — should not happen for walls
        return (1.0, 0.0)
    return (x / length, y / length)


class Element:
    """Normalized RoomPlan surface/object: IFC-space center, plan direction, extents."""

    def __init__(self, item):
        self.identifier = item.get("identifier")
        self.category, self.category_args = enum_case(item.get("category"))
        self.confidence, _ = enum_case(item.get("confidence"), "unknown")
        cols = parse_transform(item.get("transform"))
        self.center = ar_to_ifc(cols[3][:3])          # (x, y, z) IFC, z = height axis
        self.direction = plan_direction(cols)
        d = item.get("dimensions") or [0, 0, 0]
        self.width, self.height, self.depth = float(d[0]), float(d[1]), float(d[2])

    @property
    def base_z(self):
        return self.center[2] - self.height / 2.0

    def plan_endpoints(self):
        dx, dy = self.direction
        cx, cy, _ = self.center
        h = self.width / 2.0
        return (cx - dx * h, cy - dy * h), (cx + dx * h, cy + dy * h)


# --------------------------------------------------------------------------- IFC scaffold

class IfcBuilder:
    def __init__(self, project_name):
        self.f = ifcopenshell.file(schema="IFC4")
        self.owner_history = self._owner_history()
        self.body_context = None
        self.project = self._project(project_name)

    def _owner_history(self):
        f = self.f
        person = f.create_entity("IfcPerson", FamilyName="AIM", GivenName="RoomPlan")
        org = f.create_entity("IfcOrganization", Name="Assetin")
        person_org = f.create_entity("IfcPersonAndOrganization",
                                     ThePerson=person, TheOrganization=org)
        app = f.create_entity("IfcApplication", ApplicationDeveloper=org, Version="0.1",
                              ApplicationFullName="roomplan_to_ifc experiment",
                              ApplicationIdentifier="roomplan_to_ifc")
        return f.create_entity("IfcOwnerHistory", OwningUser=person_org,
                               OwningApplication=app, ChangeAction="ADDED",
                               CreationDate=int(time.time()))

    def _project(self, name):
        f = self.f
        units = [
            f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE"),
            f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
            f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE"),
            f.create_entity("IfcSIUnit", UnitType="PLANEANGLEUNIT", Name="RADIAN"),
        ]
        unit_assignment = f.create_entity("IfcUnitAssignment", Units=units)
        origin = f.create_entity("IfcAxis2Placement3D",
                                 Location=f.create_entity("IfcCartesianPoint",
                                                          Coordinates=(0.0, 0.0, 0.0)))
        ctx = f.create_entity("IfcGeometricRepresentationContext",
                              ContextType="Model", CoordinateSpaceDimension=3,
                              Precision=1e-5, WorldCoordinateSystem=origin)
        self.body_context = f.create_entity(
            "IfcGeometricRepresentationSubContext", ContextIdentifier="Body",
            ContextType="Model", ParentContext=ctx, TargetView="MODEL_VIEW")
        return f.create_entity("IfcProject", GlobalId=ifcopenshell.guid.new(),
                               OwnerHistory=self.owner_history, Name=name,
                               UnitsInContext=unit_assignment,
                               RepresentationContexts=[ctx])

    # --- placements / geometry helpers ---------------------------------------

    def placement(self, xyz, plan_dir=(1.0, 0.0), relative_to=None):
        f = self.f
        axis = f.create_entity("IfcAxis2Placement3D",
                               Location=f.create_entity("IfcCartesianPoint",
                                                        Coordinates=tuple(map(float, xyz))),
                               Axis=f.create_entity("IfcDirection",
                                                    DirectionRatios=(0.0, 0.0, 1.0)),
                               RefDirection=f.create_entity(
                                   "IfcDirection",
                                   DirectionRatios=(float(plan_dir[0]), float(plan_dir[1]), 0.0)))
        return f.create_entity("IfcLocalPlacement", PlacementRelTo=relative_to,
                               RelativePlacement=axis)

    def box_representation(self, x_dim, y_dim, height):
        """Extruded rectangle centered on the placement origin, extruded up +Z."""
        f = self.f
        profile = f.create_entity(
            "IfcRectangleProfileDef", ProfileType="AREA",
            Position=f.create_entity(
                "IfcAxis2Placement2D",
                Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0))),
            XDim=float(max(x_dim, 0.01)), YDim=float(max(y_dim, 0.01)))
        solid = f.create_entity(
            "IfcExtrudedAreaSolid", SweptArea=profile,
            Position=f.create_entity(
                "IfcAxis2Placement3D",
                Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))),
            ExtrudedDirection=f.create_entity("IfcDirection",
                                              DirectionRatios=(0.0, 0.0, 1.0)),
            Depth=float(max(height, 0.01)))
        shape = f.create_entity("IfcShapeRepresentation",
                                ContextOfItems=self.body_context,
                                RepresentationIdentifier="Body",
                                RepresentationType="SweptSolid", Items=[solid])
        return f.create_entity("IfcProductDefinitionShape", Representations=[shape])

    def entity(self, ifc_class, name, placement=None, representation=None, description=None):
        return self.f.create_entity(
            ifc_class, GlobalId=ifcopenshell.guid.new(), OwnerHistory=self.owner_history,
            Name=name, Description=description, ObjectPlacement=placement,
            Representation=representation)

    def aggregate(self, parent, children):
        self.f.create_entity("IfcRelAggregates", GlobalId=ifcopenshell.guid.new(),
                             OwnerHistory=self.owner_history,
                             RelatingObject=parent, RelatedObjects=list(children))

    def contain(self, structure, elements):
        self.f.create_entity("IfcRelContainedInSpatialStructure",
                             GlobalId=ifcopenshell.guid.new(),
                             OwnerHistory=self.owner_history,
                             RelatingStructure=structure, RelatedElements=list(elements))

    def capture_pset(self, product, element):
        """Provenance pset: RoomPlan identifier + detection confidence."""
        f = self.f
        props = [
            f.create_entity("IfcPropertySingleValue", Name="RoomPlanIdentifier",
                            NominalValue=f.create_entity("IfcLabel",
                                                         str(element.identifier))),
            f.create_entity("IfcPropertySingleValue", Name="Confidence",
                            NominalValue=f.create_entity("IfcLabel", element.confidence)),
        ]
        pset = f.create_entity("IfcPropertySet", GlobalId=ifcopenshell.guid.new(),
                               OwnerHistory=self.owner_history,
                               Name="AIM_RoomPlanCapture", HasProperties=props)
        f.create_entity("IfcRelDefinesByProperties", GlobalId=ifcopenshell.guid.new(),
                        OwnerHistory=self.owner_history,
                        RelatedObjects=[product], RelatingPropertyDefinition=pset)


# --------------------------------------------------------------------------- conversion

def convert(data, project_name):
    b = IfcBuilder(project_name)

    walls = [Element(s) for s in data.get("walls") or []]
    doors = [Element(s) for s in data.get("doors") or []]
    windows = [Element(s) for s in data.get("windows") or []]
    objects = [Element(o) for o in data.get("objects") or []]

    site = b.entity("IfcSite", "Site")
    site.ObjectPlacement = b.placement((0, 0, 0))
    building = b.entity("IfcBuilding", "Building")
    building.ObjectPlacement = b.placement((0, 0, 0), relative_to=site.ObjectPlacement)
    storey = b.entity("IfcBuildingStorey", "Storey 1")
    storey.ObjectPlacement = b.placement((0, 0, 0), relative_to=building.ObjectPlacement)
    b.aggregate(b.project, [site])
    b.aggregate(site, [building])
    b.aggregate(building, [storey])

    products = []

    def build_box(ifc_class, name, el, plan_depth, height, description=None):
        placement = b.placement((el.center[0], el.center[1], el.base_z), el.direction,
                                relative_to=storey.ObjectPlacement)
        rep = b.box_representation(el.width, plan_depth, height)
        product = b.entity(ifc_class, name, placement, rep, description)
        b.capture_pset(product, el)
        products.append(product)
        return product

    for i, w in enumerate(walls, 1):
        thickness = w.depth if w.depth > 0.01 else WALL_THICKNESS
        build_box("IfcWall", f"Wall {i}", w, thickness, w.height)

    for i, d in enumerate(doors, 1):
        door = build_box("IfcDoor", f"Door {i}", d, LEAF_THICKNESS, d.height)
        door.OverallWidth, door.OverallHeight = d.width, d.height

    for i, w in enumerate(windows, 1):
        win = build_box("IfcWindow", f"Window {i}", w, LEAF_THICKNESS, w.height)
        win.OverallWidth, win.OverallHeight = w.width, w.height

    for i, o in enumerate(objects, 1):
        label = OBJECT_CATEGORY_TO_PREDEFINED.get(o.category, o.category or "Unknown")
        # Object dimensions are a full oriented bounding box: x extent × z extent
        # in plan, y extent = height (depth attr holds the AR z extent here).
        build_box("IfcFurnishingElement", f"{label} {i}", o, o.depth, o.height,
                  description=f"RoomPlan category: {o.category}")

    # IfcSpace: plan bounding box of the wall centerlines, extruded to max wall height.
    # (MVP: axis-aligned bbox, so the L-shape space over-covers — see README limitations.)
    space = None
    if walls:
        points = [p for w in walls for p in w.plan_endpoints()]
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        height = max((w.height for w in walls), default=MIN_SPACE_HEIGHT)
        base = min(w.base_z for w in walls)
        space = b.entity("IfcSpace", "Space 1")
        space.ObjectPlacement = b.placement(
            (((min(xs) + max(xs)) / 2.0), ((min(ys) + max(ys)) / 2.0), base),
            relative_to=storey.ObjectPlacement)
        space.Representation = b.box_representation(
            max(xs) - min(xs), max(ys) - min(ys), height)
        space.CompositionType = "ELEMENT"
        b.aggregate(storey, [space])

    if products:
        b.contain(storey, products)

    return b.f


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path, help="CapturedRoom JSON export")
    ap.add_argument("-o", "--output", type=Path,
                    help="output .ifc path (default: input name with .ifc)")
    args = ap.parse_args(argv)

    data = json.loads(args.input.read_text())
    out = args.output or args.input.with_suffix(".ifc")
    model = convert(data, project_name=f"RoomPlan scan {args.input.stem}")
    model.write(str(out))
    counts = {c: len(model.by_type(c, include_subtypes=False))
              for c in ("IfcWall", "IfcDoor", "IfcWindow", "IfcFurnishingElement", "IfcSpace")}
    print(f"{args.input.name} -> {out.name}  {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
