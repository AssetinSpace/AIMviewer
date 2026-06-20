"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";

import type { SelectedElement } from "@/lib/data/drawing";

interface ObjectLink {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
}

interface NodeSummary {
  id: string;
  objectType: string;
  route: "node" | "type";
  name: string | null;
  objectRef: string | null;
  ifcType: string | null;
  predefinedType: string | null;
  userDefinedType: string | null;
  type: ObjectLink | null;
  counts: { classifications: number; documents: number; occurrences: number };
}

const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  asset_type: "Typ assetu",
};

/**
 * Bočný info-panel prehliadačky výkresov (D-042 D): pri kliknutí na prvok vo výkrese
 * načíta jeho kompaktný súhrn (`/api/element/[id]`) a zobrazí ho vedľa výkresu — bez
 * opustenia stránky. Odkaz „Otvoriť celý detail" vedie na plnú kartu prvku.
 */
export function ElementInfoPanel({
  selected,
  onClose,
}: {
  selected: SelectedElement;
  onClose: () => void;
}) {
  const [data, setData] = useState<NodeSummary | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ok">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);
    fetch(`/api/element/${selected.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: NodeSummary) => {
        if (!cancelled) {
          setData(d);
          setState("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selected.id]);

  return (
    <div className="sticky top-4 rounded-md ring-1 ring-border bg-background p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {TYPE_LABEL[data?.objectType ?? ""] ?? "Prvok"}
          </span>
          <h2 className="mt-1.5 font-heading text-base font-semibold leading-tight">
            {data?.name ?? selected.label}
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {data?.objectRef ?? selected.label}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavrieť panel"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {state === "loading" && (
        <p className="py-4 text-sm text-muted-foreground">Načítavam detail…</p>
      )}
      {state === "error" && (
        <p className="py-4 text-sm text-destructive">Detail sa nepodarilo načítať.</p>
      )}

      {state === "ok" && data && (
        <div className="space-y-3">
          <dl className="divide-y divide-border text-sm">
            <Row label="IFC typ" value={data.ifcType} />
            <Row label="PredefinedType" value={data.predefinedType} />
            <Row label="ObjectType" value={data.userDefinedType} />
            {data.type && (
              <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
                <dt className="text-muted-foreground">Typ</dt>
                <dd>
                  <Link
                    href={`/type/${data.type.id}`}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {data.type.name ?? data.type.object_ref ?? data.type.id}
                  </Link>
                </dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap gap-1.5 text-xs">
            <Chip label="klasifikácie" value={data.counts.classifications} />
            <Chip label="dokumenty" value={data.counts.documents} />
            {data.objectType === "asset_type" && (
              <Chip label="výskyty" value={data.counts.occurrences} />
            )}
          </div>
        </div>
      )}

      <Link
        href={`/${selected.route}/${selected.id}`}
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Otvoriť celý detail <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.8rem] break-words">{value}</dd>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
      <span className="font-medium tabular-nums">{value}</span>
      {label}
    </span>
  );
}
