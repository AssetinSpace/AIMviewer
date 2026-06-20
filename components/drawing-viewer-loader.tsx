"use client";

import dynamic from "next/dynamic";

import type { DrawingRegion } from "@/lib/data/drawing";

/**
 * Klientský wrapper, ktorý načíta `DrawingViewer` výhradne v prehliadači
 * (`ssr: false`) — pdf.js sa opiera o DOM/Worker, takže sa nesmie renderovať na
 * serveri. `ssr: false` v dynamic() je povolené len v client komponente, preto
 * tento medzičlánok medzi server route a samotným viewerom.
 */
const DrawingViewer = dynamic(
  () => import("./drawing-viewer").then((m) => m.DrawingViewer),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-md ring-1 ring-border p-8 text-sm text-muted-foreground">
        Načítavam prehliadačku…
      </div>
    ),
  }
);

export default function DrawingViewerLoader(props: {
  url: string;
  links: DrawingRegion[];
  /** `objects.id` prvku na zvýraznenie (obojsmernosť, D-042 D). */
  focus?: string;
  /** Počiatočná strana (1-based). */
  initialPage?: number;
}) {
  return <DrawingViewer {...props} />;
}
