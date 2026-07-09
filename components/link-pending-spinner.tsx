"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Točiace sa koliesko viditeľné počas prebiehajúcej navigácie z nadradeného
 * `<Link>` (`useLinkStatus`) — okamžitá odozva na klik, kým server streamuje
 * cieľovú stránku. Renderuj ako potomka `<Link>`; mimo neho je vždy skrytý.
 * Klientský ostrov — dá sa vložiť aj do server-komponentových zoznamov.
 */
export function LinkPendingSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      aria-label="Načítava sa"
      className={cn("size-3.5 shrink-0 animate-spin text-muted-foreground", className)}
    />
  );
}
