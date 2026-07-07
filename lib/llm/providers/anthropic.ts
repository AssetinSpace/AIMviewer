import "server-only";

import type {
  ChatMessage,
  LlmProvider,
  ProviderTurn,
  ToolCall,
  ToolSpec,
} from "@/lib/llm/types";

/**
 * Adaptér pre Anthropic Messages API (`/v1/messages`) — D-056.
 *
 * Mapuje neutrálne správy na Anthropic tvar (tool_use / tool_result bloky) a späť.
 * Bez npm SDK — priamy `fetch`, aby vrstva zostala bez závislostí a vymeniteľná.
 * Kľúč sa číta zo servera; tento modul je `server-only`.
 */

interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  temperature: number;
}

// Anthropic content bloky (len tie, ktoré používame).
type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

/**
 * Preloží neutrálne správy na Anthropic messages. `system` ide mimo poľa.
 * Po sebe idúce `tool` výsledky sa zlúčia do jedného `user` turnu (Anthropic
 * očakáva tool_result v user správe, viac výsledkov v jednej).
 */
function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  msgs: AnthropicMessage[];
} {
  let system = "";
  const msgs: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }

    if (m.role === "user") {
      msgs.push({ role: "user", content: [{ type: "text", text: m.content }] });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? [])
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      msgs.push({ role: "assistant", content: blocks });
      continue;
    }

    // role === "tool" — zlúč do predošlého user turnu, ak je posledný user.
    const block: AnthropicBlock = {
      type: "tool_result",
      tool_use_id: m.toolCallId ?? "",
      content: m.content,
    };
    const last = msgs[msgs.length - 1];
    if (last && last.role === "user") last.content.push(block);
    else msgs.push({ role: "user", content: [block] });
  }

  return { system, msgs };
}

export function createAnthropicProvider(cfg: AnthropicConfig): LlmProvider {
  return {
    name: "anthropic",
    model: cfg.model,

    async turn(messages: ChatMessage[], tools: ToolSpec[]): Promise<ProviderTurn> {
      const { system, msgs } = toAnthropicMessages(messages);

      const body = {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        system,
        messages: msgs,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      };

      const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        content?: AnthropicBlock[];
        stop_reason?: string;
      };

      let text = "";
      const toolCalls: ToolCall[] = [];
      for (const block of data.content ?? []) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use")
          toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
      }

      return {
        text,
        toolCalls,
        stopReason: data.stop_reason === "tool_use" ? "tool" : "stop",
      };
    },
  };
}
