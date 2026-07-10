import { NextResponse } from "next/server";

import {
  getLlmProvider,
  LlmConfigError,
  type LlmMessage,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
} from "@/lib/llm/provider";
import { AskToolRuntime, TOOL_DEFINITIONS } from "@/lib/llm/tools";

/**
 * LLM rozhranie nad grafom (D-056, F6): agentická tool-calling slučka nad
 * whitelistovanými views. Read-only, row-capy v tools, max počet kôl — model
 * nemá priamy prístup k SQL ani k zápisu. Zdroje (trust loop) zbiera server
 * deterministicky z tool výsledkov; UI z nich renderuje deep-linky.
 */

/** Max kôl tool-callov na jednu otázku (ochrana nákladov aj slučiek). */
const MAX_TOOL_ROUNDS = 8;
/** Max tokenov odpovede modelu. */
const MAX_TOKENS = 1500;
/** Koľko posledných správ histórie posielame modelu. */
const MAX_HISTORY = 20;
/** Max dĺžka jednej user správy. */
const MAX_INPUT_CHARS = 2000;

export const maxDuration = 60;

const SYSTEM_PROMPT = `Si asistent AIM Viewera — Asset Information Model platformy pre správu
informácií o stavbách. Odpovedáš na otázky o konkrétnej budove nad grafom v databáze:
uzly (objects: site, building, floor, space, asset, asset_type, system, document, person,
organization) a IFC-kanonické vzťahy (rel_* views). Identita prvkov: object_ref = ľudsky
čitateľný SNIM kód (napr. DD01.06.03), IFC GUID spája dáta s 3D modelom.

Pravidlá:
- Na fakty VŽDY použi tools — nič si nedomýšľaj a nevzdávaj sa po prvom prázdnom
  výsledku. Preformuluj filtre, over slovník cez get_model_stats, skús synonymá —
  „nenašiel som" povedz až po vyčerpaní možností.
- Ak tool vráti CHYBU, výsledok si NIKDY nevymýšľaj — oznám, že dáta sa nepodarilo
  načítať. Čísla a fakty smú pochádzať len z úspešných tool výsledkov.
- Cituj object_ref (prípadne názov) každého prvku, o ktorom hovoríš.
- Odpovedaj v jazyku otázky (default slovenčina), stručne a vecne.

IFC typológia a doménové pojmy:
- ifc_type = IFC trieda (IfcDoor, IfcUnitaryEquipment, IfcDuctSegment…),
  predefined_type = enum podtypu (AIRCONDITIONINGUNIT, VAV, ISOLATING…). Podtyp
  spomenutý používateľom filtruj cez predefined_type, nie ifc_type.
- Používateľ hovorí jazykom profesie, preklad na IFC urob sám. Príklady: VZT/
  vzduchotechnická jednotka → IfcUnitaryEquipment (AIRCONDITIONINGUNIT/AIRHANDLER);
  potrubie → IfcDuctSegment/IfcPipeSegment; vyústka → IfcAirTerminal; ventilátor →
  IfcFan; ventil → IfcValve; dvere → IfcDoor; stena → IfcWall. Ak si nie si istý,
  get_model_stats vráti presný slovník tried modelu s počtami.

Postup podľa typu otázky:
- „koľko X a kde/na akých podlažiach" → locate_objects (presný počet + rozpad po
  podlažiach na jeden call). Len počet → count_objects.
- Súčty/priemery/min/max nad hodnotami psetov a KAŽDÉ číselné porovnanie hodnoty
  psetu (výkon > 5, plocha < 20…) → aggregate_objects — počíta databáza. NIKDY
  nepočítaj súčty z riadkov query_view/search (sú orezané row-capom) a NIKDY
  neporovnávaj čísla psetov cez query_view (porovnáva text).
- Konkrétny prvok → search_objects/get_object → get_asset_details / get_spatial_path /
  find_in_drawings / list_relations.
- Hľadanie podľa OBSAHU vlastností (výrobca, materiál, sériové číslo, ľubovoľné
  kľúčové slovo z panelu vlastností) → search_everything (fulltext nad všetkými
  psetmi vrátane custom, toleruje diakritiku aj preklepy; skús aj anglický
  ekvivalent — kľúče psetov bývajú anglické). Vráti matched_properties = kde match
  nastal; kandidátov over cez get_asset_details a v odpovedi cituj konkrétnu
  hodnotu psetu ako dôkaz. Záver z fuzzy zhody formuluj ako odvodenie s dôkazom,
  nie ako istotu.
- Systémy (VZT vetvy, ÚK…): uzly object_type='system', členstvo cez rel_assigns_to_group
  (smer člen→systém); rel_contained_in_spatial_structure = prvok v priestore/podlaží;
  rel_aggregates = dekompozícia štruktúry; rel_assigns_to_actor = zodpovednosť.
- Otázky na vlastnosti/psety: NAJPRV query_view relation=v_property_dictionary
  (slovník psetov z reálnych dát — pset, property, typ hodnoty, vzorky, vrátane
  custom psetov; filtruj podľa ifc_type) → presná cesta properties->Pset->>Key,
  až potom filter/detail. Nikdy nehádaj názvy psetov ani properties.
- Čokoľvek, na čo špecializovaný tool nie je (psety, klasifikácie, dokumenty, história
  GUID, manifest hrán…) → query_view: read-only dopyt nad ľubovoľnou tabuľkou/view
  vrátane JSONB ciest do properties; join nahraď reťazením dopytov cez op 'in'.
- UI akcie: keď používateľ žiada niečo ZOBRAZIŤ/UKÁZAŤ/OTVORIŤ („ukáž v 3D", „otvor
  výkres", „otvor kartu"), po nájdení prvku zavolaj show_in_3d / open_drawing /
  open_node — rozhranie hneď naviguje. V odpovedi len stručne potvrď, čo sa otvorilo.

- Odpoveď je čistý text bez markdown formátovania (žiadne **, #, tabuľky).`;

interface AskRequestBody {
  messages?: { role?: string; content?: string }[];
}

export async function POST(req: Request) {
  let body: AskRequestBody;
  try {
    body = (await req.json()) as AskRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Validácia histórie: striedavé user/assistant TEXTY od klienta; tool bloky
  // žijú len server-side v rámci jednej požiadavky (klient ich nikdy neposiela).
  const history = (body.messages ?? [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.content.slice(0, MAX_INPUT_CHARS) } as TextBlock],
    })) satisfies LlmMessage[];

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "posledná správa musí byť od používateľa" },
      { status: 400 }
    );
  }

  let provider;
  try {
    provider = await getLlmProvider();
  } catch (err) {
    if (err instanceof LlmConfigError) {
      return NextResponse.json({ error: err.message, configured: false }, { status: 503 });
    }
    throw err;
  }

  const runtime = new AskToolRuntime();
  const messages: LlmMessage[] = [...history];

  try {
    let answer = "";
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await provider.complete({
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFINITIONS,
        maxTokens: MAX_TOKENS,
      });

      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const texts = res.content.filter((b): b is TextBlock => b.type === "text");
      answer = texts.map((t) => t.text).join("\n").trim() || answer;

      if (res.stopReason !== "tool_use" || toolUses.length === 0) break;

      // Posledné kolo: tool výsledky už neposielame, ostáva posledná textová odpoveď.
      if (round === MAX_TOOL_ROUNDS) break;

      messages.push({ role: "assistant", content: res.content });
      const results: ToolResultBlock[] = [];
      for (const tu of toolUses) {
        const out = await runtime.exec(tu.name, tu.input);
        results.push({
          type: "tool_result",
          toolUseId: tu.id,
          content: out.content,
          isError: out.isError || undefined,
        });
      }
      messages.push({ role: "user", content: results });
    }

    // Poistka proti konfabulácii: keď VŠETKY tool cally zlyhali, model nemá
    // žiadne dáta — jeho text sa nesmie tváriť ako fakt (overené: lite modely
    // si po chybách vymyslia čísla napriek promptu).
    const allToolsFailed =
      runtime.trace.length > 0 && runtime.trace.every((t) => !t.ok);
    if (allToolsFailed) {
      return NextResponse.json({
        answer:
          "Dáta sa nepodarilo načítať (chyba pripojenia k databáze) — odpoveď " +
          "nemám z čoho podložiť. Skús to o chvíľu znova.",
        sources: [],
        trace: runtime.trace,
        provider: provider.id,
      });
    }

    const sources = await runtime.finalizeSources();
    return NextResponse.json({
      answer: answer || "Nepodarilo sa zostaviť odpoveď — skús otázku preformulovať.",
      sources,
      trace: runtime.trace,
      actions: runtime.finalActions(),
      provider: provider.id,
    });
  } catch (err) {
    console.error("[api/ask]", err);
    return NextResponse.json(
      { error: "Spracovanie otázky zlyhalo. Skús to znova." },
      { status: 500 }
    );
  }
}
