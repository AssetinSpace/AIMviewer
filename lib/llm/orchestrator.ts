import "server-only";

import type {
  AskResult,
  ChatMessage,
  Citation,
  LlmProvider,
  ToolCall,
} from "@/lib/llm/types";
import { getLlmProvider } from "@/lib/llm/provider";
import { buildSystemPrompt } from "@/lib/llm/system-prompt";
import { TOOL_SPECS, dispatchTool, type ToolResult } from "@/lib/llm/tools";

/**
 * Provider-neutrálny tool-calling loop (D-050). Riadi konverzáciu: zavolaj model
 * → ak žiada nástroje, spusti ich a vráť výsledky → opakuj do finálnej odpovede.
 * Nástroje aj citácie sú provider-nezávislé; adaptér rieši len jednu otáčku.
 */

/** Poistka proti nekonečnému cyklu tool-callov. */
const MAX_STEPS = 6;

/** Dedupe citácií podľa id — poradie prvého výskytu. */
function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Voliteľná dependency injection — default sú reálny provider a nástroje. Injekcia
 * slúži na testovanie loopu bez externého API/DB (guardrail: interné, nie public API).
 */
export interface RunAskDeps {
  provider?: LlmProvider;
  dispatch?: (call: ToolCall) => Promise<ToolResult>;
}

export async function runAsk(
  question: string,
  contextObjectId?: string,
  deps: RunAskDeps = {}
): Promise<AskResult> {
  const provider = deps.provider ?? getLlmProvider();
  const dispatch = deps.dispatch ?? dispatchTool;

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(contextObjectId) },
    { role: "user", content: question },
  ];
  const citations: Citation[] = [];
  let steps = 0;

  for (let i = 0; i < MAX_STEPS; i++) {
    steps++;
    const turn = await provider.turn(messages, TOOL_SPECS);

    // Model dokončil — bez ďalších nástrojov.
    if (turn.toolCalls.length === 0) {
      return {
        answer: turn.text.trim(),
        citations: dedupeCitations(citations),
        meta: { provider: provider.name, model: provider.model, steps },
      };
    }

    // Model žiada nástroje — zaznač jeho turn a spusti ich.
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

    const results = await Promise.all(turn.toolCalls.map((call) => dispatch(call)));
    turn.toolCalls.forEach((call, idx) => {
      const result = results[idx];
      citations.push(...result.citations);
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result.forModel),
      });
    });
  }

  // Vyčerpaný limit krokov — vynúť finálnu odpoveď bez nástrojov.
  const final = await provider.turn(
    [
      ...messages,
      {
        role: "user",
        content:
          "Zhrň odpoveď z doteraz získaných dát. Ak dáta nestačia, povedz to. Už nevolaj nástroje.",
      },
    ],
    []
  );

  return {
    answer: final.text.trim(),
    citations: dedupeCitations(citations),
    meta: { provider: provider.name, model: provider.model, steps },
  };
}
