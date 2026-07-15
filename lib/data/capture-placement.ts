/**
 * Reality Capture (D-073) — čisté typy + validácia ukotvenia (`_capture`).
 *
 * Zámerne BEZ `server-only`/DB závislostí, aby bola validácia unit-testovateľná
 * (vzor: pure logika vedľa server-only data-access vrstvy). `captures.ts` z tohto
 * modulu re-exportuje; klientske komponenty importujú len typy.
 */

/** Verejný Storage bucket pre snímky (vzor `documents`/`ifc`). */
export const CAPTURES_BUCKET = "captures";

/** Druh capture pointu — klasická fotka vs statická equirectangular panoráma. */
export type CaptureKind = "photo" | "pano360";

/** 2D pin na konkrétnom PDF liste (normalizované súradnice 0..1). */
export interface CapturePlanAnchor {
  documentId: string;
  page: number;
  /** Normalizovaná X (0 = ľavý okraj, 1 = pravý). */
  u: number;
  /** Normalizovaná Y (0 = horný okraj, 1 = dolný). */
  v: number;
}

/** 3D pin vo viewer Y-up world frame (metre). */
export interface CaptureWorldAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * Ukotvenie capture pointu — versioned JSON v `properties._capture` (vzor `_georef`).
 * `plan` aj `world` sú nepovinné; `yaw` je počiatočná orientácia pohľadu pre
 * panorámu (radiány). Sémantické ukotvenie (na priestor) žije na hrane, nie tu.
 */
export interface CapturePlacement {
  version: 1;
  plan?: CapturePlanAnchor;
  world?: CaptureWorldAnchor;
  yaw?: number;
}

/** Wire tvar jednej snímky/verzie. */
export interface CaptureMediaWire {
  id: string;
  location: string | null;
  previewLocation: string | null;
  thumbLocation: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  /** Odvodené: najnovšia aktívna verzia capture pointu. */
  isCurrent: boolean;
}

/**
 * Wire tvar capture pinu pre embed 3D viewer (D-073, bridge `CAPTURES_LOAD`).
 * `world` je viewer Y-up world pozícia; `spaceId` je host-only (navigácia po
 * kliku na pin — do viewera sa NEposiela).
 */
export interface CaptureViewerWire {
  id: string;
  kind: CaptureKind;
  world: CaptureWorldAnchor;
  name?: string;
  thumbUrl?: string;
  /** Host-only: priestor, na ktorý po kliku navigovať. */
  spaceId: string | null;
}

/** Wire tvar capture pointu vrátane (aktívnych) médií. */
export interface CapturePointWire {
  id: string;
  name: string | null;
  kind: CaptureKind;
  /** `objects.id` priestoru (IfcSpace), na ktorý je capture naviazaný. */
  spaceId: string | null;
  placement: CapturePlacement | null;
  /** Aktívne verzie, zoradené od najnovšej (`captured_at` desc). */
  media: CaptureMediaWire[];
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validácia `_capture` v1 payloadu (server je hranica zápisu — untrusted vstup).
 * Zrkadlí `isValidGeorefV1` (D-072): prísne typy, `plan`/`world`/`yaw` nepovinné.
 * Prázdny `{version:1}` je platný — sémantické ukotvenie (na priestor) žije na
 * hrane; plán/3D pin sa môže doplniť neskôr vo vieweri (F2).
 */
export function isValidCaptureV1(raw: unknown): raw is CapturePlacement {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const g = raw as Record<string, unknown>;
  if (g.version !== 1) return false;

  if (g.plan !== undefined) {
    const p = g.plan as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return false;
    if (typeof p.documentId !== "string" || p.documentId.length === 0) return false;
    if (!num(p.page) || !Number.isInteger(p.page) || (p.page as number) < 1) return false;
    if (!num(p.u) || (p.u as number) < 0 || (p.u as number) > 1) return false;
    if (!num(p.v) || (p.v as number) < 0 || (p.v as number) > 1) return false;
  }
  if (g.world !== undefined) {
    const w = g.world as Record<string, unknown> | null;
    if (!w || typeof w !== "object") return false;
    if (!num(w.x) || !num(w.y) || !num(w.z)) return false;
  }
  if (g.yaw !== undefined && !num(g.yaw)) return false;
  return true;
}

/** Bezpečné parsovanie perzistovaného `_capture` (stale/hostile → null). */
export function parseCapturePlacement(raw: unknown): CapturePlacement | null {
  return isValidCaptureV1(raw) ? (raw as CapturePlacement) : null;
}
