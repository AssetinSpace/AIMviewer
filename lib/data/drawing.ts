import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/** Spoločné ISR nastavenie pre cachované čítania (D-029 perf). */
const AIM_CACHE = { revalidate: 60, tags: ["aim"] };

/**
 * Data-access vrstva pre in-app prehliadačku výkresov (D-042 fáza C). Číta zdrojové
 * PDF (`documents.location`, verejný Supabase Storage bucket) + klikateľné link
 * regióny z `objects.properties._drawing_links` (zapísané ETL fázou A, `pdf_link.py`).
 *
 * `_drawing_links` má snake_case kľúče (zapisuje ich Python); tu sa mapujú na camelCase.
 * Súradnice `bbox` sú v PDF bottom-left (y hore) — render ich preklápa na zdroji UI.
 */

/** Jeden klikateľný región vo výkrese (`_drawing_links`, D-042). */
export interface DrawingRegion {
  /** 1-based číslo strany. */
  page: number;
  /** PDF bottom-left [x0, y0, x1, y1] (body). */
  bbox: [number, number, number, number];
  /** Rozmer strany [šírka, výška] v bodoch — referenčná báza pre škálovanie. */
  pageSize: [number, number];
  /** Cieľový `objects.id` (asset / asset_type). */
  targetId: string;
  /** Segment route detailu prvku. */
  targetRoute: "node" | "type";
  /** Dôverová vrstva detekcie (D-041). */
  layer: "full" | "proximity" | "bare";
  /** Zobrazený SNIM kód. */
  label: string;
}

/** Výkres pre prehliadačku: verejné PDF URL + klikateľné regióny. */
export interface DrawingDoc {
  id: string;
  name: string | null;
  objectRef: string | null;
  /** Verejné PDF URL (`documents.location`). */
  location: string;
  links: DrawingRegion[];
}

type RawRegion = {
  page?: unknown;
  bbox?: unknown;
  page_size?: unknown;
  target_id?: unknown;
  target_route?: unknown;
  layer?: unknown;
  label?: unknown;
};

function normalizeRegion(r: RawRegion): DrawingRegion | null {
  if (
    typeof r.page !== "number" ||
    !Array.isArray(r.bbox) ||
    r.bbox.length !== 4 ||
    !Array.isArray(r.page_size) ||
    r.page_size.length !== 2 ||
    typeof r.target_id !== "string"
  ) {
    return null;
  }
  return {
    page: r.page,
    bbox: r.bbox as [number, number, number, number],
    pageSize: r.page_size as [number, number],
    targetId: r.target_id,
    targetRoute: r.target_route === "type" ? "type" : "node",
    layer: (r.layer as DrawingRegion["layer"]) ?? "full",
    label: typeof r.label === "string" ? r.label : "",
  };
}

async function fetchDrawingImpl(id: string): Promise<DrawingDoc | null> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_ref, name, object_type, properties")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj || obj.object_type !== "document") return null;

  const { data: doc, error: dErr } = await supabase
    .from("documents")
    .select("location")
    .eq("id", id)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);

  const location = (doc?.location as string | null) ?? null;
  if (!location) return null; // bez PDF nie je čo zobraziť

  const raw = ((obj.properties as Record<string, unknown> | null)?.[
    "_drawing_links"
  ] ?? []) as RawRegion[];
  const links = raw
    .map(normalizeRegion)
    .filter((r): r is DrawingRegion => r !== null);

  return {
    id: obj.id as string,
    name: (obj.name as string | null) ?? null,
    objectRef: (obj.object_ref as string | null) ?? null,
    location,
    links,
  };
}

/** Cachované per id (ISR, D-029 perf). */
export const fetchDrawing = unstable_cache(
  fetchDrawingImpl,
  ["fetch-drawing"],
  AIM_CACHE
);
