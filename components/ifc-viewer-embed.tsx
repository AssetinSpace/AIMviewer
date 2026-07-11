"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

/**
 * IFCViewerEmbed — iframe wrapper around the ifc-lite viewer (apps/viewer in
 * the ifc-lite repo). Drop-in replacement for the three.js `IFCViewer`: same
 * Props, same ViewerApi, same onSelect/onPickedElement, so IFCWorkspace stays
 * unchanged. All 3D work (WASM parse, geometry, render) now lives in the
 * embedded viewer; this component only speaks the postMessage bridge defined
 * in apps/viewer/src/aim/bridge-protocol.ts.
 *
 * Wire contract (keep in sync with bridge-protocol.ts on the viewer side):
 *   viewer → host: READY, MODELS_LOADED, ENTITY_SELECTED, ENTITY_DESELECTED
 *   host → viewer: FOCUS, HIGHLIGHT_FILTER, CLEAR_FILTER
 *
 * The viewer autoloads the federation from `?models=<url>,<url>` and resolves
 * GUIDs only after geometry exists — so it emits MODELS_LOADED on the 0→N
 * model-count transition and we defer every GUID-bearing command (focus,
 * filter) until then. Commands issued earlier are queued and flushed.
 */

const SOURCE = "aim-bridge" as const;

/**
 * Deployed ifc-lite viewer (with AimBridge). The default is the stable
 * scope-qualified production alias of the AssetinSpace/ifc-lite Vercel project
 * (`ifc-lite-viewer` in `assetinspaces-projects`) — NOT ifclite.com, which is
 * upstream without the bridge. `NEXT_PUBLIC_VIEWER_URL` overrides per
 * environment (dev → http://localhost:3000 with ifc-lite `pnpm dev`).
 */
const VIEWER_URL =
  process.env.NEXT_PUBLIC_VIEWER_URL ??
  "https://ifc-lite-viewer-assetinspaces-projects.vercel.app";

type ViewerToHost =
  | { source: typeof SOURCE; type: "READY" }
  | { source: typeof SOURCE; type: "MODELS_LOADED"; count: number }
  | { source: typeof SOURCE; type: "ENTITY_SELECTED"; guid: string }
  | { source: typeof SOURCE; type: "ENTITY_DESELECTED" };

type HostToViewer =
  | { source: typeof SOURCE; type: "FOCUS"; guids: string[] }
  | { source: typeof SOURCE; type: "HIGHLIGHT_FILTER"; guids: string[] }
  | { source: typeof SOURCE; type: "CLEAR_FILTER" };

function isViewerMessage(data: unknown): data is ViewerToHost {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { source?: unknown }).source === SOURCE &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

interface Props {
  /** Modely federácie (D-049) — načítané viewerom cez ?models=. */
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu (D-056). */
  focusNonce?: string;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
}

export function IFCViewerEmbed({
  models,
  guidMap,
  focus,
  focusNonce,
  apiRef,
  onSelect,
  onPickedElement,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  // Diagnostic: still no READY/MODELS_LOADED after 30 s → show a hint with the
  // viewer URL, so a wrong NEXT_PUBLIC_VIEWER_URL is visible, not a blank spin.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== "loading") return;
    const t = setTimeout(() => setSlow(true), 30_000);
    return () => clearTimeout(t);
  }, [status]);

  // Only the viewer's own origin may talk to us, and we only post to it.
  const viewerOrigin = useMemo(() => {
    if (!VIEWER_URL) return null;
    try {
      return new URL(VIEWER_URL).origin;
    } catch {
      return null;
    }
  }, []);

  // iframe src — stable across everything but the set of model URLs; a change
  // reloads the viewer, so `focus` is delivered via postMessage, not the URL.
  const modelsKey = models.map((m) => m.url).join("|");
  const src = useMemo(() => {
    if (!VIEWER_URL) return "";
    const urls = models.map((m) => m.url).filter(Boolean);
    if (urls.length === 0) return VIEWER_URL;
    const params = new URLSearchParams();
    params.set("models", urls.join(","));
    return `${VIEWER_URL}?${params.toString()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey]);

  // objectId → IFC GUID (reverse of guidMap) for DB→3D commands.
  const objectIdToGuid = useMemo(() => {
    const m = new Map<string, string>();
    for (const [guid, oid] of Object.entries(guidMap)) m.set(oid, guid);
    return m;
  }, [guidMap]);

  // Bridge state. Refs (not state) — postMessage plumbing must not re-render.
  const modelsLoadedRef = useRef(false);
  const pendingRef = useRef<HostToViewer[]>([]);

  const postToViewer = useCallback(
    (msg: HostToViewer) => {
      iframeRef.current?.contentWindow?.postMessage(msg, viewerOrigin ?? "*");
    },
    [viewerOrigin]
  );

  // Queue GUID-bearing commands until the viewer reports its models loaded;
  // resolveGuids returns nothing before then (see bridge-protocol.ts).
  const send = useCallback(
    (msg: HostToViewer) => {
      if (modelsLoadedRef.current) postToViewer(msg);
      else pendingRef.current.push(msg);
    },
    [postToViewer]
  );

  const flushPending = useCallback(() => {
    if (!modelsLoadedRef.current) return;
    const queued = pendingRef.current;
    pendingRef.current = [];
    for (const msg of queued) postToViewer(msg);
  }, [postToViewer]);

  // Reset the loading overlay whenever the viewer reloads (model set changed).
  // Render-time state reset (React's "adjust state when a prop changes"), so no
  // cascading effect re-render is scheduled.
  const [loadedSrc, setLoadedSrc] = useState(src);
  if (src !== loadedSrc) {
    setLoadedSrc(src);
    setStatus("loading");
    setSlow(false);
  }

  // Reset the postMessage bridge refs on reload. Kept in an effect (refs must
  // not be touched during render); no setState here, so no cascading render.
  useEffect(() => {
    modelsLoadedRef.current = false;
    pendingRef.current = [];
  }, [src]);

  // Inbound: viewer → host.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (viewerOrigin && e.origin !== viewerOrigin) return;
      if (!isViewerMessage(e.data)) return;

      switch (e.data.type) {
        case "READY":
          setStatus("ready");
          break;
        case "MODELS_LOADED":
          modelsLoadedRef.current = true;
          setStatus("ready");
          flushPending();
          break;
        case "ENTITY_SELECTED": {
          const objectId = guidMap[e.data.guid];
          if (!objectId) return;
          onSelect?.({ id: objectId, route: "node", label: e.data.guid });
          onPickedElement?.(objectId, e.data.guid);
          break;
        }
        case "ENTITY_DESELECTED":
          // Parity with the old three.js viewer: 3D deselect does not clear the
          // DB-side selection panel (Escape only reset the 3D highlight).
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [viewerOrigin, guidMap, onSelect, onPickedElement, flushPending]);

  // Focus (card / AI dock → 3D). Comma-separated GUIDs; queued until load.
  // focusNonce in deps: every AI action carries a fresh nonce so an identical
  // GUID set re-applies (repeated "zobraz…"). See D-056.
  useEffect(() => {
    if (!focus) return;
    const guids = focus.split(",").map((g) => g.trim()).filter(Boolean);
    if (guids.length > 0) send({ source: SOURCE, type: "FOCUS", guids });
  }, [focus, focusNonce, send]);

  // ViewerApi (DB → 3D). Same surface as the three.js viewer; oids are mapped
  // back to GUIDs here because the bridge protocol is GUID-centric.
  useEffect(() => {
    if (!apiRef) return;
    const toGuids = (oids: ReadonlyArray<string>, excludeOid?: string) =>
      oids
        .filter((oid) => oid !== excludeOid)
        .map((oid) => objectIdToGuid.get(oid))
        .filter((g): g is string => !!g);

    apiRef.current = {
      highlightFilter: (oids, excludeOid) =>
        send({ source: SOURCE, type: "HIGHLIGHT_FILTER", guids: toGuids(oids, excludeOid) }),
      highlightSiblings: (oids, excludeOid) =>
        send({ source: SOURCE, type: "HIGHLIGHT_FILTER", guids: toGuids(oids, excludeOid) }),
      clearFilter: () => send({ source: SOURCE, type: "CLEAR_FILTER" }),
      focusObject: (guid) => send({ source: SOURCE, type: "FOCUS", guids: [guid] }),
      // Raw STEP buffer now lives inside the iframe; not exposed over the bridge.
      getIfcBuffer: () => null,
    };
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [apiRef, objectIdToGuid, send]);

  if (!VIEWER_URL) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md p-6 text-center ring-1 ring-border">
        <span className="text-sm font-semibold text-destructive">3D prehliadač nie je nakonfigurovaný</span>
        <span className="max-w-sm text-xs text-muted-foreground">
          Nastavte{" "}
          <code className="rounded bg-muted px-1">NEXT_PUBLIC_VIEWER_URL</code>{" "}
          na URL nasadeného ifc-lite viewera (s AimBridge).
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
      <iframe
        ref={iframeRef}
        src={src}
        title="IFC 3D prehliadač"
        className="h-full w-full border-0"
        allow="fullscreen; xr-spatial-tracking; cross-origin-isolated"
      />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60 backdrop-blur-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">Načítavam 3D model…</span>
          {slow && (
            <span className="max-w-sm text-center text-xs text-muted-foreground">
              Trvá to dlhšie než zvyčajne. Ak sa model nezobrazí, skontrolujte
              dostupnosť prehliadača na{" "}
              <code className="rounded bg-muted px-1">{VIEWER_URL}</code>
              {" "}a hodnotu{" "}
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_VIEWER_URL</code>.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
