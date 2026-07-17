/**
 * Čisté sanitizačné/validačné helpery LLM vrstvy (D-056/D-059/D-060/D-066).
 * Zámerne bez `server-only` a bez importov — sú to guardy medzi LLM vstupom
 * a PostgREST/ops URL syntaxou, preto sú vyčlenené sem, kde sa dajú unit
 * testovať (`sanitize.test.ts`). Logiku toolov nechávaj v `tools.ts`.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Wire-safe očista selektorových hodnôt (ops formát používa : ; ~ . ako oddeľovače). */
export const sanitizeIfcType = (raw: unknown): string =>
  String(raw ?? "").replace(/[^A-Za-z0-9]/g, "").trim();
export const sanitizeModelName = (raw: unknown): string =>
  String(raw ?? "").replace(/[:;~.]/g, "").trim();

/** Povolené operátory filtra query_view (PostgREST). */
export const QUERY_OPS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
]);

/** Stĺpec alebo JSONB cesta (properties->Pset_X->>Kľúč) — nič iné neprejde. */
export const COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(->>?[a-zA-Z0-9_ .-]+)*$/;

export function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/** Sanitizácia textu do PostgREST `or=`/`ilike` filtra (čiarky/zátvorky = syntax). */
export function sanitizeQuery(raw: unknown): string {
  return String(raw ?? "").replace(/[,()%]/g, " ").trim().slice(0, 100);
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
