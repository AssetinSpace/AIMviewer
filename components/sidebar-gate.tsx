"use client";

import { usePathname } from "next/navigation";

/**
 * Skrytie ľavého sidebaru na `/ifc` (D-076 viewer-first): jediný strom v 3D
 * kontexte je natívny HierarchyPanel embed viewera (dekorovaný AIM badges);
 * hostovský strom + nav by ho duplikovali. Server fetch stromu v layoute
 * ostáva (cached, zdieľaný s ostatnými routami) — skrýva sa len render.
 */
export function SidebarGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/ifc" || pathname.startsWith("/ifc/")) return null;
  return <>{children}</>;
}
