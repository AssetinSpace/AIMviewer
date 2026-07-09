"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { DrawingRegion, SelectedElement } from "@/lib/data/drawing";
import { ElementInfoPanel } from "@/components/element-info-panel";
import {
  DocumentInfoPanel,
  type DocumentPanelData,
} from "@/components/document-info-panel";

/**
 * Pracovná plocha dokumentu/výkresu (D-042 D+): vľavo PDF viewer (s klikateľnými
 * kódmi, ak ich výkres má), vpravo bočný panel. Panel **predvolene** ukazuje info
 * o dokumente (metadáta + „Pripojené k"); klik na SNIM kód ho prepne na detail
 * prvku (so „Späť na dokument"). Klik **neopúšťa stránku**.
 *
 * Úzke šírky (D-054 kadencia 2): na mobile je panel v toku POD viewerom, takže detail
 * po kliku na kód by skončil pod foldom — vybraný prvok sa preto zobrazí ako plávajúci
 * **bottom-sheet** (fixed, vlastný scroll, bez backdropu — výkres ostáva interaktívny,
 * ďalší tap na iný kód panel len prepne). „Späť na dokument" sheet zavrie. Od `lg`
 * breakpointu sa to isté DOM vracia do statického bočného stĺpca.
 *
 * Viewer sa načíta výhradne v prehliadači (`ssr: false`) — pdf.js potrebuje DOM/Worker.
 */
const DrawingViewer = dynamic(
  () => import("@/components/drawing-viewer").then((m) => m.DrawingViewer),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-md ring-1 ring-border p-8 text-sm text-muted-foreground">
        Načítavam prehliadačku…
      </div>
    ),
  }
);

export default function DrawingWorkspace({
  pdfUrl,
  links,
  focus,
  initialPage,
  document,
}: {
  pdfUrl: string | null;
  links: DrawingRegion[];
  focus?: string;
  initialPage?: number;
  document: DocumentPanelData;
}) {
  // Predvybrať prvok z `?focus=` — panel sa otvorí rovno s ním (obojsmernosť).
  // Skladbové regióny (`drawing` route) nie sú prvky → do panela nejdú.
  const initial = focus
    ? links.find((l) => l.targetId === focus && l.targetRoute !== "drawing")
    : undefined;
  const [selected, setSelected] = useState<SelectedElement | null>(
    initial
      ? {
          id: initial.targetId,
          route: initial.targetRoute as "node" | "type",
          label: initial.label,
        }
      : null
  );

  const panel = selected ? (
    <ElementInfoPanel selected={selected} onBack={() => setSelected(null)} />
  ) : (
    <DocumentInfoPanel document={document} />
  );

  // Dokument bez PDF (defenzívne — všetkých 13 je PDF): len panel.
  if (!pdfUrl) {
    return <div className="max-w-3xl">{panel}</div>;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <DrawingViewer
          url={pdfUrl}
          links={links}
          focus={focus}
          initialPage={initialPage}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>
      <aside
        className={
          selected
            ? "fixed inset-x-3 bottom-3 z-50 max-h-[70dvh] overflow-y-auto overscroll-contain drop-shadow-xl lg:static lg:inset-auto lg:z-auto lg:max-h-none lg:w-80 lg:shrink-0 lg:overflow-visible lg:overscroll-auto lg:drop-shadow-none"
            : "shrink-0 lg:w-80"
        }
      >
        {panel}
      </aside>
    </div>
  );
}
