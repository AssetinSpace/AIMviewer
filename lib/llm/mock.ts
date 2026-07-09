import "server-only";

import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";

/**
 * Deterministický mock provider (D-056) — celá agentická slučka `/api/ask`
 * (tool-calling, zber zdrojov, error path) sa dá overiť bez API kľúča aj bez
 * siete (devtest/e2e, verify skill). Zapína sa cez `LLM_PROVIDER=mock`.
 *
 * Správanie: na prvý user vstup zavolá `search_objects` s textom otázky;
 * po tool výsledku odpovie textom (vrátane chybového výsledku — overuje, že
 * slučka prežije výpadok DB). Vstup s prefixom `notool:` odpovie priamo.
 */
export function createMockProvider(): LlmProvider {
  return {
    id: "mock",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const last = req.messages[req.messages.length - 1];

      const lastToolResult = last?.content.find((b) => b.type === "tool_result");
      if (lastToolResult) {
        const status = lastToolResult.isError ? "s chybou" : "úspešne";
        return {
          content: [
            {
              type: "text",
              text:
                `Mock odpoveď: tool dobehol ${status}. ` +
                `Výsledok (skrátený): ${lastToolResult.content.slice(0, 200)}`,
            },
          ],
          stopReason: "end_turn",
        };
      }

      const lastText =
        last?.content.find((b) => b.type === "text")?.text ?? "";
      if (lastText.startsWith("notool:")) {
        return {
          content: [
            { type: "text", text: `Mock odpoveď bez toolu: ${lastText.slice(7).trim()}` },
          ],
          stopReason: "end_turn",
        };
      }

      return {
        content: [
          { type: "text", text: "Hľadám v grafe…" },
          {
            type: "tool_use",
            id: "mock-tool-1",
            name: "search_objects",
            input: { query: lastText.slice(0, 80), limit: 5 },
          },
        ],
        stopReason: "tool_use",
      };
    },
  };
}
