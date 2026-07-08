import { NextRequest, NextResponse } from "next/server";

import { runChat, LlmNotConfiguredError } from "@/lib/llm/agent";
import type { ChatMessage } from "@/lib/llm/types";

/**
 * LLM rozhranie nad grafom (F6, D-056): POST { messages } → { reply, sources }.
 * Guardraily žijú vo vrstve tools (whitelist, row-limit, read-only); tu len
 * validácia vstupu. Bez cache — každá otázka je živý dotaz.
 */

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

function parseMessages(body: unknown): ChatMessage[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) {
    return null;
  }
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      content.length === 0 ||
      content.length > MAX_MESSAGE_CHARS
    ) {
      return null;
    }
    messages.push({ role, content });
  }
  if (messages[0].role !== "user") return null;
  return messages;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Neplatný JSON" }, { status: 400 });
  }

  const messages = parseMessages(body);
  if (!messages) {
    return NextResponse.json(
      { error: "Očakávam { messages: [{ role, content }] }, prvá správa user." },
      { status: 400 }
    );
  }

  try {
    const result = await runChat(messages);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
