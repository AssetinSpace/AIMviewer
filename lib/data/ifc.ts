import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";

const AIM_CACHE = { revalidate: 60, tags: ["aim"] };

/** ifc_guid → objects.id (aktívne záznamy, valid_until IS NULL). */
export type GuidMap = Record<string, string>;

/** Verejná URL IFC súboru. Produkcia: NEXT_PUBLIC_IFC_URL env var (Supabase Storage).
 *  Lokálny fallback: public/model.ifc (D-044). */
export function getIfcUrl(): string {
  return process.env.NEXT_PUBLIC_IFC_URL ?? "/model.ifc";
}

async function fetchGuidMapImpl(): Promise<GuidMap> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ifc_guid_history")
    .select("object_id, ifc_guid")
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const map: GuidMap = {};
  for (const row of data ?? []) {
    if (row.ifc_guid && row.object_id) {
      map[row.ifc_guid as string] = row.object_id as string;
    }
  }
  return map;
}

/** Cachovaná GUID mapa (ISR 60 s, D-029). ~681 záznamov ≈ 15 KB JSON. */
export const fetchGuidMap = unstable_cache(
  fetchGuidMapImpl,
  ["ifc-guid-map"],
  AIM_CACHE
);
