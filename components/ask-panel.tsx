"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Box,
  Cuboid,
  FileText,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

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

/** UI akcia zo servera (show_in_3d…) — klient na ňu naviguje (D-056). */
interface AskUiAction {
  type: "navigate";
  url: string;
  label: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  trace?: AskToolTrace[];
  actions?: AskUiAction[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Koľko VZT jednotiek je v budove a na akých podlažiach?",
  "Zobraz VZT jednotku v 3D",
  "V ktorej miestnosti sú dvere DD01.06.03?",
  "Kto zodpovedá za budovu?",
];

/**
 * Konverzácie prežijú navigáciu aj reload (dock je globálny, D-056).
 * Viac oddelených vlákien, aby dlhá história nekazila kontext nesúvisiacich
 * dotazov — do `/api/ask` ide vždy len história aktívnej konverzácie.
 */
const CHATS_STORAGE_KEY = "aim-ask-chats";
/** Pôvodný jednovláknový kľúč — migruje sa do prvej konverzácie. */
const LEGACY_TURNS_KEY = "aim-ask-turns";
const MAX_CHATS = 10;
const MAX_TURNS = 30;

interface ChatSession {
  id: string;
  title: string | null;
  turns: ChatTurn[];
  updatedAt: number;
}

interface ChatsState {
  chats: ChatSession[];
  activeId: string;
}

function createChat(): ChatSession {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return { id, title: null, turns: [], updatedAt: Date.now() };
}

/** Názov konverzácie = prvá otázka (skrátená). */
function chatTitle(turns: ChatTurn[]): string | null {
  const first = turns.find((t) => t.role === "user")?.content.trim();
  if (!first) return null;
  return first.length > 48 ? `${first.slice(0, 48)}…` : first;
}

function loadStoredChats(): ChatsState {
  const fresh = () => {
    const chat = createChat();
    return { chats: [chat], activeId: chat.id };
  };
  if (typeof window === "undefined") return fresh();
  try {
    const raw = window.sessionStorage.getItem(CHATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatsState;
      if (Array.isArray(parsed?.chats) && parsed.chats.length > 0) {
        const activeId = parsed.chats.some((c) => c.id === parsed.activeId)
          ? parsed.activeId
          : parsed.chats[0].id;
        return { chats: parsed.chats, activeId };
      }
    }
    // Migrácia pôvodného jedného vlákna (aim-ask-turns).
    const legacy = window.sessionStorage.getItem(LEGACY_TURNS_KEY);
    if (legacy) {
      window.sessionStorage.removeItem(LEGACY_TURNS_KEY);
      const turns = JSON.parse(legacy) as ChatTurn[];
      if (Array.isArray(turns) && turns.length > 0) {
        const chat = { ...createChat(), turns, title: chatTitle(turns) };
        return { chats: [chat], activeId: chat.id };
      }
    }
  } catch {
    // nevalidné storage → čerstvá konverzácia
  }
  return fresh();
}

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
  const actions = turn.actions ?? [];
  if (sources.length === 0 && trace.length === 0 && actions.length === 0) return null;

  const { primary, rest } = splitSources(sources, turn.content);
  const visible = showAll ? [...primary, ...rest] : primary;

  return (
    <div className="mt-2 space-y-1.5">
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {actions.map((a, i) => (
            <Link
              key={i}
              href={a.url}
              prefetch={false}
              className="inline-flex items-center gap-1 rounded-md border bg-primary/10 px-2 py-0.5 text-xs font-medium hover:bg-primary/20"
            >
              <ArrowUpRight className="size-3" />
              {a.label}
            </Link>
          ))}
        </div>
      )}
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
  const router = useRouter();
  const [{ chats, activeId }, setChats] = useState<ChatsState>(loadStoredChats);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [unconfigured, setUnconfigured] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = chats.find((c) => c.id === activeId) ?? chats[0];
  const turns = active.turns;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        CHATS_STORAGE_KEY,
        JSON.stringify({
          activeId,
          chats: chats.map((c) => ({ ...c, turns: c.turns.slice(-MAX_TURNS) })),
        })
      );
    } catch {
      // plné/nedostupné storage vlákno neláme
    }
  }, [chats, activeId]);

  // Prepnutie konverzácie → skok na koniec vlákna.
  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [activeId]);

  /** Zapíše vlákno konkrétnej konverzácie (id fixné — prepnutie počas fetchu nevadí). */
  const setChatTurns = (chatId: string, nextTurns: ChatTurn[]) => {
    setChats((s) => ({
      ...s,
      chats: s.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              turns: nextTurns,
              // Rollback na prázdno (503) zruší aj názov z odvolanej otázky.
              title: nextTurns.length === 0 ? null : (c.title ?? chatTitle(nextTurns)),
              updatedAt: Date.now(),
            }
          : c
      ),
    }));
  };

  const startNewChat = () => {
    setChats((s) => {
      // Prázdna aktívna konverzácia sa recykluje namiesto duplicity.
      const current = s.chats.find((c) => c.id === s.activeId);
      if (current && current.turns.length === 0) return s;
      const chat = createChat();
      return { chats: [chat, ...s.chats].slice(0, MAX_CHATS), activeId: chat.id };
    });
  };

  const deleteActiveChat = () => {
    setChats((s) => {
      const rest = s.chats.filter((c) => c.id !== s.activeId);
      if (rest.length === 0) {
        const chat = createChat();
        return { chats: [chat], activeId: chat.id };
      }
      return { chats: rest, activeId: rest[0].id };
    });
  };

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    const chatId = active.id;
    const history = [...turns, { role: "user" as const, content: question }];
    setChatTurns(chatId, history);
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
        actions?: AskUiAction[];
        error?: string;
        configured?: boolean;
      };

      if (res.status === 503 && data.configured === false) {
        setUnconfigured(data.error ?? "LLM rozhranie nie je nakonfigurované.");
        setChatTurns(chatId, history.slice(0, -1));
        return;
      }
      if (!res.ok || !data.answer) {
        setChatTurns(chatId, [
          ...history,
          {
            role: "assistant",
            content: data.error ?? "Spracovanie otázky zlyhalo. Skús to znova.",
            error: true,
          },
        ]);
        return;
      }
      setChatTurns(chatId, [
        ...history,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources,
          trace: data.trace,
          actions: data.actions,
        },
      ]);
      // UI akcia zo servera (show_in_3d…) — dock ostáva, naviguje sa pod ním.
      const nav = (data.actions ?? []).find((a) => a.type === "navigate");
      if (nav) router.push(nav.url);
    } catch {
      setChatTurns(chatId, [
        ...history,
        { role: "assistant", content: "Sieťová chyba — skús to znova.", error: true },
      ]);
    } finally {
      setPending(false);
      queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
        <select
          value={active.id}
          onChange={(e) => setChats((s) => ({ ...s, activeId: e.target.value }))}
          className="h-7 min-w-0 flex-1 truncate rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Konverzácia"
        >
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? "Nová konverzácia"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={startNewChat}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Nová konverzácia"
          aria-label="Nová konverzácia"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={deleteActiveChat}
          disabled={pending}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
          title="Zmazať konverzáciu"
          aria-label="Zmazať konverzáciu"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
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
