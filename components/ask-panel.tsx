"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Box, Cuboid, FileText, Loader2, Send, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Chat panel LLM rozhrania (D-056, F6). Klient drží len textovú históriu;
 * tool-calling beží server-side v `/api/ask`. Trust loop: zdroje prídu
 * štruktúrovane zo servera a renderujú sa ako deep-linky (karta / 3D / výkres) —
 * každá odpoveď je dohľadateľná až k dátam.
 */

interface AskSource {
  id: string;
  objectType: string;
  objectRef: string | null;
  name: string | null;
  route: "node" | "type" | "drawing";
  ifcGuid: string | null;
  drawings: { docId: string; docName: string | null; page: number | null }[];
}

interface AskToolTrace {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  trace?: AskToolTrace[];
  error?: boolean;
}

const SUGGESTIONS = [
  "V ktorej miestnosti sú dvere DD01.06.03?",
  "Na ktorých výkresoch je typ steny SN11.01?",
  "Aké systémy vzduchotechniky sú v budove?",
  "Kto zodpovedá za budovu?",
];

/** Max zdrojov zobrazených bez rozbalenia. */
const SOURCE_CAP = 8;

/** Zdroje spomenuté v odpovedi (object_ref/name v texte) — ostatné za rozbalením. */
function splitSources(sources: AskSource[], answer: string) {
  const mentioned = sources.filter(
    (s) =>
      (s.objectRef && answer.includes(s.objectRef)) ||
      (s.name && s.name.length > 2 && answer.includes(s.name))
  );
  const primary = (mentioned.length > 0 ? mentioned : sources).slice(0, SOURCE_CAP);
  const rest = sources.filter((s) => !primary.includes(s));
  return { primary, rest };
}

function SourceChip({ source }: { source: AskSource }) {
  const label = source.objectRef ?? source.name ?? source.id.slice(0, 8);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs">
      <Link
        href={`/${source.route}/${source.id}`}
        prefetch={false}
        className="inline-flex items-center gap-1 font-mono hover:underline"
        title={source.name ?? undefined}
      >
        <Box className="size-3 shrink-0 text-muted-foreground" />
        {label}
      </Link>
      {source.ifcGuid && (
        <Link
          href={`/ifc?focus=${encodeURIComponent(source.ifcGuid)}`}
          prefetch={false}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
          title="Zobraziť v 3D modeli"
        >
          <Cuboid className="size-3" />
          3D
        </Link>
      )}
      {source.drawings.slice(0, 2).map((d) => (
        <Link
          key={d.docId}
          href={`/drawing/${d.docId}?focus=${source.id}${d.page ? `&page=${d.page}` : ""}`}
          prefetch={false}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
          title={d.docName ?? "Výkres"}
        >
          <FileText className="size-3" />
          výkres
        </Link>
      ))}
    </span>
  );
}

function AssistantMeta({ turn }: { turn: ChatTurn }) {
  const [showAll, setShowAll] = useState(false);
  const sources = turn.sources ?? [];
  const trace = turn.trace ?? [];
  if (sources.length === 0 && trace.length === 0) return null;

  const { primary, rest } = splitSources(sources, turn.content);
  const visible = showAll ? [...primary, ...rest] : primary;

  return (
    <div className="mt-2 space-y-1.5">
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            Zdroje
          </span>
          {visible.map((s) => (
            <SourceChip key={s.id} source={s} />
          ))}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {showAll ? "menej" : `+${rest.length} ďalších`}
            </button>
          )}
        </div>
      )}
      {trace.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Ako som hľadal ({trace.length} {trace.length === 1 ? "dotaz" : "dotazy"})
          </summary>
          <ol className="mt-1 space-y-0.5 pl-4">
            {trace.map((t, i) => (
              <li key={i} className="font-mono">
                {t.ok ? "✓" : "✗"} {t.name}
                {" — "}
                {t.summary}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function AskPanel() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [unconfigured, setUnconfigured] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    const history = [...turns, { role: "user" as const, content: question }];
    setTurns(history);
    setInput("");
    setPending(true);
    queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        sources?: AskSource[];
        trace?: AskToolTrace[];
        error?: string;
        configured?: boolean;
      };

      if (res.status === 503 && data.configured === false) {
        setUnconfigured(data.error ?? "LLM rozhranie nie je nakonfigurované.");
        setTurns(history.slice(0, -1));
        return;
      }
      if (!res.ok || !data.answer) {
        setTurns([
          ...history,
          {
            role: "assistant",
            content: data.error ?? "Spracovanie otázky zlyhalo. Skús to znova.",
            error: true,
          },
        ]);
        return;
      }
      setTurns([
        ...history,
        { role: "assistant", content: data.answer, sources: data.sources, trace: data.trace },
      ]);
    } catch {
      setTurns([
        ...history,
        { role: "assistant", content: "Sieťová chyba — skús to znova.", error: true },
      ]);
    } finally {
      setPending(false);
      queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {unconfigured && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            {unconfigured}
          </div>
        )}
        {turns.length === 0 && !unconfigured && (
          <div className="space-y-3 py-6 text-center">
            <Sparkles className="mx-auto size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Opýtaj sa na prvky, miestnosti, systémy, výkresy či zodpovednosti —
              odpoveď je vždy podložená odkazmi do dát.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn("flex", t.role === "user" && "justify-end")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                t.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : t.error
                    ? "border border-destructive/40 bg-destructive/10"
                    : "bg-muted"
              )}
            >
              <div className="whitespace-pre-wrap">{t.content}</div>
              {t.role === "assistant" && <AssistantMeta turn={t} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Hľadám v grafe…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Napíš otázku o budove…"
          className="max-h-32 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={pending || !!unconfigured}
        />
        <button
          type="submit"
          disabled={pending || !input.trim() || !!unconfigured}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Odoslať otázku"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
