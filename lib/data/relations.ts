import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Data-access vrstva pre generické sekcie uzla (S3, D-029): dokumenty,
 * zodpovednosti a história IFC GUID. Všetko nad ľubovoľným `objects` uzlom —
 * sekcie sa zobrazia na asset karte aj na priestorových uzloch.
 *
 * Zobrazujú sa len **aktívne** väzby (`valid_until IS NULL`), konzistentne s
 * S1/S2. Všetko server-side cez `service_role` (D-026).
 */

export interface DocumentRef {
  /** Document `objects.id` — cieľ odkazu `/node/[id]`. */
  id: string;
  objectRef: string | null;
  name: string | null;
  /** rel_has_document.role: 'manual','certificate','as-built'… */
  role: string | null;
  identification: string | null;
  description: string | null;
  location: string | null;
  revision: string | null;
  status: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface ActorOrg {
  id: string;
  name: string | null;
}

export interface Responsibility {
  actorId: string;
  actorType: "person" | "organization";
  actorName: string | null;
  actorRef: string | null;
  /** Acting rola (rel_responsible_for.role): 'operator','maintainer'… */
  role: string;
  validFrom: string | null;
  validUntil: string | null;
  /** Firma osoby (rel_member_of) — len pri person actoroch. */
  org: ActorOrg | null;
}

export interface GuidHistoryEntry {
  id: string;
  ifcGuid: string;
  validFrom: string | null;
  /** NULL = aktuálny GUID. */
  validUntil: string | null;
  source: string | null;
  active: boolean;
}

/** Dokumenty pripojené na uzol (`rel_has_document` → `documents`, D-014). */
export async function fetchDocuments(objectId: string): Promise<DocumentRef[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_has_document")
    .select("to_id, role")
    .eq("from_id", objectId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const relRows = (rels ?? []) as { to_id: string; role: string | null }[];
  if (relRows.length === 0) return [];

  const docIds = [...new Set(relRows.map((r) => r.to_id))];

  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, object_ref, name").in("id", docIds),
    supabase
      .from("documents")
      .select(
        "id, identification, description, location, revision, status, valid_from, valid_until"
      )
      .in("id", docIds),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);

  const objById = new Map((objsRes.data ?? []).map((o) => [o.id as string, o]));
  const docById = new Map((docsRes.data ?? []).map((d) => [d.id as string, d]));

  return relRows
    .map((r) => {
      const o = objById.get(r.to_id);
      const d = docById.get(r.to_id);
      return {
        id: r.to_id,
        objectRef: (o?.object_ref as string | null) ?? null,
        name: (o?.name as string | null) ?? null,
        role: r.role,
        identification: (d?.identification as string | null) ?? null,
        description: (d?.description as string | null) ?? null,
        location: (d?.location as string | null) ?? null,
        revision: (d?.revision as string | null) ?? null,
        status: (d?.status as string | null) ?? null,
        validFrom: (d?.valid_from as string | null) ?? null,
        validUntil: (d?.valid_until as string | null) ?? null,
      };
    })
    .sort((a, b) =>
      (a.name ?? a.objectRef ?? "").localeCompare(b.name ?? b.objectRef ?? "", "sk")
    );
}

/**
 * Zodpovednosti za uzol (`rel_responsible_for`, D-020). Actor je person alebo
 * organization; pri osobe doplníme jej firmu (`rel_member_of`, D-024).
 */
export async function fetchResponsibilities(
  objectId: string
): Promise<Responsibility[]> {
  const supabase = getSupabaseAdmin();

  const { data: rels, error } = await supabase
    .from("rel_responsible_for")
    .select("from_id, role, valid_from, valid_until")
    .eq("to_id", objectId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const relRows = (rels ?? []) as {
    from_id: string;
    role: string;
    valid_from: string | null;
    valid_until: string | null;
  }[];
  if (relRows.length === 0) return [];

  const actorIds = [...new Set(relRows.map((r) => r.from_id))];

  const { data: actors, error: actErr } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .in("id", actorIds);
  if (actErr) throw new Error(actErr.message);

  const actorById = new Map((actors ?? []).map((a) => [a.id as string, a]));

  // Firmy pre person actorov (rel_member_of, aktívne).
  const personIds = (actors ?? [])
    .filter((a) => a.object_type === "person")
    .map((a) => a.id as string);

  const orgByPerson = new Map<string, ActorOrg>();
  if (personIds.length > 0) {
    const { data: memberRows, error: memErr } = await supabase
      .from("rel_member_of")
      .select("from_id, to_id")
      .in("from_id", personIds)
      .is("valid_until", null);
    if (memErr) throw new Error(memErr.message);

    const orgIds = [...new Set((memberRows ?? []).map((m) => m.to_id as string))];
    const orgName = new Map<string, string | null>();
    if (orgIds.length > 0) {
      const { data: orgs, error: orgErr } = await supabase
        .from("objects")
        .select("id, name")
        .in("id", orgIds);
      if (orgErr) throw new Error(orgErr.message);
      for (const o of orgs ?? [])
        orgName.set(o.id as string, (o.name as string | null) ?? null);
    }
    for (const m of memberRows ?? []) {
      // Prvá firma na osobu (B model: 1 členstvo v seede).
      if (!orgByPerson.has(m.from_id as string)) {
        orgByPerson.set(m.from_id as string, {
          id: m.to_id as string,
          name: orgName.get(m.to_id as string) ?? null,
        });
      }
    }
  }

  return relRows
    .map((r) => {
      const a = actorById.get(r.from_id);
      const actorType =
        (a?.object_type as "person" | "organization") ?? "organization";
      return {
        actorId: r.from_id,
        actorType,
        actorName: (a?.name as string | null) ?? null,
        actorRef: (a?.object_ref as string | null) ?? null,
        role: r.role,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
        org: actorType === "person" ? orgByPerson.get(r.from_id) ?? null : null,
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role, "sk"));
}

/**
 * História IFC GUIDov uzla (`ifc_guid_history`, D-010). Aktívny (valid_until
 * NULL) hore, potom zostupne podľa `valid_from`.
 */
export async function fetchGuidHistory(
  objectId: string
): Promise<GuidHistoryEntry[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("ifc_guid_history")
    .select("id, ifc_guid, valid_from, valid_until, source")
    .eq("object_id", objectId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    id: string;
    ifc_guid: string;
    valid_from: string | null;
    valid_until: string | null;
    source: string | null;
  }[];

  return rows
    .map((r) => ({
      id: r.id,
      ifcGuid: r.ifc_guid,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      source: r.source,
      active: r.valid_until === null,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.validFrom ?? "").localeCompare(a.validFrom ?? "");
    });
}
