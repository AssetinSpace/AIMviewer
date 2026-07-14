import { NextResponse } from "next/server";

import { fetchCaptureDetail } from "@/lib/data/captures";

/**
 * Detail capture pointu vrátane verzií médií (D-073). Read-only, server-side (D-026).
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
    const capture = await fetchCaptureDetail(id);
    if (!capture) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(capture, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[api/captures/[id]]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
