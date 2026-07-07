"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { NavGroup, NavigatorModel, NavTreeNode } from "@/lib/viewer-api";

type Tab = "spatial" | "type" | "material" | "class";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "spatial", label: "SPATIAL" },
  { id: "type", label: "TYPE" },
  { id: "material", label: "MATERIAL" },
  { id: "class", label: "CLASS" },
];

/** IFClite-native navigátor (follow-IFClite, D-055). Dáta z parseru; interakcia cez
 *  globálne (federačné) expressId — highlight (skupina) / select (prvok). */
export function IfcTree({
  models,
  onHighlight,
  onSelect,
}: {
  models: NavigatorModel[];
  onHighlight: (exprs: number[]) => void;
  onSelect: (expr: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("spatial");

  if (models.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">Navigátor sa načítava…</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "flex-1 px-1 py-1.5 text-[0.6rem] font-semibold tracking-wide transition-colors",
              tab === t.id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {models.map((m) => (
          <div key={m.id} className="mb-2">
            <div className="px-1 py-1 text-[0.65rem] font-semibold uppercase text-muted-foreground">
              {m.name}
            </div>
            {tab === "spatial" &&
              m.spatial.map((n) => (
                <TreeRow key={n.key} node={n} depth={0} onHighlight={onHighlight} onSelect={onSelect} />
              ))}
            {tab === "type" && <GroupList groups={m.types} onHighlight={onHighlight} />}
            {tab === "material" && <GroupList groups={m.materials} onHighlight={onHighlight} />}
            {tab === "class" && <GroupList groups={m.classifications} onHighlight={onHighlight} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  onHighlight,
  onSelect,
}: {
  node: NavTreeNode;
  depth: number;
  onHighlight: (exprs: number[]) => void;
  onSelect: (expr: number) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[0.72rem] hover:bg-muted"
        style={{ paddingLeft: `${depth * 10 + 2}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-muted-foreground"
            aria-label={open ? "Zbaliť" : "Rozbaliť"}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          onClick={() => {
            if (node.expr !== undefined && node.children.length === 0) onSelect(node.expr);
            else onHighlight(node.exprs);
          }}
          className="min-w-0 flex-1 truncate text-left"
          title={node.label}
        >
          {node.label}
        </button>
      </div>
      {open &&
        node.children.map((c) => (
          <TreeRow key={c.key} node={c} depth={depth + 1} onHighlight={onHighlight} onSelect={onSelect} />
        ))}
    </div>
  );
}

function GroupList({
  groups,
  onHighlight,
}: {
  groups: NavGroup[];
  onHighlight: (exprs: number[]) => void;
}) {
  if (groups.length === 0) {
    return <div className="px-2 py-1 text-[0.7rem] text-muted-foreground">Žiadne dáta</div>;
  }
  return (
    <>
      {groups.map((g, i) => (
        <button
          key={`${g.label}-${i}`}
          onClick={() => onHighlight(g.exprs)}
          className="flex w-full items-center justify-between gap-2 rounded px-2 py-0.5 text-left text-[0.72rem] hover:bg-muted"
          title={g.label}
        >
          <span className="min-w-0 truncate">{g.label}</span>
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">{g.count}</span>
        </button>
      ))}
    </>
  );
}
