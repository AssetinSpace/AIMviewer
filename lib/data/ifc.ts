import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";

const AIM_CACHE = { revalidate: 60, tags: ["aim"] };

/** ifc_guid → objects.id (aktívne záznamy, valid_until IS NULL). */
export type GuidMap = Record<string, string>;

const DEFAULT_ASR_URL =
  "https://acwoupricatirhlfkhvk.supabase.co/storage/v1/object/public/ifc/ASR.ifc";

/** Verejná URL primárneho (ASR) IFC súboru — používa single-model WebGL fallback.
 *  Priorita: NEXT_PUBLIC_IFC_URL env var → default Supabase Storage bucket `ifc/ASR.ifc`. */
export function getIfcUrl(): string {
  return process.env.NEXT_PUBLIC_IFC_URL ?? DEFAULT_ASR_URL;
}

/** Jeden disciplinárny model v scéne (federácia, D-049). `id` = stabilný kľúč
 *  pre federationRegistry aj toggle; `label` = popis v UI. */
export interface IfcModelSource {
  id: string;
  label: string;
  url: string;
}

/** Zoznam IFC modelov pre WebGPU (federovaný) viewer.
 *  ASR je vždy prítomný; VZT (a ďalšie) sa pridá cez env, keď je nahraný do Storage.
 *  - NEXT_PUBLIC_IFC_URL   → ASR (architektúra)
 *  - NEXT_PUBLIC_VZT_URL   → VZT (vzduchotechnika, D-049) — voliteľné */
export function getIfcModels(): IfcModelSource[] {
  const models: IfcModelSource[] = [
    { id: "asr", label: "ASR — architektúra", url: getIfcUrl() },
  ];
  const vzt = process.env.NEXT_PUBLIC_VZT_URL;
  if (vzt) models.push({ id: "vzt", label: "VZT — vzduchotechnika", url: vzt });
  return models;
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
