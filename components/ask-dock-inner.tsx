"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import { AskPanel } from "@/components/ask-panel";

/** Rozbalenie prežije navigáciu aj reload (sessionStorage, D-056). */
const OPEN_STORAGE_KEY = "aim-ask-open";

function loadStoredOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AskDockInner() {
  const [open, setOpen] = useState(loadStoredOpen);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
    } catch {
      // nedostupné storage dock neláme
    }
  }, [open]);

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
    <div className="fixed inset-x-0 bottom-0 z-40 px-2 pb-2 sm:px-4">
      <div className="mx-auto flex h-[70vh] max-w-3xl flex-col overflow-hidden rounded-t-lg border bg-card shadow-2xl sm:h-[55vh]">
        <div className="flex items-center justify-between border-b px-3 py-2">
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
      </div>
    </div>
  );
}
