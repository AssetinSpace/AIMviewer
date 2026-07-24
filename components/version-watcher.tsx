"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";

// Interval sledovania nového deployu. 60 s = kompromis medzi „rýchlo zbadá" a
// „nebombarduje endpoint"; kontrola beží aj pri každom návrate na tab.
const POLL_MS = 60_000;

async function fetchSha(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  } catch {
    // Sieťový výpadok/offline — ticho preskoč, skúsi sa o POLL_MS znova.
    return null;
  }
}

/**
 * Sleduje, či na Verceli nepribudol nový deploy, kým máš tab otvorený.
 * Zapamätá si SHA živého deployu pri načítaní a periodicky (+ pri návrate na
 * tab) ho porovnáva; pri zmene ponúkne nenápadnú obnovu. Rieši „staré UI po
 * deployi" — otvorený tab beží starý JS a sám o novom builde nevie (HTML má
 * `no-store` a chunky sú hashované, takže čerstvý reload vždy stačí).
 *
 * Toast, nie auto-reload: obnova je vždy na kliknutie, nikdy nevyhodí uprostred
 * práce. Klient-only; v dev je SHA vždy "dev" → nikdy nevyskočí.
 */
export function VersionWatcher() {
  const initial = useRef<string | null>(null);
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;

    async function check() {
      const sha = await fetchSha();
      if (!active || sha === null) return;
      if (initial.current === null) {
        initial.current = sha; // prvá videná verzia = referencia
      } else if (sha !== initial.current) {
        setStale(true);
      }
    }

    check();
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div className="fixed top-16 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-lg">
      <RefreshCw className="size-4 shrink-0 text-primary" />
      <span className="text-foreground">Je dostupná nová verzia.</span>
      <Button size="sm" onClick={() => window.location.reload()}>
        Obnoviť
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Zavrieť"
        onClick={() => setDismissed(true)}
      >
        <X />
      </Button>
    </div>
  );
}
