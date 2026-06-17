"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  Building2,
  ChevronRight,
  DoorOpen,
  Layers,
  MapPin,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { SpatialNode, SpatialType } from "@/lib/data/spatial";

const ICONS: Record<SpatialType, LucideIcon> = {
  site: MapPin,
  building: Building2,
  floor: Layers,
  space: DoorOpen,
  asset: Box,
};

function TreeNode({ node, depth }: { node: SpatialNode; depth: number }) {
  const pathname = usePathname();
  const isActive = pathname === `/node/${node.id}`;
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(true);

  const Icon = ICONS[node.object_type];

  return (
    <li>
      <div
        className={cn(
          "group/row flex items-center gap-1 rounded-md pr-1 text-sm",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Zbaliť" : "Rozbaliť"}
            aria-expanded={open}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        <Link
          href={`/node/${node.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name ?? node.object_ref ?? node.id}</span>
          {node.object_ref && (
            <span className="ml-auto shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground">
              {node.object_ref}
            </span>
          )}
        </Link>
      </div>

      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SpatialTree({ tree }: { tree: SpatialNode[] }) {
  if (tree.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        Žiadne dáta — priestorová hierarchia je prázdna.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {tree.map((root) => (
        <TreeNode key={root.id} node={root} depth={0} />
      ))}
    </ul>
  );
}
