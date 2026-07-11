"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Roztiahnuteľný + zbaliteľný rám sidebaru (review polish).
 * - Šírka sa mení ťahaním pravého okraja (drag handle), s medzami MIN/MAX.
 * - Celý panel sa dá zbaliť do tenkého prúžku a späť rozbaliť.
 * - Oba stavy (šírka, zbalené) sa držia v `localStorage` cez `useSyncExternalStore`
 *   — prežijú navigáciu aj reload, bez hydration warningu (server snapshot = default).
 * Obsah (strom + nav) prichádza ako `children`.
 */

const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 288;
const WIDTH_KEY = "aim:sidebar-width";
const COLLAPSED_KEY = "aim:sidebar-collapsed";

// Jednoduchý pub/sub nad localStorage — `storage` event sa v tom istom tabe nespustí,
// takže zápisy notifikujeme sami.
const listeners = new Map<string, Set<() => void>>();
function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => set!.delete(cb);
}
function writePersisted(key: string, value: string) {
  localStorage.setItem(key, value);
  listeners.get(key)?.forEach((cb) => cb());
}

function usePersistedWidth() {
  return useSyncExternalStore(
    (cb) => subscribe(WIDTH_KEY, cb),
    () => {
      const n = Number(localStorage.getItem(WIDTH_KEY));
      return n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
    },
    () => DEFAULT_WIDTH
  );
}
function usePersistedCollapsed() {
  return useSyncExternalStore(
    (cb) => subscribe(COLLAPSED_KEY, cb),
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
    () => false
  );
}

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const width = usePersistedWidth();
  const collapsed = usePersistedCollapsed();
  const draggingRef = useRef(false);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Pointer capture — mouse eventy zanikajú nad iframom 3D vieweru (iný
    // dokument), takže mouseup pustený nad ním by drag nikdy neukončil a panel
    // by potom naveky skákal za kurzorom. Capture drží eventy na úchyte.
    handle.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      // Poistka: keby mouseup predsa len zapadol, prvý pohyb bez tlačidla drag ukončí.
      if (ev.buttons === 0) return onUp();
      // Aside začína na x=0, takže clientX = požadovaná šírka.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
      writePersisted(WIDTH_KEY, String(next));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }, []);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r bg-sidebar py-3 text-sidebar-foreground">
        <button
          type="button"
          onClick={() => writePersisted(COLLAPSED_KEY, "0")}
          aria-label="Rozbaliť panel"
          title="Rozbaliť panel"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <Link href="/" className="font-heading text-sm font-semibold">
            AIM Viewer
          </Link>
          <p className="truncate text-xs text-muted-foreground">Priestorová hierarchia</p>
        </div>
        <button
          type="button"
          onClick={() => writePersisted(COLLAPSED_KEY, "1")}
          aria-label="Zbaliť panel"
          title="Zbaliť panel"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">{children}</nav>

      {/* Drag handle — pravý okraj panela. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Zmeniť šírku panela"
        onPointerDown={startResize}
        className={cn(
          "absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none",
          "hover:bg-sidebar-accent active:bg-sidebar-accent"
        )}
      />
    </aside>
  );
}
