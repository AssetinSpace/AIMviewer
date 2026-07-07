import { NextRequest, NextResponse } from "next/server";

import { runAsk } from "@/lib/llm/orchestrator";

/**
 * S-LLM endpoint (D-056): prirodzený jazyk nad grafom + trust loop.
 *
 * POST { question: string, contextObjectId?: string }
 *   → { answer: string, citations: Citation[], meta }
 *
 * Server-only — LLM kľúč (LLM_API_KEY) sa nikdy nedostane do prehliadača (D-025/D-026).
 * Guardraily (read-only nástroje, whitelist, row limit) sú v LLM/data vrstve (D-056).
 */

// Model beží dynamicky (volanie externého API), bez cache.
export const dynamic = "force-dynamic";

interface AskBody {
  question?: unknown;
  contextObjectId?: unknown;
}

export async function POST(req: NextRequest) {
  let body: AskBody;
  try {
    body = (await req.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON telo requestu." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  const contextObjectId =
    typeof body.contextObjectId === "string" && body.contextObjectId.trim()
      ? body.contextObjectId.trim()
      : undefined;

  if (!question) {
    return NextResponse.json({ error: "Chýba 'question'." }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "Otázka je príliš dlhá (max 1000 znakov)." }, { status: 400 });
  }

  try {
    const result = await runAsk(question, contextObjectId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chyba servera.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
