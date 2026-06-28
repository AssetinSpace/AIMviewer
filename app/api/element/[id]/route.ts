import { NextResponse } from "next/server";

import { fetchNodeSummary } from "@/lib/data/object";

/**
 * Kompaktný súhrn prvku pre bočný info-panel prehliadačky výkresov (D-042 D).
 * Klient (panel) ho volá pri kliknutí na región — zobrazí detail bez opustenia
 * výkresu. Server-side cez `service_role` (D-026), cachované (ISR).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const summary = await fetchNodeSummary(id);
    if (!summary) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // Read-only súhrn (revaliduje sa s ostatnými AIM dátami po 60 s). Cache v
    // prehliadači + na CDN → opakovaný klik na ten istý kód vo výkrese je okamžitý,
    // bez HTTP round-tripu na server (D-030 perf, dodatok).
    return NextResponse.json(summary, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error(`[api/element/${id}]`, err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
