# Apple RoomPlan `CapturedRoom` — JSON schema reference

> **Status: reverse-engineered reference, not an official spec.** Apple ships no JSON
> Schema for `CapturedRoom` — only the Swift `Codable` struct definitions in the
> RoomPlan framework (iOS 16+). This document describes the JSON produced by
> `JSONEncoder().encode(capturedRoom)`, reconstructed from the Swift API surface
> (`CapturedRoom`, `CapturedRoom.Surface`, `CapturedRoom.Object`) and community
> samples of real device exports. Fields marked ⚠️ are best-effort guesses that
> must be re-verified against a real device export (no LiDAR hardware was
> available when this was written).

## Encoding rules that shape the JSON

The JSON shape follows directly from how Swift encodes these types:

1. **Enums with associated values** (all `category` and `confidence` enums) encode as
   a single-key object: `{"caseName": {…associated values…}}`. A case with no
   associated values encodes as `{"caseName": {}}`. Example: a door surface is
   `"category": {"door": {"isOpen": false}}`, a chair is `"category": {"chair": {}}`.
2. **`simd_float3`** encodes as a flat 3-element array `[x, y, z]`.
3. **`simd_float4x4`** encodes as a flat 16-element array in **column-major** order
   (columns 0–3, each 4 floats: `[c0x,c0y,c0z,c0w, c1x,…, c3x,c3y,c3z,c3w]`).
   Translation therefore lives at indices 12, 13, 14.
   ⚠️ Some Swift versions/encoders may emit a nested `[[4],[4],[4],[4]]` array of
   columns instead — the converter accepts both.
4. **`UUID`** encodes as an uppercase UUID string.
5. Coordinates are **meters**, in the ARKit world coordinate system:
   **right-handed, +Y up**, X/Z horizontal. Gravity-aligned. World origin is
   wherever the AR session started — expect the room to sit at arbitrary
   world-space coordinates, not centered at origin.

## Top-level `CapturedRoom` object

```jsonc
{
  "version": 2,                    // capture format version (Int)
  "identifier": "6F5E…-UUID",      // unique id of this captured room
  "story": 1,                      // ⚠️ iOS 17+: storey index (multi-floor capture)
  "walls":    [ Surface, … ],      // planar wall surfaces
  "doors":    [ Surface, … ],      // doors (embedded in a wall, see parentIdentifier)
  "windows":  [ Surface, … ],      // windows (embedded in a wall)
  "openings": [ Surface, … ],      // wall cut-outs that are neither door nor window
  "floors":   [ Surface, … ],      // ⚠️ iOS 17+: horizontal floor surfaces
  "objects":  [ Object,  … ],      // detected furniture/appliance bounding boxes
  "sections": [ Section, … ]       // ⚠️ iOS 17+: labelled room sections
}
```

Older iOS 16 exports lack `story`, `floors`, `sections`. Consumers should treat
every array as optional-with-default-empty.

## `CapturedRoom.Surface`

Surfaces are **zero-thickness planes** (RoomPlan does not measure wall thickness).

```jsonc
{
  "identifier": "UUID",
  "parentIdentifier": null,           // for doors/windows/openings: UUID of host wall
  "category": {"wall": {}},           // see category list below
  "confidence": {"high": {}},         // "high" | "medium" | "low"
  "dimensions": [4.02, 2.51, 0.0],    // simd_float3 [width, height, ~0]
  "transform": [ /* 16 floats */ ],   // column-major world transform of surface center
  "curve": null,                      // ⚠️ non-null for curved walls (radius/arc); rare
  "polygonCorners": [],               // ⚠️ iOS 17+: [x,y,z] corner list for non-rect surfaces
  "completedEdges": [],               // ⚠️ which edges the scan considers fully observed
  "story": 1                          // ⚠️ iOS 17+
}
```

Surface local frame (before `transform` is applied): **local X = width direction
(along the wall), local Y = height (up), local Z = surface normal**. The
`transform` translation is the **center** of the surface rectangle — a wall's
base sits at `center.y − height/2`, a window's sill at the same formula.

Surface `category` cases: `wall`, `door` (associated value `{"isOpen": Bool}`),
`window`, `opening`, `floor`. (`door` splits into `isOpen`; everything else is `{}`.)

## `CapturedRoom.Object`

Detected objects are **oriented bounding boxes** — no mesh, no shape detail.

```jsonc
{
  "identifier": "UUID",
  "parentIdentifier": null,
  "category": {"table": {}},
  "confidence": {"medium": {}},
  "dimensions": [1.60, 0.74, 0.90],   // [x extent, y extent (height), z extent] of the box
  "transform": [ /* 16 floats */ ],   // world transform of the box center
  "attributes": {},                   // ⚠️ iOS 17+: per-category attributes (e.g. sofa shape)
  "story": 1                          // ⚠️ iOS 17+
}
```

Object `category` — the ~16-case catalog (`CapturedRoom.Object.Category`):

| case | case | case | case |
|---|---|---|---|
| `storage` | `refrigerator` | `stove` | `bed` |
| `sink` | `washerDryer` | `toilet` | `bathtub` |
| `oven` | `dishwasher` | `table` | `sofa` |
| `chair` | `fireplace` | `television` | `stairs` |

## `Section` (iOS 17+) ⚠️

```jsonc
{ "center": [x, y, z], "label": "livingRoom" }
```

Room-section labels RoomPlan infers (livingRoom, kitchen, bedroom, bathroom,
diningRoom, …). Ignored by the converter for now.

## Practical consequences for IFC conversion

- **No wall thickness** → converter applies a nominal thickness (default 0.10 m).
- **Center-based transforms** → base elevation = `center.y − height/2`.
- **Y-up → Z-up**: IFC is +Z up; map ARKit `(x, y, z)` → IFC `(x, −z, y)`.
- **Doors/windows reference their wall** via `parentIdentifier`, but carry their own
  full world transform, so they can be placed standalone without resolving the wall.
- **Everything is approximate** — RoomPlan is not survey-grade; expect ±cm errors
  and simplified (rectangle-snapped) geometry.
