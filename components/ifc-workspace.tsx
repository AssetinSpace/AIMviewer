"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import { ElementInfoPanel } from "@/components/element-info-panel";
import { IfcElementPanel } from "@/components/ifc-element-panel";
import { IfcTree } from "@/components/ifc-tree";
import { FilterBar } from "@/components/filter-bar";
import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type {
  IfcElementInfo,
  NavigatorModel,
  ViewerApi,
  ViewPreset,
} from "@/lib/viewer-api";

const IFCViewer = dynamic(
  () => import("@/components/ifc-viewer").then((m) => m.IFCViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-md ring-1 ring-border text-sm text-muted-foreground">
        Načítavam 3D prehliadač…
      </div>
    ),
  }
);

const PRESETS: Array<{ id: ViewPreset; label: string }> = [
  { id: "top", label: "Zhora" },
  { id: "front", label: "Spredu" },
  { id: "left", label: "Zľava" },
];

export default function IFCWorkspace({
  models,
  guidMap,
  focus,
}: {
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
}) {
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [ifcInfo, setIfcInfo] = useState<IfcElementInfo | null>(null);
  const [navModels, setNavModels] = useState<NavigatorModel[]>([]);
  const [activeFilterLabel, setActiveFilterLabel] = useState<string | null>(null);
  const [siblingLoading, setSiblingLoading] = useState(false);
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionPos, setSectionPos] = useState(0.5);
  const [queryText, setQueryText] = useState("");

  // ── Direction A: DB → 3D ──────────────────────────────────────────────────

  function handleFilter(objectIds: string[]) {
    if (!viewerApiRef.current) return;
    viewerApiRef.current.highlightFilter(objectIds);
    setActiveFilterLabel(objectIds.length > 0 ? `${objectIds.length} prvkov` : null);
  }

  function handleClearFilter() {
    viewerApiRef.current?.clearFilter();
    setActiveFilterLabel(null);
  }

  // ── Direction B: 3D → DB ──────────────────────────────────────────────────

  async function handlePickedElement(objectId: string) {
    setSiblingLoading(true);
    try {
      const res = await fetch(`/api/space-siblings/${objectId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        spaceId: string | null;
        siblingObjectIds: string[];
      };
      if (data.spaceId && data.siblingObjectIds.length > 1) {
        viewerApiRef.current?.highlightSiblings(data.siblingObjectIds, objectId);
      }
    } finally {
      setSiblingLoading(false);
    }
  }

  // ── Navigátor → 3D ─────────────────────────────────────────────────────────

  function handleTreeHighlight(exprs: number[]) {
    viewerApiRef.current?.highlightExprs(exprs);
    setActiveFilterLabel(exprs.length > 0 ? `${exprs.length} prvkov` : null);
  }

  function handleTreeSelect(expr: number) {
    viewerApiRef.current?.selectExpr(expr);
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  function applySection(on: boolean, pos: number) {
    viewerApiRef.current?.setSectionPlane(
      on ? { axis: "down", position: pos, enabled: true } : null
    );
  }

  // ── IFClite Query → 3D (aktivované @ifc-lite/query) ────────────────────────

  function runTypeQuery() {
    const types = queryText.split(/[\s,]+/).filter(Boolean);
    if (types.length === 0) return;
    const exprs = viewerApiRef.current?.queryByType(types) ?? [];
    handleTreeHighlight(exprs);
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {/* Left: IFClite-native navigátor */}
      <aside
        className="shrink-0 overflow-hidden rounded-md ring-1 ring-border bg-background lg:w-64"
        style={{ height: "72vh" }}
      >
        <IfcTree
          models={navModels}
          onHighlight={handleTreeHighlight}
          onSelect={handleTreeSelect}
        />
      </aside>

      {/* Center: toolbar + viewer + filter bar */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <FilterBar onFilter={handleFilter} onClear={handleClearFilter} />

        {/* Toolbar: pohľady, rez, reset */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => viewerApiRef.current?.setView(p.id)}
              className="rounded border border-border px-2 py-1 hover:bg-muted"
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => viewerApiRef.current?.resetView()}
            className="rounded border border-border px-2 py-1 hover:bg-muted"
          >
            Reset
          </button>
          <label className="ml-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={sectionOn}
              onChange={(e) => {
                setSectionOn(e.target.checked);
                applySection(e.target.checked, sectionPos);
              }}
              className="h-3.5 w-3.5 accent-primary"
            />
            Rez
          </label>
          {sectionOn && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sectionPos}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setSectionPos(v);
                applySection(true, v);
              }}
              className="w-32 accent-primary"
              aria-label="Poloha rezu"
            />
          )}
          {/* IFC dotaz (@ifc-lite/query) → highlight v 3D */}
          <div className="ml-auto flex items-center gap-1">
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runTypeQuery();
              }}
              placeholder="IFC dotaz: IfcDoor…"
              className="w-40 rounded border border-border bg-background px-2 py-1"
            />
            <button
              onClick={runTypeQuery}
              className="rounded border border-border px-2 py-1 hover:bg-muted"
            >
              Dotaz
            </button>
          </div>
        </div>

        {(activeFilterLabel || siblingLoading) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {activeFilterLabel && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                Filter: {activeFilterLabel}
              </span>
            )}
            {siblingLoading && <span>Načítavam priestorový kontext…</span>}
          </div>
        )}

        <div style={{ height: "72vh" }}>
          <IFCViewer
            models={models}
            guidMap={guidMap}
            focus={focus}
            apiRef={viewerApiRef}
            onSelect={(el) => {
              setSelected(el);
              setIfcInfo(null);
            }}
            onPickedElement={handlePickedElement}
            onNavigator={setNavModels}
            onIfcElement={(info) => {
              setIfcInfo(info);
              if (info) setSelected(null);
            }}
          />
        </div>
      </div>

      {/* Right: detail (DB alebo IFC) */}
      {(selected || ifcInfo) && (
        <aside className="shrink-0 lg:w-80">
          {selected ? (
            <ElementInfoPanel
              selected={selected}
              onBack={() => setSelected(null)}
              backLabel="Zavrieť"
            />
          ) : (
            ifcInfo && <IfcElementPanel info={ifcInfo} onBack={() => setIfcInfo(null)} />
          )}
        </aside>
      )}
    </div>
  );
}
