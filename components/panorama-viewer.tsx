"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReactPhotoSphereViewer } from "react-photo-sphere-viewer";
import { CompassPlugin } from "@photo-sphere-viewer/compass-plugin";
import "@photo-sphere-viewer/compass-plugin/index.css";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Immersive 360° prehliadač (D-073, F3) — Photo Sphere Viewer (MIT, three.js) cez
 * `react-photo-sphere-viewer`, host-side v Next.js modáli. BIM engine forku je
 * WebGPU → žiadna three.js koexistenčná kolízia.
 *
 * Textúrová stratégia: načíta `preview` (equirect downscale pod GPU limitom, rýchle
 * načítanie aj na mobile), tlačidlom „HD" prepne na `orig` (do 16K desktop). Modul
 * je určený na dynamický import (`ssr:false`) — PSV je čisto klientský.
 */

// PSV Viewer inštancia má bohaté API; pre setPanorama nám stačí táto časť.
type ViewerLike = { setPanorama: (src: string) => Promise<unknown> };

export function PanoramaViewer({
  open,
  onClose,
  src,
  preview,
  yaw = 0,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Plné rozlíšenie originálu. */
  src: string;
  /** Zmenšený náhľad (rýchle prvé načítanie); ak chýba, použije sa `src`. */
  preview?: string | null;
  /** Počiatočná orientácia pohľadu (radiány). */
  yaw?: number;
  title?: string | null;
}) {
  const viewerRef = useRef<ViewerLike | null>(null);
  const [hd, setHd] = useState(false);
  const [loadingHd, setLoadingHd] = useState(false);

  const initialSrc = preview ?? src;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset HD stavu pri každom otvorení / zmene panorámy.
  useEffect(() => {
    setHd(false);
    setLoadingHd(false);
  }, [open, src]);

  const loadHd = useCallback(async () => {
    if (!viewerRef.current || hd || !preview || preview === src) return;
    setLoadingHd(true);
    try {
      await viewerRef.current.setPanorama(src);
      setHd(true);
    } finally {
      setLoadingHd(false);
    }
  }, [hd, preview, src]);

  if (!open) return null;

  const canLoadHd = !!preview && preview !== src;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true">
      <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
        <span className="truncate text-sm font-medium text-white/90">
          {title ?? "360° panoráma"}
        </span>
        <div className="flex items-center gap-2">
          {canLoadHd && !hd && (
            <Button variant="secondary" size="sm" onClick={loadHd} disabled={loadingHd}>
              {loadingHd && <Loader2 className="animate-spin" />}
              HD
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={onClose}
            aria-label="Zavrieť"
          >
            <X />
          </Button>
        </div>
      </div>

      <ReactPhotoSphereViewer
        key={initialSrc}
        src={initialSrc}
        height="100vh"
        width="100%"
        defaultYaw={yaw}
        navbar={["zoom", "move", "fullscreen"]}
        plugins={[[CompassPlugin, {}]]}
        onReady={(instance) => {
          viewerRef.current = instance as unknown as ViewerLike;
        }}
      />
    </div>
  );
}
