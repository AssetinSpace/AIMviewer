"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { DrawingRegion, SelectedElement } from "@/lib/data/drawing";

// Worker self-hostovaný z vlastného originu (D-030 perf, dodatok): bundler ho vyrieši z
// nainštalovaného `pdfjs-dist` (verzia automaticky zhodná s API → žiadny version
// mismatch) a vyemituje ako hashovaný statický asset. Eliminuje externý fetch na
// unpkg, ktorý pri každom otvorení výkresu pridával DNS+TLS+stiahnutie ~1 MB pred
// samotným parsovaním PDF (a vedel visieť/byť rate-limitovaný).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const PAD = 16; // px vnútorný padding plátna (`p-4`) — vstupuje do kotvenia zoomu
const ZOOM_STEP = 0.25; // krok tlačidiel +/−
const ZOOM_MIN = 0.5; // 1 = „fit to width" viewportu
const ZOOM_MAX = 8;
const FALLBACK_FIT_WIDTH = 800; // kým sa nezmeria viewport (SSR-less mount)
// Pri vstupe s `focus` priblíž, nech je drobný kód čitateľný a zvýraznenie viditeľné.
const FOCUS_ZOOM = 2.5;
// Strop renderovaného rastra (px na šírku). Vyšší `devicePixelRatio` = ostrejšie tenké
// čiary/text; strop chráni pred obrími canvasmi pri vysokom zoome (limit prehliadača).
const MAX_RENDER_PX = 6000;
const PAN_THRESHOLD = 6; // px posunu, od ktorého je gesto pan (nie klik na región)
const DOUBLE_TAP_MS = 300; // max odstup dvoch tapov (dotyk)
const DOUBLE_TAP_RADIUS = 40; // px tolerancia polohy druhého tapu
const DOUBLE_TAP_ZOOM = 2.5; // cieľ double-tapu z fit šírky (≈ FOCUS_ZOOM čitateľnosť)
const GESTURE_COMMIT_MS = 180; // ustálenie kolieska → ostrý rerastr

type Dims = { width: number; height: number };
type Point = { x: number; y: number };

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * In-app prehliadačka výkresu (D-042 C+D, rework D-054): render zdrojového PDF
 * (react-pdf / pdf.js) + prekrytie priehľadných klikateľných boxov z `_drawing_links`.
 *
 * Ovládanie (D-054): **koliesko myši = zoom** zacielený na kurzor (zoom-to-pointer);
 * **ťahanie = posun** (pan); na dotyku **pinch = zoom, prst = pan, double-tap =
 * priblížiť/fit**; tlačidlo **fullscreen** roztiahne výkres na celú obrazovku
 * (čitateľnosť na veľkom monitore). Predvolený zoom = **fit-to-width** viewportu
 * (mobile-first).
 *
 * Výkon + ostrosť (D-054 kadencia 2): počas bežiaceho gesta (koliesko/pinch) sa strana
 * NErastruje — škáluje sa lacným CSS transformom okolo kotvy gesta; ostrý **rerastr**
 * (nie CSS-scale, do `devicePixelRatio` 2×, strop `MAX_RENDER_PX`) príde raz, po
 * ustálení gesta. Veľké výkresy tak pinch/koliesko nezasekáva rastrovaním per frame.
 *
 * Prekliky ostávajú (D-042 D): klik na box **nevyskočí** na novú stránku — vyberie
 * prvok (`onSelect`), detail v bočnom paneli; Ctrl/⌘-klik otvorí detail v novej karte;
 * skladby (D-043) navigujú na Výpis. Pan gesto klik potlačí (`didPan` threshold).
 *
 * Obojsmernosť (D): `focus` = `objects.id` → skok na stranu, priblíženie, scroll na box
 * a krátky pulz. `selectedId` (riadený zvonku) určuje trvalo zvýraznený prvok.
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
  const [fitWidth, setFitWidth] = useState(FALLBACK_FIT_WIDTH);
  const [dims, setDims] = useState<Dims | null>(null);
  const [pulsing, setPulsing] = useState(Boolean(focusRegion));
  const [isFullscreen, setIsFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const focusBoxRef = useRef<HTMLAnchorElement | null>(null);
  const focusedOnce = useRef(false);

  // Live zoom/fit v ref-e pre natívne (non-passive) wheel/pointer listenery a rAF —
  // synchronizované v efekte (ref sa nesmie zapisovať počas renderu).
  const zoomRef = useRef(zoom);
  const fitWidthRef = useRef(fitWidth);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    fitWidthRef.current = fitWidth;
  }, [fitWidth]);

  // Gestá: aktívne pointery, štart panu/pinchu, „práve som pásol" (potlačí klik),
  // odložená kotva zoomu (aplikuje sa po rerastri v layout efekte).
  const pointers = useRef<Map<number, Point>>(new Map());
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null
  );
  const pinchStart = useRef<{ d: number; zoom: number } | null>(null);
  const didPan = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const pendingAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(
    null
  );
  // Bežiace zoom gesto: cieľový zoom + kotva (px/py v netransformovaných lokálnych
  // súradniciach wrappera, base = rect pri štarte gesta). Kým gesto beží, mení sa len
  // CSS transform — rerastr (setZoom) príde až pri commite.
  const preview = useRef<{ target: number; px: number; py: number; base: DOMRect } | null>(
    null
  );
  const commitTimer = useRef<number | null>(null);

  const width = Math.round(fitWidth * zoom);
  const devicePixelRatio = Math.min(2, MAX_RENDER_PX / width);
  const pageLinks = useMemo(
    () => links.filter((l) => l.page === page),
    [links, page]
  );

  // Šírka „fit" = šírka viewportu mínus padding; sleduje resize aj prepnutie fullscreen.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - PAD * 2;
      if (w > 0) setFitWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Absolútny zoom kotvený na bod vo viewporte (client súradnice) — bod ostane pod kurzorom. */
  const zoomTo = useCallback((next: number, cx: number, cy: number) => {
    const clamped = clampZoom(next);
    // Bez viditeľnej zmeny šírky (rounding / clamp) kotvu nenastavuj — inak by ostala visieť.
    if (
      Math.round(fitWidthRef.current * clamped) ===
      Math.round(fitWidthRef.current * zoomRef.current)
    ) {
      return;
    }
    const wrap = wrapperRef.current;
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        pendingAnchor.current = {
          fx: (cx - r.left) / r.width,
          fy: (cy - r.top) / r.height,
          cx,
          cy,
        };
      }
    }
    setZoom(clamped);
  }, []);

  /**
   * Lacný náhľad zoomu počas gesta: CSS scale wrappera okolo kotvy (bod pod kurzorom /
   * stredom pinchu ostáva na mieste), žiadny rerastr. Kotva sa zmrazí pri štarte gesta.
   */
  const previewZoom = useCallback((target: number, cx: number, cy: number) => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const t = clampZoom(target);
    if (!preview.current) {
      // Prvý event gesta — wrapper je bez transformu, rect = netransformovaná geometria.
      const base = wrap.getBoundingClientRect();
      if (base.width <= 0 || base.height <= 0) return;
      preview.current = { target: t, px: cx - base.left, py: cy - base.top, base };
    } else {
      preview.current.target = t;
    }
    const p = preview.current;
    const s = t / zoomRef.current;
    wrap.style.transformOrigin = "0 0";
    wrap.style.transform = `translate(${(1 - s) * p.px}px, ${(1 - s) * p.py}px) scale(${s})`;
  }, []);

  /** Ustálenie gesta: zruš CSS náhľad a rerastruj stranu na cieľový zoom (ostrý render). */
  const commitPreview = useCallback(() => {
    if (commitTimer.current != null) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    const p = preview.current;
    const wrap = wrapperRef.current;
    if (!p) return;
    preview.current = null;
    if (wrap) wrap.style.transform = "";
    const clamped = clampZoom(p.target);
    // Bez viditeľnej zmeny šírky netreba rerastr — stačilo zrušiť transform.
    if (
      Math.round(fitWidthRef.current * clamped) ===
      Math.round(fitWidthRef.current * zoomRef.current)
    ) {
      return;
    }
    // Kotvený bod gesta má po rerastri ostať na tej istej pozícii obrazovky.
    pendingAnchor.current = {
      fx: p.px / p.base.width,
      fy: p.py / p.base.height,
      cx: p.base.left + p.px,
      cy: p.base.top + p.py,
    };
    setZoom(clamped);
  }, []);

  // Upratanie odloženého commitu pri unmounte.
  useEffect(
    () => () => {
      if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    },
    []
  );

  // Po rerastri (zmena `width`/`dims`) obnov scroll tak, aby kotvený bod ostal pod kurzorom.
  // POZOR: kotva sa aplikuje až keď raster novú šírku DOBEHNE (`dims` ≈ `width`) — hneď po
  // setZoom má canvas ešte starú CSS šírku, scrollLeft by sa clampol na starý rozsah a
  // kotva by sa zahodila (pri väčšom skoku — commit gesta, tlačidlá — viditeľne ustrelí).
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const c = scrollRef.current;
    if (!a || !c || !dims) return;
    if (Math.abs(dims.width - width) > 1) return; // rerastr ešte beží — počkaj na nový dims
    const cr = c.getBoundingClientRect();
    c.scrollLeft = cr.left + PAD + a.fx * dims.width - a.cx;
    c.scrollTop = cr.top + PAD + a.fy * dims.height - a.cy;
    pendingAnchor.current = null;
  }, [dims, width]);

  // Natívny wheel listener (non-passive) — inak nemôžeme `preventDefault` scroll stránky.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const current = preview.current?.target ?? zoomRef.current;
      previewZoom(current * factor, e.clientX, e.clientY);
      // Burst kolieska = jedno gesto; rerastr až po ustálení.
      if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(commitPreview, GESTURE_COMMIT_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [previewZoom, commitPreview]);

  // Fullscreen stav (aj keď užívateľ vyskočí cez Esc / systémovo).
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen?.();
    }
  }

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

  /** Zoom tlačidlom — kotva = stred viewportu. */
  function zoomButton(delta: number) {
    const el = scrollRef.current;
    const r = el?.getBoundingClientRect();
    const cx = r ? r.left + r.width / 2 : 0;
    const cy = r ? r.top + r.height / 2 : 0;
    zoomTo(zoom + delta, cx, cy);
  }

  /** Reset na fit-to-width + scroll na začiatok. */
  function resetZoom() {
    pendingAnchor.current = null;
    setZoom(1);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
    });
  }

  // ---- Pan / pinch cez pointer eventy (touch-action: none na plátne) ----
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) return;
    // Rozbehnutý wheel-náhľad ukonči — pan/pinch potrebuje stabilnú geometriu.
    commitPreview();
    // POZOR: pointer sa NEzachytáva hneď — capture presmeruje pointerup na scroller,
    // čím by click event obišiel `<a>` región (klik myšou na kód by bol mŕtvy).
    // Capture príde až keď gesto reálne začne: pan threshold / pinch (nižšie).
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      didPan.current = false;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      };
    } else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinchStart.current = { d: dist(p1, p2), zoom: zoomRef.current };
      panStart.current = null;
      didPan.current = true; // pinch nikdy nie je klik
      for (const id of pointers.current.keys()) el.setPointerCapture(id);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = scrollRef.current;
    if (!el) return;

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [p1, p2] = [...pointers.current.values()];
      const d = dist(p1, p2);
      if (pinchStart.current.d > 0) {
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        // Počas pinchu len CSS náhľad — rerastr príde pri pustení prstov.
        previewZoom(
          (pinchStart.current.zoom * d) / pinchStart.current.d,
          mid.x,
          mid.y
        );
      }
      return;
    }

    if (panStart.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (!didPan.current && Math.abs(dx) + Math.abs(dy) > PAN_THRESHOLD) {
        didPan.current = true;
        // Gesto je pan → od teraz drž pointer aj mimo scrollera (klik už nehrozí).
        el.setPointerCapture(e.pointerId);
      }
      el.scrollLeft = panStart.current.left - dx;
      el.scrollTop = panStart.current.top - dy;
    }
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && pinchStart.current) {
      // Koniec pinchu → ostrý rerastr na cieľový zoom.
      pinchStart.current = null;
      commitPreview();
    }
    const el = scrollRef.current;
    if (pointers.current.size === 1 && el) {
      // Prechod z pinchu späť na pan so zvyšným prstom.
      const p = [...pointers.current.values()][0];
      panStart.current = { x: p.x, y: p.y, left: el.scrollLeft, top: el.scrollTop };
    } else if (pointers.current.size === 0) {
      panStart.current = null;
      // Double-tap (dotyk): priblíž na miesto tapu; z priblíženého stavu späť na fit.
      if (e.pointerType === "touch" && !didPan.current) {
        const now = performance.now();
        const prev = lastTap.current;
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        if (
          prev &&
          now - prev.t < DOUBLE_TAP_MS &&
          dist(prev, { x: e.clientX, y: e.clientY }) < DOUBLE_TAP_RADIUS
        ) {
          lastTap.current = null;
          didPan.current = true; // druhý tap nie je klik na región
          if (zoomRef.current > 1.01) resetZoom();
          else zoomTo(DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
        }
      }
    }
  }

  // Pan gesto potlačí následný klik na región (capture fáza pred `onSelect`/navigáciou).
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (didPan.current) {
      e.preventDefault();
      e.stopPropagation();
      didPan.current = false;
    }
  }

  return (
    <div
      ref={rootRef}
      className={
        isFullscreen
          ? "flex h-screen flex-col gap-3 bg-background p-3"
          : "space-y-3"
      }
    >
      {/* Toolbar: stránkovanie + zoom + fullscreen */}
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
            onClick={() => zoomButton(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="inline-flex size-8 items-center justify-center rounded-l-md hover:bg-secondary disabled:opacity-40"
            aria-label="Oddialiť"
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="min-w-12 text-center text-sm tabular-nums hover:bg-secondary"
            title="Prispôsobiť šírke"
            aria-label="Prispôsobiť šírke"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomButton(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="inline-flex size-8 items-center justify-center rounded-r-md hover:bg-secondary disabled:opacity-40"
            aria-label="Priblížiť"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="inline-flex size-8 items-center justify-center rounded-md ring-1 ring-border hover:bg-secondary"
          title={isFullscreen ? "Zavrieť celú obrazovku" : "Celá obrazovka"}
          aria-label={isFullscreen ? "Zavrieť celú obrazovku" : "Celá obrazovka"}
        >
          {isFullscreen ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </button>

        {links.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {pageLinks.length} klikateľných prvkov na strane
          </span>
        )}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          koliesko = zoom · ťahaj = posun
        </span>
      </div>

      {/* Plátno výkresu + overlay — vlastný pan/zoom (touch-action: none). */}
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={onClickCapture}
        style={{ touchAction: "none" }}
        className={`overflow-auto rounded-md ring-1 ring-border bg-muted/30 p-4 ${
          isFullscreen ? "min-h-0 flex-1 cursor-grab" : "max-h-[78vh] cursor-grab"
        }`}
      >
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
          <div ref={wrapperRef} className="relative inline-block select-none leading-none">
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

  // Skladba (D-043): región vedie na iný dokument (Výpis skladieb) na danú stranu —
  // nie na detail prvku. Klik = bežná navigácia (žiadny `onSelect`/bočný panel).
  const isSkladba = region.targetRoute === "drawing";
  const href = isSkladba
    ? `/drawing/${region.targetId}?page=${region.targetPage ?? 1}`
    : `/${region.targetRoute}/${region.targetId}`;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Skladba → nechaj odkaz navigovať. Ctrl/⌘/shift-klik = otvoriť detail v novej karte.
    if (isSkladba || !onSelect || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onSelect({
      id: region.targetId,
      route: region.targetRoute as "node" | "type",
      label: region.label,
    });
  }

  // Skladby vizuálne odlíšené (jantárová) od prvkových kódov (primárna farba).
  const className = isSkladba
    ? "absolute rounded-sm bg-amber-400/15 ring-1 ring-amber-500/50 transition-colors hover:bg-amber-400/30 hover:ring-amber-500"
    : selected
      ? `absolute rounded-sm bg-primary/30 ring-2 ring-primary ring-offset-1 ring-offset-background ${
          pulsing ? "animate-pulse" : ""
        }`
      : "absolute rounded-sm bg-primary/10 ring-1 ring-primary/40 transition-colors hover:bg-primary/25 hover:ring-primary";

  const title = isSkladba
    ? `Skladba ${region.label} — otvoriť vo Výpise skladieb`
    : `${region.label}${selected ? " (vybraný)" : ""} — zobraziť detail`;

  return (
    <a
      ref={boxRef}
      href={href}
      onClick={handleClick}
      draggable={false}
      title={title}
      style={style}
      className={className}
    />
  );
}
