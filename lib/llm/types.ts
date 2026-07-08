/**
 * Zdieľané typy LLM rozhrania (F6, D-056) — bez `server-only`, aby ich mohol
 * importovať aj klientský chat panel (len typy, žiadny runtime kód).
 */

/** Odkaz na výkres, v ktorom je citovaný prvok zobrazený (región z `_drawing_links`). */
export interface SourceDrawingRef {
  /** Document `objects.id` — cieľ `/drawing/[id]`. */
  drawingId: string;
  drawingName: string | null;
  /** 1-based strana s regiónom prvku (pre `?page=`). */
  page: number | null;
  /** Zobrazený SNIM kód v regióne. */
  label: string | null;
}

/**
 * Citovaný zdroj odpovede (trust loop, D-047/D-056). Zbiera sa zo SKUTOČNÝCH
 * tool výsledkov — nie z tvrdení modelu. UI z neho skladá deep-linky:
 * karta `/node/[id]`, 3D `/ifc?focus=<ifcGuid>`, výkres `/drawing/[id]?focus=&page=`.
 */
export interface ChatSource {
  id: string;
  objectType: string;
  objectRef: string | null;
  name: string | null;
  /** Aktívny IFC GUID (`objects.ifc_guid`) — spojka do 3D (D-044). */
  ifcGuid: string | null;
  /** Výkresy s regiónom tohto prvku (naplní `get_element_drawings`). */
  drawings: SourceDrawingRef[];
}

/** Jedna správa konverzácie na API hranici. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Odpoveď `POST /api/chat`. */
export interface ChatResponse {
  reply: string;
  sources: ChatSource[];
}
