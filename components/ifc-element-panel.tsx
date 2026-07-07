"use client";

import { ArrowLeft, Boxes } from "lucide-react";

import type { IfcElementInfo } from "@/lib/viewer-api";

/** Panel prvku mimo DB (naparsované IFC). Doplnok k `element-info-panel` (ten je pre
 *  prvky v DB). Ukazuje „úplnosť pokrytia" — MEP tvarovky, sub-časti (D-055). */
export function IfcElementPanel({
  info,
  onBack,
}: {
  info: IfcElementInfo;
  onBack: () => void;
}) {
  return (
    <div className="sticky top-4 rounded-md ring-1 ring-border bg-background p-4">
      <button
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Zavrieť
      </button>

      <div className="flex items-start gap-2">
        <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="truncate font-heading text-sm font-semibold">
            {info.name || info.objectType || "Prvok IFC"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {info.objectType ?? "—"} · {info.modelName}
          </p>
        </div>
      </div>

      <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
        Len v IFC (mimo DB)
      </span>

      {info.guid && (
        <p className="mt-2 break-all font-mono text-[0.65rem] text-muted-foreground">
          GUID: {info.guid}
        </p>
      )}

      {info.psets.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Bez property setov.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {info.psets.map((pset, pi) => (
            <div key={`${pset.name}-${pi}`}>
              <h3 className="mb-1 text-[0.7rem] font-semibold text-foreground">{pset.name}</h3>
              <dl className="space-y-0.5">
                {pset.props.map((pr, i) => (
                  <div key={`${pr.name}-${i}`} className="flex justify-between gap-2 text-[0.72rem]">
                    <dt className="min-w-0 truncate text-muted-foreground" title={pr.name}>
                      {pr.name}
                    </dt>
                    <dd className="min-w-0 truncate text-right" title={pr.value}>
                      {pr.value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
