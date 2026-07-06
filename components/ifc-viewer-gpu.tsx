"use client";

/**
 * WebGPU IFC viewer (federovaný, D-044/D-049) — opt-in engine.
 *
 * Postavený na oficiálnom @ifc-lite/renderer (WebGPU) + @ifc-lite/geometry.
 * Načíta N disciplinárnych modelov (ASR + VZT + …), federuje ich cez
 * `federationRegistry` (unikátny ID offset per model → žiadne kolízie expressId),
 * a umožní ich zapínať/vypínať v jednej scéne. Spojka 3D↔DB ostáva IFC GUID.
 *
 * Runtime vyžaduje `navigator.gpu` (Chrome/Edge/Safari 26+). Výber engine rieši
 * IFCWorkspace — tento komponent sa mountne len keď je WebGPU dostupné.
 */

import { useEffect, useRef, useState } from "react";
import { Renderer, federationRegistry } from "@ifc-lite/renderer";
import { GeometryProcessor } from "@ifc-lite/geometry";

import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModelSource } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

// Typy neexportované z package rootu — odvodíme z metód (bez krehkých subpath importov).
type GeometryResult = Awaited<ReturnType<GeometryProcessor["process"]>>;
type MeshData = GeometryResult["meshes"][number];
type RenderOptions = NonNullable<Parameters<Renderer["render"]>[0]>;

const GUID_RE = /#(\d+)=IFC\w+\('([0-9A-Za-z_$]{22})'/g;
const FILTER_COLOR: [number, number, number, number] = [0.376, 0.647, 0.98, 1]; // blue-400

interface Props {
  models: IfcModelSource[];
  guidMap: GuidMap;
  focus?: string;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
}

export function IFCViewerGPU({
  models,
  guidMap,
  focus,
  apiRef,
  onSelect,
  onPickedElement,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [modelLabels, setModelLabels] = useState<IfcModelSource[]>([]);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  // Imperatívny most z toggle-effectu do scény.
  const applyModelVisibilityRef = useRef<((hidden: Set<string>) => void) | null>(null);
  const cleanupKeydownRef = useRef<(() => void) | null>(null);

  // ── Re-aplikuj viditeľnosť modelov pri zmene toggle-u ──────────────────────
  useEffect(() => {
    applyModelVisibilityRef.current?.(hiddenModels);
  }, [hiddenModels]);

  // ── Hlavný effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    setStatus("loading");
    setErrorMsg("");
    applyModelVisibilityRef.current = null;

    let cancelled = false;
    let renderer: Renderer | null = null;
    let disposed = false;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const resizeObs = new ResizeObserver(() => {
      if (!renderer) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * Math.min(window.devicePixelRatio, 2)));
      canvas.height = Math.max(1, Math.floor(h * Math.min(window.devicePixelRatio, 2)));
      renderer.resize(canvas.width, canvas.height);
      renderer.requestRender();
    });

    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("WebGPU nie je v tomto prehliadači dostupné (navigator.gpu).");
        }

        // ── Init renderer + geometry ────────────────────────────────
        setProgress("Inicializujem WebGPU…");
        renderer = new Renderer(canvas);
        // enableInstancing:false je pre federáciu povinné (renderer inak zahodí
        // opakované occurrences druhého modelu).
        const processor = new GeometryProcessor({ enableInstancing: false });
        await Promise.all([renderer.init(), processor.init()]);
        if (cancelled) return;

        federationRegistry.clear();

        const combined: MeshData[] = [];
        const globalIdToGuid = new Map<number, string>();
        const guidToGlobalId = new Map<string, number>();
        const modelIdToGlobalIds = new Map<string, number[]>();
        let firstBuffer: Uint8Array | null = null;

        // ── Načítaj + federuj každý model ───────────────────────────
        for (const model of models) {
          setProgress(`Sťahujem ${model.label}…`);
          const resp = await fetchWithRetry(model.url);
          if (!resp.ok) throw new Error(`${model.label}: HTTP ${resp.status}\n${model.url}`);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          if (cancelled) return;
          if (!firstBuffer) firstBuffer = bytes;

          setProgress(`Spracúvam geometriu — ${model.label}…`);
          const result = await processor.process(bytes);
          if (cancelled) return;

          // Offset pre tento model = max(expressId) + 1 (federationRegistry).
          let maxEid = 0;
          for (const m of result.meshes) if (m.expressId > maxEid) maxEid = m.expressId;
          const offset = federationRegistry.registerModel(model.id, maxEid);

          const ids: number[] = [];
          for (const mesh of result.meshes) {
            const globalId = mesh.expressId + offset;
            combined.push({ ...mesh, expressId: globalId });
            ids.push(globalId);
          }
          modelIdToGlobalIds.set(model.id, ids);

          // expressId → ifc_guid z STEP textu → global id.
          const text = new TextDecoder().decode(bytes);
          GUID_RE.lastIndex = 0;
          let rm: RegExpExecArray | null;
          while ((rm = GUID_RE.exec(text)) !== null) {
            const globalId = parseInt(rm[1], 10) + offset;
            const guid = rm[2];
            globalIdToGuid.set(globalId, guid);
            guidToGlobalId.set(guid, globalId);
          }
        }

        if (combined.length === 0) throw new Error("Modely neobsahujú žiadnu geometriu.");

        // objectId → guid (obrátená guidMap, DB→3D smer).
        const objectIdToGuid = new Map<string, string>();
        for (const [guid, oid] of Object.entries(guidMap)) objectIdToGuid.set(oid, guid);

        // ── Nahraj do scény ────────────────────────────────────────
        setProgress("Renderujem…");
        canvas.width = Math.max(1, Math.floor(host.clientWidth * Math.min(window.devicePixelRatio, 2)));
        canvas.height = Math.max(1, Math.floor(host.clientHeight * Math.min(window.devicePixelRatio, 2)));
        renderer.resize(canvas.width, canvas.height);
        renderer.loadGeometry(combined);
        renderer.fitToView();
        resizeObs.observe(host);

        if (!cancelled) setModelLabels(models);

        // ── Per-frame render state ─────────────────────────────────
        const state: RenderOptions = {
          clearColor: [0.945, 0.961, 0.976, 1], // slate-100
          selectedIds: new Set<number>(),
          hiddenIds: new Set<number>(),
        };
        const draw = () => {
          if (!renderer || disposed) return;
          renderer.render(state);
        };

        // ── Model on/off (hiddenIds = zjednotenie skrytých modelov) ──
        function applyModelVisibility(hidden: Set<string>): void {
          const h = new Set<number>();
          for (const modelId of hidden) {
            for (const gid of modelIdToGlobalIds.get(modelId) ?? []) h.add(gid);
          }
          state.hiddenIds = h;
          draw();
        }
        applyModelVisibilityRef.current = applyModelVisibility;

        // ── Farebné zvýraznenie (DB→3D filter) cez scene color overrides ─
        function applyFilter(objectIds: ReadonlyArray<string>, excludeOid?: string): void {
          if (!renderer) return;
          const overrides = new Map<number, [number, number, number, number]>();
          for (const oid of objectIds) {
            if (oid === excludeOid) continue;
            const guid = objectIdToGuid.get(oid);
            if (!guid) continue;
            const gid = guidToGlobalId.get(guid);
            if (gid !== undefined) overrides.set(gid, FILTER_COLOR);
          }
          const device = renderer.getGPUDevice();
          const pipeline = renderer.getPipeline();
          if (device && pipeline) {
            renderer.getScene().setColorOverrides(overrides, device, pipeline);
          }
          draw();
        }

        // ── Focus (karta → 3D): zvýrazni + rám celok ────────────────
        function focusGuid(guid: string): void {
          const gid = guidToGlobalId.get(guid);
          if (gid === undefined || !renderer) return;
          state.selectedIds = new Set([gid]);
          renderer.fitToView();
          draw();
        }
        if (focus) focusGuid(focus);

        // ── ViewerApi ───────────────────────────────────────────────
        if (apiRef) {
          apiRef.current = {
            highlightFilter: (oids, excludeOid) => applyFilter(oids, excludeOid),
            clearFilter: () => applyFilter([]),
            highlightSiblings: (oids, excludeOid) => applyFilter(oids, excludeOid),
            focusObject: (guid) => focusGuid(guid),
            getIfcBuffer: () => firstBuffer,
          };
        }

        // ── Picking (3D → DB) ───────────────────────────────────────
        let downPos = { x: 0, y: 0 };
        canvas.addEventListener("pointerdown", (e) => {
          downPos = { x: e.clientX, y: e.clientY };
        });
        canvas.addEventListener("pointerup", async (e) => {
          if (Math.abs(e.clientX - downPos.x) > 6 || Math.abs(e.clientY - downPos.y) > 6) return;
          if (!renderer) return;
          const rect = canvas.getBoundingClientRect();
          const hit = await renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
          if (!hit) return;
          const guid = globalIdToGuid.get(hit.expressId);
          if (!guid) return;
          const objectId = guidMap[guid];
          if (!objectId) return;
          state.selectedIds = new Set([hit.expressId]);
          draw();
          onSelect?.({ id: objectId, route: "node", label: guid });
          onPickedElement?.(objectId, guid);
        });

        // Escape = zruš výber
        const onKeyDown = (e: KeyboardEvent) => {
          if (e.key === "Escape") {
            state.selectedIds = new Set<number>();
            draw();
          }
        };
        window.addEventListener("keydown", onKeyDown);
        cleanupKeydownRef.current = () => window.removeEventListener("keydown", onKeyDown);

        draw();
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      disposed = true;
      resizeObs.disconnect();
      cleanupKeydownRef.current?.();
      cleanupKeydownRef.current = null;
      applyModelVisibilityRef.current = null;
      if (apiRef) apiRef.current = null;
      federationRegistry.clear();
      renderer?.destroy();
      if (host.contains(canvas)) host.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, models.map((m) => m.url).join("|")]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
      <div ref={hostRef} className="h-full w-full" />

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60 backdrop-blur-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">{progress || "Načítavam…"}</span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            Chyba pri načítaní 3D modelu (WebGPU)
          </span>
          <span className="max-w-sm whitespace-pre-line break-words text-xs text-muted-foreground">
            {errorMsg}
          </span>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Skúsiť znova
          </button>
        </div>
      )}

      {/* Prepínač modelov — zapínanie/vypínanie disciplinárnych modelov */}
      {status === "ready" && modelLabels.length > 1 && (
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {modelLabels.map((m) => {
            const on = !hiddenModels.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() =>
                  setHiddenModels((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
                className={[
                  "rounded px-2 py-1 text-[0.65rem] font-medium backdrop-blur-sm transition-colors",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "bg-background/80 text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {on ? "◉" : "◯"} {m.label}
              </button>
            );
          })}
        </div>
      )}

      {status === "ready" && (
        <div className="absolute bottom-2 right-2 rounded bg-background/70 px-2 py-1 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
          Otáčanie: ľavé · Zoom: koliesko · Escape: zruš výber
        </div>
      )}
    </div>
  );
}

// ── Pomocné ─────────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 1, delayMs = 400): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries && /load failed|failed to fetch|networkerror/i.test(msg)) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
