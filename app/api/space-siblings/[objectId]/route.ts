import { NextRequest, NextResponse } from "next/server";

import { fetchSpaceSiblings } from "@/lib/data/filter";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ objectId: string }> }
) {
  const { objectId } = await params;

  try {
    const result = await fetchSpaceSiblings(objectId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
