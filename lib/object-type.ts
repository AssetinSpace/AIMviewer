import type { SpatialType } from "@/lib/data/spatial";

/** Všetky typy uzlov, ktoré Viewer vie zobraziť (D-018). */
export type ObjectType =
  | SpatialType
  | "asset_type"
  | "person"
  | "organization"
  | "document";

/** Slovenské labely typov uzlov (zobrazenie vo Viewerі). */
export const OBJECT_TYPE_LABEL: Record<ObjectType, string> = {
  site: "Areál",
  building: "Budova",
  floor: "Podlažie",
  space: "Miestnosť",
  asset: "Asset",
  asset_type: "Typ assetu",
  person: "Osoba",
  organization: "Organizácia",
  document: "Dokument",
};

/** Acting roly zo `rel_responsible_for.role` (D-020, IfcActorRole). */
export const ACTING_ROLE_LABEL: Record<string, string> = {
  owner: "vlastník",
  operator: "prevádzkovateľ",
  maintainer: "údržbár",
  manufacturer: "výrobca",
};

/** Roly dokumentovej väzby `rel_has_document.role` (D-014). */
export const DOC_ROLE_LABEL: Record<string, string> = {
  manual: "manuál",
  certificate: "certifikát",
  "as-built": "as-built",
};

/** Preloží rolu cez mapu; neznámu rolu vráti tak ako je. `null` ostáva `null`. */
export function roleLabel(
  map: Record<string, string>,
  role: string | null | undefined
): string | null {
  if (role == null) return null;
  return map[role] ?? role;
}
