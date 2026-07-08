"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cuboid, FileText, Loader2, SendHorizonal, SquareArrowOutUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ChatMessage, ChatResponse, ChatSource } from "@/lib/llm/types";

/**
 * Chat panel LLM rozhrania (F6, D-056). Klient drží históriu a volá
 * `POST /api/chat`; pod každou odpoveďou renderuje trust-loop citácie —
 * deep-linky na kartu prvku, 3D highlight a výkres — zo skutočne
 * prečítaných dát (zbiera ich server, nie model).
 */

interface PanelMessage extends ChatMessage {
  sources?: ChatSource[];
}

const SUGGESTIONS = [
  "Na ktorých výkresoch sú dvere DD01.06.03 a kde presne?",
  "Ktoré prvky obsluhuje systém Prívod-1NP?",
  "V ktorej miestnosti je prvok DD01.02.01?",
  "Kto zodpovedá za budovu a aké dokumenty k nej máme?",
];

function cardHref(s: ChatSource): string {
  return s.objectType === "asset_type" ? `/type/${s.id}` : `/node/${s.id}`;
}

function SourceChip({ source }: { source: ChatSource }) {
  const label = source.objectRef ?? source.name ?? source.id.slice(0, 8);
  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      <Link
        href={cardHref(source)}
        className="flex items-center gap-1 font-mono hover:underline"
        title={source.name ?? undefined}
      >
        <SquareArrowOutUpRight className="size-3 shrink-0 text-muted-foreground" />
        <span className="max-w-40 truncate">{label}</span>
      </Link>
      {source.ifcGuid && (
        <Link
          href={`/ifc?focus=${encodeURIComponent(source.ifcGuid)}`}
          className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
          title="Zvýrazniť v 3D modeli"
        >
          <Cuboid className="size-3" />
          3D
        </Link>
      )}
      {source.drawings.map((d, i) => (
        <Link
          key={`${d.drawingId}-${d.page ?? 0}-${i}`}
          href={`/drawing/${d.drawingId}?focus=${source.id}${d.page ? `&page=${d.page}` : ""}`}
          className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
          title={d.drawingName ?? "Výkres"}
        >
          <FileText className="size-3" />
          {d.page ? `s. ${d.page}` : "výkres"}
        </Link>
      ))}
    </div>
  );
}

export function ChatPanel() {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;

    const history: PanelMessage[] = [...messages, { role: "user", content: question }];
    setMessages(history);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessages([
        ...history,
        { role: "assistant", content: data.reply, sources: data.sources },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Požiadavka zlyhala");
      // História ostáva — otázku možno poslať znova.
      setMessages(history.slice(0, -1));
      setInput(question);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !loading && (
          <div className="mx-auto mt-8 max-w-lg space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              Opýtaj sa na čokoľvek nad grafom budovy — prvky, miestnosti,
              systémy, výkresy, zodpovednosti. Každá odpoveď má klikateľné
              citácie do karty prvku, 3D modelu a výkresu.
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card"
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                  {m.sources.map((s) => (
                    <SourceChip key={s.id} source={s} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Hľadám v grafe…
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
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
          rows={2}
          placeholder="Napíš otázku… (Enter odošle, Shift+Enter nový riadok)"
          className="min-h-0 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="icon" disabled={loading || !input.trim()}>
          <SendHorizonal className="size-4" />
          <span className="sr-only">Odoslať</span>
        </Button>
      </form>
    </div>
  );
}
