"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { MessageSquare, X, CornerDownLeft, Box, FileText, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * S-LLM chat panel (D-050, F2+F3) — prirodzený jazyk nad grafom + trust loop.
 *
 * Plávajúci panel dostupný na každej stránke Viewera. Otázku posiela na
 * `/api/ask`; kontext „tohto prvku" odvodí z URL (`/node/<id>`, `/type/<id>`),
 * takže „obsluhuje tento prvok nejaký systém?" funguje bez ďalšieho klikania.
 * Každá odpoveď nesie dohľadateľné citácie (karta + 3D deep-link cez IFC GUID).
 */

interface Citation {
  id: string;
  label: string;
  objectType: string | null;
  nodeHref: string;
  focusGuid: string | null;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  error?: boolean;
}

/** Z pathname odvodí id objektu, na ktorý sa používateľ práve pozerá (kontext). */
function contextFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/(?:node|type)\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function AskPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const contextObjectId = contextFromPath(pathname);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setLoading(true);

    // Scroll na spodok po pridaní správy.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    );

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, contextObjectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Chyba servera.");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.answer || "(prázdna odpoveď)", citations: data.citations ?? [] },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "Nepodarilo sa získať odpoveď.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
      );
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 h-11 gap-2 rounded-full px-4 shadow-lg"
        aria-label="Opýtať sa asistenta"
      >
        <MessageSquare className="size-4" />
        Opýtať sa
      </Button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
      {/* Hlavička */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold">Asistent</p>
          <p className="truncate text-xs text-muted-foreground">
            Pýtaj sa na prvky, systémy a podlažia
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Zavrieť"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Správy */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="space-y-2 px-1 py-2 text-xs text-muted-foreground">
            <p>Skús napríklad:</p>
            <ul className="space-y-1">
              {[
                "Aké prvky obsahuje systém Prívod 2NP?",
                contextObjectId
                  ? "Obsluhuje tento prvok nejaký systém a na akom podlaží?"
                  : "Na akom podlaží je vzduchotechnická jednotka?",
              ].map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => setInput(ex)}
                    className="text-left text-foreground/80 hover:text-foreground hover:underline"
                  >
                    {`„${ex}“`}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : msg.error
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-foreground"
              )}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>

              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                  <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                    Zdroje
                  </p>
                  <ul className="space-y-1">
                    {msg.citations.map((c) => (
                      <li key={c.id} className="flex items-center gap-1.5 text-xs">
                        <Link
                          href={c.nodeHref}
                          className="inline-flex items-center gap-1 text-foreground hover:underline"
                        >
                          <FileText className="size-3 shrink-0 text-muted-foreground" />
                          {c.label}
                        </Link>
                        {c.focusGuid && (
                          <Link
                            href={`/ifc?focus=${c.focusGuid}`}
                            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
                            title="Zobraziť v 3D"
                          >
                            <Box className="size-3" />
                            3D
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Premýšľam…
            </div>
          </div>
        )}
      </div>

      {/* Vstup */}
      <div className="border-t p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Napíš otázku…"
            className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            size="icon"
            aria-label="Odoslať"
            className="size-9"
          >
            <CornerDownLeft className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
