/**
 * Zdieľané konštanty dátovej vrstvy — importuj namiesto lokálnych definícií.
 */

/** `source` hrán z auto-linkingu výkresov (E4, D-041). */
export const PDF_LINK_SOURCE = "pdf_link (E4)";

/** Spoločné ISR nastavenie pre cachované čítania (D-029 perf). */
export const AIM_CACHE = { revalidate: 60, tags: ["aim"] };

/** Kanonický tvar UUID (8-4-4-4-12 hex) — guard pred DB dotazom na `uuid` stĺpec. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True, ak `value` má tvar UUID. Používaj v route handleroch pred dotazom,
 *  aby neplatné id skončilo ako 400, nie ako 500 z Postgresu (`invalid input
 *  syntax for type uuid`) po zbytočnom round-tripe. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
