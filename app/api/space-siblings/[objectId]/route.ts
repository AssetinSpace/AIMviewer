import { NextRequest, NextResponse } from "next/server";

import { fetchSpaceSiblings } from "@/lib/data/filter";
import { isUuid } from "@/lib/data/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ objectId: string }> }
) {
  const { objectId } = await params;

  // Guard pred DB dotazom na `uuid` stĺpec — neplatné id = 400, nie 500 z Postgresu.
  if (!isUuid(objectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

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
