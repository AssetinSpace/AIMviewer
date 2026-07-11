"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import { ElementInfoPanel } from "@/components/element-info-panel";
import type { SelectedElement } from "@/lib/data/drawing";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

// 3D viewer je embed-nutý ifc-lite viewer cez iframe (postMessage bridge),
// nie in-process three.js. Rovnaké Props + ViewerApi, takže workspace je bez zmeny.
// Starý three.js komponent (components/ifc-viewer.tsx) ostáva pre rollback.
const IFCViewer = dynamic(
  () => import("@/components/ifc-viewer-embed").then((m) => m.IFCViewerEmbed),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-md ring-1 ring-border text-sm text-muted-foreground">
        Načítavam 3D prehliadač…
      </div>
    ),
  }
);

/**
 * Full-page 3D workspace: viewer vypĺňa celú plochu, panel s detailom prvku
 * pláva ako overlay vpravo (len keď je niečo vybrané). IFC-typ FilterBar bol
 * odstránený — filtrovanie beží cez AI dock a natívne nástroje embed viewera.
 */
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
  const [siblingLoading, setSiblingLoading] = useState(false);

  // 3D → DB: po picku dotiahni súrodencov v priestore a zvýrazni ich.
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
    <div className="relative h-full w-full">
      <IFCViewer
        models={models}
        guidMap={guidMap}
        focus={focus}
        focusNonce={focusNonce}
        apiRef={viewerApiRef}
        onSelect={setSelected}
        onPickedElement={handlePickedElement}
      />

      {siblingLoading && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow backdrop-blur-sm">
          Načítavam priestorový kontext…
        </div>
      )}

      {/* Detail vybraného prvku — plávajúci panel nad viewerom vpravo */}
      {selected && (
        <aside className="absolute bottom-3 right-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-md border bg-background/95 shadow-lg backdrop-blur-sm">
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
