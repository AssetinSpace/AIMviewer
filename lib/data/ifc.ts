import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";

const AIM_CACHE = { revalidate: 60, tags: ["aim"] };

/** ifc_guid → objects.id (aktívne záznamy, valid_until IS NULL). */
export type GuidMap = Record<string, string>;

/** Jeden federovaný IFC model v 3D scéne (D-050). */
export interface IfcModel {
  /** Stabilné id (= kľúč v Supabase `ifc/` buckete bez prípony). */
  id: string;
  /** Ľudský názov do panela Modely. */
  name: string;
  /** Verejná URL IFC súboru. */
  url: string;
}

const STORAGE_BASE =
  (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ??
    "https://acwoupricatirhlfkhvk.supabase.co") + "/storage/v1/object/public/ifc";

/** Federačná sada modelov (D-049/D-050). N-ary — pridanie modelu = nahrať do
 *  bucketu `ifc/` (`etl/ifc_upload.py`) a doplniť sem. Self-upload UI mimo scope (D-055). */
const IFC_MODELS: ReadonlyArray<{ id: string; name: string; file: string }> = [
  { id: "ASR", name: "ASR — architektúra", file: "ASR.ifc" },
  { id: "VZT", name: "VZT — vzduchotechnika", file: "VZT.ifc" },
];

/** Pole modelov pre federovanú 3D scénu. `NEXT_PUBLIC_IFC_URL` (ak je) prepíše URL
 *  prvého (ARCH) modelu — spätná kompatibilita so single-model konfiguráciou. */
export function getIfcModels(): IfcModel[] {
  return IFC_MODELS.map((m, i) => ({
    id: m.id,
    name: m.name,
    url:
      i === 0 && process.env.NEXT_PUBLIC_IFC_URL
        ? process.env.NEXT_PUBLIC_IFC_URL
        : `${STORAGE_BASE}/${m.file}`,
  }));
}

/** Verejná URL primárneho (ARCH) IFC modelu. Spätná kompatibilita — nové miesta
 *  používajú `getIfcModels()`. */
export function getIfcUrl(): string {
  return getIfcModels()[0].url;
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
