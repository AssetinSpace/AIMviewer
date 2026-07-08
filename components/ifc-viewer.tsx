"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

/** expressId → ifc_guid, budovaná z IFC STEP textu regex-om. */
type ExprToGuid = Map<number, string>;

const HIGHLIGHT_COLOR = new THREE.Color(0xf97316); // orange-500 — pick selection
const HIGHLIGHT_EMISSIVE = new THREE.Color(0x7c2d12);
const FILTER_COLOR = new THREE.Color(0x60a5fa);    // blue-400 — filter / siblings
const FILTER_EMISSIVE = new THREE.Color(0x1e3a8a);

interface StoreyInfo {
  eid: number;
  name: string;
}

interface Props {
  ifcUrl: string;
  guidMap: GuidMap;
  focus?: string;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
}

export function IFCViewer({
  ifcUrl,
  guidMap,
  focus,
  apiRef,
  onSelect,
  onPickedElement,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState("");
  const [storeys, setStoreys] = useState<StoreyInfo[]>([]);
  const [activeStoreyEid, setActiveStoreyEid] = useState<number | null>(null);

  // Imperatívne refs — prístupné z useEffect-ov aj keyboard handlerov
  const applyStoreyFilterRef = useRef<((eid: number | null) => void) | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);

  // ── Escape key — zruš selekciu ─────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelectionRef.current?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Storey filter — re-aplikuj pri zmene aktívneho podlažia ────────────
  useEffect(() => {
    applyStoreyFilterRef.current?.(activeStoreyEid);
  }, [activeStoreyEid]);

  // ── Hlavný IFC effect ───────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reset stavu pri zmene modelu
    setStoreys([]);
    setActiveStoreyEid(null);
    applyStoreyFilterRef.current = null;
    clearSelectionRef.current = null;

    let cancelled = false;
    let animId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let orbitControls: OrbitControls | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let sceneToDispose: THREE.Scene | null = null;

    const resizeObs = new ResizeObserver(() => {
      if (!renderer || !camera || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });

    (async () => {
      try {
        // ── Three.js scene ──────────────────────────────────────────
        const scene = new THREE.Scene();
        sceneToDispose = scene;
        scene.background = new THREE.Color(0xf1f5f9);

        camera = new THREE.PerspectiveCamera(
          45,
          container.clientWidth / Math.max(container.clientHeight, 1),
          0.01,
          5000
        );

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);

        orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.enableDamping = true;
        orbitControls.dampingFactor = 0.05;

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(1, 2, 1.5);
        scene.add(sun);

        resizeObs.observe(container);

        // ── IFClite WASM ────────────────────────────────────────────
        setProgress("Inicializujem WASM…");
        const { default: initWasm, IfcAPI } = (await import(
          "@ifc-lite/wasm"
        )) as {
          default: (path?: string | URL | Request) => Promise<unknown>;
          IfcAPI: new () => {
            exportGlb(
              content: string,
              includeMetadata: boolean,
              hidden: Uint32Array,
              isolated: Uint32Array,
              hiddenTypesCsv: string
            ): Uint8Array;
          };
        };
        if (cancelled) return;

        await initWasm("/ifc-lite_bg.wasm");
        if (cancelled) return;

        // ── Fetch IFC ───────────────────────────────────────────────
        setProgress("Sťahujem IFC model…");
        const resp = await fetch(ifcUrl);
        if (!resp.ok) throw new Error(`IFC ${resp.status}: ${resp.statusText}`);
        const ifcText = await resp.text();
        if (cancelled) return;

        // IFC buffer pre @ifc-lite/query (Phase 4)
        const ifcBuffer = new TextEncoder().encode(ifcText);

        // ── expressId → ifc_guid z STEP textu ──────────────────────
        const exprToGuid: ExprToGuid = new Map();
        const guidRe = /#(\d+)=IFC\w+\('([0-9A-Za-z_$]{22})'/g;
        let rm: RegExpExecArray | null;
        while ((rm = guidRe.exec(ifcText)) !== null) {
          exprToGuid.set(parseInt(rm[1], 10), rm[2]);
        }

        // Reverse mapy — O(n) raz, O(1) lookup
        const guidToExpr = new Map<string, number>();
        for (const [eid, guid] of exprToGuid) guidToExpr.set(guid, eid);

        const objectIdToGuid = new Map<string, string>();
        for (const [guid, oid] of Object.entries(guidMap)) objectIdToGuid.set(oid, guid);

        // ── Storey mapy z STEP textu ────────────────────────────────
        // IfcBuildingStorey: #N=IFCBUILDINGSTOREY('guid',#owner,'Name',...
        const storeyNames = new Map<number, string>();
        const storeyRe =
          /#(\d+)=IFCBUILDINGSTOREY\('[^']*',[^,]+,(?:'([^']*)'|\$)/g;
        while ((rm = storeyRe.exec(ifcText)) !== null) {
          storeyNames.set(
            parseInt(rm[1], 10),
            rm[2]?.trim() || `Podlažie #${rm[1]}`
          );
        }

        // IfcRelContainedInSpatialStructure: (...elems...),#storeyEid
        const elementToStorey = new Map<number, number>(); // eid → storeyEid
        const storeyElements = new Map<number, Set<number>>(); // storeyEid → Set<eid>
        const containRe =
          /#\d+=IFCRELCONTAINEDINSPATIALSTRUCTURE\('[^']*',[^,]+,(?:'[^']*'|\$),(?:'[^']*'|\$),\(([^)]+)\),#(\d+)/g;
        while ((rm = containRe.exec(ifcText)) !== null) {
          const storeyEid = parseInt(rm[2], 10);
          if (!storeyNames.has(storeyEid)) continue; // len reálne storeys
          if (!storeyElements.has(storeyEid)) storeyElements.set(storeyEid, new Set());
          const elemSet = storeyElements.get(storeyEid)!;
          for (const ref of rm[1].split(",")) {
            const eid = parseInt(ref.trim().replace(/^#/, ""), 10);
            if (!isNaN(eid)) {
              elemSet.add(eid);
              elementToStorey.set(eid, storeyEid);
            }
          }
        }

        // Zoraď podlažia podľa mena (napr. 1NP < 2NP < 3NP)
        const storeyInfos: StoreyInfo[] = Array.from(storeyNames.entries())
          .filter(([eid]) => storeyElements.has(eid))
          .map(([eid, name]) => ({ eid, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "sk"));
        if (!cancelled) setStoreys(storeyInfos);

        // ── GLB konverzia cez IFClite ───────────────────────────────
        setProgress("Spracúvam geometriu…");
        const api = new IfcAPI();
        const empty = new Uint32Array(0);
        const glbBytes = api.exportGlb(
          ifcText,
          true,
          empty,
          empty,
          "IfcOpeningElement,IfcSpace"
        );
        if (cancelled) return;

        // ── GLB → Three.js ──────────────────────────────────────────
        setProgress("Načítavam scénu…");
        const loader = new GLTFLoader();
        const gltf = await new Promise<{ scene: THREE.Group }>(
          (resolve, reject) => {
            loader.parse(glbBytes.buffer as ArrayBuffer, "", resolve, reject);
          }
        );
        if (cancelled) return;

        scene.add(gltf.scene);

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(
          center.x + maxDim * 0.8,
          center.y + maxDim * 0.6,
          center.z + maxDim * 1.3
        );
        orbitControls.target.copy(center);
        orbitControls.update();

        // ── Storey visibility (žiadny re-parse GLB) ─────────────────
        function applyStoreyFilter(storeyEid: number | null): void {
          gltf.scene.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            const eid = getEidFromObject(node);
            if (storeyEid === null || eid === undefined) {
              node.visible = true;
              return;
            }
            const elemStorey = elementToStorey.get(eid);
            // Prvky bez priradenia podlažia sú vždy viditeľné (napr. strecha)
            node.visible = elemStorey === undefined || elemStorey === storeyEid;
          });
        }
        applyStoreyFilterRef.current = applyStoreyFilter;

        // ── Focus param (karta → 3D) ────────────────────────────────
        if (focus) {
          const targetEid = getEidForGuid(focus, exprToGuid);
          if (targetEid !== undefined) {
            highlightEid(gltf.scene, targetEid);
            zoomToEid(gltf.scene, targetEid, camera, orbitControls);
            // Auto-zobraz podlažie fokusovaného prvku
            const focusStorey = elementToStorey.get(targetEid);
            if (focusStorey !== undefined && !cancelled) {
              setActiveStoreyEid(focusStorey);
              applyStoreyFilter(focusStorey); // okamžitý efekt (state update je async)
            }
          }
        }

        // ── Filter materials (DB→3D, Query Bridging) ────────────────
        const filterMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

        function applyFilter(
          objectIds: ReadonlyArray<string>,
          excludeOid?: string
        ): void {
          filterMaterials.forEach((mat, mesh) => { mesh.material = mat; });
          filterMaterials.clear();
          if (objectIds.length === 0) return;

          const targetEids = new Set<number>();
          for (const oid of objectIds) {
            if (oid === excludeOid) continue;
            const guid = objectIdToGuid.get(oid);
            if (!guid) continue;
            const eid = guidToExpr.get(guid);
            if (eid !== undefined) targetEids.add(eid);
          }

          gltf.scene.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            const eid = getEidFromObject(node);
            if (eid === undefined || !targetEids.has(eid)) return;
            filterMaterials.set(node, node.material);
            node.material = new THREE.MeshStandardMaterial({
              color: FILTER_COLOR,
              emissive: FILTER_EMISSIVE,
              emissiveIntensity: 0.35,
              transparent: true,
              opacity: 0.92,
            });
          });
        }

        // ── ViewerApi ───────────────────────────────────────────────
        if (apiRef) {
          apiRef.current = {
            highlightFilter: (oids, excludeOid) => applyFilter(oids, excludeOid),
            clearFilter: () => applyFilter([]),
            highlightSiblings: (oids, excludeOid) => applyFilter(oids, excludeOid),
            focusObject: (guid) => {
              const eid = guidToExpr.get(guid);
              if (eid !== undefined && camera && orbitControls) {
                highlightEid(gltf.scene, eid);
                zoomToEid(gltf.scene, eid, camera, orbitControls);
              }
            },
            getIfcBuffer: () => ifcBuffer,
          };
        }

        // ── Raycasting / picking ─────────────────────────────────────
        if (onSelect || onPickedElement) {
          const raycaster = new THREE.Raycaster();
          const mouse = new THREE.Vector2();
          let pointerDownPos = { x: 0, y: 0 };
          const savedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
          let currentSelectedEid: number | undefined;

          function clearSelection() {
            savedMaterials.forEach((mat, mesh) => { mesh.material = mat; });
            savedMaterials.clear();
            currentSelectedEid = undefined;
          }
          clearSelectionRef.current = clearSelection;

          function pick(clientX: number, clientY: number) {
            const rect = renderer!.domElement.getBoundingClientRect();
            mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera!);
            const hits = raycaster.intersectObjects(gltf.scene.children, true);
            if (hits.length === 0) return;
            const eid = getEidFromObject(hits[0].object);
            if (eid === undefined || eid === currentSelectedEid) return;
            const guid = exprToGuid.get(eid);
            if (!guid) return;
            const objectId = guidMap[guid];
            if (!objectId) return;
            clearSelection();
            currentSelectedEid = eid;
            gltf.scene.traverse((node) => {
              if (!(node instanceof THREE.Mesh)) return;
              if (getEidFromObject(node) !== eid) return;
              savedMaterials.set(node, node.material);
              node.material = new THREE.MeshStandardMaterial({
                color: HIGHLIGHT_COLOR,
                emissive: HIGHLIGHT_EMISSIVE,
                emissiveIntensity: 0.4,
              });
            });
            onSelect?.({ id: objectId, route: "node", label: guid });
            onPickedElement?.(objectId, guid);
          }

          // Mouse (desktop)
          renderer.domElement.addEventListener("mousedown", (e) => {
            pointerDownPos = { x: e.clientX, y: e.clientY };
          });
          renderer.domElement.addEventListener("mouseup", (e) => {
            if (
              Math.abs(e.clientX - pointerDownPos.x) > 6 ||
              Math.abs(e.clientY - pointerDownPos.y) > 6
            ) return;
            pick(e.clientX, e.clientY);
          });

          // Touch (mobile)
          renderer.domElement.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) {
              pointerDownPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
          }, { passive: true });
          renderer.domElement.addEventListener("touchend", (e) => {
            if (e.changedTouches.length !== 1) return;
            const t = e.changedTouches[0];
            if (
              Math.abs(t.clientX - pointerDownPos.x) > 10 ||
              Math.abs(t.clientY - pointerDownPos.y) > 10
            ) return;
            pick(t.clientX, t.clientY);
          }, { passive: true });
        }

        setStatus("ready");

        // ── Render loop ─────────────────────────────────────────────
        function animate() {
          if (cancelled) return;
          animId = requestAnimationFrame(animate);
          orbitControls!.update();
          renderer!.render(scene, camera!);
        }
        animate();
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      resizeObs.disconnect();
      orbitControls?.dispose();
      applyStoreyFilterRef.current = null;
      clearSelectionRef.current = null;
      if (apiRef) apiRef.current = null;
      // GPU zdroje (geometrie/materiály) sa pri unmounte/zmene modelu musia uvoľniť
      // explicitne — Three.js ich za nás negarbage-collectne.
      sceneToDispose?.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry?.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) m?.dispose();
      });
      if (renderer) {
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifcUrl]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
      <div ref={containerRef} className="h-full w-full" />

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
          <span className="text-xs text-muted-foreground">
            Skontrolujte, či je súbor{" "}
            <code className="rounded bg-muted px-1">public/model.ifc</code> prítomný,
            alebo nastavte{" "}
            <code className="rounded bg-muted px-1">NEXT_PUBLIC_IFC_URL</code>.
          </span>
        </div>
      )}

      {/* Floor filter overlay — viditeľné len keď sú podlažia načítané */}
      {status === "ready" && storeys.length > 0 && (
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          <button
            onClick={() => setActiveStoreyEid(null)}
            className={[
              "rounded px-2 py-1 text-[0.65rem] font-medium backdrop-blur-sm transition-colors",
              activeStoreyEid === null
                ? "bg-primary text-primary-foreground"
                : "bg-background/80 text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            Všetky
          </button>
          {storeys.map((s) => (
            <button
              key={s.eid}
              onClick={() =>
                setActiveStoreyEid(s.eid === activeStoreyEid ? null : s.eid)
              }
              className={[
                "rounded px-2 py-1 text-[0.65rem] font-medium backdrop-blur-sm transition-colors",
                activeStoreyEid === s.eid
                  ? "bg-primary text-primary-foreground"
                  : "bg-background/80 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {status === "ready" && (
        <div className="absolute bottom-2 right-2 rounded bg-background/70 px-2 py-1 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
          Otáčanie: ľavé · Zoom: koliesko · Pan: pravé · Escape: zruš výber
        </div>
      )}
    </div>
  );
}

// ── Pomocné funkcie ─────────────────────────────────────────────────────────

function getEidFromObject(obj: THREE.Object3D): number | undefined {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const eid = cur.userData?.expressId;
    if (typeof eid === "number") return eid;
    cur = cur.parent;
  }
  return undefined;
}

function getEidForGuid(guid: string, map: ExprToGuid): number | undefined {
  for (const [eid, g] of map) {
    if (g === guid) return eid;
  }
  return undefined;
}

function highlightEid(root: THREE.Group, eid: number): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (getEidFromObject(node) !== eid) return;
    node.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xf97316),
      emissive: new THREE.Color(0x7c2d12),
      emissiveIntensity: 0.4,
    });
  });
}

function zoomToEid(
  root: THREE.Group,
  eid: number,
  cam: THREE.PerspectiveCamera,
  ctrl: OrbitControls
): void {
  const box = new THREE.Box3();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && getEidFromObject(node) === eid) {
      box.expandByObject(node);
    }
  });
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  ctrl.target.copy(center);
  cam.position.set(
    center.x + maxDim * 2.5,
    center.y + maxDim * 1.5,
    center.z + maxDim * 2.5
  );
  ctrl.update();
}
