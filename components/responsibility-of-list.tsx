import Link from "next/link";

import type { ResponsibilityOf } from "@/lib/data/object";
import { ACTING_ROLE_LABEL, OBJECT_TYPE_LABEL, roleLabel } from "@/lib/object-type";

/**
 * Za čo aktor zodpovedá (S3, reverz `rel_assigns_to_actor`) — na detaile osoby
 * a organizácie. Zrkadlo k `ResponsibilityList` (tá ide z pohľadu objektu).
 */
export function ResponsibilityOfList({ items }: { items: ResponsibilityOf[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Žiadne zodpovednosti.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li
          key={`${r.object.id}-${r.role}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          <span className="rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
            {roleLabel(ACTING_ROLE_LABEL, r.role)}
          </span>
          <Link
            href={`/node/${r.object.id}`}
            className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {r.object.name ?? r.object.object_ref ?? r.object.id}
          </Link>
          <span className="text-xs text-muted-foreground">
            {OBJECT_TYPE_LABEL[r.object.object_type]}
          </span>
          {r.object.object_ref && (
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {r.object.object_ref}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
