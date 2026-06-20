"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";

import type { DrawingRegion, SelectedElement } from "@/lib/data/drawing";

// Worker z CDN (verzia viazaná na nainštalovaný pdfjs) — robustné pod Turbopackom,
// žiadne bundler-špecifické riešenie worker súboru.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const BASE_WIDTH = 1000; // px šírka strany pri zoom = 1
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
// Pri vstupe s `focus` priblíž, nech je drobný kód čitateľný a zvýraznenie viditeľné.
const FOCUS_ZOOM = 2.5;
// Strop renderovaného rastra (px na šírku). Vyšší `devicePixelRatio` = ostrejšie tenké
// čiary/text; strop chráni pred obrími canvasmi pri vysokom zoome (limit prehliadača).
const MAX_RENDER_PX = 6000;

type Dims = { width: number; height: number };

/**
 * In-app prehliadačka výkresu (D-042 C+D): render zdrojového PDF (react-pdf / pdf.js) +
 * prekrytie priehľadných klikateľných boxov z `_drawing_links`. Klik na box **nevyskočí
 * na novú stránku** — vyberie prvok (`onSelect`), detail sa zobrazí v bočnom paneli;
 * Ctrl/⌘-klik otvorí celý detail v novej karte. Zoom + stránkovanie + hover highlight.
 *
 * Obojsmernosť (D): `focus` = `objects.id` → skok na stranu, priblíženie, scroll na box
 * a krátky pulz. `selectedId` (riadený zvonku) určuje trvalo zvýraznený prvok.
 *
 * Ostrosť: strana sa renderuje pri `devicePixelRatio` až 2× (strop `MAX_RENDER_PX`),
 * takže tenké čiary a drobný text ostávajú čitateľné aj pri priblížení.
 */
export function DrawingViewer({
  url,
  links,
  focus,
  initialPage,
  selectedId,
  onSelect,
}: {
  url: string;
  links: DrawingRegion[];
  focus?: string;
  initialPage?: number;
  selectedId?: string | null;
  onSelect?: (sel: SelectedElement) => void;
}) {
  const focusRegion = useMemo(
    () => (focus ? links.find((l) => l.targetId === focus) : undefined),
    [focus, links]
  );

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(() => focusRegion?.page ?? initialPage ?? 1);
  const [zoom, setZoom] = useState(() => (focusRegion ? FOCUS_ZOOM : 1));
  const [dims, setDims] = useState<Dims | null>(null);
  const [pulsing, setPulsing] = useState(Boolean(focusRegion));

  const focusBoxRef = useRef<HTMLAnchorElement | null>(null);
  const focusedOnce = useRef(false);

  const width = Math.round(BASE_WIDTH * zoom);
  const devicePixelRatio = Math.min(2, MAX_RENDER_PX / width);
  const pageLinks = useMemo(
    () => links.filter((l) => l.page === page),
    [links, page]
  );

  // Zmena focusu (soft-navigácia s iným `?focus=`) → skoč na jeho stranu a znovu zacieľ.
  useEffect(() => {
    focusedOnce.current = false;
    if (focusRegion) {
      setPage(focusRegion.page);
      setZoom(FOCUS_ZOOM);
      setPulsing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Po vyrenderovaní strany s focus prvkom: odscrolluj naň a krátko rozpulzuj (raz).
  useEffect(() => {
    if (!focusRegion || !dims || focusRegion.page !== page || focusedOnce.current) {
      return;
    }
    focusBoxRef.current?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    focusedOnce.current = true;
    const t = setTimeout(() => setPulsing(false), 2400);
    return () => clearTimeout(t);
  }, [focusRegion, dims, page]);

  function goPage(next: number) {
    if (next < 1 || (numPages && next > numPages)) return;
    setDims(null); // kým sa nová strana nevyrenderuje, boxy neskladáme
    setPage(next);
  }

  function changeZoom(delta: number) {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: stránkovanie + zoom */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-md ring-1 ring-border">
          <button
            type="button"
            onClick={() => goPage(page - 1)}
            disabled={page <= 1}
            className="inline-flex size-8 items-center justify-center rounded-l-md hover:bg-secondary disabled:opacity-40"
            aria-label="Predchádzajúca strana"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-16 text-center text-sm tabular-nums">
            {page} / {numPages || "…"}
          </span>
          <button
            type="button"
            onClick={() => goPage(page + 1)}
            disabled={!!numPages && page >= numPages}
            className="inline-flex size-8 items-center justify-center rounded-r-md hover:bg-secondary disabled:opacity-40"
            aria-label="Ďalšia strana"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="inline-flex items-center gap-1 rounded-md ring-1 ring-border">
          <button
            type="button"
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="inline-flex size-8 items-center justify-center rounded-l-md hover:bg-secondary disabled:opacity-40"
            aria-label="Oddialiť"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="min-w-12 text-center text-sm tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="inline-flex size-8 items-center justify-center rounded-r-md hover:bg-secondary disabled:opacity-40"
            aria-label="Priblížiť"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>

        {links.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {pageLinks.length} klikateľných prvkov na strane
          </span>
        )}
      </div>

      {/* Plátno výkresu + overlay */}
      <div className="max-h-[78vh] overflow-auto rounded-md ring-1 ring-border bg-muted/30 p-4">
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={
            <div className="p-8 text-sm text-muted-foreground">Načítavam výkres…</div>
          }
          error={
            <div className="p-8 text-sm text-destructive">
              Výkres sa nepodarilo načítať.
            </div>
          }
          className="inline-block"
        >
          <div className="relative inline-block leading-none">
            <Page
              pageNumber={page}
              width={width}
              devicePixelRatio={devicePixelRatio}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onRenderSuccess={(p) => setDims({ width: p.width, height: p.height })}
              loading={
                <div
                  className="bg-background"
                  style={{ width, height: width * 0.66 }}
                />
              }
            />
            {dims && (
              <div className="absolute inset-0">
                {pageLinks.map((r, i) => {
                  const isSelected = !!selectedId && r.targetId === selectedId;
                  const isFocus =
                    !!focusRegion && r.targetId === focusRegion.targetId;
                  return (
                    <RegionBox
                      key={`${r.targetId}-${i}`}
                      region={r}
                      dims={dims}
                      selected={isSelected}
                      pulsing={isFocus && pulsing}
                      boxRef={isFocus ? focusBoxRef : undefined}
                      onSelect={onSelect}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </Document>
      </div>
    </div>
  );
}

/** Jeden klikateľný box prekrytý nad kódom vo výkrese. */
function RegionBox({
  region,
  dims,
  selected,
  pulsing,
  boxRef,
  onSelect,
}: {
  region: DrawingRegion;
  dims: Dims;
  selected: boolean;
  pulsing: boolean;
  boxRef?: React.Ref<HTMLAnchorElement>;
  onSelect?: (sel: SelectedElement) => void;
}) {
  const [wpt, hpt] = region.pageSize;
  const [x0, y0, x1, y1] = region.bbox;
  const sx = dims.width / wpt;
  const sy = dims.height / hpt;

  // PDF bottom-left → CSS top-left (y-flip): horný okraj = výška − y1.
  const style: React.CSSProperties = {
    left: x0 * sx,
    top: (hpt - y1) * sy,
    width: (x1 - x0) * sx,
    height: (y1 - y0) * sy,
  };

  const href = `/${region.targetRoute}/${region.targetId}`;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Ctrl/⌘/shift-klik = nechaj prehliadač otvoriť celý detail (nová karta).
    if (!onSelect || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onSelect({ id: region.targetId, route: region.targetRoute, label: region.label });
  }

  const className = selected
    ? `absolute rounded-sm bg-primary/30 ring-2 ring-primary ring-offset-1 ring-offset-background ${
        pulsing ? "animate-pulse" : ""
      }`
    : "absolute rounded-sm bg-primary/10 ring-1 ring-primary/40 transition-colors hover:bg-primary/25 hover:ring-primary";

  return (
    <a
      ref={boxRef}
      href={href}
      onClick={handleClick}
      title={`${region.label}${selected ? " (vybraný)" : ""} — zobraziť detail`}
      style={style}
      className={className}
    />
  );
}
