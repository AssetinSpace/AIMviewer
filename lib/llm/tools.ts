import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PDF_LINK_SOURCE } from "@/lib/data/constants";
import type { ChatSource, SourceDrawingRef } from "@/lib/llm/types";

/**
 * Tool vrstva LLM rozhrania (F6, D-056): typované nástroje nad whitelistom —
 * model NIKDY negeneruje SQL, každý tool je pevná parametrizovaná query cez
 * server-only `service_role` klient (D-026). Guardraily D-005: read-only,
 * whitelist zdrojov (kanonické views `rel_*` + `objects`/`v_asset_effective`/
 * `documents`), row-limit, len aktívne hrany (`valid_until IS NULL`).
 *
 * Trust loop: každý executor hlási dotknuté uzly do `SourceCollector` — citácie
 * v odpovedi tak vždy pochádzajú zo skutočne prečítaných dát, nie z tvrdení modelu.
 */

const ROW_LIMIT = 25;

/** Whitelist kanonických views hrán (D-051) — LLM vrstva nesmie na base tabuľku. */
const REL_VIEWS = [
  "rel_aggregates",
  "rel_contained_in_spatial_structure",
  "rel_defines_by_type",
  "rel_associates_document",
  "rel_assigns_to_actor",
  "rel_assigns_to_group",
  "rel_member_of",
] as const;

type RelView = (typeof REL_VIEWS)[number];

/** Stĺpce `objects`, ktoré smú odísť do modelu (bez `properties` — tie len cez get_object). */
const OBJECT_COLS =
  "id, object_type, object_ref, name, ifc_type, predefined_type, ifc_guid";

interface ObjectRow {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  predefined_type: string | null;
  ifc_guid: string | null;
}

/** Zbiera citované zdroje počas jednej konverzačnej odpovede. */
export class SourceCollector {
  private map = new Map<string, ChatSource>();

  add(row: ObjectRow): void {
    const existing = this.map.get(row.id);
    if (existing) return;
    this.map.set(row.id, {
      id: row.id,
      objectType: row.object_type,
      objectRef: row.object_ref,
      name: row.name,
      ifcGuid: row.ifc_guid,
      drawings: [],
    });
  }

  addDrawings(objectId: string, drawings: SourceDrawingRef[]): void {
    const src = this.map.get(objectId);
    if (src) src.drawings.push(...drawings);
  }

  list(): ChatSource[] {
    return [...this.map.values()];
  }
}

// ── Tool definície (JSON schema pre model) ────────────────────────────────────

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "search_objects",
    description:
      "Vyhľadá uzly grafu budovy (site/building/floor/space/asset/asset_type/system/document/person/organization) " +
      "podľa časti názvu alebo object_ref kódu (SNIM, napr. 'DD01.06.03'), voliteľne filtrované podľa object_type " +
      "alebo IFC triedy (ifc_type, napr. 'IfcDoor'). Volaj vždy, keď potrebuješ nájsť konkrétny prvok, miestnosť, " +
      "systém, dokument alebo osobu. Vracia max 25 riadkov.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Časť názvu alebo object_ref (case-insensitive substring).",
        },
        object_type: {
          type: "string",
          description:
            "Voliteľný filter: site|building|floor|space|asset|asset_type|system|document|person|organization",
        },
        ifc_type: {
          type: "string",
          description: "Voliteľný filter na IFC triedu, napr. 'IfcDoor', 'IfcAirTerminal'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_object",
    description:
      "Detail uzla podľa objects.id: atribúty, aktívny IFC GUID a pri assetoch efektívne properties " +
      "(merge typ + occurrence z v_asset_effective, D-028) vrátane informácie o type. " +
      "Volaj po search_objects, keď potrebuješ vlastnosti konkrétneho prvku.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id (UUID) uzla." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_related",
    description:
      "Vzťahy uzla v grafe (IFC-kanonické hrany, D-048/D-051): priestorové zaradenie " +
      "(rel_contained_in_spatial_structure — prvok v miestnosti/podlaží; rel_aggregates — dekompozícia " +
      "Site→Building→Floor→Space), typ (rel_defines_by_type), dokumenty (rel_associates_document), " +
      "zodpovednosti (rel_assigns_to_actor), členstvo v distribučnom systéme (rel_assigns_to_group), " +
      "členstvo osoby vo firme (rel_member_of). Smer 'out' = uzol je subjekt (from), 'in' = objekt (to). " +
      "Napr. miestnosť prvku: list_related(id, rel_contained_in_spatial_structure, out); " +
      "prvky systému: list_related(system_id, rel_assigns_to_group, in).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id (UUID) uzla." },
        rel_type: {
          type: "string",
          description:
            "Voliteľné zúženie na jeden typ hrany: " + REL_VIEWS.join("|"),
        },
        direction: {
          type: "string",
          enum: ["out", "in", "both"],
          description: "Smer hrán voči uzlu (default both).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_element_drawings",
    description:
      "Výkresy, v ktorých je prvok (asset alebo asset_type) zobrazený (PDF auto-linking E4/D-041), " +
      "vrátane strany a SNIM labelu regiónu — presné miesto vo výkrese. Volaj pre dotazy " +
      "'na ktorých výkresoch je prvok a kde'.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id (UUID) prvku alebo typu." },
      },
      required: ["id"],
    },
  },
];

// ── Executory ─────────────────────────────────────────────────────────────────

function isRelView(v: unknown): v is RelView {
  return typeof v === "string" && (REL_VIEWS as readonly string[]).includes(v);
}

async function searchObjects(
  input: { query?: string; object_type?: string; ifc_type?: string },
  sources: SourceCollector
) {
  const query = (input.query ?? "").trim();
  if (!query) return { error: "query je povinný" };

  const supabase = getSupabaseAdmin();
  // Escapovanie % a _ v ilike vzore — vstup je substring, nie vzor.
  const q = query.replace(/[%_]/g, (m) => `\\${m}`);
  let builder = supabase
    .from("objects")
    .select(OBJECT_COLS)
    .or(`name.ilike.%${q}%,object_ref.ilike.%${q}%`)
    .limit(ROW_LIMIT);
  if (input.object_type) builder = builder.eq("object_type", input.object_type);
  if (input.ifc_type) builder = builder.eq("ifc_type", input.ifc_type);

  const { data, error } = await builder;
  if (error) return { error: error.message };

  const rows = (data ?? []) as ObjectRow[];
  rows.forEach((r) => sources.add(r));
  return { count: rows.length, results: rows };
}

async function getObject(input: { id?: string }, sources: SourceCollector) {
  if (!input.id) return { error: "id je povinný" };
  const supabase = getSupabaseAdmin();

  const { data: obj, error } = await supabase
    .from("objects")
    .select(OBJECT_COLS)
    .eq("id", input.id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!obj) return { error: "Uzol neexistuje" };

  const row = obj as ObjectRow;
  sources.add(row);

  if (row.object_type !== "asset") return { object: row };

  // Efektívne properties (dedičnosť type→occurrence, D-028) — len pre assety.
  const { data: eff, error: effErr } = await supabase
    .from("v_asset_effective")
    .select("predefined_type, user_defined_type, properties, type_id, type_name")
    .eq("id", input.id)
    .maybeSingle();
  if (effErr) return { object: row, effective_error: effErr.message };

  return { object: row, effective: eff ?? null };
}

async function listRelated(
  input: { id?: string; rel_type?: string; direction?: string },
  sources: SourceCollector
) {
  if (!input.id) return { error: "id je povinný" };
  if (input.rel_type !== undefined && !isRelView(input.rel_type)) {
    return { error: `rel_type mimo whitelistu. Povolené: ${REL_VIEWS.join(", ")}` };
  }
  const direction =
    input.direction === "out" || input.direction === "in" ? input.direction : "both";
  const views: readonly RelView[] = input.rel_type ? [input.rel_type] : REL_VIEWS;

  const supabase = getSupabaseAdmin();
  type Edge = {
    rel_type: RelView;
    direction: "out" | "in";
    other_id: string;
    role: string | null;
  };

  // Views s `role` stĺpcom (ostatné ho v kanonickom view nemajú).
  const HAS_ROLE: readonly RelView[] = [
    "rel_associates_document",
    "rel_assigns_to_actor",
    "rel_member_of",
  ];

  const fetchEdges = async (view: RelView, dir: "out" | "in"): Promise<Edge[]> => {
    const cols = HAS_ROLE.includes(view) ? "from_id, to_id, role" : "from_id, to_id";
    const { data, error } = await supabase
      .from(view)
      .select(cols)
      .eq(dir === "out" ? "from_id" : "to_id", input.id!)
      .is("valid_until", null)
      .limit(ROW_LIMIT);
    if (error) throw new Error(`${view}: ${error.message}`);
    const rows = (data ?? []) as unknown as {
      from_id: string;
      to_id: string;
      role?: string | null;
    }[];
    return rows.map((r) => ({
      rel_type: view,
      direction: dir,
      other_id: dir === "out" ? r.to_id : r.from_id,
      role: r.role ?? null,
    }));
  };

  const queries: Promise<Edge[]>[] = [];
  for (const view of views) {
    if (direction !== "in") queries.push(fetchEdges(view, "out"));
    if (direction !== "out") queries.push(fetchEdges(view, "in"));
  }

  let edges: Edge[];
  try {
    edges = (await Promise.all(queries)).flat();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Chyba čítania hrán" };
  }

  // Hydratácia protistrán jedným dotazom; hlásenie do zdrojov.
  const otherIds = [...new Set(edges.map((e) => e.other_id))];
  const others = new Map<string, ObjectRow>();
  if (otherIds.length > 0) {
    const { data, error } = await supabase
      .from("objects")
      .select(OBJECT_COLS)
      .in("id", otherIds);
    if (error) return { error: error.message };
    for (const o of (data ?? []) as ObjectRow[]) {
      others.set(o.id, o);
      sources.add(o);
    }
  }

  return {
    count: edges.length,
    relations: edges.map((e) => ({
      rel_type: e.rel_type,
      direction: e.direction,
      role: e.role,
      other: others.get(e.other_id) ?? { id: e.other_id },
    })),
  };
}

async function getElementDrawings(input: { id?: string }, sources: SourceCollector) {
  if (!input.id) return { error: "id je povinný" };
  const supabase = getSupabaseAdmin();

  // E4 väzby prvok → výkres (diskriminátor source, D-041).
  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("to_id")
    .eq("from_id", input.id)
    .eq("source", PDF_LINK_SOURCE)
    .is("valid_until", null)
    .limit(ROW_LIMIT);
  if (error) return { error: error.message };

  const docIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
  if (docIds.length === 0) return { count: 0, drawings: [] };

  const { data: docs, error: dErr } = await supabase
    .from("objects")
    .select(`${OBJECT_COLS}, properties`)
    .in("id", docIds);
  if (dErr) return { error: dErr.message };

  const drawings = ((docs ?? []) as (ObjectRow & {
    properties: Record<string, unknown> | null;
  })[]).map((doc) => {
    sources.add(doc);
    // Regióny tohto prvku v `_drawing_links` (D-042 fáza A) → strana + label.
    const raw = (doc.properties?.["_drawing_links"] ?? []) as {
      page?: unknown;
      target_id?: unknown;
      label?: unknown;
    }[];
    const regions = raw
      .filter((r) => r.target_id === input.id && typeof r.page === "number")
      .map((r) => ({
        page: r.page as number,
        label: typeof r.label === "string" ? r.label : null,
      }));

    const refs: SourceDrawingRef[] = (regions.length > 0
      ? regions
      : [{ page: null, label: null }]
    ).map((r) => ({
      drawingId: doc.id,
      drawingName: doc.name ?? doc.object_ref,
      page: r.page,
      label: r.label,
    }));
    sources.addDrawings(input.id!, refs);

    return {
      drawing_id: doc.id,
      object_ref: doc.object_ref,
      name: doc.name,
      regions,
    };
  });

  return { count: drawings.length, drawings };
}

/** Dispatch tool volania od modelu na executor. Neznámy tool = chybový výsledok. */
export async function executeTool(
  name: string,
  input: unknown,
  sources: SourceCollector
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, string | undefined>;
  switch (name) {
    case "search_objects":
      return searchObjects(args, sources);
    case "get_object":
      return getObject(args, sources);
    case "list_related":
      return listRelated(args, sources);
    case "get_element_drawings":
      return getElementDrawings(args, sources);
    default:
      return { error: `Neznámy tool: ${name}` };
  }
}
