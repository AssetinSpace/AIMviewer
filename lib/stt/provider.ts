import "server-only";

/**
 * Provider vrstva hlasového prepisu (STT, D-069). Zrkadlí `lib/llm/provider.ts`:
 * neutrálne rozhranie, konkrétna služba sa vyberá cez env (`STT_PROVIDER`,
 * `STT_MODEL`). Server-only — API kľúč nikdy neopustí server (línia D-026).
 * Ďalšie služby (OpenAI gpt-4o-transcribe, Deepgram…) sa dopĺňajú aditívne
 * ako nové case-y bez zmeny UI.
 */

export interface SttRequest {
  /** Surové audio dáta nahrávky. */
  audio: Uint8Array;
  /** MIME typ nahrávky (audio/webm, audio/mp4…). */
  mimeType: string;
}

export interface SttProvider {
  /** Identifikátor pre trace/log (napr. 'gemini:gemini-flash-lite-latest'). */
  id: string;
  /** Doslovný prepis nahrávky; prázdny string = žiadna zrozumiteľná reč. */
  transcribe(req: SttRequest): Promise<string>;
}

/** Chyba konfigurácie (chýbajúci kľúč…) — API ju mapuje na 503 s návodom. */
export class SttConfigError extends Error {}

/** Bez explicitného STT_PROVIDER sa provider odvodí z dostupného kľúča. */
function detectProvider(): string {
  if (process.env.GEMINI_API_KEY) return "gemini";
  throw new SttConfigError(
    "Hlasový prepis nie je nakonfigurovaný — doplň GEMINI_API_KEY do " +
      ".env.local (lokálne) / Vercel env (deploy)."
  );
}

export async function getSttProvider(): Promise<SttProvider> {
  // `||`, nie `??` — prázdna env hodnota znamená „nenastavené".
  const provider = process.env.STT_PROVIDER || detectProvider();
  switch (provider) {
    case "gemini": {
      const { createGeminiSttProvider } = await import("./gemini");
      return createGeminiSttProvider();
    }
    case "mock": {
      const { createMockSttProvider } = await import("./mock");
      return createMockSttProvider();
    }
    default:
      throw new SttConfigError(
        `Neznámy STT_PROVIDER '${provider}' — podporované: gemini, mock.`
      );
  }
}
