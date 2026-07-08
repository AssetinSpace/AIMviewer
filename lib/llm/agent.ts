import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  TOOL_DEFINITIONS,
  executeTool,
  SourceCollector,
} from "@/lib/llm/tools";
import type { ChatMessage, ChatResponse } from "@/lib/llm/types";

/**
 * Agentická slučka LLM rozhrania (F6, D-056): tool-calling nad whitelistom
 * (lib/llm/tools.ts), API-pluggable model — výmena modelu je env var
 * (`AIM_LLM_MODEL`), výmena providera je izolovaná v tomto module.
 *
 * Server-only: `ANTHROPIC_API_KEY` sa nikdy nedostane do prehliadača (D-026 línia).
 */

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_ITERATIONS = 8;
const MAX_TOKENS = 16000;

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmNotConfiguredError(
      "Chýba ANTHROPIC_API_KEY — doplň do .env.local / Vercel env."
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

export class LlmNotConfiguredError extends Error {}

const SYSTEM_PROMPT = `Si asistent AIM Viewera — platformy pre správu informácií o stavbách. Odpovedáš na otázky nad grafom jednej administratívnej budovy (Office centrum Brno), naimportovaným z IFC modelov (ARS architektúra + VZT vzduchotechnika).

Dátový model:
- Uzly (objects): site, building, floor (1NP–5NP), space (miestnosti), asset (prvky — dvere, steny, VZT potrubie…), asset_type (typy prvkov), system (distribučné systémy VZT), document (PDF výkresy a manuály), person, organization.
- Prvky majú object_ref = SNIM kód (napr. DD01.06.03 = konkrétne dvere, DD01.06 = ich typ); MEP prvky bez SNIM majú ako ref IFC GUID.
- Hrany (IFC-kanonické): rel_contained_in_spatial_structure (prvok → miestnosť/podlažie), rel_aggregates (dekompozícia Site→Building→Floor→Space), rel_defines_by_type (occurrence → typ), rel_associates_document (uzol → dokument), rel_assigns_to_actor (aktor → zodpovednosť), rel_assigns_to_group (prvok → systém), rel_member_of (osoba → firma).

Pravidlá:
1. Odpovedaj v jazyku otázky (default slovensky), stručne a vecne, čistý text bez markdownu.
2. VŽDY najprv hľadaj v dátach cez tools — nikdy si nevymýšľaj prvky, hodnoty ani vzťahy. Ak dáta neexistujú, povedz to na rovinu.
3. Každý prvok, o ktorom hovoríš, označ jeho object_ref (a názvom) — presne tak, ako prišiel z toolu. Používateľ dostane pod odpoveďou klikateľné citácie (karta prvku, 3D model, výkres) zo skutočne prečítaných dát.
4. Priestorové otázky ("v ktorej miestnosti/podlaží") rieš cez list_related s rel_contained_in_spatial_structure; členstvo v systéme cez rel_assigns_to_group; výkresy cez get_element_drawings.
5. Vodný model (ÚK/ZTI, ventily) zatiaľ nie je naimportovaný — pri otázkach na ventily to uveď.`;

/** Spustí konverzáciu nad grafom; vráti text odpovede + citované zdroje. */
export async function runChat(history: ChatMessage[]): Promise<ChatResponse> {
  const anthropic = getClient();
  const model = process.env.AIM_LLM_MODEL ?? DEFAULT_MODEL;
  const sources = new SourceCollector();

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let response = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    tools: TOOL_DEFINITIONS,
    messages,
  });

  for (
    let i = 0;
    i < MAX_ITERATIONS && response.stop_reason === "tool_use";
    i++
  ) {
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    messages.push({ role: "assistant", content: response.content });

    // Paralelné vykonanie všetkých tool volaní z jednej odpovede; všetky
    // výsledky sa vracajú v JEDNEJ user správe (vyžaduje API).
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
        try {
          const result = await executeTool(tu.name, tu.input, sources);
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          };
        } catch (e) {
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: e instanceof Error ? e.message : "Tool zlyhal",
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: "user", content: results });

    response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
    });
  }

  const reply = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    reply: reply || "Nepodarilo sa zostaviť odpoveď — skús otázku preformulovať.",
    sources: sources.list(),
  };
}
