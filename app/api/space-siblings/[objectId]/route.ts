import { NextRequest, NextResponse } from "next/server";

import { fetchSpaceSiblings } from "@/lib/data/filter";
import { isUuid } from "@/lib/utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ objectId: string }> }
) {
  const { objectId } = await params;

  if (!isUuid(objectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const result = await fetchSpaceSiblings(objectId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    console.error(`[api/space-siblings/${objectId}]`, err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
