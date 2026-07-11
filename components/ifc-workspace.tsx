"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import { ElementInfoPanel } from "@/components/element-info-panel";
import { FilterBar } from "@/components/filter-bar";
import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

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

export default function IFCWorkspace({
  models,
  guidMap,
  focus,
  focusNonce,
}: {
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu (D-056). */
  focusNonce?: string;
}) {
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [activeFilterLabel, setActiveFilterLabel] = useState<string | null>(null);
  const [siblingLoading, setSiblingLoading] = useState(false);

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

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {/* Left: viewer + filter bar */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <FilterBar onFilter={handleFilter} onClear={handleClearFilter} />

        {/* Active filter / sibling status badge */}
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
            focusNonce={focusNonce}
            apiRef={viewerApiRef}
            onSelect={setSelected}
            onPickedElement={handlePickedElement}
          />
        </div>
      </div>

      {/* Right: element info panel */}
      {selected && (
        <aside className="shrink-0 lg:w-80">
          <ElementInfoPanel
            selected={selected}
            onBack={() => setSelected(null)}
            backLabel="Zavrieť"
          />
        </aside>
      )}
    </div>
  );
}
