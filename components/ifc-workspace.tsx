"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { UnderlayDrawingWire } from "@/lib/data/drawing";
import type { CaptureViewerWire } from "@/lib/data/captures";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";

// 3D viewer je embed-nutý ifc-lite viewer cez iframe (postMessage bridge),
// nie in-process three.js. Rovnaké Props + ViewerApi, takže workspace je bez zmeny.
// Používa sa variant s podporou viewer ops AI docku (D-066).
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

/**
 * Full-page 3D workspace: viewer vypĺňa celú plochu. Detail vybraného prvku
 * sa zobrazuje ako AIM karta priamo v natívnom paneli embed viewera (host mu
 * posiela DB dáta cez bridge, viď ifc-viewer.tsx + lib/aim-panel.ts) — žiadny
 * druhý plávajúci panel. IFC-typ FilterBar bol odstránený — filtrovanie beží
 * cez AI dock a natívne nástroje embed viewera.
 */
export default function IFCWorkspace({
  models,
  guidMap,
  focus,
  focusNonce,
  ops,
  underlays,
  captures,
}: {
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu/ops (D-056). */
  focusNonce?: string;
  /** Viewer operácie AI docku (ofarbenie/skrytie/izolácia, D-066). */
  ops?: string;
  /** Georeferencované PDF podklady pre embed viewer (D-072). */
  underlays?: UnderlayDrawingWire[];
  /** Reality Capture piny s 3D ukotvením (D-073). */
  captures?: CaptureViewerWire[];
}) {
  const router = useRouter();
  const viewerApiRef = useRef<ViewerApi | null>(null);
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
    } catch (err) {
      // Volá sa fire-and-forget z bridge handlera — bez catch by network
      // chyba skončila ako unhandled rejection. Zvýraznenie je best-effort.
      console.error("space-siblings fetch failed", err);
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
        ops={ops}
        underlays={underlays}
        captures={captures}
        apiRef={viewerApiRef}
        onPickedElement={handlePickedElement}
        onNavigate={(href) => router.push(href)}
        onCaptureClick={(captureId) => {
          // 3D → host: klik na capture pin → otvor priestor so snímkami (galéria
          // na /node/[space]). Obojsmernosť „snímka ↔ priestor" (D-073).
          const pin = captures?.find((c) => c.id === captureId);
          if (pin?.spaceId) router.push(`/node/${pin.spaceId}`);
        }}
      />

      {siblingLoading && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow backdrop-blur-sm">
          Načítavam priestorový kontext…
        </div>
      )}
    </div>
  );
}
