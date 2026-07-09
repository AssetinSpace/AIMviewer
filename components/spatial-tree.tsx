"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  Building2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  DoorOpen,
  Layers,
  Loader2,
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

// Default: rozbalené po podlažia (site→building→floor viditeľné, space a nižšie zbalené).
const DEFAULT_OPEN_DEPTH = 2;

/**
 * Zdieľaný open-stav stromu. Mód `default` (pravidlo podľa hĺbky) sa dá globálne
 * prepnúť na `all`/`none` cez „Rozbaliť/Zbaliť všetko"; jednotlivé uzly prepisuje
 * `overrides`. Toggle uloží opačnú hodnotu k aktuálne efektívnej.
 */
type TreeMode = "default" | "all" | "none";

interface TreeCtx {
  isOpen: (id: string, depth: number) => boolean;
  toggle: (id: string, depth: number) => void;
}

const TreeContext = createContext<TreeCtx | null>(null);

/**
 * Ikona uzla, ktorá sa počas prebiehajúcej navigácie z tohto odkazu zmení na
 * točiace sa koliesko (`useLinkStatus`) — klik má okamžitú viditeľnú odozvu.
 */
function TreeLinkIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <Loader2
        aria-label="Načítava sa"
        className="size-4 shrink-0 animate-spin text-muted-foreground"
      />
    );
  }
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

function useTree() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("TreeContext chýba");
  return ctx;
}

function TreeNode({ node, depth }: { node: SpatialNode; depth: number }) {
  const pathname = usePathname();
  const { isOpen, toggle } = useTree();
  const isActive = pathname === `/node/${node.id}`;
  const hasChildren = node.children.length > 0;
  const open = isOpen(node.id, depth);

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
            onClick={() => toggle(node.id, depth)}
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
          // Plný prefetch RSC payloadu viditeľných uzlov — klik je potom
          // z klientskej cache namiesto server round-tripu.
          prefetch={true}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
        >
          <TreeLinkIcon icon={ICONS[node.object_type]} />
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
  const [mode, setMode] = useState<TreeMode>("default");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const effectiveOpen = useCallback(
    (id: string, depth: number) => {
      if (id in overrides) return overrides[id];
      if (mode === "all") return true;
      if (mode === "none") return false;
      return depth < DEFAULT_OPEN_DEPTH;
    },
    [overrides, mode]
  );

  const toggle = useCallback(
    (id: string, depth: number) => {
      setOverrides((o) => ({ ...o, [id]: !effectiveOpen(id, depth) }));
    },
    [effectiveOpen]
  );

  const expandAll = useCallback(() => {
    setMode("all");
    setOverrides({});
  }, []);
  const collapseAll = useCallback(() => {
    setMode("none");
    setOverrides({});
  }, []);

  if (tree.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        Žiadne dáta — priestorová hierarchia je prázdna.
      </p>
    );
  }

  return (
    <TreeContext.Provider value={{ isOpen: effectiveOpen, toggle }}>
      <div className="mb-1 flex items-center justify-end gap-0.5 px-1">
        <button
          type="button"
          onClick={expandAll}
          title="Rozbaliť všetko"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[0.7rem] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <ChevronsUpDown className="size-3.5" />
          Rozbaliť
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title="Zbaliť všetko"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[0.7rem] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <ChevronsDownUp className="size-3.5" />
          Zbaliť
        </button>
      </div>

      <ul className="space-y-0.5">
        {tree.map((root) => (
          <TreeNode key={root.id} node={root} depth={0} />
        ))}
      </ul>
    </TreeContext.Provider>
  );
}
