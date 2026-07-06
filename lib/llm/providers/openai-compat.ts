import "server-only";

import type {
  ChatMessage,
  LlmProvider,
  ProviderTurn,
  ToolCall,
  ToolSpec,
} from "@/lib/llm/types";

/**
 * Adaptér pre OpenAI-kompatibilné Chat Completions API (`/chat/completions`) — D-050.
 *
 * Univerzálny hook na „barsaký" model: cez `LLM_BASE_URL` obslúži OpenAI, OpenRouter,
 * Groq, Together, DeepSeek, lokálne vLLM / Ollama (`/v1`) / LM Studio — všetky
 * hovoria týmto protokolom. Bez npm SDK — priamy `fetch`. `server-only`.
 */

interface OpenAiConfig {
  apiKey: string;
  model: string;
  /** Napr. https://api.openai.com/v1 alebo http://localhost:11434/v1. */
  baseUrl: string;
  maxTokens: number;
  temperature: number;
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/** Preloží neutrálne správy na OpenAI messages. */
function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant") {
      const out: OpenAiMessage = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      return out;
    }
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }
    // system / user
    return { role: m.role, content: m.content };
  });
}

/** Bezpečne rozparsuje argumenty tool callu (niektoré modely vrátia prázdny string). */
function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createOpenAiProvider(cfg: OpenAiConfig): LlmProvider {
  return {
    name: "openai-compat",
    model: cfg.model,

    async turn(messages: ChatMessage[], tools: ToolSpec[]): Promise<ProviderTurn> {
      const body = {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        messages: toOpenAiMessages(messages),
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: "auto",
      };

      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`LLM API ${res.status}: ${detail.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        choices?: {
          message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
          finish_reason?: string;
        }[];
      };

      const choice = data.choices?.[0];
      const msg = choice?.message;
      const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: parseArgs(tc.function.arguments),
      }));

      return {
        text: msg?.content ?? "",
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool" : "stop",
      };
    },
  };
}
