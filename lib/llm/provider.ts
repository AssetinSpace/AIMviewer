import "server-only";

/**
 * Provider vrstva LLM rozhrania (D-056, F6). API-pluggable: neutrálne typy správ
 * a tool-callov, konkrétny model sa vyberá cez env (`LLM_PROVIDER`, `LLM_MODEL`).
 * Server-only — API kľúč nikdy neopustí server (rovnaká línia ako D-026).
 */

/** Textový blok odpovede modelu. */
export interface TextBlock {
  type: "text";
  text: string;
}

/** Model žiada zavolať tool s argumentami. */
export interface ToolUseBlock {
  type: "tool_use";
  /** Provider-špecifické ID callu — vracia sa v tool_result. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Výsledok toolu, ktorý posielame späť modelu. */
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  /** JSON-serializovaný výsledok (alebo chybová hláška). */
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LlmMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** JSON Schema definícia toolu (subset postačujúci pre naše tools). */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface LlmResponse {
  content: (TextBlock | ToolUseBlock)[];
  /** 'tool_use' → treba vykonať tools a pokračovať v slučke. */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
}

export interface LlmProvider {
  /** Identifikátor pre trace/log (napr. 'anthropic:claude-sonnet-5'). */
  id: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Chyba konfigurácie (chýbajúci kľúč…) — API ju mapuje na 503 s návodom. */
export class LlmConfigError extends Error {}

export async function getLlmProvider(): Promise<LlmProvider> {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  switch (provider) {
    case "anthropic": {
      const { createAnthropicProvider } = await import("./anthropic");
      return createAnthropicProvider();
    }
    case "mock": {
      const { createMockProvider } = await import("./mock");
      return createMockProvider();
    }
    default:
      throw new LlmConfigError(
        `Neznámy LLM_PROVIDER '${provider}' — podporované: anthropic, mock.`
      );
  }
}
