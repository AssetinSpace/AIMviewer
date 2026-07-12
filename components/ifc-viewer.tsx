"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { nodeSummaryToAimPanel } from "@/lib/aim-panel";
import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { NodeSummary } from "@/lib/data/object";
import type { ViewerApi } from "@/lib/viewer-api";

/**
 * 3D prehliadač = self-hostovaná IFClite appka (fork AssetinSpace/ifc-lite,
 * vetva aim-integration) vložená cez <iframe>. Tento wrapper drží NEZMENENÝ
 * kontrakt pôvodného three.js vieweru (Props + ViewerApi + onSelect/
 * onPickedElement), takže ifc-workspace.tsx a zvyšok appu sa nemenia — mení
 * sa len transport: in-process volania → postMessage cez hranicu iframu.
 *
 * Druhá strana mostu žije vo forku: apps/viewer/src/aim/AimBridge.tsx.
 * Protokol (source: "aim-bridge"):
 *   host → viewer:  FOCUS{guids} · HIGHLIGHT_FILTER{guids} · CLEAR_FILTER ·
 *                   COLORIZE{guids|selector,color} · HIDE{guids|selector} ·
 *                   SHOW{guids|selector} · ISOLATE{guids|selector} ·
 *                   SHOW_ALL · RESET_COLORS   (D-066; selector = množinový
 *                   výber {types,model} rozkladaný viewer-side) ·
 *                   AIM_PANEL_DATA{guid,data} · AIM_PANEL_EMPTY{guid,reason}
 *   viewer → host:  READY · MODELS_LOADED · ENTITY_SELECTED{guid} ·
 *                   ENTITY_DESELECTED · AIM_NAVIGATE{href}
 *
 * AIM karta: po ENTITY_SELECTED host dotiahne DB súhrn (/api/element/{id})
 * a pošle ho ako render schému (lib/aim-panel.ts) do natívneho panelu
 * viewera — jeden panel namiesto dvoch. Kliky v karte chodia späť cez
 * AIM_NAVIGATE a naviguje ich parent appka.
 */

const SOURCE = "aim-bridge" as const;

/** URL nasadeného IFClite vieweru. Override cez NEXT_PUBLIC_IFC_VIEWER_URL. */
const VIEWER_URL =
  process.env.NEXT_PUBLIC_IFC_VIEWER_URL ?? "https://ifc-lite-viewer.vercel.app";

type OutboundMessage =
  | { source: typeof SOURCE; type: "READY" }
  | { source: typeof SOURCE; type: "MODELS_LOADED"; count: number }
  | { source: typeof SOURCE; type: "ENTITY_SELECTED"; guid: string }
  | { source: typeof SOURCE; type: "ENTITY_DESELECTED" }
  // Klik na link v AIM karte vo viewri — navigáciu robí táto (parent) appka.
  | { source: typeof SOURCE; type: "AIM_NAVIGATE"; href: string };

/**
 * Viewer operácia AI docku (D-066) — kompaktný wire formát v URL parametri
 * `ops`: `<op>:<arg>:<guid.guid…>` spájané `;`. GUIDy (base64 abeceda IFC,
 * bez bodky) sa oddeľujú bodkou — neencoduje sa, URL ostáva krátka.
 *
 * Množinové varianty `<op>_sel:<arg>:<selektor>` (D-066 rozšírenie) nesú
 * namiesto GUIDov selektor `t=IfcA.IfcB~m=Model` — celé triedy/súbory
 * rozloží viewer sám z entity tables, takže URL ostáva krátka pri
 * ľubovoľnom počte prvkov.
 */
interface OpsSelector {
  types?: string[];
  model?: string;
}

type ViewerOp =
  | { op: "colorize"; guids: string[]; color: string }
  | { op: "hide" | "show" | "isolate"; guids: string[] }
  | { op: "colorize_sel"; selector: OpsSelector; color: string }
  | { op: "hide_sel" | "show_sel" | "isolate_sel"; selector: OpsSelector }
  | { op: "show_all" }
  | { op: "reset_colors" };

function parseSelector(raw: string): OpsSelector | null {
  const sel: OpsSelector = {};
  for (const field of raw.split("~")) {
    if (field.startsWith("t=")) {
      const types = field.slice(2).split(".").filter(Boolean);
      if (types.length > 0) sel.types = types;
    } else if (field.startsWith("m=")) {
      const model = field.slice(2).trim();
      if (model) sel.model = model;
    }
  }
  return sel.types || sel.model ? sel : null;
}

function parseOps(raw: string): ViewerOp[] {
  const out: ViewerOp[] = [];
  for (const part of raw.split(";")) {
    const [op, arg = "", joined = ""] = part.split(":");
    const guids = joined.split(".").filter(Boolean);
    const sel = op.endsWith("_sel") ? parseSelector(joined) : null;
    if (op === "colorize" && guids.length > 0 && /^[0-9a-fA-F]{6}$/.test(arg)) {
      out.push({ op, guids, color: `#${arg}` });
    } else if ((op === "hide" || op === "show" || op === "isolate") && guids.length > 0) {
      out.push({ op, guids });
    } else if (op === "colorize_sel" && sel && /^[0-9a-fA-F]{6}$/.test(arg)) {
      out.push({ op, selector: sel, color: `#${arg}` });
    } else if ((op === "hide_sel" || op === "show_sel" || op === "isolate_sel") && sel) {
      out.push({ op, selector: sel });
    } else if (op === "show_all" || op === "reset_colors") {
      out.push({ op });
    }
  }
  return out;
}

function isBridgeMessage(data: unknown): data is OutboundMessage {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { source?: unknown }).source === SOURCE &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

interface Props {
  /** Modely federácie (D-049) — renderované do jednej scény. */
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu/ops (D-056). */
  focusNonce?: string;
  /** Viewer operácie AI docku (ofarbenie/skrytie/izolácia, D-066) — wire formát viď parseOps. */
  ops?: string;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
  /** Navigácia z AIM karty vo viewri (host-relatívne href, napr. /node/{id}). */
  onNavigate?: (href: string) => void;
}

export function IFCViewer({
  models,
  guidMap,
  focus,
  focusNonce,
  ops,
  apiRef,
  onSelect,
  onPickedElement,
  onNavigate,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const readyRef = useRef(false);
  /** true až po MODELS_LOADED — skôr viewer nevie resolvnúť GUIDy. */
  const loadedRef = useRef(false);
  // AIM karta: race guard fetchu detailu — nová selekcia abortne predchádzajúci
  // fetch a odpoveď sa pošle len pre stále aktuálny GUID (viewer má navyše
  // vlastný guid guard, belt-and-suspenders).
  const aimGuidRef = useRef<string | null>(null);
  const aimAbortRef = useRef<AbortController | null>(null);

  const viewerOrigin = useMemo(() => {
    try {
      return new URL(VIEWER_URL).origin;
    } catch {
      return "*";
    }
  }, []);

  // objects.id → ifc_guid (reverz guidMap) — na preklad DB→3D príkazov.
  const objectIdToGuid = useMemo(() => {
    const m = new Map<string, string>();
    for (const [guid, oid] of Object.entries(guidMap)) m.set(oid, guid);
    return m;
  }, [guidMap]);

  // iframe src — modely sa autoloadnú cez ?models=<url>,<url> (AimBridge/
  // ViewerLayout). URLSearchParams zakóduje čiarky/URL bezpečne; viewer ich
  // dekóduje späť a splitne na ','.
  const src = useMemo(() => {
    const u = new URL(VIEWER_URL);
    u.searchParams.set("models", models.map((m) => m.url).join(","));
    return u.toString();
  }, [models]);

  // Stabilný kľúč — iframe sa remountuje len keď sa zmenia URL modelov.
  const modelsKey = models.map((m) => m.url).join("|");

  // Reset stavu pri zmene modelov — React pattern „adjust state during render"
  // (nie setState v effekte). V praxi sa modely počas session nemenia.
  const [prevModelsKey, setPrevModelsKey] = useState(modelsKey);
  if (modelsKey !== prevModelsKey) {
    setPrevModelsKey(modelsKey);
    setStatus("loading");
  }

  function post(msg: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(
      { source: SOURCE, ...msg },
      viewerOrigin
    );
  }

  /**
   * Po selekcii vo viewri dotiahne DB súhrn a pošle ho do AIM karty
   * v natívnom paneli viewera (AIM_PANEL_DATA / AIM_PANEL_EMPTY).
   */
  function sendAimPanel(guid: string, objectId: string | undefined) {
    aimAbortRef.current?.abort();
    aimGuidRef.current = guid;

    if (!objectId) {
      post({ type: "AIM_PANEL_EMPTY", guid, reason: "no-mapping" });
      return;
    }

    const controller = new AbortController();
    aimAbortRef.current = controller;
    fetch(`/api/element/${objectId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((summary: NodeSummary) => {
        if (aimGuidRef.current !== guid) return; // medzičasom iná selekcia
        post({ type: "AIM_PANEL_DATA", guid, data: nodeSummaryToAimPanel(summary, guid) });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || aimGuidRef.current !== guid) return;
        const reason = err instanceof Error && err.message === "404" ? "not-found" : "error";
        post({ type: "AIM_PANEL_EMPTY", guid, reason });
      });
  }

  /** Aplikuje viewer ops AI docku (D-066) — jedna op = jedna bridge správa. */
  function applyOps(raw: string) {
    for (const o of parseOps(raw)) {
      switch (o.op) {
        case "colorize":
          post({ type: "COLORIZE", guids: o.guids, color: o.color });
          break;
        case "hide":
          post({ type: "HIDE", guids: o.guids });
          break;
        case "show":
          post({ type: "SHOW", guids: o.guids });
          break;
        case "isolate":
          post({ type: "ISOLATE", guids: o.guids });
          break;
        case "colorize_sel":
          post({ type: "COLORIZE", selector: o.selector, color: o.color });
          break;
        case "hide_sel":
          post({ type: "HIDE", selector: o.selector });
          break;
        case "show_sel":
          post({ type: "SHOW", selector: o.selector });
          break;
        case "isolate_sel":
          post({ type: "ISOLATE", selector: o.selector });
          break;
        case "show_all":
          post({ type: "SHOW_ALL" });
          break;
        case "reset_colors":
          post({ type: "RESET_COLORS" });
          break;
      }
    }
  }

  // ── Príjem správ z iframu (3D → DB) ─────────────────────────────────────
  useEffect(() => {
    readyRef.current = false;

    function onMessage(e: MessageEvent) {
      if (viewerOrigin !== "*" && e.origin !== viewerOrigin) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMessage(e.data)) return;

      switch (e.data.type) {
        case "READY": {
          readyRef.current = true;
          setStatus("ready");
          // Naplň ViewerApi až po READY — presne ako pôvodný kontrakt, kde
          // apiRef.current bol null pred načítaním scény.
          if (apiRef) apiRef.current = makeApi();
          break;
        }
        case "MODELS_LOADED":
          // Modely sú naparsované — až teraz vie resolveGuids nájsť prvok.
          // Počiatočný deep-link focus/ops (?focus=…&ops=…) aplikuj tu, nie na READY.
          loadedRef.current = true;
          if (focus) post({ type: "FOCUS", guids: focus.split(",") });
          if (ops) applyOps(ops);
          break;
        case "ENTITY_SELECTED": {
          const objectId = guidMap[e.data.guid];
          sendAimPanel(e.data.guid, objectId);
          if (!objectId) return;
          onSelect?.({ id: objectId, route: "node", label: e.data.guid });
          onPickedElement?.(objectId, e.data.guid);
          break;
        }
        case "ENTITY_DESELECTED":
          // AIM kartu si viewer čistí sám pri deselekcii; tu stačí zahodiť
          // rozbehnutý fetch, aby stale odpoveď nešla do ďalšej selekcie.
          aimAbortRef.current?.abort();
          aimGuidRef.current = null;
          break;
        case "AIM_NAVIGATE": {
          // Len host-relatívne cesty — obrana pred navigáciou na cudzie URL.
          const href = e.data.href;
          if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
            onNavigate?.(href);
          }
          break;
        }
      }
    }

    function makeApi(): ViewerApi {
      const toGuids = (oids: ReadonlyArray<string>, excludeOid?: string) =>
        oids
          .filter((oid) => oid !== excludeOid)
          .map((oid) => objectIdToGuid.get(oid))
          .filter((g): g is string => !!g);

      return {
        highlightFilter: (oids, excludeOid) =>
          post({ type: "HIGHLIGHT_FILTER", guids: toGuids(oids, excludeOid) }),
        highlightSiblings: (oids, excludeOid) =>
          post({ type: "HIGHLIGHT_FILTER", guids: toGuids(oids, excludeOid) }),
        clearFilter: () => post({ type: "CLEAR_FILTER" }),
        focusObject: (guid) => post({ type: "FOCUS", guids: [guid] }),
        getIfcBuffer: () => null,
      };
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      readyRef.current = false;
      loadedRef.current = false;
      aimAbortRef.current?.abort();
      aimAbortRef.current = null;
      aimGuidRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey, viewerOrigin]);

  // ── Focus (karta/AI dock → 3D), reaktívne pri soft-nav (D-056) ──────────
  useEffect(() => {
    if (!readyRef.current || !focus) return;
    post({ type: "FOCUS", guids: focus.split(",") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, focusNonce]);

  // ── Viewer ops AI docku (ofarbenie/skrytie/izolácia, D-066) pri soft-nav.
  // Pred MODELS_LOADED nemá zmysel posielať (GUIDy sa nedajú resolvnúť) —
  // počiatočné ops aplikuje handler MODELS_LOADED vyššie.
  useEffect(() => {
    if (!loadedRef.current || !ops) return;
    applyOps(ops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, focusNonce]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
      <iframe
        key={modelsKey}
        ref={iframeRef}
        src={src}
        title="3D model budovy"
        className="h-full w-full border-0"
        onError={() => setStatus("error")}
        allow="fullscreen"
      />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60 backdrop-blur-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">Načítavam 3D scénu…</span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            Chyba pri načítaní 3D prehliadača
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Skontrolujte dostupnosť vieweru na{" "}
            <code className="rounded bg-muted px-1">{VIEWER_URL}</code> alebo
            nastavte <code className="rounded bg-muted px-1">NEXT_PUBLIC_IFC_VIEWER_URL</code>.
          </span>
        </div>
      )}
    </div>
  );
}
