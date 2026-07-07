"use client";

import { useEffect, useRef, useState } from "react";
import initWasm from "@ifc-lite/wasm";
import { GeometryProcessor } from "@ifc-lite/geometry";
import { Renderer, federationRegistry } from "@ifc-lite/renderer";
import {
  IfcParser,
  extractEntityAttributesOnDemand,
  extractPropertiesOnDemand,
  extractClassificationsOnDemand,
  buildMaterialUsageIndex,
  type IfcDataStore,
} from "@ifc-lite/parser";
import type { MeshData } from "@ifc-lite/geometry";
import type { SectionPlane } from "@ifc-lite/renderer";

import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type {
  IfcElementInfo,
  LoadedModel,
  NavGroup,
  NavigatorModel,
  NavTreeNode,
  ViewerApi,
} from "@/lib/viewer-api";

interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

interface Props {
  /** Federačná sada modelov (D-050). Prvý = primárny (ARCH). */
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
  /** Zoznam načítaných modelov (pre panel/navigátor v orchestrácii). */
  onModelsLoaded?: (models: LoadedModel[]) => void;
  /** IFClite-native navigátor dáta (SPATIAL/TYPE/MATERIAL/CLASS). */
  onNavigator?: (models: NavigatorModel[]) => void;
  /** Detail prvku mimo DB (naparsované IFC) — `null` zavrie panel. */
  onIfcElement?: (info: IfcElementInfo | null) => void;
}

export function IFCViewer({
  models,
  guidMap,
  focus,
  apiRef,
  onSelect,
  onPickedElement,
  onModelsLoaded,
  onNavigator,
  onIfcElement,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiInternalRef = useRef<ViewerApi | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState("");
  const [loadedModels, setLoadedModels] = useState<LoadedModel[]>([]);

  // Reaktívny focus (karta/strom → 3D) po načítaní.
  useEffect(() => {
    if (focus) apiInternalRef.current?.focusObject(focus);
  }, [focus]);

  const modelsKey = models.map((m) => m.url).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

    let cancelled = false;
    let raf = 0;
    let renderer: Renderer | null = null;
    const cleanupFns: Array<() => void> = [];

    // ── Mutovateľný stav scény ────────────────────────────────────────────
    const selectedIds = new Set<number>(); // pick highlight (globálne exprId)
    let filterSet: Set<number> | null = null; // ghostExceptIds (DB → 3D filter)
    let section: SectionPlane | null = null;
    const visibleModels = new Map<string, boolean>();
    const modelMeshes = new Map<string, MeshData[]>(); // offsetnuté meshe per model
    const globalExprToGuid = new Map<number, string>();
    const guidToGlobalExpr = new Map<string, number>();
    const boundsByExpr = new Map<number, AABB>();
    const objectIdToGuid = new Map<string, string>();
    for (const [g, o] of Object.entries(guidMap)) objectIdToGuid.set(o, g);
    let primaryBuffer: Uint8Array | null = null;
    let sceneBounds: AABB | null = null;
    // Parsované IFClite store per model (navigátor + IFC-props fallback, follow-IFClite).
    const stores = new Map<
      string,
      { store: IfcDataStore; offset: number; typeByLocal: Map<number, string> }
    >();

    // ── Pomocné (čítajú `renderer`/mapy až pri volaní) ───────────────────
    function reloadVisible(): void {
      if (!renderer) return;
      const all: MeshData[] = [];
      for (const [id, meshes] of modelMeshes) {
        if (visibleModels.get(id)) all.push(...meshes);
      }
      renderer.loadGeometry(all);
    }

    function selectionFromOids(
      oids: ReadonlyArray<string>,
      excludeOid?: string
    ): Set<number> {
      const s = new Set<number>();
      for (const oid of oids) {
        if (oid === excludeOid) continue;
        const g = objectIdToGuid.get(oid);
        if (!g) continue;
        const ge = guidToGlobalExpr.get(g);
        if (ge !== undefined) s.add(ge);
      }
      return s;
    }

    function frameExpr(ge: number): void {
      const bb = boundsByExpr.get(ge);
      if (!bb || !renderer) return;
      void renderer
        .getCamera()
        .frameBounds(
          { x: bb.min[0], y: bb.min[1], z: bb.min[2] },
          { x: bb.max[0], y: bb.max[1], z: bb.max[2] }
        );
    }

    function emitIfcElement(ge: number): void {
      const lookup = federationRegistry.fromGlobalId(ge);
      if (!lookup) {
        onIfcElement?.(null);
        return;
      }
      const rec = stores.get(lookup.modelId);
      if (!rec) {
        onIfcElement?.(null);
        return;
      }
      try {
        const attrs = extractEntityAttributesOnDemand(rec.store, lookup.expressId);
        const psetsRaw = extractPropertiesOnDemand(rec.store, lookup.expressId);
        const psets = psetsRaw.map((p) => ({
          name: p.name,
          props: p.properties.map((pr) => ({
            name: pr.name,
            value: pr.value == null ? "" : String(pr.value),
          })),
        }));
        onIfcElement?.({
          guid: attrs.globalId || null,
          name: attrs.name || null,
          objectType: rec.typeByLocal.get(lookup.expressId) || attrs.objectType || null,
          modelName: models.find((mm) => mm.id === lookup.modelId)?.name ?? lookup.modelId,
          psets,
        });
      } catch {
        onIfcElement?.(null);
      }
    }

    function selectByGlobalExpr(ge: number): void {
      selectedIds.clear();
      selectedIds.add(ge);
      frameExpr(ge);
      const guid = globalExprToGuid.get(ge);
      const objectId = guid ? guidMap[guid] : undefined;
      if (objectId && guid) {
        onIfcElement?.(null);
        onSelect?.({ id: objectId, route: "node", label: guid });
        onPickedElement?.(objectId, guid);
      } else {
        emitIfcElement(ge);
      }
    }

    async function doPick(clientX: number, clientY: number): Promise<void> {
      if (!renderer) return;
      const rect = canvas!.getBoundingClientRect();
      const res = await renderer.pick(clientX - rect.left, clientY - rect.top);
      if (cancelled || !res) return;
      selectByGlobalExpr(res.expressId);
    }

    function applyResize(): void {
      if (!renderer) return;
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.resize(
        Math.max(1, Math.floor(w * dpr)),
        Math.max(1, Math.floor(h * dpr))
      );
      renderer.getCamera().setAspect(w / Math.max(h, 1));
    }

    const resizeObs = new ResizeObserver(applyResize);

    (async () => {
      try {
        if (!hasWebGPU) {
          throw new Error(
            "Tento prehliadač nepodporuje WebGPU (potrebný Chrome/Edge 113+, Firefox 127+, Safari 18+)."
          );
        }
        setStatus("loading");
        setProgress("Inicializujem WebGPU…");
        federationRegistry.clear();

        // Predinicializuj zdieľanú WASM zo self-hostovanej cesty; GeometryProcessor
        // ju cez guard (`if (wasm !== undefined) return`) znovupoužije.
        await initWasm("/ifc-lite_bg.wasm");
        if (cancelled) return;

        renderer = new Renderer(canvas);
        await renderer.init();
        if (cancelled) return;

        const geom = new GeometryProcessor({ enableInstancing: false });
        await geom.init();
        if (cancelled) return;

        for (let i = 0; i < models.length; i++) {
          const m = models[i];
          setProgress(`Sťahujem ${m.name}… (${i + 1}/${models.length})`);
          const resp = await fetch(m.url);
          if (!resp.ok) throw new Error(`${m.name}: HTTP ${resp.status}`);
          const buf = new Uint8Array(await resp.arrayBuffer());
          if (cancelled) return;
          if (i === 0) primaryBuffer = buf;

          // Lokálne expressId → IFC GUID zo STEP textu.
          const text = new TextDecoder().decode(buf);
          const localGuid = new Map<number, string>();
          const re = /#(\d+)=IFC\w+\('([0-9A-Za-z_$]{22})'/g;
          let mm: RegExpExecArray | null;
          while ((mm = re.exec(text)) !== null) {
            localGuid.set(parseInt(mm[1], 10), mm[2]);
          }

          setProgress(`Spracúvam geometriu ${m.name}…`);
          const result = await geom.process(buf);
          if (cancelled) return;

          let maxId = 0;
          for (const me of result.meshes) if (me.expressId > maxId) maxId = me.expressId;
          const offset = federationRegistry.registerModel(m.id, maxId);

          const offsetMeshes: MeshData[] = result.meshes.map((me) => ({
            ...me,
            expressId: me.expressId + offset,
          }));
          modelMeshes.set(m.id, offsetMeshes);
          visibleModels.set(m.id, true);

          for (const [eid, g] of localGuid) {
            const ge = eid + offset;
            globalExprToGuid.set(ge, g);
            guidToGlobalExpr.set(g, ge);
          }
          for (const me of offsetMeshes) accumulateBounds(boundsByExpr, me);

          // Parsovanie pre navigátor (follow-IFClite). Defenzívne — zlyhanie
          // parsu nezhodí render.
          try {
            setProgress(`Analyzujem ${m.name}…`);
            const store = await new IfcParser().parseColumnar(buf.buffer as ArrayBuffer);
            if (cancelled) return;
            const typeByLocal = new Map<number, string>();
            for (const [t, ids] of store.entityIndex.byType) {
              for (const id of ids) typeByLocal.set(id, t);
            }
            stores.set(m.id, { store, offset, typeByLocal });
          } catch {
            /* navigátor pre tento model nedostupný */
          }
        }

        setProgress("Skladám scénu…");
        reloadVisible();
        renderer.fitToView();
        const b = renderer.getModelBounds();
        if (b) {
          sceneBounds = {
            min: [b.min.x, b.min.y, b.min.z],
            max: [b.max.x, b.max.y, b.max.z],
          };
          renderer.getCamera().setSceneBounds(b);
        }

        resizeObs.observe(container);
        applyResize();

        const list: LoadedModel[] = models.map((m) => ({
          id: m.id,
          name: m.name,
          visible: true,
          elementCount: modelMeshes.get(m.id)?.length ?? 0,
        }));
        if (!cancelled) {
          setLoadedModels(list);
          onModelsLoaded?.(list);
        }

        // ── Navigátor (IFClite-native, follow-IFClite) ─────────────────
        if (onNavigator) {
          const navModels: NavigatorModel[] = [];
          for (const m of models) {
            const rec = stores.get(m.id);
            if (rec) navModels.push(buildNavigator(m.id, m.name, rec.store, rec.offset, rec.typeByLocal));
          }
          if (!cancelled && navModels.length) onNavigator(navModels);
        }

        // ── ViewerApi ──────────────────────────────────────────────────
        const api: ViewerApi = {
          highlightFilter: (oids, ex) => {
            const s = selectionFromOids(oids, ex);
            filterSet = s.size ? s : null;
          },
          clearFilter: () => {
            filterSet = null;
          },
          highlightSiblings: (oids, ex) => {
            const s = selectionFromOids(oids, ex);
            filterSet = s.size ? s : null;
          },
          focusObject: (guid) => {
            const ge = guidToGlobalExpr.get(guid);
            if (ge === undefined) return;
            selectedIds.clear();
            selectedIds.add(ge);
            frameExpr(ge);
          },
          setModelVisible: (id, v) => {
            visibleModels.set(id, v);
            reloadVisible();
            setLoadedModels((prev) =>
              prev.map((x) => (x.id === id ? { ...x, visible: v } : x))
            );
          },
          setSectionPlane: (p) => {
            section = p;
          },
          setView: (preset) => {
            if (renderer && sceneBounds) {
              renderer.getCamera().setPresetView(preset, {
                min: { x: sceneBounds.min[0], y: sceneBounds.min[1], z: sceneBounds.min[2] },
                max: { x: sceneBounds.max[0], y: sceneBounds.max[1], z: sceneBounds.max[2] },
              });
            }
          },
          resetView: () => renderer?.fitToView(),
          highlightExprs: (exprs) => {
            filterSet = exprs.length ? new Set(exprs) : null;
          },
          selectExpr: (ge) => selectByGlobalExpr(ge),
          getIfcBuffer: () => primaryBuffer,
        };
        if (apiRef) apiRef.current = api;
        apiInternalRef.current = api;
        if (focus) api.focusObject(focus);

        // ── Ovládanie kamery ───────────────────────────────────────────
        let dragging = false;
        let btn = 0;
        let lastX = 0;
        let lastY = 0;
        let moved = false;

        const onPointerDown = (e: PointerEvent) => {
          dragging = true;
          btn = e.button;
          lastX = e.clientX;
          lastY = e.clientY;
          moved = false;
          canvas.setPointerCapture?.(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
          if (!dragging || !renderer) return;
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          const cam = renderer.getCamera();
          if (btn === 2 || e.shiftKey) cam.pan(dx, dy);
          else cam.orbit(dx * 0.01, dy * 0.01);
        };
        const onPointerUp = (e: PointerEvent) => {
          if (dragging && !moved) void doPick(e.clientX, e.clientY);
          dragging = false;
          canvas.releasePointerCapture?.(e.pointerId);
        };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          if (!renderer) return;
          const rect = canvas.getBoundingClientRect();
          renderer
            .getCamera()
            .zoom(e.deltaY * 0.01, false, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        };
        const onContext = (e: Event) => e.preventDefault();
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") selectedIds.clear();
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("contextmenu", onContext);
        window.addEventListener("keydown", onKey);
        cleanupFns.push(() => {
          canvas.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("wheel", onWheel);
          canvas.removeEventListener("contextmenu", onContext);
          window.removeEventListener("keydown", onKey);
        });

        if (!cancelled) setStatus("ready");

        // ── Render loop ────────────────────────────────────────────────
        let last = performance.now();
        const frame = () => {
          if (cancelled || !renderer) return;
          raf = requestAnimationFrame(frame);
          const now = performance.now();
          const dt = (now - last) / 1000;
          last = now;
          renderer.getCamera().update(dt);
          renderer.render({
            clearColor: [0.945, 0.961, 0.976, 1],
            selectedIds: selectedIds.size ? new Set(selectedIds) : undefined,
            ghostExceptIds: filterSet,
            sectionPlane: section ?? undefined,
          });
        };
        frame();
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resizeObs.disconnect();
      cleanupFns.forEach((f) => f());
      if (apiRef) apiRef.current = null;
      apiInternalRef.current = null;
      try {
        renderer?.destroy();
      } catch {
        /* už zničené */
      }
      federationRegistry.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
      <div ref={containerRef} className="h-full w-full">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60 backdrop-blur-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">{progress || "Načítavam…"}</span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            Chyba pri načítaní 3D modelu
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">{errorMsg}</span>
        </div>
      )}

      {/* Panel modelov — zap/vyp federovaných modelov (D-050) */}
      {status === "ready" && loadedModels.length > 0 && (
        <div className="absolute left-2 top-2 flex flex-col gap-1 rounded bg-background/80 p-2 backdrop-blur-sm">
          <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Modely
          </span>
          {loadedModels.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-1.5 text-[0.7rem] text-foreground"
            >
              <input
                type="checkbox"
                checked={m.visible}
                onChange={(e) =>
                  apiInternalRef.current?.setModelVisible(m.id, e.target.checked)
                }
                className="h-3 w-3 accent-primary"
              />
              {m.name}
            </label>
          ))}
        </div>
      )}

      {status === "ready" && (
        <div className="absolute bottom-2 right-2 rounded bg-background/70 px-2 py-1 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
          Otáčanie: ľavé · Zoom: koliesko · Pan: pravé/Shift · Escape: zruš výber
        </div>
      )}
    </div>
  );
}

// ── Pomocné funkcie ─────────────────────────────────────────────────────────

interface SpatialNodeLike {
  expressId: number;
  name?: string;
  longName?: string;
  children: SpatialNodeLike[];
  elements: number[];
}

function walkSpatial(
  node: SpatialNodeLike,
  offset: number,
  typeByLocal: Map<number, string>,
  modelId: string
): NavTreeNode {
  const childNodes = node.children.map((c) => walkSpatial(c, offset, typeByLocal, modelId));
  const groupChildren: NavTreeNode[] = [];
  if (node.elements.length) {
    const byType = new Map<string, number[]>();
    for (const e of node.elements) {
      const t = typeByLocal.get(e) ?? "IfcElement";
      const arr = byType.get(t) ?? [];
      arr.push(e + offset);
      byType.set(t, arr);
    }
    for (const [t, exprs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      groupChildren.push({
        key: `${modelId}:${node.expressId}:${t}`,
        label: `${t} (${exprs.length})`,
        exprs,
        children: [],
      });
    }
  }
  const subtreeExprs = [
    ...node.elements.map((e) => e + offset),
    ...childNodes.flatMap((c) => c.exprs),
  ];
  const label = node.longName
    ? `${node.name ?? ""} ${node.longName}`.trim()
    : node.name || "(uzol)";
  return {
    key: `${modelId}:${node.expressId}`,
    label,
    expr: node.expressId + offset,
    exprs: subtreeExprs,
    children: [...childNodes, ...groupChildren],
  };
}

function collectSpatialElements(root: SpatialNodeLike | undefined): number[] {
  const out: number[] = [];
  if (!root) return out;
  const stack: SpatialNodeLike[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    for (const e of n.elements) out.push(e);
    for (const c of n.children) stack.push(c);
  }
  return out;
}

function buildNavigator(
  id: string,
  name: string,
  store: IfcDataStore,
  offset: number,
  typeByLocal: Map<number, string>
): NavigatorModel {
  const hier = store.spatialHierarchy;
  const spatial: NavTreeNode[] = hier?.project
    ? [walkSpatial(hier.project as unknown as SpatialNodeLike, offset, typeByLocal, id)]
    : [];

  const types: NavGroup[] = [];
  for (const [t, ids] of store.entityIndex.byType) {
    types.push({ label: t, count: ids.length, exprs: ids.map((x) => x + offset) });
  }
  types.sort((a, b) => b.count - a.count);

  const materials: NavGroup[] = [];
  try {
    for (const usage of buildMaterialUsageIndex(store).values()) {
      materials.push({
        label: usage.name || "(bez názvu)",
        count: usage.entries.length,
        exprs: usage.entries.map((e) => e.entityId + offset),
      });
    }
    materials.sort((a, b) => b.count - a.count);
  } catch {
    /* materiály nedostupné */
  }

  const classifications: NavGroup[] = [];
  try {
    const byCode = new Map<string, number[]>();
    for (const eid of collectSpatialElements(hier?.project as unknown as SpatialNodeLike | undefined)) {
      for (const info of extractClassificationsOnDemand(store, eid)) {
        const code = info.identification || info.name || info.system;
        if (!code) continue;
        const label =
          info.identification && info.name ? `${info.identification} — ${info.name}` : code;
        const arr = byCode.get(label) ?? [];
        arr.push(eid + offset);
        byCode.set(label, arr);
      }
    }
    for (const [label, exprs] of byCode) {
      classifications.push({ label, count: exprs.length, exprs });
    }
    classifications.sort((a, b) => b.count - a.count);
  } catch {
    /* klasifikácie nedostupné */
  }

  return { id, name, spatial, types, materials, classifications };
}

function accumulateBounds(map: Map<number, AABB>, mesh: MeshData): void {
  const p = mesh.positions;
  if (!p || p.length < 3) return;
  let bb = map.get(mesh.expressId);
  if (!bb) {
    bb = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    map.set(mesh.expressId, bb);
  }
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    if (x < bb.min[0]) bb.min[0] = x;
    if (y < bb.min[1]) bb.min[1] = y;
    if (z < bb.min[2]) bb.min[2] = z;
    if (x > bb.max[0]) bb.max[0] = x;
    if (y > bb.max[1]) bb.max[1] = y;
    if (z > bb.max[2]) bb.max[2] = z;
  }
}
