"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, Check, ImageIcon, Orbit, X } from "lucide-react";

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
 * (normalizované u,v → pixely renderovanej strany). Klik na pin → otvorí rovno
 * fotku / 360° panorámu (obojsmernosť „plán → snímka").
 *
 * Authoring: s `?placeCapture=<id>` v URL sa zapne umiestňovací režim — klik na
 * plán položí **draft** pin, ktorý sa dá **ťahať** na presné miesto, a tlačidlom
 * **Uložiť** sa uloží (PATCH `/api/captures/{id}` `{plan}`). Existujúca pozícia sa
 * predvyplní (edit/„presunúť"). DocumentId sa odvodí z route → self-contained.
 */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

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
  const [draft, setDraft] = useState<{ u: number; v: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

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

  // Vstup/výstup umiestňovacieho režimu: reset; predvyplň draft z existujúcej
  // pozície pinu (edit/„presunúť"), kým používateľ neinteragoval (`dirty`).
  useEffect(() => {
    if (!placeId) {
      setDraft(null);
      setDirty(false);
      return;
    }
    if (dirty) return;
    const existing = pins.find((p) => p.id === placeId && p.page === page);
    if (existing) setDraft({ u: existing.u, v: existing.v });
  }, [placeId, pins, page, dirty]);

  const uvFromEvent = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      u: clamp01((clientX - rect.left) / rect.width),
      v: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const onPlaceClick = useCallback(
    (e: React.MouseEvent) => {
      const uv = uvFromEvent(e.clientX, e.clientY);
      if (uv) {
        setDraft(uv);
        setDirty(true);
      }
    },
    [uvFromEvent]
  );

  const onDraftPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const uv = uvFromEvent(e.clientX, e.clientY);
      if (uv) {
        setDraft(uv);
        setDirty(true);
      }
    },
    [uvFromEvent]
  );

  const exitPlacement = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("placeCapture");
    router.replace(sp.toString() ? `${pathname}?${sp}` : pathname);
  }, [searchParams, router, pathname]);

  const save = useCallback(async () => {
    if (!documentId || !placeId || !draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/captures/${placeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: { documentId, page, u: draft.u, v: draft.v } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 403 ? "Zápis je vypnutý (CAPTURE_WRITE_ENABLED)." : (j.error ?? "Uloženie zlyhalo.")
        );
      }
      // Optimisticky vykresli pin ihneď — nezávisle od refetchu/cache/re-render
      // timingu. Pri presune existujúceho pinu zachovaj ostatné polia
      // (kind/urls/name), pri novom použij minimálny tvar; `refetch()` nižšie ich
      // následne dopl­ní reálnymi dátami.
      const { u, v } = draft;
      setPins((prev) => {
        const existing = prev.find((p) => p.id === placeId);
        const next: CapturePlanPinWire = existing
          ? { ...existing, page, u, v }
          : { id: placeId, kind: "photo", page, u, v, spaceId: null };
        return [...prev.filter((p) => p.id !== placeId), next];
      });
      exitPlacement();
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznáma chyba.");
    } finally {
      setBusy(false);
    }
  }, [documentId, placeId, draft, busy, page, exitPlacement, refetch]);

  if (!documentId) return null;
  const pagePins = pins.filter((p) => p.page === page && p.id !== placeId);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      {/* Uložené piny — klik otvorí fotku/360°. V placement móde ich prekryje
          klikacia vrstva (nezasahujú), takže netreba osobitne vypínať. */}
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
              setOpenPin(pin);
            }}
            className="pointer-events-auto absolute flex size-6 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white shadow-md transition-transform hover:scale-110"
            style={{ left: pin.u * dims.width, top: pin.v * dims.height, transform: "translate(-50%, -100%)" }}
          >
            <Icon className="size-3" />
          </button>
        );
      })}

      {/* Umiestňovací režim (authoring): klikacia vrstva + draft pin + toolbar. */}
      {placeId && (
        <>
          <div
            role="button"
            aria-label="Umiestni capture pin"
            onClick={onPlaceClick}
            className="pointer-events-auto absolute inset-0 cursor-crosshair bg-sky-500/5"
          />

          {draft && (
            <button
              type="button"
              aria-label="Presuň capture pin"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                draggingRef.current = true;
              }}
              onPointerMove={onDraftPointerMove}
              onPointerUp={(e) => {
                draggingRef.current = false;
                (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
              }}
              className="pointer-events-auto absolute flex size-7 cursor-grab touch-none items-center justify-center rounded-full border-2 border-white bg-orange-500 text-white shadow-lg active:cursor-grabbing"
              style={{ left: draft.u * dims.width, top: draft.v * dims.height, transform: "translate(-50%, -100%)" }}
            >
              <Camera className="size-3.5" />
            </button>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 p-2">
            <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white shadow">
              {error
                ? error
                : draft
                  ? "Potiahni pin na presné miesto, potom Uložiť"
                  : "Klikni na plán pre umiestnenie capture bodu"}
            </span>
            <div className="pointer-events-auto flex gap-2">
              <Button size="sm" onClick={save} disabled={!draft || busy}>
                <Check /> {busy ? "Ukladám…" : "Uložiť"}
              </Button>
              <Button size="sm" variant="outline" onClick={exitPlacement} disabled={busy}>
                <X /> Zrušiť
              </Button>
            </div>
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
