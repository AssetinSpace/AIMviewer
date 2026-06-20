import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { fetchDrawing } from "@/lib/data/drawing";
import DrawingWorkspace from "@/components/drawing-workspace";

// ISR — render sa cachuje a po 60 s revaliduje (viewer je verejný read-only, D-029).
export const revalidate = 60;

/**
 * Interaktívna prehliadačka výkresu (D-042 fáza C). Renderuje zdrojové PDF z
 * Supabase Storage + prekrytie klikateľných SNIM kódov (`_drawing_links`). Kód
 * vedie na detail prvku — vizuálne ukazuje previazanosť dát (jadro dema).
 */
export default async function DrawingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `focus` = `objects.id` prvku na zvýraznenie; `page` = počiatočná strana (D-042 D). */
  searchParams: Promise<{ focus?: string; page?: string }>;
}) {
  const { id } = await params;
  const { focus, page } = await searchParams;
  const drawing = await fetchDrawing(id);
  if (!drawing) notFound();

  const initialPage = page ? Number.parseInt(page, 10) : undefined;

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-4">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          Výkres
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          {drawing.name ?? drawing.objectRef ?? "—"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {drawing.objectRef && (
            <span className="font-mono text-[0.8rem]">{drawing.objectRef}</span>
          )}
          <span>{drawing.links.length} klikateľných prvkov</span>
          <Link
            href={`/node/${drawing.id}`}
            className="hover:text-foreground hover:underline"
          >
            Detail dokumentu
          </Link>
          <a
            href={drawing.location}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <FileText className="size-3.5" /> Pôvodné PDF
          </a>
        </div>
      </header>

      <DrawingWorkspace
        url={drawing.location}
        links={drawing.links}
        focus={focus}
        initialPage={
          initialPage && Number.isFinite(initialPage) ? initialPage : undefined
        }
      />
    </div>
  );
}
