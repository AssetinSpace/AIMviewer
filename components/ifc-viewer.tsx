"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

const HIGHLIGHT_COLOR = new THREE.Color(0xf97316); // orange-500 — pick selection
const HIGHLIGHT_EMISSIVE = new THREE.Color(0x7c2d12);
const FILTER_COLOR = new THREE.Color(0x60a5fa);    // blue-400 — filter / siblings
const FILTER_EMISSIVE = new THREE.Color(0x1e3a8a);

const NP_RE = /\d+NP/; // normalizácia podlažia naprieč modelmi: "1NP_VZT" → "1NP" (D-049)

interface Props {
  /** Modely federácie (D-049) — renderované do jednej scény. */
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu (D-056). */
  focusNonce?: string;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
}

export function IFCViewer({
  models,
  guidMap,
  focus,
  focusNonce,
  apiRef,
  onSelect,
  onPickedElement,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState("");
  const [floors, setFloors] = useState<string[]>([]);
  const [activeFloor, setActiveFloor] = useState<string | null>(null);

  // Imperatívne refs — prístupné z useEffect-ov aj keyboard handlerov
  const applyFloorFilterRef = useRef<((floor: string | null) => void) | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);
  const applyFocusRef = useRef<((focus: string) => void) | null>(null);

  // Stabilný kľúč efektu — modely sa menia len keď sa zmenia ich URL.
  const modelsKey = models.map((m) => m.url).join("|");

  // ── Escape key — zruš selekciu ─────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelectionRef.current?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Floor filter — re-aplikuj pri zmene aktívneho podlažia ─────────────
  useEffect(() => {
    applyFloorFilterRef.current?.(activeFloor);
  }, [activeFloor]);

  // ── Focus — reaguj aj na SOFT zmenu ?focus= (AI dock pushne novú URL bez
  // remountu; hlavný efekt beží len na [modelsKey], takže focus rieši tento).
  // `focusNonce` v deps: každá AI akcia nesie nový nonce, takže focus sa
  // re-aplikuje aj pri identickej množine prvkov (opakované „zobraz…").
  // Pri prvom mounte je ref ešte null — vtedy focus aplikuje load efekt sám.
  useEffect(() => {
    if (focus) applyFocusRef.current?.(focus);
  }, [focus, focusNonce]);

  // ── Hlavný IFC effect ───────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reset stavu pri zmene modelov
    setFloors([]);
    setActiveFloor(null);
    applyFloorFilterRef.current = null;
    clearSelectionRef.current = null;
    applyFocusRef.current = null;

    let cancelled = false;
    let animId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let orbitControls: OrbitControls | null = null;
    let camera: THREE.PerspectiveCamera | null = null;

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

        // ── Globálne, GUID-centrické mapy (naprieč modelmi) ─────────
        // Multi-model: expressId sa medzi súbormi prekrýva → identitu drží IFC GUID
        // (globálne unikátny). Každý mesh označíme jeho GUID-om a plníme spoločné mapy.
        const meshToGuid = new Map<THREE.Mesh, string>();
        const guidToMeshes = new Map<string, THREE.Mesh[]>();
        const meshToFloor = new Map<THREE.Mesh, string>();  // normalizovaný label podlažia
        const objectIdToGuid = new Map<string, string>();
        for (const [guid, oid] of Object.entries(guidMap)) objectIdToGuid.set(oid, guid);
        const floorSet = new Set<string>();
        let firstBuffer: Uint8Array | null = null;

        const rootGroup = new THREE.Group();

        // ── Načítaj a spracuj každý model ───────────────────────────
        for (let mi = 0; mi < models.length; mi++) {
          const model = models[mi];

          setProgress(`Sťahujem ${model.label}…`);
          const resp = await fetch(model.url);
          if (!resp.ok) throw new Error(`${model.label} ${resp.status}: ${resp.statusText}`);
          const ifcText = await resp.text();
          if (cancelled) return;
          if (mi === 0) firstBuffer = new TextEncoder().encode(ifcText);

          // expressId → ifc_guid (lokálne pre tento model)
          const exprToGuid = new Map<number, string>();
          const guidRe = /#(\d+)=IFC\w+\('([0-9A-Za-z_$]{22})'/g;
          let rm: RegExpExecArray | null;
          while ((rm = guidRe.exec(ifcText)) !== null) {
            exprToGuid.set(parseInt(rm[1], 10), rm[2]);
          }

          // Storeys + containment (pre floor filter) — lokálne pre model
          const storeyNames = new Map<number, string>();
          const storeyRe =
            /#(\d+)=IFCBUILDINGSTOREY\('[^']*',[^,]+,(?:'([^']*)'|\$)/g;
          while ((rm = storeyRe.exec(ifcText)) !== null) {
            storeyNames.set(parseInt(rm[1], 10), rm[2]?.trim() || `#${rm[1]}`);
          }
          const elementToStorey = new Map<number, number>();
          const containRe =
            /#\d+=IFCRELCONTAINEDINSPATIALSTRUCTURE\('[^']*',[^,]+,(?:'[^']*'|\$),(?:'[^']*'|\$),\(([^)]+)\),#(\d+)/g;
          while ((rm = containRe.exec(ifcText)) !== null) {
            const storeyEid = parseInt(rm[2], 10);
            if (!storeyNames.has(storeyEid)) continue;
            for (const ref of rm[1].split(",")) {
              const eid = parseInt(ref.trim().replace(/^#/, ""), 10);
              if (!isNaN(eid)) elementToStorey.set(eid, storeyEid);
            }
          }

          // GLB konverzia cez IFClite
          setProgress(`Spracúvam geometriu (${model.label})…`);
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

          // GLB → Three.js
          const loader = new GLTFLoader();
          const gltf = await new Promise<{ scene: THREE.Group }>(
            (resolve, reject) => {
              loader.parse(glbBytes.buffer as ArrayBuffer, "", resolve, reject);
            }
          );
          if (cancelled) return;

          // Označ každý mesh jeho GUID-om + normalizovaným podlažím (identita = GUID).
          gltf.scene.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            const eid = getEidFromObject(node);
            if (eid === undefined) return;
            const guid = exprToGuid.get(eid);
            if (!guid) return;
            node.userData.guid = guid;
            meshToGuid.set(node, guid);
            const arr = guidToMeshes.get(guid);
            if (arr) arr.push(node);
            else guidToMeshes.set(guid, [node]);

            const storeyEid = elementToStorey.get(eid);
            if (storeyEid !== undefined) {
              const floor = normalizeFloor(storeyNames.get(storeyEid));
              if (floor) {
                meshToFloor.set(node, floor);
                floorSet.add(floor);
              }
            }
          });

          rootGroup.add(gltf.scene);
        }

        scene.add(rootGroup);
        if (!cancelled) {
          setFloors([...floorSet].sort((a, b) => a.localeCompare(b, "sk")));
        }

        // ── Camera fit na celú federovanú scénu ─────────────────────
        const box = new THREE.Box3().setFromObject(rootGroup);
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

        // ── Floor filter (normalizované podlažie, naprieč modelmi) ──
        function applyFloorFilter(floor: string | null): void {
          rootGroup.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            const fl = meshToFloor.get(node);
            // Prvky bez priradenia podlažia sú vždy viditeľné (napr. strecha, rozvody).
            node.visible = floor === null || fl === undefined || fl === floor;
          });
        }
        applyFloorFilterRef.current = applyFloorFilter;

        // ── Focus param (karta/AI → 3D) ─────────────────────────────
        // Viac GUIDov oddelených čiarkou (AI akcia „zobraz ich v 3D", D-056):
        // zvýrazni všetky a zoomni na ich spoločný bounding box. Floor filter
        // sa prepne len keď sú všetky na jednom podlaží (multi-floor = ukáž
        // všetko — filter z minulého focusu by časť prvkov skryl). Žije ako
        // znovupoužiteľná funkcia v ref-e: focus sa mení SOFT navigáciou
        // (dock pushne /ifc?focus=…) bez remountu — efekt nižšie na [focus]
        // ju volá aj po načítaní modelu, nie len pri ňom.
        const focusMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
        function applyFocus(f: string): void {
          // Obnov materiály predchádzajúceho focusu (opakované „zobraz…").
          focusMaterials.forEach((mat, mesh) => { mesh.material = mat; });
          focusMaterials.clear();

          const meshes = f
            .split(",")
            .filter(Boolean)
            .flatMap((g) => guidToMeshes.get(g) ?? []);
          if (meshes.length === 0 || !camera || !orbitControls) return;

          for (const mesh of meshes) {
            if (!focusMaterials.has(mesh)) focusMaterials.set(mesh, mesh.material);
          }
          highlightMeshes(meshes);
          zoomToMeshes(meshes, camera, orbitControls);

          const floors = new Set(
            meshes.map((m) => meshToFloor.get(m)).filter((f2): f2 is string => !!f2)
          );
          if (cancelled) return;
          if (floors.size === 1) {
            const fl = [...floors][0];
            setActiveFloor(fl);
            applyFloorFilter(fl);
          } else {
            setActiveFloor(null);
            applyFloorFilter(null);
          }
        }
        applyFocusRef.current = applyFocus;
        if (focus) applyFocus(focus);

        // ── Filter materials (DB→3D, Query Bridging) ────────────────
        const filterMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

        function applyFilter(
          objectIds: ReadonlyArray<string>,
          excludeOid?: string
        ): void {
          filterMaterials.forEach((mat, mesh) => { mesh.material = mat; });
          filterMaterials.clear();
          if (objectIds.length === 0) return;

          for (const oid of objectIds) {
            if (oid === excludeOid) continue;
            const guid = objectIdToGuid.get(oid);
            if (!guid) continue;
            const meshes = guidToMeshes.get(guid);
            if (!meshes) continue;
            for (const mesh of meshes) {
              if (filterMaterials.has(mesh)) continue;
              filterMaterials.set(mesh, mesh.material);
              mesh.material = new THREE.MeshStandardMaterial({
                color: FILTER_COLOR,
                emissive: FILTER_EMISSIVE,
                emissiveIntensity: 0.35,
                transparent: true,
                opacity: 0.92,
              });
            }
          }
        }

        // ── ViewerApi ───────────────────────────────────────────────
        if (apiRef) {
          apiRef.current = {
            highlightFilter: (oids, excludeOid) => applyFilter(oids, excludeOid),
            clearFilter: () => applyFilter([]),
            highlightSiblings: (oids, excludeOid) => applyFilter(oids, excludeOid),
            focusObject: (guid) => {
              const meshes = guidToMeshes.get(guid);
              if (meshes && meshes.length > 0 && camera && orbitControls) {
                highlightMeshes(meshes);
                zoomToMeshes(meshes, camera, orbitControls);
              }
            },
            getIfcBuffer: () => firstBuffer,
          };
        }

        // ── Raycasting / picking (GUID-centrické) ───────────────────
        if (onSelect || onPickedElement) {
          const raycaster = new THREE.Raycaster();
          const mouse = new THREE.Vector2();
          let pointerDownPos = { x: 0, y: 0 };
          const savedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
          let currentSelectedGuid: string | undefined;

          function clearSelection() {
            savedMaterials.forEach((mat, mesh) => { mesh.material = mat; });
            savedMaterials.clear();
            currentSelectedGuid = undefined;
          }
          clearSelectionRef.current = clearSelection;

          function pick(clientX: number, clientY: number) {
            const rect = renderer!.domElement.getBoundingClientRect();
            mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera!);
            const hits = raycaster.intersectObjects(rootGroup.children, true);
            if (hits.length === 0) return;
            const guid = getGuidFromObject(hits[0].object);
            if (!guid || guid === currentSelectedGuid) return;
            const objectId = guidMap[guid];
            if (!objectId) return;
            clearSelection();
            currentSelectedGuid = guid;
            const meshes = guidToMeshes.get(guid) ?? [];
            for (const mesh of meshes) {
              savedMaterials.set(mesh, mesh.material);
              mesh.material = new THREE.MeshStandardMaterial({
                color: HIGHLIGHT_COLOR,
                emissive: HIGHLIGHT_EMISSIVE,
                emissiveIntensity: 0.4,
              });
            }
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
      applyFloorFilterRef.current = null;
      clearSelectionRef.current = null;
      if (apiRef) apiRef.current = null;
      if (renderer) {
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey]);

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
            Skontrolujte dostupnosť IFC súborov v Storage alebo nastavte{" "}
            <code className="rounded bg-muted px-1">NEXT_PUBLIC_IFC_URLS</code>.
          </span>
        </div>
      )}

      {/* Floor filter overlay — viditeľné len keď sú podlažia načítané */}
      {status === "ready" && floors.length > 0 && (
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          <button
            onClick={() => setActiveFloor(null)}
            className={[
              "rounded px-2 py-1 text-[0.65rem] font-medium backdrop-blur-sm transition-colors",
              activeFloor === null
                ? "bg-primary text-primary-foreground"
                : "bg-background/80 text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            Všetky
          </button>
          {floors.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFloor(f === activeFloor ? null : f)}
              className={[
                "rounded px-2 py-1 text-[0.65rem] font-medium backdrop-blur-sm transition-colors",
                activeFloor === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-background/80 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {f}
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

/** Normalizuj názov podlažia naprieč modelmi: "1NP_VZT" → "1NP" (D-049). */
function normalizeFloor(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const m = NP_RE.exec(name);
  return m ? m[0] : name.trim() || undefined;
}

/** expressId z uzla alebo jeho predkov (GLB metadata z IFClite) — použité pri loade. */
function getEidFromObject(obj: THREE.Object3D): number | undefined {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const eid = cur.userData?.expressId;
    if (typeof eid === "number") return eid;
    cur = cur.parent;
  }
  return undefined;
}

/** ifc_guid z uzla alebo jeho predkov (stampnutý pri loade) — použité pri pickingu. */
function getGuidFromObject(obj: THREE.Object3D): string | undefined {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const guid = cur.userData?.guid;
    if (typeof guid === "string") return guid;
    cur = cur.parent;
  }
  return undefined;
}

function highlightMeshes(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) {
    mesh.material = new THREE.MeshStandardMaterial({
      color: HIGHLIGHT_COLOR,
      emissive: HIGHLIGHT_EMISSIVE,
      emissiveIntensity: 0.4,
    });
  }
}

function zoomToMeshes(
  meshes: THREE.Mesh[],
  cam: THREE.PerspectiveCamera,
  ctrl: OrbitControls
): void {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
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
