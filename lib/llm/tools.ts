import "server-only";

import type { Citation, ToolCall, ToolSpec } from "@/lib/llm/types";
import {
  resolveObjects,
  getObjectSummary,
  findElementSystems,
  listSystemElements,
  type ObjectMatch,
  type SystemElement,
} from "@/lib/data/systems";

/**
 * Whitelistovaná sada grafových nástrojov pre S-LLM (D-050). Každý nástroj je
 * tenký, read-only wrapper nad `lib/data/*`. Guardraily (read-only, row limit)
 * sú v data-vrstve; model nikdy neskladá dotaz, len vyberá nástroj + argumenty.
 *
 * `dispatchTool` vracia dva výstupy:
 *  - `forModel` — JSON-friendly dáta, ktoré dostane model späť,
 *  - `citations` — dohľadateľné objekty pre trust loop (skladá orchestrátor).
 */

/** Odkaz na kartu uzla vo Vieweri. */
function nodeHref(id: string): string {
  return `/node/${id}`;
}

/** Citácia z opisu objektu (`ObjectMatch`). */
function citeMatch(m: ObjectMatch): Citation {
  return {
    id: m.id,
    label: m.objectRef ?? m.name ?? m.id,
    objectType: m.objectType,
    nodeHref: nodeHref(m.id),
    focusGuid: m.ifcGuid,
  };
}

/** Citácia z člena systému (`SystemElement`). */
function citeElement(e: SystemElement): Citation {
  return {
    id: e.id,
    label: e.objectRef ?? e.name ?? e.id,
    objectType: null,
    nodeHref: nodeHref(e.id),
    focusGuid: e.ifcGuid,
  };
}

/** Definície nástrojov (JSON schema) — prenosné naprieč providermi. */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "resolve_object",
    description:
      "Nájde objekty (prvky, systémy, podlažia, priestory, typy) podľa voľného textu — " +
      "zhoda na kód (object_ref) alebo názov. Použi na naviazanie prvku/systému z otázky, " +
      "keď nemáš jeho id. Vracia kandidátov s id, ktoré ďalej použiješ v iných nástrojoch.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Hľadaný kód alebo názov, napr. 'DD01.06' alebo 'Prívod 2NP' alebo 'ventilátor'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "find_element_systems",
    description:
      "Pre daný prvok vráti distribučné systémy, ktorých je členom, a jeho priestorové " +
      "umiestnenie (priamy kontajner + podlažie). Odpovedá na 'ktorý systém obsluhuje tento " +
      "prvok a na akom podlaží'.",
    parameters: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "id prvku (z resolve_object alebo z kontextu)." },
      },
      required: ["object_id"],
    },
  },
  {
    name: "list_system_elements",
    description:
      "Vypíše členov distribučného systému (prvky priradené cez rel_assigns_to_group), " +
      "s typom (ifc_type) a polohou. Odpovedá na 'aké prvky obsahuje systém X'.",
    parameters: {
      type: "object",
      properties: {
        system_id: { type: "string", description: "id systému (z resolve_object)." },
      },
      required: ["system_id"],
    },
  },
  {
    name: "get_object_summary",
    description:
      "Základné údaje o objekte podľa id: typ objektu, IFC typ, predefined type, kód a názov. " +
      "Použi na overenie, čo je daný objekt zač.",
    parameters: {
      type: "object",
      properties: {
        object_id: { type: "string", description: "id objektu." },
      },
      required: ["object_id"],
    },
  },
];

export interface ToolResult {
  /** Dáta, ktoré dostane model späť (JSON-serializovateľné). */
  forModel: unknown;
  /** Dohľadateľné objekty pre trust loop. */
  citations: Citation[];
}

/** Spustí jeden nástroj podľa mena. Neznáme meno / zlé argumenty → chybová správa pre model. */
export async function dispatchTool(call: ToolCall): Promise<ToolResult> {
  const args = call.args ?? {};
  try {
    switch (call.name) {
      case "resolve_object": {
        const query = String(args.query ?? "");
        const matches = await resolveObjects(query);
        return {
          forModel: {
            matches: matches.map((m) => ({
              id: m.id,
              object_type: m.objectType,
              object_ref: m.objectRef,
              name: m.name,
              ifc_type: m.ifcType,
              predefined_type: m.predefinedType,
            })),
          },
          citations: matches.map(citeMatch),
        };
      }

      case "find_element_systems": {
        const objectId = String(args.object_id ?? "");
        const { element, systems, context } = await findElementSystems(objectId);
        const citations: Citation[] = [];
        if (element) citations.push(citeMatch(element));
        for (const s of systems)
          citations.push({
            id: s.id,
            label: s.name ?? s.objectRef ?? s.id,
            objectType: "system",
            nodeHref: nodeHref(s.id),
            focusGuid: null,
          });
        return {
          forModel: {
            element: element
              ? { object_ref: element.objectRef, name: element.name, ifc_type: element.ifcType }
              : null,
            systems: systems.map((s) => ({
              id: s.id,
              name: s.name,
              predefined_type: s.predefinedType,
            })),
            location: {
              container: context.containerName,
              container_type: context.containerType,
              floor: context.floorName,
            },
          },
          citations,
        };
      }

      case "list_system_elements": {
        const systemId = String(args.system_id ?? "");
        const { system, elements, total } = await listSystemElements(systemId);
        const citations: Citation[] = [];
        if (system) citations.push(citeMatch(system));
        for (const e of elements) citations.push(citeElement(e));
        return {
          forModel: {
            system: system ? { name: system.name, predefined_type: system.predefinedType } : null,
            total,
            returned: elements.length,
            elements: elements.map((e) => ({
              id: e.id,
              object_ref: e.objectRef,
              name: e.name,
              ifc_type: e.ifcType,
              location: e.location,
            })),
          },
          citations,
        };
      }

      case "get_object_summary": {
        const objectId = String(args.object_id ?? "");
        const m = await getObjectSummary(objectId);
        return {
          forModel: m
            ? {
                object_type: m.objectType,
                object_ref: m.objectRef,
                name: m.name,
                ifc_type: m.ifcType,
                predefined_type: m.predefinedType,
              }
            : null,
          citations: m ? [citeMatch(m)] : [],
        };
      }

      default:
        return { forModel: { error: `Neznámy nástroj: ${call.name}` }, citations: [] };
    }
  } catch (err) {
    return {
      forModel: { error: err instanceof Error ? err.message : "Chyba pri spustení nástroja" },
      citations: [],
    };
  }
}
