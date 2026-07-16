import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";

/**
 * Data-access vrstva pre in-viewer knižnicu dokumentov (D-075): mapuje
 * `objects` (`object_type='document'`) + príponu `documents` na wire formát
 * `DOCUMENTS_LOAD` bridge správy (DocumentDescriptorWire vo forku).
 *
 * Súrodenec `fetchUnderlayDrawings` (D-072), nie náhrada — kalibrované
 * výkresy idú do viewera v OBOCH správach (rovnaké documentId) a panel ich
 * prepája cez `storeyGuid`.
 */

/** Wire formát dokumentu pre `DOCUMENTS_LOAD` (zrkadlí fork bridge-protocol). */
export interface DocumentWire {
  documentId: string;
  name: string;
  kind: "drawing" | "document" | "image";
  url: string;
  mime?: string;
  storeyGuid?: string;
  folder?: string[];
  meta?: Record<string, string>;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

async function fetchProjectDocumentsImpl(): Promise<DocumentWire[]> {
  const supabase = getSupabaseAdmin();

  // Bez stránkovania zámerne (vzor fetchUnderlayDrawings): dokumentov je ~13
  // (E3), hlboko pod PostgREST capom 1000. Pri multi-projekte (D-033) prehodnotiť.
  // 1) všetky dokumenty s verejným súborom v Supabase Storage.
  const [objsRes, docsRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, name")
      .eq("object_type", "document"),
    supabase
      .from("documents")
      .select("id, location, storage_type, revision, status, purpose")
      .eq("storage_type", "supabase"),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);
  const docById = new Map((docsRes.data ?? []).map((d) => [d.id as string, d]));

  // 2) väzba podlažie → výkres (E3, role='drawing') určuje kind='drawing',
  //    storeyGuid (IFC GlobalId podlažia) a folder (názov podlažia).
  const { data: floors, error: fErr } = await supabase
    .from("objects")
    .select("id, name, ifc_guid")
    .eq("object_type", "floor");
  if (fErr) throw new Error(fErr.message);
  const floorById = new Map(
    (floors ?? []).map((f) => [
      f.id as string,
      { name: (f.name as string | null) ?? "", guid: (f.ifc_guid as string | null) ?? "" },
    ])
  );

  const floorIds = [...floorById.keys()];
  const drawingFloorByDocId = new Map<string, { name: string; guid: string }>();
  if (floorIds.length > 0) {
    const { data: rels, error: rErr } = await supabase
      .from("rel_associates_document")
      .select("from_id, to_id")
      .in("from_id", floorIds)
      .eq("role", "drawing")
      .is("valid_until", null);
    if (rErr) throw new Error(rErr.message);
    for (const rel of (rels ?? []) as { from_id: string; to_id: string }[]) {
      const floor = floorById.get(rel.from_id);
      if (floor && !drawingFloorByDocId.has(rel.to_id)) {
        drawingFloorByDocId.set(rel.to_id, floor);
      }
    }
  }

  const out: DocumentWire[] = [];
  for (const obj of objsRes.data ?? []) {
    const id = obj.id as string;
    const doc = docById.get(id);
    const location = (doc?.location as string | null) ?? null;
    if (!doc || !location) continue; // bez verejného súboru niet čo zobraziť
    const name = (obj.name as string | null) ?? id;
    const floor = drawingFloorByDocId.get(id);
    const kind: DocumentWire["kind"] = floor
      ? "drawing"
      : IMAGE_EXT_RE.test(location)
        ? "image"
        : "document";

    const meta: Record<string, string> = {};
    for (const key of ["revision", "status", "purpose"] as const) {
      const value = doc[key] as string | null;
      if (value) meta[key] = value;
    }

    // Folder: výkresy podľa podlažia, ostatné podľa účelu (CDE typ, D-036).
    const folder = floor?.name
      ? ["Výkresy", floor.name]
      : typeof doc.purpose === "string" && doc.purpose
        ? [doc.purpose]
        : undefined;

    out.push({
      documentId: id,
      name,
      kind,
      url: location,
      ...(floor?.guid ? { storeyGuid: floor.guid } : {}),
      ...(folder ? { folder } : {}),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
  }
  // Stabilné poradie pre viewer aj cache (názov, potom id).
  out.sort((a, b) => a.name.localeCompare(b.name) || a.documentId.localeCompare(b.documentId));
  return out;
}

/** Knižnica dokumentov pre 3D viewer (ISR, tag `aim`). */
export const fetchProjectDocuments = unstable_cache(
  fetchProjectDocumentsImpl,
  ["fetch-project-documents"],
  AIM_CACHE
);
