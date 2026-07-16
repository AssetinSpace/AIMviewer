"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, ImageIcon, Orbit, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CapturePlanPinWire } from "@/lib/data/captures";

// PSV je čisto klientský (three.js) — dynamický import bez SSR (rovnako ako galéria).
const PanoramaViewer = dynamic(
  () => import("@/components/panorama-viewer").then((m) => m.PanoramaViewer),
  { ssr: false }
);

/**
 * Reality Capture overlay nad 2D plánom (D-073) — v drawing vieweri (`/drawing/[id]`).
 * Číta capture piny s plán ukotvením na tento dokument a vykreslí ich na strane
 * (normalizované u,v → pixely renderovanej strany). Klik na pin → priestor so
 * snímkami (obojsmernosť „plán → snímky").
 *
 * Authoring: s `?placeCapture=<id>` v URL sa zapne umiestňovací režim — klik na
 * plán vypočíta u,v a uloží ich (PATCH `/api/captures/{id}` `{plan}`). DocumentId
 * sa odvodí z route (`/drawing/<id>`), takže komponent je self-contained.
 */
export function CapturePlanOverlay({
  page,
  dims,
}: {
  page: number;
  dims: { width: number; height: number };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const parts = pathname.split("/");
  const documentId = parts[1] === "drawing" ? parts[2] : undefined;
  const placeId = searchParams.get("placeCapture");

  const [pins, setPins] = useState<CapturePlanPinWire[]>([]);
  const [openPin, setOpenPin] = useState<CapturePlanPinWire | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!documentId) return;
    try {
      const res = await fetch(`/api/captures?document=${documentId}`, { cache: "no-store" });
      if (res.ok) {
        const { pins: fresh } = (await res.json()) as { pins: CapturePlanPinWire[] };
        setPins(fresh);
      }
    } catch {
      /* best-effort */
    }
  }, [documentId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!openPin) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenPin(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPin]);

  const place = useCallback(
    async (u: number, v: number) => {
      if (!documentId || !placeId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/captures/${placeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: { documentId, page, u, v } }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(
            res.status === 403 ? "Zápis je vypnutý (CAPTURE_WRITE_ENABLED)." : (j.error ?? "Uloženie zlyhalo.")
          );
        }
        // Vyčisti umiestňovací režim z URL + obnov.
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("placeCapture");
        router.replace(sp.toString() ? `${pathname}?${sp}` : pathname);
        await refetch();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Neznáma chyba.");
      } finally {
        setBusy(false);
      }
    },
    [documentId, placeId, page, busy, searchParams, pathname, router, refetch]
  );

  const onPlaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const v = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      void place(u, v);
    },
    [place]
  );

  if (!documentId) return null;
  const pagePins = pins.filter((p) => p.page === page);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Piny (čítanie) */}
      {pagePins.map((pin) => {
        const Icon = pin.kind === "pano360" ? Orbit : Camera;
        return (
          <button
            key={pin.id}
            type="button"
            title={pin.name ?? (pin.kind === "pano360" ? "360° panoráma" : "Fotka")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpenPin(pin); // klik na pin → otvor rovno fotku/360°
            }}
            className="pointer-events-auto absolute flex size-6 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white shadow-md transition-transform hover:scale-110"
            style={{ left: pin.u * dims.width, top: pin.v * dims.height, transform: "translate(-50%, -100%)" }}
          >
            <Icon className="size-3" />
          </button>
        );
      })}

      {/* Umiestňovací režim (authoring) */}
      {placeId && (
        <>
          <div
            role="button"
            aria-label="Umiestni capture pin"
            onClick={onPlaceClick}
            className="pointer-events-auto absolute inset-0 cursor-crosshair bg-sky-500/5"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
            <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white shadow">
              {busy ? "Ukladám…" : error ?? "Klikni na plán pre umiestnenie capture bodu"}
            </span>
          </div>
        </>
      )}

      {/* Klik na pin → otvor rovno fotku / 360°. Portál do body, lebo drawing
          wrapper má počas zoomu CSS transform (rozbil by `fixed` modal). */}
      {openPin &&
        typeof document !== "undefined" &&
        createPortal(
          openPin.kind === "pano360" && openPin.origUrl ? (
            <PanoramaViewer
              open
              onClose={() => setOpenPin(null)}
              src={openPin.origUrl}
              preview={openPin.previewUrl}
              yaw={openPin.yaw ?? 0}
              title={openPin.name}
            />
          ) : (
            <div
              className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
              role="dialog"
              aria-modal="true"
              onClick={() => setOpenPin(null)}
            >
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={() => setOpenPin(null)}
                aria-label="Zavrieť"
                className="absolute top-3 right-3"
              >
                <X />
              </Button>
              {openPin.previewUrl ?? openPin.origUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={openPin.previewUrl ?? openPin.origUrl}
                  alt={openPin.name ?? "snímka"}
                  className="max-h-[85vh] max-w-full rounded-lg object-contain"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex flex-col items-center gap-2 text-white/70">
                  <ImageIcon className="size-8" /> Snímka sa nenačítala
                </span>
              )}
              {openPin.spaceId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/node/${openPin.spaceId}`);
                  }}
                  className="mt-3 text-sm text-white/80 underline hover:text-white"
                >
                  Otvoriť priestor so všetkými snímkami
                </button>
              )}
            </div>
          ),
          document.body
        )}
    </div>
  );
}
