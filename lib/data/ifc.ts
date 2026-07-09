import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";

const AIM_CACHE = { revalidate: 60, tags: ["aim"] };

/** ifc_guid → objects.id (aktívne záznamy, valid_until IS NULL). */
export type GuidMap = Record<string, string>;

const IFC_STORAGE_BASE =
  "https://acwoupricatirhlfkhvk.supabase.co/storage/v1/object/public/ifc";

/** Jeden 3D model federácie (D-049): štítok pre UI + verejná URL IFC súboru. */
export interface IfcModel {
  id: string;
  label: string;
  url: string;
}

/**
 * IFC modely na render (D-044/D-049). Geometria je klient-side ephemerálna
 * (Postgres sa jej nedotýka); spojka na dáta = IFC GUID cez `guidMap`.
 * Default = ARCH (ASR) + vzduchotechnika (VZT) federované do jednej scény.
 * Override: `NEXT_PUBLIC_IFC_URLS` = "Label|url,Label|url" (alebo len "url,url");
 * legacy `NEXT_PUBLIC_IFC_URL` = jeden model.
 */
export function getIfcModels(): IfcModel[] {
  const multi = process.env.NEXT_PUBLIC_IFC_URLS;
  if (multi) {
    return multi
      .split(",")
      .map((entry, i) => {
        const [a, b] = entry.split("|");
        const url = (b ?? a).trim();
        const label = (b ? a : `Model ${i + 1}`).trim();
        return { id: `m${i}`, label, url };
      })
      .filter((m) => m.url.length > 0);
  }
  const single = process.env.NEXT_PUBLIC_IFC_URL;
  if (single) return [{ id: "ASR", label: "Architektúra", url: single }];
  return [
    { id: "ASR", label: "Architektúra", url: `${IFC_STORAGE_BASE}/ASR.ifc` },
    { id: "VZT", label: "Vzduchotechnika", url: `${IFC_STORAGE_BASE}/VZT.ifc` },
  ];
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
