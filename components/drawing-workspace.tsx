"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { DrawingRegion, SelectedElement } from "@/lib/data/drawing";
import { ElementInfoPanel } from "@/components/element-info-panel";

/**
 * Pracovná plocha prehliadačky výkresov (D-042 D): vľavo PDF viewer s klikateľnými
 * kódmi, vpravo bočný panel s detailom vybraného prvku. Klik na kód **neopúšťa
 * stránku** — len vyberie prvok a panel ukáže jeho súhrn.
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
  url,
  links,
  focus,
  initialPage,
}: {
  url: string;
  links: DrawingRegion[];
  focus?: string;
  initialPage?: number;
}) {
  // Predvybrať prvok z `?focus=` — panel sa otvorí rovno s ním (obojsmernosť).
  const initial = focus ? links.find((l) => l.targetId === focus) : undefined;
  const [selected, setSelected] = useState<SelectedElement | null>(
    initial
      ? { id: initial.targetId, route: initial.targetRoute, label: initial.label }
      : null
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <DrawingViewer
          url={url}
          links={links}
          focus={focus}
          initialPage={initialPage}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>
      {selected && (
        <aside className="shrink-0 lg:w-80">
          <ElementInfoPanel selected={selected} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}
