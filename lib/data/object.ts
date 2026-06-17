import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { ObjectType } from "@/lib/object-type";

/**
 * Data-access pre generický object route (S3, D-029): ľahká meta pre dispatch
 * v `/node/[id]` + detail views pre person / organization / document.
 * Obojsmerné prelinkovanie uzatvára graf (z osoby → firma + jej zodpovednosti;
 * z dokumentu → „pripojené k"). Server-side cez `service_role` (D-026).
 */

export interface ObjectMeta {
  id: string;
  object_type: ObjectType;
  object_ref: string | null;
  name: string | null;
}

/** Skrátený odkaz na ľubovoľný objekt (cieľ `/node/[id]`). */
export interface ObjectLink {
  id: string;
  object_type: ObjectType;
  object_ref: string | null;
  name: string | null;
}

export interface Membership {
  orgId: string;
  orgName: string | null;
  orgRef: string | null;
  /** Rola vo firme (rel_member_of.role, ≠ acting rola). */
  role: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface ResponsibilityOf {
  object: ObjectLink;
  /** Acting rola (rel_responsible_for.role). */
  role: string;
  validFrom: string | null;
  validUntil: string | null;
}

export interface PersonDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  memberships: Membership[];
  responsibilities: ResponsibilityOf[];
}

export interface OrgMember {
  personId: string;
  personName: string | null;
  personRef: string | null;
  role: string | null;
}

export interface OrganizationDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  /** Zachytené `_contact` (capture-don't-structure, D-024). */
  contact: Record<string, unknown> | null;
  members: OrgMember[];
  responsibilities: ResponsibilityOf[];
}

export interface DocumentAttachment {
  object: ObjectLink;
  role: string | null;
}

export interface DocumentDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  identification: string | null;
  description: string | null;
  location: string | null;
  purpose: string | null;
  revision: string | null;
  status: string | null;
  documentOwner: string | null;
  validFrom: string | null;
  validUntil: string | null;
  attachedTo: DocumentAttachment[];
}

/** Ľahká identita objektu pre dispatch v route. `null`, ak neexistuje. */
export async function fetchObjectMeta(id: string): Promise<ObjectMeta | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id as string,
    object_type: row.object_type as ObjectType,
    object_ref: (row.object_ref as string | null) ?? null,
    name: (row.name as string | null) ?? null,
  };
}

/** Načíta `objects` riadky ako odkazy (pre prelinkovanie). */
async function loadObjectLinks(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, ObjectLink>> {
  const out = new Map<string, ObjectLink>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .in("id", ids);
  if (error) throw new Error(error.message);
  for (const o of data ?? []) {
    out.set(o.id as string, {
      id: o.id as string,
      object_type: o.object_type as ObjectType,
      object_ref: (o.object_ref as string | null) ?? null,
      name: (o.name as string | null) ?? null,
    });
  }
  return out;
}

/** Za čo aktor (person|organization) zodpovedá — reverz `rel_responsible_for`. */
async function loadResponsibilitiesOf(
  supabase: SupabaseClient,
  actorId: string
): Promise<ResponsibilityOf[]> {
  const { data, error } = await supabase
    .from("rel_responsible_for")
    .select("to_id, role, valid_from, valid_until")
    .eq("from_id", actorId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    to_id: string;
    role: string;
    valid_from: string | null;
    valid_until: string | null;
  }[];
  const links = await loadObjectLinks(
    supabase,
    rows.map((r) => r.to_id)
  );
  return rows
    .map((r) => ({
      object:
        links.get(r.to_id) ??
        ({ id: r.to_id, object_type: "asset", object_ref: null, name: null } as ObjectLink),
      role: r.role,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
    }))
    .sort((a, b) => a.role.localeCompare(b.role, "sk"));
}

/** Detail osoby: kontakt, členstvá vo firmách, za čo zodpovedá. */
export async function fetchPerson(id: string): Promise<PersonDetail | null> {
  const supabase = getSupabaseAdmin();

  const { data: objRows, error } = await supabase
    .from("objects")
    .select("id, object_ref, name")
    .eq("id", id)
    .eq("object_type", "person")
    .limit(1);
  if (error) throw new Error(error.message);
  const obj = objRows?.[0];
  if (!obj) return null;

  const { data: pRows, error: pErr } = await supabase
    .from("persons")
    .select("given_name, family_name, email, phone")
    .eq("id", id)
    .limit(1);
  if (pErr) throw new Error(pErr.message);
  const p = pRows?.[0];

  // Členstvá (rel_member_of, aktívne).
  const { data: memRows, error: memErr } = await supabase
    .from("rel_member_of")
    .select("to_id, role, valid_from, valid_until")
    .eq("from_id", id)
    .is("valid_until", null);
  if (memErr) throw new Error(memErr.message);
  const memberRows = (memRows ?? []) as {
    to_id: string;
    role: string | null;
    valid_from: string | null;
    valid_until: string | null;
  }[];
  const orgLinks = await loadObjectLinks(
    supabase,
    memberRows.map((m) => m.to_id)
  );
  const memberships: Membership[] = memberRows.map((m) => {
    const o = orgLinks.get(m.to_id);
    return {
      orgId: m.to_id,
      orgName: o?.name ?? null,
      orgRef: o?.object_ref ?? null,
      role: m.role,
      validFrom: m.valid_from,
      validUntil: m.valid_until,
    };
  });

  const responsibilities = await loadResponsibilitiesOf(supabase, id);

  return {
    id: obj.id as string,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    givenName: (p?.given_name as string | null) ?? null,
    familyName: (p?.family_name as string | null) ?? null,
    email: (p?.email as string | null) ?? null,
    phone: (p?.phone as string | null) ?? null,
    memberships,
    responsibilities,
  };
}

/** Detail organizácie: zachytený kontakt, členovia, za čo zodpovedá. */
export async function fetchOrganization(
  id: string
): Promise<OrganizationDetail | null> {
  const supabase = getSupabaseAdmin();

  const { data: objRows, error } = await supabase
    .from("objects")
    .select("id, object_ref, name, properties")
    .eq("id", id)
    .eq("object_type", "organization")
    .limit(1);
  if (error) throw new Error(error.message);
  const obj = objRows?.[0];
  if (!obj) return null;

  const props = (obj.properties ?? {}) as Record<string, unknown>;
  const contactRaw = props["_contact"];
  const contact =
    contactRaw && typeof contactRaw === "object" && !Array.isArray(contactRaw)
      ? (contactRaw as Record<string, unknown>)
      : null;

  // Členovia (rel_member_of, kde to_id = táto firma).
  const { data: memRows, error: memErr } = await supabase
    .from("rel_member_of")
    .select("from_id, role")
    .eq("to_id", id)
    .is("valid_until", null);
  if (memErr) throw new Error(memErr.message);
  const memberRows = (memRows ?? []) as { from_id: string; role: string | null }[];
  const personLinks = await loadObjectLinks(
    supabase,
    memberRows.map((m) => m.from_id)
  );
  const members: OrgMember[] = memberRows
    .map((m) => {
      const o = personLinks.get(m.from_id);
      return {
        personId: m.from_id,
        personName: o?.name ?? null,
        personRef: o?.object_ref ?? null,
        role: m.role,
      };
    })
    .sort((a, b) => (a.personName ?? "").localeCompare(b.personName ?? "", "sk"));

  const responsibilities = await loadResponsibilitiesOf(supabase, id);

  return {
    id: obj.id as string,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    contact,
    members,
    responsibilities,
  };
}

/** Detail dokumentu: IfcDocumentInformation polia + „pripojené k" (reverz). */
export async function fetchDocument(id: string): Promise<DocumentDetail | null> {
  const supabase = getSupabaseAdmin();

  const { data: objRows, error } = await supabase
    .from("objects")
    .select("id, object_ref, name")
    .eq("id", id)
    .eq("object_type", "document")
    .limit(1);
  if (error) throw new Error(error.message);
  const obj = objRows?.[0];
  if (!obj) return null;

  const { data: dRows, error: dErr } = await supabase
    .from("documents")
    .select(
      "identification, description, location, purpose, revision, document_owner, status, valid_from, valid_until"
    )
    .eq("id", id)
    .limit(1);
  if (dErr) throw new Error(dErr.message);
  const d = dRows?.[0];

  // Pripojené k (rel_has_document, kde to_id = tento dokument).
  const { data: relRows, error: relErr } = await supabase
    .from("rel_has_document")
    .select("from_id, role")
    .eq("to_id", id)
    .is("valid_until", null);
  if (relErr) throw new Error(relErr.message);
  const rels = (relRows ?? []) as { from_id: string; role: string | null }[];
  const links = await loadObjectLinks(
    supabase,
    rels.map((r) => r.from_id)
  );
  const attachedTo: DocumentAttachment[] = rels
    .map((r) => ({
      object:
        links.get(r.from_id) ??
        ({ id: r.from_id, object_type: "asset", object_ref: null, name: null } as ObjectLink),
      role: r.role,
    }))
    .sort((a, b) =>
      (a.object.name ?? "").localeCompare(b.object.name ?? "", "sk")
    );

  return {
    id: obj.id as string,
    object_ref: (obj.object_ref as string | null) ?? null,
    name: (obj.name as string | null) ?? null,
    identification: (d?.identification as string | null) ?? null,
    description: (d?.description as string | null) ?? null,
    location: (d?.location as string | null) ?? null,
    purpose: (d?.purpose as string | null) ?? null,
    revision: (d?.revision as string | null) ?? null,
    status: (d?.status as string | null) ?? null,
    documentOwner: (d?.document_owner as string | null) ?? null,
    validFrom: (d?.valid_from as string | null) ?? null,
    validUntil: (d?.valid_until as string | null) ?? null,
    attachedTo,
  };
}
