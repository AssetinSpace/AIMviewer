import { NextResponse } from "next/server";

/**
 * Vráti SHA aktuálne živého Vercel deployu. `<VersionWatcher>` (klient) si túto
 * hodnotu zapamätá pri načítaní a periodicky ju porovnáva — keď sa zmení, vie,
 * že medzitým pribudol nový build, a ponúkne obnovu (rieši „staré UI po deployi").
 *
 * `force-dynamic` + `no-store`: nesmie sa cachovať, inak by otvorený tab dostával
 * svoje vlastné staré SHA a novú verziu by nikdy nezachytil. Lokálne/dev bez
 * Vercel env vracia "dev" → klient nikdy nefalošne nevyskočí.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    "dev";

  return NextResponse.json(
    { sha },
    { headers: { "Cache-Control": "no-store" } }
  );
}
