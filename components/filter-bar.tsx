"use client";

import { useState } from "react";

const IFC_TYPES = [
  "IfcDoor",
  "IfcWindow",
  "IfcColumn",
  "IfcBeam",
  "IfcWall",
  "IfcSlab",
  "IfcStair",
  "IfcRailing",
  "IfcFurnishingElement",
] as const;

interface Props {
  onFilter: (objectIds: string[]) => void;
  onClear: () => void;
  isLoading?: boolean;
}

type FilterMode = "ifc_type" | "classification";

export function FilterBar({ onFilter, onClear, isLoading }: Props) {
  const [mode, setMode] = useState<FilterMode>("ifc_type");
  const [ifcType, setIfcType] = useState<string>(IFC_TYPES[0]);
  const [classCode, setClassCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setPending(true);
    setError(null);
    try {
      const param =
        mode === "ifc_type"
          ? `ifc_type=${encodeURIComponent(ifcType)}`
          : `classification=${encodeURIComponent(classCode.trim())}`;
      const res = await fetch(`/api/filter?${param}`);
      if (!res.ok) throw new Error(`Filter zlyhal (${res.status})`);
      const data = (await res.json()) as { objectIds: string[] };
      onFilter(data.objectIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setPending(false);
    }
  }

  const busy = pending || isLoading;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      {/* Mode toggle */}
      <select
        className="rounded border border-border bg-background px-2 py-1 text-xs"
        value={mode}
        onChange={(e) => setMode(e.target.value as FilterMode)}
        disabled={busy}
      >
        <option value="ifc_type">IFC typ</option>
        <option value="classification">Klasifikácia</option>
      </select>

      {/* Value input */}
      {mode === "ifc_type" ? (
        <select
          className="rounded border border-border bg-background px-2 py-1 text-xs"
          value={ifcType}
          onChange={(e) => setIfcType(e.target.value)}
          disabled={busy}
        >
          {IFC_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          className="w-28 rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground"
          placeholder="napr. DD01"
          value={classCode}
          onChange={(e) => setClassCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && handleApply()}
          disabled={busy}
        />
      )}

      {/* Apply */}
      <button
        onClick={handleApply}
        disabled={busy || (mode === "classification" && !classCode.trim())}
        className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending && (
          <span className="h-3 w-3 animate-spin rounded-full border border-primary-foreground border-t-transparent" />
        )}
        Použiť filter
      </button>

      {/* Clear */}
      <button
        onClick={onClear}
        disabled={busy}
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Zrušiť
      </button>

      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
