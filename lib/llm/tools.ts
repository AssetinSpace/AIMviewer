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
/** Koľko prvkov naraz zvládne lokalizácia (locate_objects). */
const LOCATE_CAP = 500;
/** Veľkosť dávky pre `.in()` filtre (limit dĺžky URL v PostgREST). */
const IN_CHUNK = 100;

/**
 * Whitelist relácií pre generický query_view (celá čitateľná DB, D-056 dodatok).
 * Base `relationships` zámerne chýba — LLM dotazuje len kanonické views (D-051).
 */
const QUERY_RELATIONS = new Set([
  "objects",
  "floors",
  "documents",
  "persons",
  "classification_systems",
  "classification_references",
  "ifc_guid_history",
  "relationship_types",
  "v_asset_effective",
  "v_asset_classifications",
  "v_floors",
  "v_actors",
  "v_property_dictionary",
  "rel_aggregates",
  "rel_contained_in_spatial_structure",
  "rel_defines_by_type",
  "rel_associates_document",
  "rel_associates_classification",
  "rel_assigns_to_actor",
  "rel_assigns_to_group",
  "rel_member_of",
]);

/** Povolené operátory filtra query_view (PostgREST). */
const QUERY_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]);

/** Stĺpec alebo JSONB cesta (properties->Pset_X->>Kľúč) — nič iné neprejde. */
const COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(->>?[a-zA-Z0-9_ .-]+)*$/;

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

/** UI akcia vyžiadaná modelom (show_in_3d…) — klient na ňu naviguje (D-056). */
export interface AskAction {
  type: "navigate";
  /** Interná cesta Viewera (server ju stavia z whitelistu — nikdy nie z modelu). */
  url: string;
  label: string;
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
    name: "get_model_stats",
    description:
      "Slovník modelu: počty uzlov podľa object_type, zoznam IFC tried assetov " +
      "(ifc_type × predefined_type) s počtami, zoznam psetov (názvy + počet properties), " +
      "podlažia, systémy, klasifikačné systémy a dokumenty. Zavolaj, keď nevieš, aké " +
      "triedy/podtypy/psety v projekte existujú, alebo keď search nič nenašiel — zistíš " +
      "správne hodnoty filtrov. Presné JSONB cesty (pset × property × typ hodnoty × " +
      "vzorky hodnôt) → query_view relation=v_property_dictionary (D-058).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_objects",
    description:
      "Vyhľadanie uzlov grafu (objects). `query` hľadá naraz v názve, object_ref, IFC triede " +
      "aj predefined_type (ilike). Filtre: object_type (asset, asset_type, space, floor, " +
      "building, site, system, document, person, organization), ifc_type = IFC trieda " +
      "(napr. IfcDoor, IfcUnitaryEquipment), predefined_type = IFC enum podtypu (napr. " +
      "AIRCONDITIONINGUNIT, VAV). POZOR: podtyp ako AIRCONDITIONINGUNIT je predefined_type, " +
      "NIE ifc_type. Na počty použi count_objects, na slovník hodnôt get_model_stats.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "Filter na object_type" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "Filter na IFC predefined_type enum (case-insensitive zhoda)" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
    },
  },
  {
    name: "count_objects",
    description:
      "Presný počet uzlov vyhovujúcich filtrom (rovnaké filtre ako search_objects). " +
      "Použi na otázky typu 'koľko X je v projekte' — search_objects vracia max " +
      `${MAX_LIMIT} riadkov, takže počítať z jeho výsledkov je nespoľahlivé.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "Filter na object_type" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "Filter na IFC predefined_type enum (case-insensitive zhoda)" },
      },
    },
  },
  {
    name: "locate_objects",
    description:
      "Nájde prvky podľa filtrov (rovnaké ako search_objects) a rovno určí, na ktorom " +
      "podlaží a v ktorej miestnosti sú — vráti presný celkový počet + rozpad po podlažiach " +
      "so vzorkou prvkov. Ideálne na otázky 'koľko X je v projekte a kde/na akých podlažiach'. " +
      "Alternatívne miesto filtrov prijme zoznam ids z predchádzajúceho hľadania.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "Filter na object_type (default asset)" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "Filter na IFC predefined_type enum (case-insensitive zhoda)" },
        ids: { type: "array", items: { type: "string" }, description: "Alternatíva k filtrom: konkrétne objects.id" },
      },
    },
  },
  {
    name: "query_view",
    description:
      "Generický read-only dopyt nad ľubovoľnou tabuľkou/view v DB (celá dátová vrstva). " +
      "Relácie: objects (uzly: id, object_type, object_ref, name, ifc_type, predefined_type, " +
      "user_defined_type, properties JSONB s psetmi), floors (elevation), documents, persons, " +
      "classification_systems/references, ifc_guid_history, relationship_types (manifest hrán), " +
      "v_asset_effective (properties s dedičnosťou type→occurrence), v_asset_classifications, " +
      "v_floors, v_actors, v_property_dictionary (slovník psetov z dát: object_type, ifc_type, " +
      "pset, property, value_type, object_count, sample_values, min/max_number — presné JSONB " +
      "cesty zisti TU, nehádaj ich) a hrany rel_aggregates, rel_contained_in_spatial_structure, " +
      "rel_defines_by_type, rel_associates_document, rel_associates_classification, " +
      "rel_assigns_to_actor, rel_assigns_to_group, rel_member_of (všetky: from_id→to_id, " +
      "valid_until null = aktívna). JSONB cesty fungujú v select aj filtri: " +
      "properties->Pset_ValveTypeIsolating->>IsNormallyOpen. Join nie je — reťaz dopyty " +
      "cez op 'in' so zoznamom id z predchádzajúceho výsledku.",
    inputSchema: {
      type: "object",
      properties: {
        relation: { type: "string", description: "Názov tabuľky/view z whitelistu" },
        select: {
          type: "array",
          items: { type: "string" },
          description: "Stĺpce (default *). JSONB cesta: properties->Pset->>Kľúč",
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op: { type: "string", description: "eq|neq|gt|gte|lt|lte|like|ilike|is|in" },
              value: { description: "Hodnota; pre 'in' pole hodnôt; pre 'is' null" },
            },
            required: ["column", "op"],
          },
          description: "AND filtre",
        },
        order: {
          type: "object",
          properties: {
            column: { type: "string" },
            ascending: { type: "boolean" },
          },
          description: "Zoradenie výsledku",
        },
        count_only: { type: "boolean", description: "true = vráť len presný počet riadkov" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
      required: ["relation"],
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
    name: "show_in_3d",
    description:
      "UI AKCIA: otvorí 3D model so zvýraznenými a priblíženými prvkami. Zavolaj, keď " +
      "používateľ žiada prvky UKÁZAŤ/ZOBRAZIŤ v 3D. Najprv prvky nájdi (search/locate), " +
      "potom pošli VŠETKY naraz v ids_or_refs (viac prvkov = JEDEN call, nie viac callov). " +
      "Funguje len pre prvky s IFC GUID (sú z IFC modelu).",
    inputSchema: {
      type: "object",
      properties: {
        ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: "objects.id (UUID) alebo object_ref prvkov na zvýraznenie (1–20)",
        },
        id_or_ref: { type: "string", description: "Alternatíva pre jediný prvok" },
      },
    },
  },
  {
    name: "open_drawing",
    description:
      "UI AKCIA: otvorí výkres/dokument v prehliadačke, voliteľne so zvýrazneným prvkom " +
      "a stranou. Zavolaj, keď používateľ žiada otvoriť/ukázať výkres alebo prvok vo výkrese " +
      "(document_id a page zisti cez find_in_drawings).",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "objects.id dokumentu (UUID)" },
        focus_id: { type: "string", description: "Voliteľné: objects.id prvku na zvýraznenie" },
        page: { type: "number", description: "Voliteľné: číslo strany" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "open_node",
    description:
      "UI AKCIA: otvorí detailnú kartu uzla (asset, typ, miestnosť, podlažie, systém, " +
      "osoba, organizácia…). Zavolaj, keď používateľ žiada otvoriť/ukázať detail alebo kartu.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_ref: { type: "string", description: "objects.id (UUID) alebo object_ref uzla" },
      },
      required: ["id_or_ref"],
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
  /** UI akcie vyžiadané modelom — route ich vráti klientovi na vykonanie. */
  readonly actions: AskAction[] = [];

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
    const unique = [...new Set(ids)].slice(0, LOCATE_CAP);
    if (unique.length === 0) return [];
    const supabase = getSupabaseAdmin();
    const rows: ObjectRow[] = [];
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name, ifc_type, predefined_type")
        .in("id", unique.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as ObjectRow[]));
    }
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
      case "get_model_stats":
        return this.getModelStats();
      case "search_objects":
        return this.searchObjects(input);
      case "count_objects":
        return this.countObjects(input);
      case "locate_objects":
        return this.locateObjects(input);
      case "query_view":
        return this.queryView(input);
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
      case "show_in_3d":
        return this.showIn3d(input);
      case "open_drawing":
        return this.openDrawing(input);
      case "open_node":
        return this.openNode(input);
      default:
        throw new Error(`Neznámy tool '${name}'.`);
    }
  }

  /** Spoločné filtre search_objects/count_objects nad `objects`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyObjectFilters<T extends { or: any; ilike: any; eq: any }>(
    q: T,
    input: Record<string, unknown>
  ): T {
    const query = sanitizeQuery(input.query);
    if (query) {
      // Hľadáme naprieč identitou aj IFC typológiou — podtyp (AIRCONDITIONINGUNIT)
      // žije v predefined_type, nie v názve (poučenie z prevádzky, D-056).
      q = q.or(
        `name.ilike.%${query}%,object_ref.ilike.%${query}%,` +
          `ifc_type.ilike.%${query}%,predefined_type.ilike.%${query}%`
      );
    }
    if (typeof input.object_type === "string" && input.object_type)
      q = q.eq("object_type", input.object_type);
    // ilike bez % = case-insensitive presná zhoda (model píše ifcdoor/IFCDOOR…).
    const ifcType = sanitizeQuery(input.ifc_type);
    if (ifcType) q = q.ilike("ifc_type", ifcType);
    const predefinedType = sanitizeQuery(input.predefined_type);
    if (predefinedType) q = q.ilike("predefined_type", predefinedType);
    return q;
  }

  private async searchObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const limit = clampLimit(input.limit);
    const q = this.applyObjectFilters(
      supabase
        .from("objects")
        .select("id, object_type, object_ref, name, ifc_type, predefined_type"),
      input
    ).limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ObjectRow[];
    for (const r of rows) this.addSource(r);
    if (rows.length === 0) {
      return { rows, hint: "Nič sa nenašlo — zavolaj get_model_stats a over hodnoty filtrov." };
    }
    return rows;
  }

  private async countObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const q = this.applyObjectFilters(
      supabase.from("objects").select("id", { count: "exact", head: true }),
      input
    );
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  }

  /**
   * Batch lokalizácia: prvky podľa filtrov/ids → podlažie (+ miestnosť) na
   * jeden call. Containment: prvok →(contained_in) space|floor; space
   * →(aggregates) floor (MEP býva rovno na podlaží, D-049).
   */
  private async locateObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();

    let elements: ObjectRow[];
    let total: number;
    const idsInput = Array.isArray(input.ids)
      ? (input.ids as unknown[]).filter((v): v is string => typeof v === "string" && isUuid(v))
      : [];
    if (idsInput.length > 0) {
      elements = await this.loadObjects(idsInput.slice(0, LOCATE_CAP));
      total = elements.length;
    } else {
      const filters = { object_type: "asset", ...input };
      const [listRes, countRes] = await Promise.all([
        this.applyObjectFilters(
          supabase
            .from("objects")
            .select("id, object_type, object_ref, name, ifc_type, predefined_type"),
          filters
        ).limit(LOCATE_CAP),
        this.applyObjectFilters(
          supabase.from("objects").select("id", { count: "exact", head: true }),
          filters
        ),
      ]);
      if (listRes.error) throw new Error(listRes.error.message);
      if (countRes.error) throw new Error(countRes.error.message);
      elements = (listRes.data ?? []) as ObjectRow[];
      total = countRes.count ?? elements.length;
    }
    if (elements.length === 0) {
      return { total: 0, hint: "Nič sa nenašlo — over hodnoty filtrov cez get_model_stats." };
    }

    // Rodičia (space alebo priamo floor) po dávkach.
    const elementIds = elements.map((e) => e.id);
    const parentByElement = new Map<string, string>();
    for (let i = 0; i < elementIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("rel_contained_in_spatial_structure")
        .select("from_id, to_id")
        .in("from_id", elementIds.slice(i, i + IN_CHUNK))
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { from_id: string; to_id: string }[]) {
        parentByElement.set(r.from_id, r.to_id);
      }
    }

    const parentIds = [...new Set(parentByElement.values())];
    const parents = new Map<string, ObjectRow>();
    for (let i = 0; i < parentIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name")
        .in("id", parentIds.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as ObjectRow[]) parents.set(r.id, r);
    }

    // space → floor (rel_aggregates, smer dieťa→rodič).
    const spaceIds = parentIds.filter((id) => parents.get(id)?.object_type === "space");
    const floorBySpace = new Map<string, string>();
    for (let i = 0; i < spaceIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("rel_aggregates")
        .select("from_id, to_id")
        .in("from_id", spaceIds.slice(i, i + IN_CHUNK))
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { from_id: string; to_id: string }[]) {
        floorBySpace.set(r.from_id, r.to_id);
      }
    }
    const floorIds = [...new Set(floorBySpace.values())].filter((id) => !parents.has(id));
    for (let i = 0; i < floorIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name")
        .in("id", floorIds.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as ObjectRow[]) parents.set(r.id, r);
    }

    // Zoskupenie po podlažiach; vzorka prvkov (+miestnosť) na podlažie.
    const SAMPLE = 10;
    const groups = new Map<
      string,
      { floor: { id: string; name: string | null; object_ref: string | null } | null; count: number; sample: unknown[] }
    >();
    for (const el of elements) {
      const parentId = parentByElement.get(el.id);
      const parent = parentId ? parents.get(parentId) : undefined;
      const floorId =
        parent?.object_type === "floor"
          ? parent.id
          : parent?.object_type === "space"
            ? floorBySpace.get(parent.id)
            : undefined;
      const floor = floorId ? parents.get(floorId) : undefined;
      const key = floor?.id ?? "bez-podlažia";
      let g = groups.get(key);
      if (!g) {
        g = {
          floor: floor
            ? { id: floor.id, name: floor.name ?? null, object_ref: floor.object_ref ?? null }
            : null,
          count: 0,
          sample: [],
        };
        groups.set(key, g);
        if (floor) this.addSource(floor);
      }
      g.count += 1;
      if (g.sample.length < SAMPLE) {
        this.addSource(el);
        g.sample.push({
          id: el.id,
          object_ref: el.object_ref,
          name: el.name,
          ifc_type: el.ifc_type,
          predefined_type: el.predefined_type,
          space: parent?.object_type === "space" ? (parent.name ?? parent.object_ref) : null,
        });
      }
    }

    return {
      total,
      located: elements.length,
      truncated: total > elements.length,
      by_floor: [...groups.values()].sort((a, b) => b.count - a.count),
    };
  }

  /** Generický read-only dopyt nad whitelistom relácií (celá dátová vrstva). */
  private async queryView(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const relation = String(input.relation ?? "").trim();
    if (!QUERY_RELATIONS.has(relation)) {
      throw new Error(
        `Relácia '${relation}' nie je vo whiteliste. Povolené: ${[...QUERY_RELATIONS].join(", ")}.`
      );
    }

    const selectCols = Array.isArray(input.select)
      ? (input.select as unknown[]).filter(
          (c): c is string => typeof c === "string" && COLUMN_RE.test(c)
        )
      : [];
    const select = selectCols.length > 0 ? selectCols.join(", ") : "*";

    const countOnly = input.count_only === true;
    let q = countOnly
      ? supabase.from(relation).select("*", { count: "exact", head: true })
      : supabase.from(relation).select(select).limit(clampLimit(input.limit));

    const filters = Array.isArray(input.filters) ? (input.filters as unknown[]) : [];
    for (const f of filters) {
      if (typeof f !== "object" || f === null) continue;
      const { column, op, value } = f as { column?: unknown; op?: unknown; value?: unknown };
      const col = String(column ?? "");
      const operator = String(op ?? "");
      if (!COLUMN_RE.test(col)) throw new Error(`Neplatný stĺpec '${col}'.`);
      if (!QUERY_OPS.has(operator))
        throw new Error(`Neplatný operátor '${operator}' — povolené: ${[...QUERY_OPS].join(", ")}.`);
      if (operator === "in") {
        const vals = Array.isArray(value) ? value : [value];
        q = q.in(col, vals.slice(0, IN_CHUNK));
      } else if (operator === "is") {
        q = q.is(col, value === "null" ? null : (value as boolean | null));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        q = (q as any)[operator](col, value);
      }
    }

    const order = input.order as { column?: unknown; ascending?: unknown } | undefined;
    if (!countOnly && order && typeof order.column === "string" && COLUMN_RE.test(order.column)) {
      q = q.order(order.column, { ascending: order.ascending !== false });
    }

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    if (countOnly) return { count: count ?? 0 };

    const rows = (data ?? []) as Record<string, unknown>[];
    // Uzly do zdrojov (trust loop) — podľa tvaru riadku (objects/v_* views).
    for (const r of rows) {
      if (typeof r.id === "string" && (typeof r.object_type === "string" || relation === "v_asset_effective")) {
        this.addSource({
          id: r.id,
          object_type: (r.object_type as string | undefined) ?? "asset",
          object_ref: (r.object_ref as string | null | undefined) ?? null,
          name: (r.name as string | null | undefined) ?? null,
        });
      }
    }
    return { rows, row_count: rows.length };
  }

  /** Slovník modelu — grounding pre filtre (model nemusí hádať hodnoty). */
  private async getModelStats() {
    const supabase = getSupabaseAdmin();
    // Jadro (objects) je povinné; grounding bloky (psety, podlažia, systémy,
    // klasifikácie, dokumenty — D-058) sú best-effort: ich výpadok nezhodí tool.
    const [objRes, psetRes, floorsRes, systemsRes, clsSysRes, docsRes] = await Promise.all([
      supabase.from("objects").select("object_type, ifc_type, predefined_type").limit(10000),
      supabase.from("v_property_dictionary").select("pset, property").limit(5000),
      supabase
        .from("v_floors")
        .select("name, elevation")
        .order("elevation", { ascending: true })
        .limit(50),
      supabase.from("objects").select("name").eq("object_type", "system").limit(50),
      supabase.from("classification_systems").select("name").limit(20),
      supabase.from("objects").select("name").eq("object_type", "document").limit(50),
    ]);
    const { data, error } = objRes;
    if (error) throw new Error(error.message);

    const byObjectType = new Map<string, number>();
    const byClass = new Map<string, { ifc_type: string; predefined_type: string | null; count: number }>();
    for (const r of (data ?? []) as {
      object_type: string;
      ifc_type: string | null;
      predefined_type: string | null;
    }[]) {
      byObjectType.set(r.object_type, (byObjectType.get(r.object_type) ?? 0) + 1);
      if ((r.object_type === "asset" || r.object_type === "asset_type") && r.ifc_type) {
        const key = `${r.object_type}|${r.ifc_type}|${r.predefined_type ?? ""}`;
        const entry = byClass.get(key);
        if (entry) entry.count += 1;
        else
          byClass.set(key, {
            ifc_type: r.ifc_type,
            predefined_type: r.predefined_type,
            count: 1,
          });
      }
    }

    // Psety: názov → počet properties (presné cesty žijú vo v_property_dictionary).
    const psetProps = new Map<string, Set<string>>();
    for (const r of (psetRes.error ? [] : (psetRes.data ?? [])) as {
      pset: string;
      property: string;
    }[]) {
      let set = psetProps.get(r.pset);
      if (!set) {
        set = new Set();
        psetProps.set(r.pset, set);
      }
      set.add(r.property);
    }
    const names = (res: { error: unknown; data: { name: string | null }[] | null }) =>
      res.error ? [] : (res.data ?? []).map((r) => r.name).filter(Boolean);

    return {
      object_types: Object.fromEntries(byObjectType),
      // Len occurrence triedy (asset) — typy by duplikovali slovník.
      asset_classes: [...byClass.entries()]
        .filter(([k]) => k.startsWith("asset|"))
        .map(([, v]) => v)
        .sort((a, b) => b.count - a.count)
        .slice(0, 150),
      psets: [...psetProps.entries()]
        .map(([pset, props]) => ({ pset, properties: props.size }))
        .sort((a, b) => b.properties - a.properties)
        .slice(0, 100),
      psets_hint:
        "Presné cesty properties->Pset->>Key, typy hodnôt a vzorky: " +
        "query_view relation=v_property_dictionary (filtruj ifc_type/pset).",
      floors: floorsRes.error ? [] : (floorsRes.data ?? []),
      systems: names(systemsRes),
      classification_systems: names(clsSysRes),
      documents: names(docsRes),
    };
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

  /** Uzol podľa UUID alebo object_ref — spoločné pre akčné tools. */
  private async resolveObject(idOrRef: string): Promise<ObjectRow | null> {
    const supabase = getSupabaseAdmin();
    const value = idOrRef.trim();
    if (!value) return null;
    const col = isUuid(value) ? "id" : "object_ref";
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type")
      .eq(col, value)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data?.[0] as ObjectRow | undefined) ?? null;
    if (row) this.addSource(row);
    return row;
  }

  private async showIn3d(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const refs: string[] = [];
    if (Array.isArray(input.ids_or_refs)) {
      refs.push(
        ...(input.ids_or_refs as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        )
      );
    }
    const single = String(input.id_or_ref ?? "").trim();
    if (single) refs.push(single);
    if (refs.length === 0) throw new Error("Zadaj ids_or_refs (pole) alebo id_or_ref.");

    const shown: { label: string; guid: string }[] = [];
    const skipped: string[] = [];
    for (const ref of [...new Set(refs)].slice(0, 20)) {
      const obj = await this.resolveObject(ref);
      if (!obj) {
        skipped.push(`${ref} (neexistuje)`);
        continue;
      }
      const { data, error } = await supabase
        .from("ifc_guid_history")
        .select("ifc_guid")
        .eq("object_id", obj.id)
        .is("valid_until", null)
        .limit(1);
      if (error) throw new Error(error.message);
      const guid = data?.[0]?.ifc_guid as string | undefined;
      const label = obj.object_ref ?? obj.name ?? obj.id.slice(0, 8);
      if (!guid) skipped.push(`${label} (bez IFC GUID — nie je v 3D)`);
      else shown.push({ label, guid });
    }
    if (shown.length === 0) {
      throw new Error(`Žiadny z prvkov sa nedá zobraziť v 3D: ${skipped.join(", ")}.`);
    }

    this.actions.push({
      type: "navigate",
      url: `/ifc?focus=${encodeURIComponent(shown.map((s) => s.guid).join(","))}`,
      label: shown.length === 1 ? `3D: ${shown[0].label}` : `3D: ${shown.length} prvkov`,
    });
    return {
      ok: true,
      opened: "3d",
      shown: shown.map((s) => s.label),
      ...(skipped.length ? { skipped } : {}),
    };
  }

  private async openDrawing(input: Record<string, unknown>) {
    const docId = String(input.document_id ?? "").trim();
    if (!isUuid(docId)) throw new Error("document_id musí byť UUID (objects.id dokumentu).");
    const doc = await this.resolveObject(docId);
    if (!doc || doc.object_type !== "document") {
      throw new Error("Dokument neexistuje — id výkresu zisti cez find_in_drawings.");
    }

    const focusId = typeof input.focus_id === "string" && isUuid(input.focus_id.trim())
      ? input.focus_id.trim()
      : null;
    const page =
      typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
        ? Math.floor(input.page)
        : null;

    const params = new URLSearchParams();
    if (focusId) params.set("focus", focusId);
    if (page) params.set("page", String(page));
    const qs = params.toString();
    const label = doc.name ?? doc.object_ref ?? "výkres";
    this.actions.push({
      type: "navigate",
      url: `/drawing/${doc.id}${qs ? `?${qs}` : ""}`,
      label: `Výkres: ${label}`,
    });
    return { ok: true, opened: "drawing", document: label };
  }

  private async openNode(input: Record<string, unknown>) {
    const obj = await this.resolveObject(String(input.id_or_ref ?? ""));
    if (!obj) throw new Error("Uzol neexistuje — najprv ho nájdi cez search_objects.");
    const label = obj.name ?? obj.object_ref ?? obj.id.slice(0, 8);
    this.actions.push({
      type: "navigate",
      url: `/${routeFor(obj.object_type)}/${obj.id}`,
      label: `Karta: ${label}`,
    });
    return { ok: true, opened: "node", node: label, object_type: obj.object_type };
  }

  /**
   * Akcie pre klienta: viac 3D akcií (model občas zavolá show_in_3d per prvok
   * napriek inštrukcii) sa zlúči do jednej multi-focus URL — klient vykonáva
   * len prvú navigáciu, bez zlúčenia by sa zvýraznil jediný prvok.
   */
  finalActions(): AskAction[] {
    const PREFIX = "/ifc?focus=";
    const ifcActions = this.actions.filter((a) => a.url.startsWith(PREFIX));
    if (ifcActions.length <= 1) return this.actions;

    const guids = [
      ...new Set(
        ifcActions.flatMap((a) =>
          decodeURIComponent(a.url.slice(PREFIX.length)).split(",")
        )
      ),
    ];
    const merged: AskAction = {
      type: "navigate",
      url: `${PREFIX}${encodeURIComponent(guids.join(","))}`,
      label: `3D: ${guids.length} prvkov`,
    };
    return [merged, ...this.actions.filter((a) => !a.url.startsWith(PREFIX))];
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
      const guidById = new Map<string, string>();
      const relRows: { from_id: string; to_id: string }[] = [];
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const chunk = ids.slice(i, i + IN_CHUNK);
        const [guidRes, drawRes] = await Promise.all([
          supabase
            .from("ifc_guid_history")
            .select("object_id, ifc_guid")
            .in("object_id", chunk)
            .is("valid_until", null),
          supabase
            .from("rel_associates_document")
            .select("from_id, to_id")
            .in("from_id", chunk)
            .eq("source", PDF_LINK_SOURCE)
            .is("valid_until", null),
        ]);
        if (!guidRes.error) {
          for (const g of guidRes.data ?? [])
            guidById.set(g.object_id as string, g.ifc_guid as string);
        }
        if (!drawRes.error) {
          relRows.push(...((drawRes.data ?? []) as { from_id: string; to_id: string }[]));
        }
      }

      for (const s of all) s.ifcGuid = guidById.get(s.id) ?? null;

      {
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
