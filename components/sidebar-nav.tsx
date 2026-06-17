"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Building2, FileText, User, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem, SidebarNavData } from "@/lib/data/nav";

/**
 * Ploché navigačné zoznamy ne-priestorových uzlov pod stromom (S3 polish).
 * Typy assetov vedú na `/type/[id]`, ostatné na `/node/[id]`. Aktívny odkaz sa
 * zvýrazní cez `usePathname` (rovnako ako strom).
 */
function Section({
  title,
  icon: Icon,
  items,
  hrefBase,
}: {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
  hrefBase: string;
}) {
  const pathname = usePathname();
  if (items.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 px-2 py-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => {
          const href = `${hrefBase}/${it.id}`;
          const active = pathname === href;
          return (
            <li key={it.id}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md py-1.5 pl-8 pr-2 text-sm",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60"
                )}
              >
                <span className="truncate">{it.name ?? it.object_ref ?? it.id}</span>
                {it.object_ref && (
                  <span className="ml-auto shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground">
                    {it.object_ref}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SidebarNav({ nav }: { nav: SidebarNavData }) {
  const empty =
    nav.assetTypes.length === 0 &&
    nav.persons.length === 0 &&
    nav.organizations.length === 0 &&
    nav.documents.length === 0;
  if (empty) return null;

  return (
    <div className="mt-2 border-t pt-1">
      <Section title="Typy assetov" icon={Box} items={nav.assetTypes} hrefBase="/type" />
      <Section title="Osoby" icon={User} items={nav.persons} hrefBase="/node" />
      <Section
        title="Organizácie"
        icon={Building2}
        items={nav.organizations}
        hrefBase="/node"
      />
      <Section title="Dokumenty" icon={FileText} items={nav.documents} hrefBase="/node" />
    </div>
  );
}
