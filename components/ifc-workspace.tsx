"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { ElementInfoPanel } from "@/components/element-info-panel";
import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap } from "@/lib/data/ifc";

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
  ifcUrl,
  guidMap,
  focus,
}: {
  ifcUrl: string;
  guidMap: GuidMap;
  focus?: string;
}) {
  const [selected, setSelected] = useState<SelectedElement | null>(null);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1" style={{ height: "72vh" }}>
        <IFCViewer
          ifcUrl={ifcUrl}
          guidMap={guidMap}
          focus={focus}
          onSelect={setSelected}
        />
      </div>
      {selected && (
        <aside className="shrink-0 lg:w-80">
          <ElementInfoPanel
            selected={selected}
            onBack={() => setSelected(null)}
            backLabel="Späť na model"
          />
        </aside>
      )}
    </div>
  );
}
