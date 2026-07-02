# AIM Platform — Claude Context

## Čo budujeme
Asset Information Model platforma pre správu informácií o stavbách
počas celého životného cyklu (návrh → výstavba → prevádzka).
Demo na administratívnej budove (upravená diplomka).
Primárny use case: AIM Viewer — ukážka správne previazaných dát.

## Stack
- **Supabase** — Postgres databáza, API, auth, storage
- **Next.js** — frontend
- **Vercel** — hosting (vlastná doména cez Websupport)
- **Python + ifcopenshell** — IFC parser / ETL pipeline
- **rdflib** — RDF/ICDD export

## Kľúčové dokumenty — vždy čítaj pred prácou
- `DECISIONS.md` — všetky architektonické rozhodnutia s kontextom
- `SCHEMA.md` — aktuálna databázová schéma
- `ROADMAP.md` — fázy a priority

## Databázové konvencie

### Uzly — centrálna tabuľka `objects` (D-018)
- Všetky uzly sú riadky v `objects`, rozlíšené `object_type`:
  site, building, floor, space, asset, asset_type, document, person, organization
- `object_type` validuje ETL/app (NIE CHECK — pridanie typu je aditívne)
- Povinné stĺpce: `id UUID PRIMARY KEY` (Master UUID), `object_type`, `created_at`, `updated_at`
- IFC atribúty (stĺpce): `ifc_guid` (nullable), `ifc_type`, `predefined_type`,
  `user_defined_type`, `name`, `object_ref UNIQUE`
- `properties JSONB` — property sety + rezervované `_kľúče` (viď nižšie)
- Typovo-špecifické stĺpce → tenká 1:1 prípona (`floors`, `documents`, `persons`),
  `id` ako FK na `objects(id) ON DELETE CASCADE`
- `organization` = obyčajný `objects` riadok (name = názov firmy), bez prípony

### Property sety — tri vrstvy (D-022)
- **Atribúty** (pevné zo schémy) → stĺpce, NIE do `properties`
- **Štandardné psety** (buildingSMART) → `properties[<názov>]`, názov `Pset_`/`Qto_`
- **Custom psety** → `properties[<názov>]`, akýkoľvek iný názov (bez povinného prefixu)
- **Rezervované `_kľúče`** (`_contact`, `_org`…) = meta/zachytené dáta, NIE psety; psety nikdy nezačínajú `_`

### Hrany (vzťahové tabuľky) — IFC-kanonické (D-048)
- Každá hrana = konkrétny IFC `IfcRelationship` podtyp, **pomenovaná podľa neho**,
  s granularitou akú rozlišuje IFC:
  `rel_aggregates` (IfcRelAggregates), `rel_contained_in_spatial_structure`
  (IfcRelContainedInSpatialStructure), `rel_defines_by_type` (IfcRelDefinesByType),
  `rel_associates_document` (IfcRelAssociatesDocument), `rel_associates_classification`
  (IfcRelAssociatesClassification), `rel_assigns_to_actor` (IfcRelAssignsToActor),
  `rel_assigns_to_group` (IfcRelAssignsToGroup — systémy, D-047),
  `rel_member_of` (IfcPersonAndOrganization — **resource, nie IfcRel**; poctivo mimo taxonómie)
- **Fyzicky binárne `from→to` + naše meta stĺpce, NIE objektifikované N-árne IFC entity**
  (preberáme identitu/granularitu IFC, nie serializačnú štruktúru — index nad IFC
  sémantikou, nie STEP v Postgrese, D-046/D-048)
- Povinné stĺpce: `id`, `valid_from`, `valid_until`, `source`
- Smer: `from_id` → `to_id` (subjekt → objekt) — konvencia ostáva jednotná; ktorý koniec
  je IFC `Relating`, je v mapovaní v SCHEMA.md §5
- **Namespace (D-048):** hrana **bez prefixu = IFC-kanonická** (serializuje sa na `IfcRel*`);
  hrana, pre ktorú IFC **nemá koncept**, dostane prefix **`aim_`** (`aim_rel_*`, snake_case).
  Prefix kóduje aj export: `rel_*`→`IfcRel`, `aim_*`→ICDD linkset/IFCX. Rezervované pre
  skutočnú absenciu IFC konceptu (NIE koncept realizovaný inak — preto `rel_member_of`
  ostáva `rel_`). Dnes žiadna `aim_*` hrana neexistuje; je to dopredná konvencia.
- Výnimka: `rel_associates_classification.to_id` → `classification_references`
- Spatial: `rel_aggregates` = dekompozícia štruktúry (Site→Building→Floor→Space);
  `rel_contained_in_spatial_structure` = fyzický prvok (asset) v priestore/podlaží

### Type–occurrence (D-021)
- Type = `object_type='asset_type'`, NIKDY nie je v `rel_located_in`
- Väzba `rel_defined_by_type` (occurrence → type), 1:N
- Dedičnosť s prepisom: type zdieľané, occurrence prepíše; effective z `v_asset_effective`

### Aktori (D-020, D-024) — úroveň B
- `person` (prípona `persons`) a `organization` (objects riadok), väzba `rel_member_of`
- `rel_responsible_for` ide z person aj z organization
- Dve roly: `rel_responsible_for.role` (acting v zodpovednosti) vs `rel_member_of.role` (rola vo firme)
- C (org-hierarchia, štruktúrované adresy, intrinsic roly) = plánované aditívne rozšírenie

### Identita objektov (trojvrstvová, D-010)
- **Master UUID** (`objects.id`) = primárna identita, nikdy sa nemení
- **object_ref** = ľudsky čitateľný stabilný tag (QR), unikátny; NIE je to klasifikačný kód
- **IFC GUID** = len atribút; história v `ifc_guid_history`

### Klasifikácia (D-011, D-019, D-023)
- Nikdy hardcodovať konkrétny klasifikačný systém
- Dvojúrovňová, referenčné dáta: `classification_systems` + `classification_references`
- Väzba `rel_has_classification`, povolená na type aj occurrence
- Efektívna klasifikácia occurrence = **union** vlastných + zdedených z type (nie override)

## Čo nerobiť
- Nikdy nemazať migrácie — vždy pridávať nové
- Nikdy pevne stanoviť klasifikačný systém v schéme
- Nikdy používať IFC GUID ako primárny kľúč
- Nevytvárať samostatnú tabuľku pre každý typ uzla — použiť `objects` + príponu
- Neukladať type property sety na occurrence — patria na type (dedia sa cez view)
- Nedávať IFC atribúty do `properties` — sú to stĺpce
- Nezahadzovať adresy/org-väzby zo zdroja — uložiť do `_contact`/`_org` v `properties` (kým nie je C)
- Nebudovať features bez zodpovedajúceho záznamu v DECISIONS.md
- Nezavádzať nový atribút/hranu/enum bez kontroly IFC4.3 ekvivalentu — ak existuje,
  prevziať IFC názov aj hodnoty doslovne; ak nie, zapísať ako deklarovanú extenziu
  do SCHEMA.md §5 (IFC-first naming, D-046)
- Nikdy neukladať geometriu/meshe do DB — 3D rendering je ephemerálna klient-side vrstva (IFClite, D-044)

## Priestorová hierarchia
```
Site → Building → Floor → Space → Asset
```
Každá úroveň je riadok v `objects` (líši sa `object_type`). Spatial väzby IFC-kanonicky
(D-048): `rel_aggregates` medzi štruktúrami (Site→Building→Floor→Space),
`rel_contained_in_spatial_structure` pre fyzický prvok (asset) v priestore/podlaží.

## RDF / ICDD
RDF nie je interná databáza — len export formát.
Export generuje Python skript z Postgres dát do ICDD kontajnera (ISO 21597).

## 3D Viewer — IFClite (D-044)
Geometria = **ephemerálna v prehliadači** (IFClite WASM, klient-side, IFC súbor neopustí tab).
**Postgres sa geometrie nikdy nedotýka.** Spojka medzi 3D scénou a dátami = **IFC GUID**
(`ifc_guid_history`, D-010). Plánované ako S5 — paralelná vetva, neblokuje S4/DV.
