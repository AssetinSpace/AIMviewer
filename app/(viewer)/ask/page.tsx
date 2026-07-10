import { AskPanel } from "@/components/ask-panel";

// Render na request (ako /ifc) — samotná stránka je statická, ale nadradený
// (viewer) layout číta DB; build bez Supabase env by na prerenderi padol.
export const dynamic = "force-dynamic";

/**
 * LLM rozhranie nad grafom (D-056, F6): otázky v prirodzenom jazyku, odpovede
 * podložené deep-linkami do dát (karta / 3D / výkres — trust loop D-047).
 * Stránka sama DB nečíta — všetko beží cez `/api/ask` (tool-calling slučka).
 */
export default function AskPage() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="mb-4">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          AI asistent
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          Opýtaj sa na budovu
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Odpovede vychádzajú výhradne z grafu previazaných dát — každý fakt má
          odkaz na kartu prvku, 3D model alebo výkres (D-056).
        </p>
      </header>

      <div className="min-h-0 flex-1 pb-2">
        <AskPanel />
      </div>
    </div>
  );
}
