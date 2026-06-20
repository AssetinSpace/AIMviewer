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
  const initial = focus ? links.find((l) => l.targetId === focus) : undefined;
  const [selected, setSelected] = useState<SelectedElement | null>(
    initial
      ? { id: initial.targetId, route: initial.targetRoute, label: initial.label }
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
      <aside className="shrink-0 lg:w-80">{panel}</aside>
    </div>
  );
}
