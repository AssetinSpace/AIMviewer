import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validácia `id` z URL pred dotazom na uuid stĺpec — Postgres by na ne-UUID
 *  hodnote spadol (invalid input syntax), čo by z 404 spravilo 500. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** ISO timestamp → `YYYY-MM-DD` (deň stačí pre platnosti vo Viewerі). */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

/** ISO timestamp → SK locale dátum ('15. 6. 2025') pre zobrazenie používateľom. */
export function formatLocalDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("sk-SK")
}
