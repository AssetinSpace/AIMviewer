"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";

import type { DrawingRegion } from "@/lib/data/drawing";

// Worker z CDN (verzia viazaná na nainštalovaný pdfjs) — robustné pod Turbopackom,
// žiadne bundler-špecifické riešenie worker súboru.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const BASE_WIDTH = 1000; // px šírka strany pri zoom = 1
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

type Dims = { width: number; height: number };

/**
 * In-app prehliadačka výkresu (D-042 fáza C): render zdrojového PDF (react-pdf /
 * pdf.js) + prekrytie priehľadných klikateľných boxov z `_drawing_links`. Box vedie
 * na detail prvku (`/node|/type/[id]`). Zoom + stránkovanie + hover highlight.
 *
 * Súradnice regiónov sú v PDF bottom-left (y hore); preklápajú sa na renderovaný
 * raster strany (`pageSize` = referenčná báza, aktuálne px dimenzie z `onRenderSuccess`).
 */
export function DrawingViewer({
  url,
  links,
}: {
  url: string;
  links: DrawingRegion[];
}) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [dims, setDims] = useState<Dims | null>(null);

  const width = Math.round(BASE_WIDTH * zoom);
  const pageLinks = useMemo(
    () => links.filter((l) => l.page === page),
    [links, page]
  );

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

        <span className="text-xs text-muted-foreground">
          {pageLinks.length} klikateľných prvkov na strane
        </span>
      </div>

      {/* Plátno výkresu + overlay */}
      <div className="overflow-auto rounded-md ring-1 ring-border bg-muted/30 p-4">
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
                {pageLinks.map((r, i) => (
                  <RegionBox key={`${r.targetId}-${i}`} region={r} dims={dims} />
                ))}
              </div>
            )}
          </div>
        </Document>
      </div>
    </div>
  );
}

/** Jeden klikateľný box prekrytý nad kódom vo výkrese. */
function RegionBox({ region, dims }: { region: DrawingRegion; dims: Dims }) {
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

  return (
    <Link
      href={`/${region.targetRoute}/${region.targetId}`}
      title={`${region.label} → detail prvku`}
      style={style}
      className="absolute rounded-sm bg-primary/10 ring-1 ring-primary/40 transition-colors hover:bg-primary/25 hover:ring-primary"
    />
  );
}
