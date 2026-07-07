/**
 * Provider-neutrálne typy LLM vrstvy (D-056).
 *
 * Orchestrátor (`orchestrator.ts`) pracuje výhradne s týmito typmi; konkrétny
 * provider (Anthropic / OpenAI-kompatibilný) ich prekladá do svojho drôtového
 * formátu v `providers/*`. JSON-schema definície nástrojov (`ToolSpec.parameters`)
 * sú prenosné naprieč providermi — to je celá pointa vymeniteľnosti modelu.
 */

/** JSON schema objekt (parametre nástroja). Zámerne voľné — validuje ho model. */
export type JsonSchema = Record<string, unknown>;

/** Definícia nástroja, ktorý model môže zavolať. Provider-neutrálna. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema pre argumenty (`type: "object"`, `properties`, `required`). */
  parameters: JsonSchema;
}

/** Požiadavka modelu na spustenie nástroja. */
export interface ToolCall {
  /** Provider-specifické id — spája volanie s jeho výsledkom. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * Jedna správa konverzácie v neutrálnom tvare.
 * - `assistant` s `toolCalls` = model žiada nástroje.
 * - `tool` s `toolCallId` = výsledok nástroja (content = JSON string).
 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** Výsledok jednej otáčky modelu (jedno volanie providera). */
export interface ProviderTurn {
  /** Textová časť odpovede (môže byť prázdna, ak model len volá nástroje). */
  text: string;
  /** Nástroje, ktoré model chce spustiť (prázdne = hotová odpoveď). */
  toolCalls: ToolCall[];
  /** `tool` = čaká na výsledky nástrojov; `stop` = finálna odpoveď. */
  stopReason: "tool" | "stop";
}

/**
 * Adaptér konkrétneho LLM API. Jediná zodpovednosť: jedna otáčka — pošli
 * neutrálne správy + nástroje, vráť neutrálny `ProviderTurn`. Tool-calling loop
 * je nad ním v orchestrátore.
 */
export interface LlmProvider {
  /** Diagnostický názov (napr. "anthropic", "openai-compat"). */
  readonly name: string;
  /** Zvolený model (z env). */
  readonly model: string;
  turn(messages: ChatMessage[], tools: ToolSpec[]): Promise<ProviderTurn>;
}

/**
 * Dohľadateľný zdroj tvrdenia v odpovedi (trust loop, D-047). Skladá ho
 * orchestrátor z tool-výsledkov — deterministicky z dát, nie parsovaním textu.
 */
export interface Citation {
  /** `objects.id` — cieľ deep-linku. */
  id: string;
  /** Ľudský label (object_ref / name). */
  label: string;
  objectType: string | null;
  /** Odkaz na kartu uzla vo Vieweri. */
  nodeHref: string;
  /** IFC GUID pre 3D deep-link (`/ifc?focus=<guid>`); null ak prvok nemá GUID. */
  focusGuid: string | null;
}

/** Výsledok jedného behu S-LLM konverzácie — vstup pre API odpoveď. */
export interface AskResult {
  answer: string;
  citations: Citation[];
  /** Diagnostika (provider/model, počet krokov) — nezobrazuje sa používateľovi. */
  meta: {
    provider: string;
    model: string;
    steps: number;
  };
}
