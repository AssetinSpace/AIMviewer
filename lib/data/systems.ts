import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchSystemMembership, type SystemRef } from "@/lib/data/relations";

/**
 * Data-access vrstva pre grafové dotazy S-LLM (D-050), postavená na distribučných
 * systémoch a členstve z D-049. Zámerne úzka, read-only sada funkcií — každá je
 * priamo mapovaná na jeden LLM nástroj (`lib/llm/tools.ts`). Row limity sú v tele
 * (guardrail D-005). Server-side cez `service_role` (D-026).
 */

/** Základný opis objektu — spoločný tvar pre resolve/summary aj citácie. */
export interface ObjectMatch {
  id: string;
  objectType: string;
  objectRef: string | null;
  name: string | null;
  ifcType: string | null;
  predefinedType: string | null;
  ifcGuid: string | null;
}

const OBJECT_COLS = "id, object_type, object_ref, name, ifc_type, predefined_type, ifc_guid";

function toMatch(o: Record<string, unknown>): ObjectMatch {
  return {
    id: o.id as string,
    objectType: o.object_type as string,
    objectRef: (o.object_ref as string | null) ?? null,
    name: (o.name as string | null) ?? null,
    ifcType: (o.ifc_type as string | null) ?? null,
    predefinedType: (o.predefined_type as string | null) ?? null,
    ifcGuid: (o.ifc_guid as string | null) ?? null,
  };
}

/**
 * Nájde objekty podľa voľného textu — match na `object_ref` alebo `name`
 * (case-insensitive substring). Slúži na naviazanie „tohto prvku"/„tohto systému"
 * z otázky, keď UI nedodá `contextObjectId`. Zoradené: presná zhoda ref hore.
 */
export async function resolveObjects(
  query: string,
  limit = 8
): Promise<ObjectMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = getSupabaseAdmin();

  // Dva samostatné `.ilike()` dotazy (parametrizované, čiarka/rezervované znaky
  // bezpečné) namiesto `.or()` s raw textom — potom zliatie a dedupe podľa id.
  const pattern = `%${q}%`;
  const [byRef, byName] = await Promise.all([
    supabase.from("objects").select(OBJECT_COLS).ilike("object_ref", pattern).limit(limit),
    supabase.from("objects").select(OBJECT_COLS).ilike("name", pattern).limit(limit),
  ]);
  if (byRef.error) throw new Error(byRef.error.message);
  if (byName.error) throw new Error(byName.error.message);

  const seen = new Set<string>();
  const rows: ObjectMatch[] = [];
  for (const r of [...(byRef.data ?? []), ...(byName.data ?? [])]) {
    const id = r.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(toMatch(r));
  }

  const ql = q.toLowerCase();
  rows.sort((a, b) => {
    const score = (m: ObjectMatch) =>
      (m.objectRef?.toLowerCase() === ql ? 0 : 1) +
      (m.objectRef?.toLowerCase().startsWith(ql) ? 0 : 1);
    return score(a) - score(b);
  });
  return rows.slice(0, limit);
}

/** Základný opis jedného objektu podľa id. */
export async function getObjectSummary(
  objectId: string
): Promise<ObjectMatch | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select(OBJECT_COLS)
    .eq("id", objectId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  return toMatch(data[0]);
}

/** Priestorový kontext prvku: priamy kontajner + podlažie (ak kontajner je priestor). */
export interface SpatialContext {
  containerId: string | null;
  containerType: string | null;
  containerName: string | null;
  floorId: string | null;
  floorName: string | null;
}

const EMPTY_CONTEXT: SpatialContext = {
  containerId: null,
  containerType: null,
  containerName: null,
  floorId: null,
  floorName: null,
};

/**
 * Nájde priestorové umiestnenie prvku (`rel_contained_in_spatial_structure`).
 * Ak je kontajner `space`, doplní jeho `floor` (cez `rel_aggregates`). MEP prvky
 * len s členstvom v systéme (potrubie/tvarovky, D-049) kontajner nemajú → prázdne.
 */
export async function spatialContextOf(
  objectId: string
): Promise<SpatialContext> {
  const supabase = getSupabaseAdmin();

  const { data: contain, error } = await supabase
    .from("rel_contained_in_spatial_structure")
    .select("to_id")
    .eq("from_id", objectId)
    .is("valid_until", null)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!contain?.length) return EMPTY_CONTEXT;

  const containerId = contain[0].to_id as string;
  const container = await getObjectSummary(containerId);
  if (!container) return EMPTY_CONTEXT;

  // Kontajner je priamo podlažie.
  if (container.objectType === "floor") {
    return {
      containerId,
      containerType: "floor",
      containerName: container.name,
      floorId: containerId,
      floorName: container.name,
    };
  }

  // Kontajner je priestor → nájdi jeho podlažie (dekompozícia štruktúry).
  let floorId: string | null = null;
  let floorName: string | null = null;
  if (container.objectType === "space") {
    const { data: agg, error: aggErr } = await supabase
      .from("rel_aggregates")
      .select("to_id")
      .eq("from_id", containerId)
      .is("valid_until", null)
      .limit(1);
    if (aggErr) throw new Error(aggErr.message);
    if (agg?.length) {
      const parent = await getObjectSummary(agg[0].to_id as string);
      if (parent?.objectType === "floor") {
        floorId = parent.id;
        floorName = parent.name;
      }
    }
  }

  return {
    containerId,
    containerType: container.objectType,
    containerName: container.name,
    floorId,
    floorName,
  };
}

/** Odpoveď na „ktorý systém obsluhuje tento prvok a na akom podlaží" (D-047/D-049). */
export interface ElementSystems {
  element: ObjectMatch | null;
  systems: SystemRef[];
  context: SpatialContext;
}

export async function findElementSystems(
  objectId: string
): Promise<ElementSystems> {
  const [element, systems, context] = await Promise.all([
    getObjectSummary(objectId),
    fetchSystemMembership(objectId),
    spatialContextOf(objectId),
  ]);
  return { element, systems, context };
}

/** Člen systému + jeho priama poloha (label kontajnera). */
export interface SystemElement {
  id: string;
  objectRef: string | null;
  name: string | null;
  ifcType: string | null;
  ifcGuid: string | null;
  /** Názov priameho kontajnera (podlažie/priestor) — null pre group-only prvky. */
  location: string | null;
}

/** Odpoveď na „vypíš prvky systému X" (D-049). */
export interface SystemDetail {
  system: ObjectMatch | null;
  elements: SystemElement[];
  /** Celkový počet členov (aj keď `elements` je orezané limitom). */
  total: number;
}

/**
 * Členovia systému (`rel_assigns_to_group`, smer člen → systém). Batchované:
 * prvky + ich priame kontajnery dvoma dotazmi. Orezané na `limit` (guardrail),
 * `total` drží skutočný počet.
 */
export async function listSystemElements(
  systemId: string,
  limit = 60
): Promise<SystemDetail> {
  const supabase = getSupabaseAdmin();

  const [system, relRes] = await Promise.all([
    getObjectSummary(systemId),
    supabase
      .from("rel_assigns_to_group")
      .select("from_id")
      .eq("to_id", systemId)
      .is("valid_until", null),
  ]);
  if (relRes.error) throw new Error(relRes.error.message);

  const allIds = [...new Set((relRes.data ?? []).map((r) => r.from_id as string))];
  const total = allIds.length;
  const elemIds = allIds.slice(0, limit);
  if (elemIds.length === 0) return { system, elements: [], total };

  const [objsRes, containRes] = await Promise.all([
    supabase.from("objects").select(OBJECT_COLS).in("id", elemIds),
    supabase
      .from("rel_contained_in_spatial_structure")
      .select("from_id, to_id")
      .in("from_id", elemIds)
      .is("valid_until", null),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (containRes.error) throw new Error(containRes.error.message);

  // Názvy kontajnerov jedným dotazom.
  const containerByElem = new Map<string, string>(
    (containRes.data ?? []).map((r) => [r.from_id as string, r.to_id as string])
  );
  const containerIds = [...new Set(containerByElem.values())];
  const containerName = new Map<string, string | null>();
  if (containerIds.length > 0) {
    const { data: containers, error: cErr } = await supabase
      .from("objects")
      .select("id, name")
      .in("id", containerIds);
    if (cErr) throw new Error(cErr.message);
    for (const c of containers ?? [])
      containerName.set(c.id as string, (c.name as string | null) ?? null);
  }

  const byId = new Map((objsRes.data ?? []).map((o) => [o.id as string, o]));
  const elements: SystemElement[] = elemIds
    .map((id) => {
      const o = byId.get(id);
      const cid = containerByElem.get(id);
      return {
        id,
        objectRef: (o?.object_ref as string | null) ?? null,
        name: (o?.name as string | null) ?? null,
        ifcType: (o?.ifc_type as string | null) ?? null,
        ifcGuid: (o?.ifc_guid as string | null) ?? null,
        location: cid ? containerName.get(cid) ?? null : null,
      };
    })
    .sort((a, b) =>
      (a.objectRef ?? a.name ?? "").localeCompare(b.objectRef ?? b.name ?? "", "sk")
    );

  return { system, elements, total };
}
