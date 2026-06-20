import { NextResponse } from "next/server";

import { fetchNodeSummary } from "@/lib/data/object";

/**
 * Kompaktný súhrn prvku pre bočný info-panel prehliadačky výkresov (D-042 D).
 * Klient (panel) ho volá pri kliknutí na región — zobrazí detail bez opustenia
 * výkresu. Server-side cez `service_role` (D-026), cachované (ISR).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const summary = await fetchNodeSummary(id);
  if (!summary) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(summary);
}
