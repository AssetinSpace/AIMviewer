import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Data-access vrstva pre priestorovú hierarchiu (S1).
 *
 * Číta `objects` + aktívne hrany `rel_located_in` (D-013) a poskladá strom
 * Site → Building → Floor → Space → Asset (D-018, D-021). `asset_type` sa tu
 * NIKDY nevyskytuje (type nemá polohu).
 *
 * Pri ~15 uzloch načítame celý graf jedným ťahom a poskladáme ho v pamäti —
 * žiadna rekurzia v DB. Všetko beží server-side cez `service_role` (D-026).
 */

export const SPATIAL_TYPES = [
  "site",
  "building",
  "floor",
  "space",
  "asset",
] as const;

export type SpatialType = (typeof SPATIAL_TYPES)[number];

/** Surový riadok z `objects` (podmnožina stĺpcov, ktorú Viewer potrebuje). */
export interface ObjectRow {
  id: string;
  object_type: SpatialType;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefined_type: string | null;
  elevation: number | null; // len floor (z prípony `floors`)
}

/** Uzol stromu — `ObjectRow` + potomkovia. */
export interface SpatialNode extends ObjectRow {
  children: SpatialNode[];
}

/** Skrátený odkaz na uzol (breadcrumb, zoznam assetov). */
export interface NodeRef {
  id: string;
  object_type: SpatialType;
  object_ref: string | null;
  name: string | null;
}

interface Graph {
  byId: Map<string, ObjectRow>;
  /** to_id (rodič) → from_id[] (deti) */
  childrenOf: Map<string, string[]>;
  /** from_id (dieťa) → to_id (rodič) */
  parentOf: Map<string, string>;
}

/** Načíta celý priestorový graf jedným setom dotazov. */
async function loadGraph(): Promise<Graph> {
  const supabase = getSupabaseAdmin();

  const [objectsRes, relsRes, floorsRes] = await Promise.all([
    supabase
      .from("objects")
      .select(
        "id, object_type, object_ref, name, ifc_type, ifc_guid, predefined_type"
      )
      .in("object_type", SPATIAL_TYPES as unknown as string[]),
    // Len aktívne väzby (valid_until IS NULL) — partial-unique to garantuje 1 na dieťa.
    supabase
      .from("rel_located_in")
      .select("from_id, to_id")
      .is("valid_until", null),
    supabase.from("floors").select("id, elevation"),
  ]);

  if (objectsRes.error) throw new Error(objectsRes.error.message);
  if (relsRes.error) throw new Error(relsRes.error.message);
  if (floorsRes.error) throw new Error(floorsRes.error.message);

  const elevationById = new Map<string, number | null>(
    (floorsRes.data ?? []).map((f) => [f.id as string, f.elevation as number | null])
  );

  const byId = new Map<string, ObjectRow>();
  for (const o of objectsRes.data ?? []) {
    byId.set(o.id as string, {
      id: o.id as string,
      object_type: o.object_type as SpatialType,
      object_ref: (o.object_ref as string | null) ?? null,
      name: (o.name as string | null) ?? null,
      ifc_type: (o.ifc_type as string | null) ?? null,
      ifc_guid: (o.ifc_guid as string | null) ?? null,
      predefined_type: (o.predefined_type as string | null) ?? null,
      elevation: elevationById.get(o.id as string) ?? null,
    });
  }

  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const r of relsRes.data ?? []) {
    const from = r.from_id as string;
    const to = r.to_id as string;
    // Ignoruj hrany mimo priestorového grafu (napr. ak by to_id nebol v byId).
    if (!byId.has(from) || !byId.has(to)) continue;
    parentOf.set(from, to);
    const list = childrenOf.get(to);
    if (list) list.push(from);
    else childrenOf.set(to, [from]);
  }

  return { byId, childrenOf, parentOf };
}

/** Poradie potomkov: floory podľa elevation, inak podľa object_ref/name. */
function compareNodes(a: ObjectRow, b: ObjectRow): number {
  if (a.object_type === "floor" && b.object_type === "floor") {
    return (a.elevation ?? 0) - (b.elevation ?? 0);
  }
  const ka = a.object_ref ?? a.name ?? "";
  const kb = b.object_ref ?? b.name ?? "";
  return ka.localeCompare(kb, "sk");
}

function buildSubtree(id: string, graph: Graph): SpatialNode {
  const row = graph.byId.get(id)!;
  const childIds = graph.childrenOf.get(id) ?? [];
  const children = childIds
    .map((cid) => graph.byId.get(cid)!)
    .sort(compareNodes)
    .map((c) => buildSubtree(c.id, graph));
  return { ...row, children };
}

/**
 * Celý strom priestorovej hierarchie. Korene = uzly bez rodiča (typicky `site`).
 */
export async function fetchSpatialTree(): Promise<SpatialNode[]> {
  const graph = await loadGraph();
  const roots: ObjectRow[] = [];
  for (const row of graph.byId.values()) {
    if (!graph.parentOf.has(row.id)) roots.push(row);
  }
  return roots.sort(compareNodes).map((r) => buildSubtree(r.id, graph));
}

export interface NodeDetail {
  node: ObjectRow;
  /** Cesta od koreňa po rodiča uzla (bez samotného uzla). */
  breadcrumb: NodeRef[];
  /** Priami potomkovia (assety pod space, spaces pod floor, …). */
  children: NodeRef[];
}

function toRef(row: ObjectRow): NodeRef {
  return {
    id: row.id,
    object_type: row.object_type,
    object_ref: row.object_ref,
    name: row.name,
  };
}

/**
 * Detail jedného uzla + breadcrumb (chôdza nahor po `rel_located_in`)
 * a priami potomkovia. `null`, ak uzol neexistuje / nie je priestorový.
 */
export async function fetchNode(id: string): Promise<NodeDetail | null> {
  const graph = await loadGraph();
  const node = graph.byId.get(id);
  if (!node) return null;

  // Breadcrumb: nazbieraj predkov a otoč na poradie root → … → rodič.
  const breadcrumb: NodeRef[] = [];
  let cursor = graph.parentOf.get(id);
  const guard = new Set<string>(); // poistka proti cyklu
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const parent = graph.byId.get(cursor);
    if (parent) breadcrumb.push(toRef(parent));
    cursor = graph.parentOf.get(cursor);
  }
  breadcrumb.reverse();

  const children = (graph.childrenOf.get(id) ?? [])
    .map((cid) => graph.byId.get(cid)!)
    .sort(compareNodes)
    .map(toRef);

  return { node, breadcrumb, children };
}
