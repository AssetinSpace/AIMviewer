import { cn } from "@/lib/utils";
import type { ClassificationFacet } from "@/lib/data/asset";

/**
 * Render klasifikačných faset (S2). Efektívna klasifikácia occurrence = union
 * vlastných + zdedených z typu (D-023). `showLevel` zobrazí badge
 * `occurrence`/`type` — na type stránke je vždy `type`, preto sa skryje.
 */
export function ClassificationList({
  facets,
  showLevel = true,
}: {
  facets: ClassificationFacet[];
  showLevel?: boolean;
}) {
  if (facets.length === 0) {
    return <p className="text-sm text-muted-foreground">Žiadne klasifikácie.</p>;
  }

  return (
    <ul className="space-y-2">
      {facets.map((f) => (
        <li
          key={`${f.refId}-${f.level}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          <span className="font-mono font-medium">{f.identification}</span>
          {f.name && <span className="text-muted-foreground">{f.name}</span>}
          <span className="text-xs text-muted-foreground">· {f.systemName}</span>
          {showLevel && (
            <span
              className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                f.level === "occurrence"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {f.level}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
