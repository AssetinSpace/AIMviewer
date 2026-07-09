import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PDF_LINK_SOURCE } from "@/lib/data/constants";
import type { ToolDefinition } from "./provider";

/**
 * Read-only tools LLM rozhrania (D-056) — tool-calling nad whitelistom, NIE
 * text-to-SQL. Guardraily D-005: každý tool dotazuje len whitelistované
 * views/tabuľky, má tvrdý row-cap a nikdy nezapisuje. Vzťahy idú výhradne cez
 * kanonické `rel_*` views (D-051), nikdy cez base `relationships`.
 *
 * Trust loop: runtime pri každom tool výsledku zbiera „zdroje" (objekty, ktoré
 * sa v odpovedi vyskytli) a po skončení slučky ich obohatí o aktívny IFC GUID
 * (deep-link do 3D) a E4 výkresy (deep-link do výkresu) — dohľadateľnosť
 * nezávisí od formátovania modelu.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Max dĺžka JSON payloadu tool výsledku (ochrana kontextu). */
const MAX_RESULT_CHARS = 12_000;

/** Whitelist kanonických views vzťahov (D-051) — jediné povolené `rel_type`. */
const REL_VIEWS = new Set([
  "rel_aggregates",
  "rel_contained_in_spatial_structure",
  "rel_defines_by_type",
  "rel_associates_document",
  "rel_associates_classification",
  "rel_assigns_to_actor",
  "rel_assigns_to_group",
  "rel_member_of",
]);

/** Zdroj pre trust loop — deep-linky renderuje UI, nie model. */
export interface AskSource {
  id: string;
  objectType: string;
  objectRef: string | null;
  name: string | null;
  /** Segment detail route: `asset_type` → type, document → drawing, inak node. */
  route: "node" | "type" | "drawing";
  /** Aktívny IFC GUID (deep-link `/ifc?focus=<guid>`); null = nie je v 3D. */
  ifcGuid: string | null;
  /** Výkresy, kde je prvok zobrazený (deep-link `/drawing/[docId]?focus=<id>`). */
  drawings: { docId: string; docName: string | null; page: number | null }[];
}

/** Záznam o vykonanom tool calle (transparentnosť v UI). */
export interface AskToolTrace {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  /** Krátky súhrn výsledku (počet riadkov / chyba). */
  summary: string;
}

interface ObjectRow {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type?: string | null;
  predefined_type?: string | null;
}

function routeFor(objectType: string): AskSource["route"] {
  if (objectType === "asset_type") return "type";
  if (objectType === "document") return "drawing";
  return "node";
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/** Sanitizácia textu do PostgREST `or=`/`ilike` filtra (čiarky/zátvorky = syntax). */
function sanitizeQuery(raw: unknown): string {
  return String(raw ?? "").replace(/[,()%]/g, " ").trim().slice(0, 100);
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_objects",
    description:
      "Fulltext vyhľadanie uzlov grafu (objects) podľa názvu alebo object_ref. " +
      "Voliteľne filtruj podľa object_type (asset, asset_type, space, floor, building, " +
      "site, system, document, person, organization) alebo IFC triedy (ifc_type, napr. IfcDoor).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov alebo object_ref, ilike)" },
        object_type: { type: "string", description: "Filter na object_type" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (presná zhoda)" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
    },
  },
  {
    name: "get_object",
    description:
      "Detail jedného uzla podľa UUID alebo object_ref (napr. 'DD01.06.03'): " +
      "identita, IFC trieda, predefined_type, aktívny IFC GUID.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_ref: { type: "string", description: "objects.id (UUID) alebo object_ref" },
      },
      required: ["id_or_ref"],
    },
  },
  {
    name: "get_asset_details",
    description:
      "Efektívne vlastnosti assetu (dedičnosť type→occurrence, v_asset_effective) + " +
      "klasifikácie (v_asset_classifications, union vlastných a zdedených). Len pre object_type='asset'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id assetu (UUID)" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_relations",
    description:
      "Vzťahy uzla cez kanonické views: rel_aggregates (dekompozícia štruktúry), " +
      "rel_contained_in_spatial_structure (prvok v priestore), rel_defines_by_type (occurrence→typ), " +
      "rel_associates_document (uzol→dokument), rel_associates_classification, " +
      "rel_assigns_to_actor (zodpovednosti, aktor→uzol), rel_assigns_to_group (člen→systém), " +
      "rel_member_of (osoba→organizácia). Smer je subjekt(from)→objekt(to); zadaj from_id alebo to_id.",
    inputSchema: {
      type: "object",
      properties: {
        rel_type: { type: "string", description: "Názov kanonického view (rel_*)" },
        from_id: { type: "string", description: "Filter na subjekt (objects.id)" },
        to_id: { type: "string", description: "Filter na objekt (objects.id)" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
      required: ["rel_type"],
    },
  },
  {
    name: "get_spatial_path",
    description:
      "Priestorové zaradenie uzla — cesta nahor (asset → space → floor → building → site) " +
      "cez rel_contained_in_spatial_structure a rel_aggregates. Odpovedá na 'v ktorej miestnosti/podlaží je X'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id (UUID)" },
      },
      required: ["id"],
    },
  },
  {
    name: "find_in_drawings",
    description:
      "Výkresy, v ktorých je prvok (asset/asset_type) zobrazený (E4 auto-linking) vrátane " +
      "čísel strán s regiónom prvku. Odpovedá na 'na ktorých výkresoch a kde je X'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id prvku (UUID)" },
      },
      required: ["id"],
    },
  },
];

export interface ToolExecution {
  content: string;
  isError: boolean;
}

/** Runtime jednej /api/ask požiadavky: vykonáva tools + zbiera zdroje a trace. */
export class AskToolRuntime {
  private sources = new Map<string, AskSource>();
  readonly trace: AskToolTrace[] = [];

  /** Zaregistruje objekt medzi zdroje (dedupe podľa id). */
  private addSource(row: ObjectRow) {
    if (this.sources.has(row.id)) return;
    this.sources.set(row.id, {
      id: row.id,
      objectType: row.object_type,
      objectRef: row.object_ref ?? null,
      name: row.name ?? null,
      route: routeFor(row.object_type),
      ifcGuid: null,
      drawings: [],
    });
  }

  private async loadObjects(ids: string[]): Promise<ObjectRow[]> {
    if (ids.length === 0) return [];
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type")
      .in("id", [...new Set(ids)].slice(0, MAX_LIMIT * 2));
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ObjectRow[];
    for (const r of rows) this.addSource(r);
    return rows;
  }

  async exec(name: string, input: Record<string, unknown>): Promise<ToolExecution> {
    try {
      const result = await this.dispatch(name, input);
      let content = JSON.stringify(result);
      if (content.length > MAX_RESULT_CHARS) {
        content = content.slice(0, MAX_RESULT_CHARS) + "…(orezané)";
      }
      const count = Array.isArray(result)
        ? result.length
        : typeof result === "object" && result !== null && "rows" in result &&
            Array.isArray((result as { rows: unknown[] }).rows)
          ? (result as { rows: unknown[] }).rows.length
          : 1;
      this.trace.push({ name, input, ok: true, summary: `${count} výsledkov` });
      return { content, isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.trace.push({ name, input, ok: false, summary: msg.slice(0, 200) });
      return { content: `Chyba toolu: ${msg.slice(0, 300)}`, isError: true };
    }
  }

  private async dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "search_objects":
        return this.searchObjects(input);
      case "get_object":
        return this.getObject(input);
      case "get_asset_details":
        return this.getAssetDetails(input);
      case "list_relations":
        return this.listRelations(input);
      case "get_spatial_path":
        return this.getSpatialPath(input);
      case "find_in_drawings":
        return this.findInDrawings(input);
      default:
        throw new Error(`Neznámy tool '${name}'.`);
    }
  }

  private async searchObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const limit = clampLimit(input.limit);
    let q = supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type")
      .limit(limit);

    const query = sanitizeQuery(input.query);
    if (query) q = q.or(`name.ilike.%${query}%,object_ref.ilike.%${query}%`);
    if (typeof input.object_type === "string" && input.object_type)
      q = q.eq("object_type", input.object_type);
    if (typeof input.ifc_type === "string" && input.ifc_type)
      q = q.eq("ifc_type", input.ifc_type);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ObjectRow[];
    for (const r of rows) this.addSource(r);
    return rows;
  }

  private async getObject(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const idOrRef = String(input.id_or_ref ?? "").trim();
    if (!idOrRef) throw new Error("Chýba id_or_ref.");

    const col = isUuid(idOrRef) ? "id" : "object_ref";
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type, user_defined_type")
      .eq(col, idOrRef)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = data?.[0] as (ObjectRow & { user_defined_type?: string | null }) | undefined;
    if (!row) return { found: false, hint: "Uzol neexistuje — skús search_objects." };
    this.addSource(row);

    const { data: guidRows } = await supabase
      .from("ifc_guid_history")
      .select("ifc_guid")
      .eq("object_id", row.id)
      .is("valid_until", null)
      .limit(1);
    return { ...row, ifc_guid: guidRows?.[0]?.ifc_guid ?? null };
  }

  private async getAssetDetails(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const id = String(input.id ?? "").trim();
    if (!isUuid(id)) throw new Error("id musí byť UUID (objects.id).");

    const [effRes, clsRes] = await Promise.all([
      supabase
        .from("v_asset_effective")
        .select("id, object_ref, name, ifc_type, predefined_type, user_defined_type, properties, type_id, type_name")
        .eq("id", id)
        .limit(1),
      supabase
        .from("v_asset_classifications")
        .select("classification_ref_id, level")
        .eq("object_id", id)
        .limit(MAX_LIMIT),
    ]);
    if (effRes.error) throw new Error(effRes.error.message);
    const eff = effRes.data?.[0];
    if (!eff) return { found: false, hint: "Nie je asset — skús get_object." };
    if (clsRes.error) throw new Error(clsRes.error.message);

    const clsRows = (clsRes.data ?? []) as { classification_ref_id: string; level: string }[];
    let classifications: unknown[] = [];
    if (clsRows.length > 0) {
      const { data: refs, error: refErr } = await supabase
        .from("classification_references")
        .select("id, identification, name")
        .in("id", clsRows.map((c) => c.classification_ref_id));
      if (refErr) throw new Error(refErr.message);
      const byId = new Map((refs ?? []).map((r) => [r.id as string, r]));
      classifications = clsRows.map((c) => ({
        identification: byId.get(c.classification_ref_id)?.identification ?? null,
        name: byId.get(c.classification_ref_id)?.name ?? null,
        level: c.level,
      }));
    }

    this.addSource({
      id: eff.id as string,
      object_type: "asset",
      object_ref: (eff.object_ref as string | null) ?? null,
      name: (eff.name as string | null) ?? null,
    });
    if (eff.type_id) {
      this.addSource({
        id: eff.type_id as string,
        object_type: "asset_type",
        object_ref: null,
        name: (eff.type_name as string | null) ?? null,
      });
    }
    return { ...eff, classifications };
  }

  private async listRelations(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const relType = String(input.rel_type ?? "").trim();
    if (!REL_VIEWS.has(relType)) {
      throw new Error(
        `rel_type '${relType}' nie je vo whiteliste. Povolené: ${[...REL_VIEWS].join(", ")}.`
      );
    }
    const limit = clampLimit(input.limit);
    const fromId = typeof input.from_id === "string" ? input.from_id.trim() : "";
    const toId = typeof input.to_id === "string" ? input.to_id.trim() : "";
    if (!fromId && !toId) throw new Error("Zadaj from_id alebo to_id.");
    if (fromId && !isUuid(fromId)) throw new Error("from_id musí byť UUID.");
    if (toId && !isUuid(toId)) throw new Error("to_id musí byť UUID.");

    let q = supabase.from(relType).select("*").is("valid_until", null).limit(limit);
    if (fromId) q = q.eq("from_id", fromId);
    if (toId) q = q.eq("to_id", toId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { from_id: string; to_id: string; role?: string | null }[];
    // Klasifikačné to_id mieri do classification_references, nie objects.
    const isClassification = relType === "rel_associates_classification";
    const objIds = rows.flatMap((r) => (isClassification ? [r.from_id] : [r.from_id, r.to_id]));
    const metas = await this.loadObjects(objIds);
    const metaById = new Map(metas.map((m) => [m.id, m]));

    let classRefById = new Map<string, { identification: string; name: string | null }>();
    if (isClassification && rows.length > 0) {
      const { data: refs, error: refErr } = await supabase
        .from("classification_references")
        .select("id, identification, name")
        .in("id", rows.map((r) => r.to_id));
      if (refErr) throw new Error(refErr.message);
      classRefById = new Map(
        (refs ?? []).map((r) => [
          r.id as string,
          { identification: r.identification as string, name: (r.name as string | null) ?? null },
        ])
      );
    }

    return rows.map((r) => ({
      from: metaById.get(r.from_id) ?? { id: r.from_id },
      to: isClassification
        ? classRefById.get(r.to_id) ?? { id: r.to_id }
        : metaById.get(r.to_id) ?? { id: r.to_id },
      ...(r.role !== undefined ? { role: r.role } : {}),
    }));
  }

  private async getSpatialPath(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const id = String(input.id ?? "").trim();
    if (!isUuid(id)) throw new Error("id musí byť UUID (objects.id).");

    // Nahor: najprv fyzické umiestnenie (contained), potom dekompozícia (aggregates).
    const chainIds: string[] = [];
    let current = id;
    for (let depth = 0; depth < 8; depth++) {
      let parent: string | null = null;
      for (const view of ["rel_contained_in_spatial_structure", "rel_aggregates"]) {
        const { data, error } = await supabase
          .from(view)
          .select("to_id")
          .eq("from_id", current)
          .is("valid_until", null)
          .limit(1);
        if (error) throw new Error(error.message);
        if (data?.length) {
          parent = data[0].to_id as string;
          break;
        }
      }
      if (!parent || chainIds.includes(parent)) break;
      chainIds.push(parent);
      current = parent;
    }

    const metas = await this.loadObjects([id, ...chainIds]);
    const metaById = new Map(metas.map((m) => [m.id, m]));
    return {
      object: metaById.get(id) ?? { id },
      path: chainIds.map((cid) => metaById.get(cid) ?? { id: cid }),
    };
  }

  private async findInDrawings(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const id = String(input.id ?? "").trim();
    if (!isUuid(id)) throw new Error("id musí byť UUID (objects.id).");

    const { data: rels, error } = await supabase
      .from("rel_associates_document")
      .select("to_id")
      .eq("from_id", id)
      .eq("source", PDF_LINK_SOURCE)
      .is("valid_until", null)
      .limit(MAX_LIMIT);
    if (error) throw new Error(error.message);

    const docIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
    if (docIds.length === 0) return { drawings: [], hint: "Prvok nie je v žiadnom výkrese (E4)." };

    const { data: docs, error: docErr } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, properties")
      .in("id", docIds);
    if (docErr) throw new Error(docErr.message);

    const source = this.sources.get(id);
    const out = (docs ?? []).map((d) => {
      this.addSource(d as ObjectRow);
      // Strany, na ktorých má prvok región (_drawing_links, D-042).
      const links = ((d.properties as Record<string, unknown> | null)?.["_drawing_links"] ??
        []) as { page?: number; target_id?: string }[];
      const pages = [
        ...new Set(
          links
            .filter((l) => l.target_id === id && typeof l.page === "number")
            .map((l) => l.page as number)
        ),
      ].sort((a, b) => a - b);
      const entry = {
        docId: d.id as string,
        docName: (d.name as string | null) ?? null,
        page: pages[0] ?? null,
      };
      if (source && !source.drawings.some((x) => x.docId === entry.docId)) {
        source.drawings.push(entry);
      }
      return {
        ...entry,
        pages,
        deep_link: `/drawing/${d.id}?focus=${id}${pages[0] ? `&page=${pages[0]}` : ""}`,
      };
    });
    return { drawings: out };
  }

  /**
   * Po skončení slučky: obohatí zdroje o aktívne IFC GUIDy (3D deep-link) a
   * E4 výkresy prvkov, ktoré ich ešte nemajú. Zlyhanie obohatenia nezhodí
   * odpoveď — zdroje sa vrátia bez neho.
   */
  async finalizeSources(): Promise<AskSource[]> {
    const all = [...this.sources.values()];
    if (all.length === 0) return all;
    const supabase = getSupabaseAdmin();

    try {
      const ids = all.map((s) => s.id);
      const [guidRes, drawRes] = await Promise.all([
        supabase
          .from("ifc_guid_history")
          .select("object_id, ifc_guid")
          .in("object_id", ids)
          .is("valid_until", null),
        supabase
          .from("rel_associates_document")
          .select("from_id, to_id")
          .in("from_id", ids)
          .eq("source", PDF_LINK_SOURCE)
          .is("valid_until", null),
      ]);

      if (!guidRes.error) {
        const guidById = new Map(
          (guidRes.data ?? []).map((g) => [g.object_id as string, g.ifc_guid as string])
        );
        for (const s of all) s.ifcGuid = guidById.get(s.id) ?? null;
      }

      if (!drawRes.error) {
        const relRows = (drawRes.data ?? []) as { from_id: string; to_id: string }[];
        const docIds = [...new Set(relRows.map((r) => r.to_id))];
        if (docIds.length > 0) {
          const { data: docs } = await supabase
            .from("objects")
            .select("id, name")
            .in("id", docIds);
          const nameById = new Map(
            (docs ?? []).map((d) => [d.id as string, (d.name as string | null) ?? null])
          );
          for (const r of relRows) {
            const s = this.sources.get(r.from_id);
            if (s && !s.drawings.some((x) => x.docId === r.to_id)) {
              s.drawings.push({
                docId: r.to_id,
                docName: nameById.get(r.to_id) ?? null,
                page: null,
              });
            }
          }
        }
      }
    } catch {
      // bez obohatenia — zdroje aj tak vrátime
    }
    return all;
  }
}
