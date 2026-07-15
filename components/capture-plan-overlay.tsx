"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, Orbit } from "lucide-react";

import type { CapturePlanPinWire } from "@/lib/data/captures";

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
              if (pin.spaceId) router.push(`/node/${pin.spaceId}`);
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
    </div>
  );
}
