import type { GuidMap } from "@/lib/data/ifc";

/**
 * AIM dekorácie stromu (D-076) — čistá agregácia počtov väzieb per objekt,
 * kľúčovaná IFC GlobalId pre bridge správu AIM_TREE_DECORATIONS.
 *
 * Zámerne BEZ `server-only`/DB závislostí (vzor `capture-placement.ts`):
 * agregácia je unit-testovateľná, DB čítanie žije v `decorations.ts`.
 */

/** Kompaktné počty pre badge v strome viewera: d=dokumenty, r=zodpovednosti, c=snímky. */
export interface TreeDecoration {
  d?: number;
  r?: number;
  c?: number;
}

/** Per-GUID mapa dekorácií — payload bridge správy AIM_TREE_DECORATIONS. */
export type TreeDecorations = Record<string, TreeDecoration>;

/**
 * Riadky väzieb (už filtrované na aktívne) → per-GUID počty. Objekty bez GUID
 * (nie sú v modeli) sa ticho vynechajú — badge patrí len prvkom v 3D strome.
 *
 * @param guidMap  ifc_guid → objects.id (fetchGuidMap)
 * @param docObjectIds   objekt (from_id) za každú väzbu dokumentu
 * @param respObjectIds  objekt (to_id) za každú väzbu zodpovednosti
 * @param capSpaceIds    priestor (to_id) za každú väzbu capture → space
 */
export function buildDecorations(
  guidMap: GuidMap,
  docObjectIds: readonly string[],
  respObjectIds: readonly string[],
  capSpaceIds: readonly string[]
): TreeDecorations {
  const guidByObjectId = new Map<string, string>();
  for (const [guid, objectId] of Object.entries(guidMap)) {
    guidByObjectId.set(objectId, guid);
  }

  const out: TreeDecorations = {};
  const bump = (objectId: string, key: keyof TreeDecoration) => {
    const guid = guidByObjectId.get(objectId);
    if (!guid) return;
    const deco = (out[guid] ??= {});
    deco[key] = (deco[key] ?? 0) + 1;
  };

  for (const id of docObjectIds) bump(id, "d");
  for (const id of respObjectIds) bump(id, "r");
  for (const id of capSpaceIds) bump(id, "c");
  return out;
}
