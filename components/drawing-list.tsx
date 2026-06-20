import Link from "next/link";
import { Eye, FileText } from "lucide-react";

import type { DrawingLink } from "@/lib/data/relations";

/**
 * Výkresy, v ktorých je prvok zobrazený (E4 auto-linking, D-041). Názov vedie na
 * detail dokumentu (`/node/[id]`), „Prehliadačka" otvorí interaktívny výkres
 * (`/drawing/[id]`, D-042) — s `?focus=<elementId>` odscrolluje a zvýrazní práve
 * tento prvok (obojsmernosť, fáza D); ikona je priamy odkaz na PDF (`location`).
 */
export function DrawingList({
  drawings,
  elementId,
}: {
  drawings: DrawingLink[];
  /** `objects.id` aktuálneho prvku — cieľ zvýraznenia vo výkrese (`?focus=`). */
  elementId?: string;
}) {
  if (drawings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Prvok nie je zachytený v žiadnom výkrese.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {drawings.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-center gap-2 rounded-md p-3 ring-1 ring-border"
        >
          <Link
            href={`/node/${d.id}`}
            className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {d.name ?? d.objectRef ?? d.id}
          </Link>
          <Link
            href={
              elementId
                ? `/drawing/${d.id}?focus=${encodeURIComponent(elementId)}`
                : `/drawing/${d.id}`
            }
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Eye className="size-3.5" /> Prehliadačka
          </Link>
          {d.location && (
            <a
              href={d.location}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <FileText className="size-3.5" /> PDF
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
