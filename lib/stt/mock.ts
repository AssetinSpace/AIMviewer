import "server-only";

import type { SttProvider, SttRequest } from "./provider";

/**
 * Deterministický mock STT (D-069) — celá cesta mikrofón → /api/transcribe →
 * vloženie prepisu do inputu sa dá overiť bez API kľúča aj bez siete
 * (devtest/e2e, verify skill). Zapína sa cez `STT_PROVIDER=mock`.
 */
export function createMockSttProvider(): SttProvider {
  return {
    id: "mock",
    async transcribe(req: SttRequest): Promise<string> {
      return `Koľko VZT jednotiek je v budove? (mock prepis, ${req.audio.byteLength} B ${req.mimeType})`;
    },
  };
}
