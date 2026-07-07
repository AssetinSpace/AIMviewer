import "server-only";

import type { LlmProvider } from "@/lib/llm/types";
import { createAnthropicProvider } from "@/lib/llm/providers/anthropic";
import { createOpenAiProvider } from "@/lib/llm/providers/openai-compat";

/**
 * Výber LLM providera podľa env (D-056). Prepnutie modelu/providera = zmena env,
 * žiadny redeploy kódu. Žiadny model-id natvrdo — chýbajúce `LLM_MODEL`/`LLM_API_KEY`
 * padne s jasnou chybou.
 *
 *   LLM_PROVIDER    anthropic | openai-compat   (default: anthropic)
 *   LLM_MODEL       id modelu (povinné)
 *   LLM_API_KEY     API kľúč (povinné)
 *   LLM_BASE_URL    override endpointu (voliteľné; default per provider)
 *   LLM_MAX_TOKENS  default 1024
 *   LLM_TEMPERATURE default 0 (deterministickejší text-to-query)
 */

const DEFAULT_BASE_URL: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  "openai-compat": "https://api.openai.com/v1",
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getLlmProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? "anthropic").trim();
  const model = process.env.LLM_MODEL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL[provider] || "").replace(
    /\/$/,
    ""
  );
  const maxTokens = num("LLM_MAX_TOKENS", 1024);
  const temperature = num("LLM_TEMPERATURE", 0);

  if (!model) {
    throw new Error("Chýba env premenná LLM_MODEL (id modelu). Doplň ju do .env.local / Vercel env.");
  }
  if (!apiKey) {
    throw new Error("Chýba env premenná LLM_API_KEY. Doplň ju do .env.local / Vercel env.");
  }
  if (!baseUrl) {
    throw new Error(
      `Neznámy LLM_PROVIDER="${provider}". Použi 'anthropic' alebo 'openai-compat', ` +
        "prípadne nastav LLM_BASE_URL na vlastný endpoint."
    );
  }

  const common = { apiKey, model, baseUrl, maxTokens, temperature };

  switch (provider) {
    case "anthropic":
      return createAnthropicProvider(common);
    case "openai-compat":
      return createOpenAiProvider(common);
    default:
      // Neznámy provider s explicitným base URL → predpokladáme OpenAI-kompatibilný.
      return createOpenAiProvider(common);
  }
}
