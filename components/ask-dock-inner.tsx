"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import { AskPanel } from "@/components/ask-panel";

/**
 * Plávajúce okno AI chatu (D-056): drag za hlavičku, resize za pravý dolný
 * roh, geometria aj otvorenosť prežívajú navigáciu a reload (sessionStorage).
 * Default = ukotvené pri spodku v strede; po prvom potiahnutí voľné okno.
 */

const OPEN_STORAGE_KEY = "aim-ask-open";
const GEOM_STORAGE_KEY = "aim-ask-geom";

const MIN_W = 320;
const MIN_H = 300;
const MARGIN = 8;

interface DockGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampGeom(g: DockGeom): DockGeom {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(g.w, MIN_W), vw - 2 * MARGIN);
  const h = Math.min(Math.max(g.h, MIN_H), vh - 2 * MARGIN);
  const x = Math.min(Math.max(g.x, MARGIN), Math.max(vw - w - MARGIN, MARGIN));
  const y = Math.min(Math.max(g.y, MARGIN), Math.max(vh - h - MARGIN, MARGIN));
  return { x, y, w, h };
}

function defaultGeom(): DockGeom {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(768, vw - 2 * MARGIN);
  const h = Math.round(vh * 0.55);
  return clampGeom({ x: Math.round((vw - w) / 2), y: vh - h - MARGIN, w, h });
}

function loadGeom(): DockGeom {
  try {
    const raw = window.sessionStorage.getItem(GEOM_STORAGE_KEY);
    if (raw) return clampGeom(JSON.parse(raw) as DockGeom);
  } catch {
    // nevalidné storage → default
  }
  return defaultGeom();
}

function loadStoredOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AskDockInner() {
  const [open, setOpen] = useState(loadStoredOpen);
  const [geom, setGeomState] = useState<DockGeom>(loadGeom);
  const geomRef = useRef(geom);

  const setGeom = (g: DockGeom) => {
    geomRef.current = g;
    setGeomState(g);
  };

  useEffect(() => {
    try {
      window.sessionStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
    } catch {
      // nedostupné storage dock neláme
    }
  }, [open]);

  // Zmena veľkosti okna prehliadača → okno ostáva vo viewporte.
  useEffect(() => {
    const onResize = () => setGeom(clampGeom(geomRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const persistGeom = () => {
    try {
      window.sessionStorage.setItem(GEOM_STORAGE_KEY, JSON.stringify(geomRef.current));
    } catch {
      // nedostupné storage dock neláme
    }
  };

  /** Spoločný pointer-drag: `apply` premietne delta kurzora do geometrie. */
  const beginPointerDrag = (
    e: React.PointerEvent,
    apply: (start: DockGeom, dx: number, dy: number) => DockGeom
  ) => {
    e.preventDefault();
    // Pointer capture — dock pláva nad iframom 3D vieweru (iný dokument);
    // pointerup pustený nad ním by k nám nikdy nedorazil a dock by naveky
    // nasledoval kurzor. Capture drží eventy na úchyte.
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const start = geomRef.current;
    const px = e.clientX;
    const py = e.clientY;
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      persistGeom();
    };
    const onMove = (ev: PointerEvent) => {
      // Poistka: keby pointerup predsa len zapadol, prvý pohyb bez tlačidla drag ukončí.
      if (ev.buttons === 0) return onUp();
      setGeom(clampGeom(apply(start, ev.clientX - px, ev.clientY - py)));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const beginMove = (e: React.PointerEvent) => {
    // Klik na tlačidlo v hlavičke nie je drag.
    if ((e.target as HTMLElement).closest("button")) return;
    beginPointerDrag(e, (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  };

  const beginResize = (e: React.PointerEvent) => {
    beginPointerDrag(e, (s, dx, dy) => ({ ...s, w: s.w + dx, h: s.h + dy }));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2.5 text-sm font-medium shadow-lg hover:bg-accent"
        aria-label="Otvoriť AI asistenta"
      >
        <Sparkles className="size-4" />
        Opýtaj sa (AI)
      </button>
    );
  }

  return (
    <div
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border bg-card shadow-2xl"
      style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h }}
      role="dialog"
      aria-label="AI asistent"
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center justify-between border-b px-3 py-2"
        style={{ touchAction: "none" }}
        onPointerDown={beginMove}
      >
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4" />
          Opýtaj sa (AI)
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Zbaliť AI asistenta"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <AskPanel />
      </div>

      {/* Úchyt na zmenu veľkosti (pravý dolný roh). */}
      <div
        className="absolute bottom-0 right-0 z-10 flex size-4 cursor-nwse-resize items-end justify-end text-muted-foreground/70"
        style={{ touchAction: "none" }}
        onPointerDown={beginResize}
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor">
          <path d="M14 8 L8 14 M14 12 L12 14" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
