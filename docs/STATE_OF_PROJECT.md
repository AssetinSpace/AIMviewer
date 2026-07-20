# STATE OF PROJECT — AIMviewer (assetin.space)

> Self-contained snapshot reálneho stavu repa `AssetinSpace/AIMviewer` k **2026-07-20**.
> Zostavené overením kódu (migrácie, seed, `app/`, `lib/`, `etl/`, git log), nie len
> MD dokumentov. Určené ako jediný kontext pre strategický brainstorm nad ďalšími
> modulmi platformy. Rozpory dokumentácie a kódu sú v samostatnej sekcii §10.
> Zdroje pravdy v repe: `DECISIONS.md` (D-001…D-077), `SCHEMA.md`, `ROADMAP.md`,
> `AGENTS.md`, `README.md`, `supabase/migrations/`, `etl/`.

---

## 1. Executive summary

AIMviewer je **Asset Information Model viewer** — webová appka, ktorá zobrazuje správne
previazané dáta o stavbe (priestory, prvky, typy, dokumenty, zodpovednosti, klasifikácie)
v konečnom „handover" stave, plus **3D/2D prehliadanie IFC modelu** a **LLM chat nad
grafom**. Je to prvý use-case (D-003) širšej BIM-konzultačnej platformy; nástroj vzniká
ako vedľajší produkt a distribučný kanál konzultácie (D-001). Stack: **Next.js 16 (App
Router) + TypeScript + Tailwind 4 + shadcn/ui**, dáta **výhradne server-side** cez
Supabase (`service_role`, RLS zámerne vypnutá — D-025), hosting **Vercel** (auto-deploy
z `main`). 3D beží cez **forknutý `@ifc-lite` WASM viewer** (samostatné repo
`AssetinSpace/ifc-lite`, embed cez iframe). V produkcii beží viewer S0–S5 + LLM rozhranie;
ETL (IFC→Supabase) je hotové po sprint E4. **Chýba len vlastná doména** a verejné
spustenie (S4). Viacero rozostavaných feature vetiev (georeferencované podklady, reality
capture, dokumenty vo viewri, AIM inspector) čaká na review/merge. Model dát je aditívna
IFC-aligned schéma nad centrálnou `objects` tabuľkou; nič sa nemaže, len pridáva.

---

## 2. Architektúra dátového modelu

### 2.1 Jadro — `objects` + tenké prípony + hrany v `relationships`

Celá schéma stojí na **jednej centrálnej tabuľke `objects`** (uzol grafu, D-018).
Každý uzol — site, building, floor, space, asset, asset_type, document, person,
organization, system, capture, capture_media — je riadok v `objects`, líšia sa
`object_type`. Špecifické atribúty sú v **tenkých 1:1 príponách** (`floors`, `documents`,
`persons`, `spaces`, `captures`, `capture_media`) s `id` = FK na `objects(id)` ON DELETE
CASCADE. Organizácia nemá príponu (je len `objects` riadok). Klasifikácia je **referenčná
dvojica tabuliek** mimo `objects`.

**Kľúčové stĺpce `objects`:** `id` (Master UUID, D-010/1), `object_type`, `object_ref`
(ľudsky čitateľná identita / QR, UNIQUE, D-010/2), `name` (IFC Name), `ifc_guid`
(len atribút, nullable — NIKDY nie PK, D-010/3), `ifc_type` (IfcPump…), `predefined_type`,
`user_defined_type`, `properties` (JSONB), `search_text` (generated stored, D-059).

**Hrany (D-051, F1)** žijú od sprintu F1 v **jednej generickej tabuľke `relationships`**
s diskriminátorom `rel_type` (symetricky k `objects.object_type`) — nie per-vzťah tabuľky.
Fyzicky binárne `from_id → to_id` (subjekt → objekt) + meta stĺpce `role`, `valid_from`,
`valid_until`, `source`. `from_id` má FK+CASCADE; `to_id` je **polymorfné** (objects ALEBO
classification_references) → zámerne bez FK, integritu drží **validačný trigger** čítajúci
manifest `relationship_types`. N-árnosť = N binárnych riadkov. Sme index nad IFC
sémantikou, **nie STEP v Postgrese** (D-046/D-048).

**Trojtabuľkový IFC meta-model:** `objects` (IfcObjectDefinition) + `relationships`
(IfcRelationship) + `properties` (IfcPropertyDefinition). Manifest `relationship_types`
je jediný zdroj pravdy o `rel_type` (generovaný a overený proti IFC schéme cez
`ifcopenshell`, `etl/manifest.py`) — poháňa validačný trigger, ETL routing aj export.

### 2.2 Trojvrstvová identita (D-010)

| Vrstva | Kde | Zmysel |
|---|---|---|
| Master UUID | `objects.id` | trvalá kotva naprieč verziami IFC súborov |
| `object_ref` | `objects.object_ref` (UNIQUE) | ľudsky čitateľný kód / QR; skladá sa z kódovacej schémy projektu (D-033), NIE z IFC Tag |
| IFC GlobalId | `objects.ifc_guid` + `ifc_guid_history` | len atribút; história väzieb GUID↔uzol s `valid_from/valid_until` (append-only, aktívny = `valid_until IS NULL`) |

`ifc_guid_history` je zároveň **spojka medzi 3D scénou a dátami** — GUID→id preklad pre
AIM kartu vo viewri.

### 2.3 Type–occurrence dedičnosť (D-021)

Type aj occurrence sú `objects` riadky (`object_type` = `asset_type` / `asset`), spojené
hranou `rel_defines_by_type` (occurrence → type, 1:N). Efektívny pohľad `v_asset_effective`
robí **deep-merge** psetov (`jsonb_deep_merge`, occurrence prepíše type na úrovni skalárov)
a dedí `predefined_type`/`user_defined_type` z typu. Type property sety sa NIKDY neukladajú
na occurrence — dedia sa cez view. `asset_type` sa NIKDY nevyskytuje v spatial väzbách.

### 2.4 Klasifikácia ako union faset (D-011/D-019/D-023)

Žiadny pevný klasifikačný systém v schéme. `classification_systems` (IfcClassification)
◄─ `classification_references` (IfcClassificationReference). Hrana
`rel_associates_classification` visí na **type aj occurrence**. Efektívna klasifikácia
`v_asset_classifications` = **UNION** vlastných (occurrence) + zdedených (z type), nie
override. Objekt môže niesť viac systémov naraz.

### 2.5 `properties` — tri vrstvy (D-022)

| Vrstva | Kde | Rozlíšenie |
|---|---|---|
| 1 — IFC atribúty | stĺpce na `objects` | pevný zoznam zo schémy (NIKDY nie v `properties`) |
| 2 — štandardné psety | `properties[<názov>]` | názov `Pset_` / `Qto_` |
| 3 — custom psety | `properties[<názov>]` | čokoľvek iné bez `Pset_`/`Qto_` |

**Rezervované `_kľúče`** (nie psety, ale meta / zachytené dáta, capture-don't-structure):
`_contact`, `_org` (surové adresy/org-väzby kým nie je Actor model C), `_drawing_links`
(klikateľné regióny výkresov, D-042), `_georef` (georeferencia PDF podkladu, D-072),
`_capture` (ukotvenie reality-capture bodu 2D/3D, D-073). Psety nikdy nezačínajú `_`.

### 2.6 Zoznam tabuliek

| Tabuľka | Migrácia | Popis |
|---|---|---|
| `objects` | init 20260616 | centrálny uzol grafu; `search_text` pridané 20260712 |
| `floors` | init | prípona podlažia (`elevation`) |
| `documents` | init | prípona IfcDocumentInformation; `storage_type` pridané 20260620 |
| `persons` | init | prípona IfcPerson |
| `spaces` | 20260620140000 | prípona IfcSpace (`long_name`, D-040) |
| `classification_systems` | init | IfcClassification (referenčné dáta) |
| `classification_references` | init | IfcClassificationReference |
| `ifc_guid_history` | init | história GUID↔uzol (bitemporálne) |
| `relationship_types` | 20260707150000 | manifest `rel_type` (zdroj pravdy, D-051) |
| `relationships` | 20260707150000 | generická tabuľka hrán (diskriminátor `rel_type`) |
| `ifc_property_definitions` | 20260714120000 | statický IFC slovník psetov (grounding LLM, D-061) |
| `document_pages` | 20260715120000 | extrahovaný text PDF per strana (fulltext, D-063) |
| `captures` | 20260716120000 | reality-capture bod (`kind` photo/pano360, D-073) |
| `capture_media` | 20260716120000 | snímka/verzia (analóg documents, append-only) |

> Pozn.: iniciálna migrácia vytvorila per-vzťah tabuľky (`rel_located_in`, `rel_defined_by_type`,
> `rel_has_document`…), medzikrok 20260702 ich prečísloval na IFC-kanonické tabuľky, a
> 20260707 (F1) ich **supersedoval** generickou `relationships` + views. Transitional compat
> views (`rel_located_in`…) boli **dropnuté** v 20260702140000. Aktuálny stav = generická
> tabuľka + views nižšie.

### 2.7 Zoznam views a RPC

| View | Popis |
|---|---|
| `rel_aggregates` | Site→Building→Floor→Space dekompozícia (IfcRelAggregates) |
| `rel_contained_in_spatial_structure` | asset → priestor/podlažie |
| `rel_defines_by_type` | occurrence → type |
| `rel_associates_document` | objekt → dokument (nesie `role`) |
| `rel_associates_classification` | objekt(type/occ) → klasifikačná referencia |
| `rel_assigns_to_actor` | person/org → objekt (`role`, platnosť = handover) |
| `rel_assigns_to_group` | element → system (D-047) |
| `rel_member_of` | person → organization (`role`) |
| `aim_rel_capture_located` | capture → space/floor (PRVÁ `aim_` hrana, D-073) |
| `aim_rel_capture_media` | capture → capture_media (1:N) |
| `v_asset_effective` | dedičnosť type→occurrence (deep-merge) |
| `v_asset_classifications` | union klasifikácií (type + occurrence) |
| `v_floors` | objects + floors.elevation |
| `v_spaces` | objects + spaces.long_name |
| `v_actors` | objects kde object_type in (person, organization) |
| `v_property_dictionary` | runtime slovník psetov z reálnych dát (D-058) |

**Views = jediný zdroj pravdy pre merge/union pravidlá.** Čítacia vrstva (viewer, 3D,
filter, LLM) sa dotýka LEN views, nie base `relationships`. LLM tools dotazujú výhradne
whitelistované views (nikdy base tabuľku ani surové SQL).

**RPC / funkcie:** `set_updated_at`, `jsonb_deep_merge`, `relationships_validate`
(integritný trigger), `f_unaccent` + `f_object_search_text` (IMMUTABLE, D-059),
`search_everything(q, object_types[], max_rows)` (FTS + fuzzy, D-059),
`aggregate_objects(...)` (numericky bezpečné sum/avg/min/max + filtre, D-060),
`search_documents(q, max_rows)` (fulltext nad obsahom PDF, D-063).

---

## 3. Register rozhodnutí (D-001 … D-077)

Stav: **IMPL** = implementované · **ČIAST** = čiastočne / MVP / na vetve · **ZÁMER** =
len smer/kandidát/procedúra bez implementácie · **SUPERSEDED** = nahradené iným D.

| D | Názov | Rozhodnutie (1 veta) | Stav | Poznámka |
|---|---|---|---|---|
| D-001 | Biznis model | Nástroj je vedľajší produkt BIM konzultácie a distribučný kanál. | IMPL | rámec |
| D-002 | Demo projekt | Admin. budova z diplomovky (ASR.ifc) ako verejný sandbox. | IMPL | pozri §10 — prod model vymenený |
| D-003 | Prvý use case | Ukázať konečný stav previazaných dát, nie procesy. | IMPL | jadro naratívu |
| D-004 | Vibecoding | Claude Code + Cursor ako hlavné dev nástroje. | IMPL | — |
| D-005 | DB Supabase/Postgres | Supabase ako primárne úložisko, migrovateľné na Azure. | IMPL | nie locked-in |
| D-006 | FE Next.js + Vercel | Next.js na Verceli, DNS cez Websupport. | IMPL | — |
| D-007 | IFC parser | ifcopenshell (Python) ako ETL nástroj. | IMPL | — |
| D-008 | RDF/ICDD export | RDF nie je úložisko, len výstupný formát. | ČIAST | serializácia „horizont rokov" |
| D-009 | Graph v relačnej DB | Tabuľky = uzly, `rel_` = hrany. | IMPL | — |
| D-010 | Trojvrstvová identita | Master UUID + object_ref + IFC GUID (atribút s históriou). | IMPL | `ifc_guid_history` |
| D-011 | Flexibilná klasifikácia | Žiadny pevný systém; viac IfcClassification naraz. | IMPL | — |
| D-012 | IFC-aligned schéma | Inšpirovaná IFC4.3, nie priama implementácia. | IMPL | sprísnené D-046/48/51 |
| D-013 | Priestorová hierarchia | Site→Building→Floor→Space→Asset. | IMPL | — |
| D-014 | Dokumenty | Atribúty IfcDocumentInformation, väzba cez `rel_`. | IMPL | — |
| D-015 | ICDD export | Handover cez ICDD kontajner (ISO 21597) + RDF linky. | ČIAST | skript navrhnutý, neexistuje (§10) |
| D-016 | Typy chatov | Oddelenie brainstorm/planning/execution. | IMPL | proces |
| D-017 | Dokumentačná štruktúra | docs + `.claude/commands`. | IMPL | konsolidované do AGENTS.md |
| D-018 | Objektový model | `objects` + tenké prípony + čisté FK hrany. | IMPL | jadro schémy |
| D-019 | Klasifikácia dvojúrovňová | systems + references ako referenčné dáta. | IMPL | — |
| D-020 | Zodpovednosti od v1 | Aktori + `rel_responsible_for` (role/platnosť). | IMPL | spresnené D-024 |
| D-021 | Type–Occurrence | Dedičnosť s prepisom cez `v_asset_effective`. | IMPL | — |
| D-022 | Properties tri vrstvy | Atribúty→stĺpce, psety→JSONB, rozlíšené názvom. | IMPL | `property_set_templates` odložené |
| D-023 | Klasifikácia union | Na type aj occurrence = zjednotenie, nie override. | IMPL | — |
| D-024 | Actor model B/C | B teraz (person/org/member_of), C aditívne neskôr. | ČIAST | B hotové, C plánované |
| D-025 | Iniciálna migrácia | SCHEMA §2 ako 1 migrácia; RLS + časť views odložené. | IMPL | overené na PG17 |
| D-026 | AIM Viewer stack | Next.js App Router + Tailwind + shadcn, server-side. | IMPL | RLS off (línia D-025) |
| D-027 | Viewer navigácia S1 | Route-first strom + `/node/[id]`, výber v URL. | IMPL | — |
| D-028 | S2 asset karta | Dedičnosť/provenance/klasifikácie + `/type/[id]`. | IMPL | overené na seede |
| D-029 | S3 dokumenty/zodpovednosti/GUID | 3 generické sekcie + generický object route. | IMPL | — |
| D-030 | Viewer výkon (ISR) | `unstable_cache` + ploché nav; TTFB 1.9s→0.3s. | IMPL | 4 dodatky |
| D-031 | ETL pipeline | Python+ifcopenshell, psycopg upsert, deterministické UUID. | IMPL | E2 naložil reálny model |
| D-032 | PDF dokumenty | Hybrid úložisko (`storage_type`), dokument=uzol, revízie, ICDD. | ČIAST | model/upload E3 hotové |
| D-033 | Coding scheme resolver | Field-source resolver, `object_ref` zo schémy. | IMPL | nahrádza provizórny ref |
| D-034 | Rozsah importu | „Asset = na čo je info požiadavka"; scope z policy. | IMPL | dodatok IfcRailing |
| D-035 | Konsolidácia podlaží | Pomocné Revit úrovne → reálne podlažie. | IMPL | 18→5 NP |
| D-036 | Dokumentová naming = CDE | 7-pozičný CDE názov (ISO 19650). | IMPL | `doc_scheme.py` |
| D-037 | 3D IFC viewer (pôvodný) | Kandidát na 3D viewer. | SUPERSEDED | → **D-044** |
| D-038 | PDF/DWG split-screen | Kandidát na 2D+3D split. | SUPERSEDED | → **D-072** |
| D-039 | Georeferencing výkresov | Kandidát 2-bod kalibrácie + `_georef`. | SUPERSEDED | → **D-072** |
| D-040 | IfcSpace.LongName | Zachytenie LongName do prípony `spaces`. | IMPL | — |
| D-041 | PDF auto-linking (E4) | 3 dôverové vrstvy matchu + element-väzby. | IMPL | ~193 väzieb |
| D-042 | Interaktívna prehliadačka výkresov | Klikateľné kódy → detail prvku, obojsmerne. | IMPL | titul „plánované", fázy A–D hotové |
| D-043 | Skladby S1–S9 | Značka `S#` → link na výpis skladieb (bez uzla). | IMPL | možnosť „uzol" odložená |
| D-044 | IFC 3D viewer (IFClite) | Postgres=pravda, prehliadač=ephemerálna geometria, spojka GUID. | IMPL | superceduje D-037 |
| **D-045** | (chýba hlavička) | V logu „kandidát: pasportizácia + dynamika". | ZÁMER | bez sekcie; tému prebral D-065 |
| D-046 | IFC alignment stratégia | IFC4.3 slovník teraz, pripravenosť IFC5/IFCX; IFC-first naming. | IMPL | pravidlo, bez migrácie |
| D-047 | North-star: LLM nad grafom | Ťažisko = NL nad grafom + trust loop. | ČIAST | konkretizované D-056, reframe D-049 |
| D-048 | IFC-kanonická vrstva vzťahov | Hrany = IfcRel* identita; split `rel_located_in`. | SUPERSEDED | generickou `relationships` v D-051 |
| D-049 | Federácia disciplinárnych modelov | VZT federácia cez normalizovaný názov podlažia. | IMPL | ventil čaká na vodný model |
| D-050 | 3D vrstva federácie | Multi-model render ASR+VZT, identita cez GUID. | IMPL | — |
| D-051 | Meta-model `relationships` | 1 generická tabuľka + views + manifest. | IMPL | revízia D-048; F1 na prod |
| D-052 | Geom containment + IDS | Element→space cez Python geom, IDS verifikácia. | ZÁMER | detail pri sprinte |
| D-053 | Live upload + verifikácia | SharePoint-like upload s IDS/CDE kontrolou. | ZÁMER | nice-to-have |
| D-054 | PDF prehliadačka rework | Zoom/pan/pinch/fullscreen/Range load. | IMPL | kadencie 1–3 |
| D-055 | 3D/IFClite feature port | Prebrať ďalšie IFClite moduly (2D/meranie/rezy/IDS). | ZÁMER | priority pri sprinte |
| D-056 | LLM rozhranie nad grafom | Pluggable model, tool-calling nad whitelist views, trust loop. | IMPL | Gemini free tier default |
| D-057 | Eval harness | Deterministická sada zlatých otázok (`npm run eval`). | IMPL | 42/44 verified |
| D-058 | Runtime slovník psetov | `v_property_dictionary` z reálnych dát. | IMPL | mig. 20260711 |
| D-059 | Fulltext nad všetkým | `search_text` + `search_everything` (FTS+fuzzy). | IMPL | mig. 20260712 |
| D-060 | Agregácie + numerika | `aggregate_objects` (numericky bezpečné). | IMPL | mig. 20260713 |
| D-061 | Statický IFC slovník psetov | `ifc_property_definitions` z ifcopenshell. | IMPL | mig. 20260714 |
| D-062 | Výber produkčného modelu | Eval-driven výber modelu pre `/api/ask`. | ZÁMER | víťaz nezapísaný |
| D-063 | Obsah dokumentov | `document_pages` + `search_documents`. | IMPL | mig. 20260715; OCR mimo scope |
| D-064 | Multi-projekt LLM pripravenosť | Prerekvizita = `project` entita. | ZÁMER | kandidát, pri 2. projekte |
| D-065 | Pasportizácia budovy | Data/CDE provider, Odoo as-is, platform features. | ZÁMER | kandidát, zákazka nepotvrdená |
| D-066 | AI chat ovláda 3D scénu | Tool `style_in_3d` → URL `ops` → bridge do forku. | IMPL | výber podľa hodnoty psetu |
| D-067 | AIM karta v paneli viewera | Host render → bridge `AIM_PANEL_DATA` → fork AimCard. | IMPL | — |
| D-068 | Ochrana `/api/ask` | Per-IP rate limit + origin guard. | IMPL | in-memory per inštancia |
| D-069 | Hlasový vstup (STT) | Dictation + Gemini STT (`/api/transcribe`). | IMPL | žiadne auto-send |
| D-070 | Assetin design kit | Zdieľané brand tokeny (repo design-kit). | ČIAST | kit v0.1.0; ArchiveApp čaká |
| D-071 | Stratégia forku IFClite | Fork + izolovaná AIM vrstva, upstream cez merge/bot-PR. | IMPL | — |
| D-072 | Georeferencované PDF podklady | `@ifc-lite/drawing-underlay`, 2-bod kalibrácia, `_georef`. | ČIAST | MVP; superceduje D-038/39 |
| D-073 | Reality Capture v1 | Fotky + 360° panorámy ukotvené 2D/3D/IfcSpace. | ČIAST | mig. 20260716; na vetve |
| D-074 | Zoskupenie stromu podľa IFC triedy | Rozbaľovacie skupiny podľa `ifc_type`. | IMPL | prezentačná vrstva |
| D-075 | Dokumentácia v jednom rozhraní | Prepínač 3D/2D/Split + documents panel. | ČIAST | M1–M3, M4 neskôr |
| D-076 | Identifikátorové hyperlinky v 2D | Kódy v texte PDF → klikateľné linky (regex/zdroj). | IMPL | na forku, viac dodatkov |
| D-077 | AIM inspector (viewer-first) | Konsolidácia: `AimPanelData v2`, jeden strom, jeden render. | IMPL | na vetve (§4 F10) |

**Rozhodnutia neskôr spresnené / nahradené:** D-020 → spresnené D-024 · D-048 →
supersedované D-051 (generická tabuľka) · D-037 → D-044 · D-038/D-039 → D-072 · D-047 →
konkretizované D-056, reframe D-049 · D-031 provizórny `object_ref` → nahradené D-033 ·
D-067 (AIM karta) → dotiahnuté a konsolidované D-077.

**Explicitní kandidáti / procedúry bez implementácie:** D-045 (bez sekcie), D-052, D-053,
D-055, D-062, D-064, D-065.

---

## 4. Implementačný stav — sprint po sprinte

### Viewer sprinty (S0–S5)

- **S0 Skeleton & deploy — hotové.** Next.js App Router (TS, Tailwind 4, shadcn/ui),
  Supabase klient so `service_role` (server-only, `lib/supabase/server.ts`), Vercel
  auto-deploy z `main`. Health check `/health` (`force-dynamic`).
- **S1 Priestorová hierarchia — hotové.** Strom Site→Building→Floor→Space→Asset
  (`components/spatial-tree.tsx`, data `lib/data/spatial.ts` cez React `cache()`),
  ploché nav zoznamy (`lib/data/nav.ts`). Neskôr D-074 (zoskupenie podľa `ifc_type`).
- **S2 Asset karta — hotové (D-028).** Detail z `v_asset_effective` + `v_asset_classifications`,
  properties s provenance (`components/property-sets.tsx`), link na `/type/[id]`.
  Data `lib/data/asset.ts`.
- **S3 Dokumenty + zodpovednosti + GUID — hotové (D-029).** Generický route `/node/[id]`,
  sekcie z `lib/data/relations.ts` (`fetchNodeSections`, `fetchResponsibilities`,
  `fetchGuidHistory`), komponenty `document-list`, `responsibility-list`,
  `responsibility-of-list`, `guid-history`.
- **S3 polish (D-030) — hotové.** ISR cache `unstable_cache` (`AIM_CACHE =
  {revalidate:60, tags:['aim']}`), `loading.tsx` skeleton, TTFB Vercel 1.9s→0.3s.
- **S4 Polish & launch — beží.** Reálne ETL dáta naložené; ostáva vizuálny polish,
  responzivita, empty states a **vlastná doména + verejné spustenie** (jediný blocker).
- **S5 IFC 3D viewer — hotové fázy 1–3 (D-044).** Route `/ifc` (`force-dynamic`),
  `components/ifc-workspace.tsx` + `ifc-viewer.tsx`, embed forknutého `@ifc-lite/wasm`
  (WebGL/Three.js, `ssr:false`, WASM self-hosted v `public/`). GUID mapa `lib/data/ifc.ts`
  (`fetchGuidMap`, stránkované cez `fetchAllPages`). Obojsmerná selekcia cez IFC GUID.
- **S5-fed 3D federácia — hotové (D-050).** ASR + VZT v jednej scéne, identita cez GUID,
  floor filter cez normalizované podlažie, `getIfcModels()` (default ASR+VZT zo Storage
  bucketu `ifc`, override `NEXT_PUBLIC_IFC_URLS`).

### ETL track (E1–E6, DV)

- **E1 Coding scheme + object_ref — hotové.** `etl/scheme.py` (field-source resolver,
  SNIM definícia). 18 SNIM kategórií.
- **E2 Load reálnych dát — hotové.** `ScopePolicy` (D-034), konsolidácia 18→5 podlaží
  (D-035). `--reset` load reálneho ASR modelu (~926 uzlov: 681 asset + 149 asset_type +
  89 space + 5 floor + building + site) nahradil ručný seed.
- **E3 Document storage + upload — hotové (D-036).** `documents.storage_type`, public
  bucket `documents`, `etl/doc_upload.py`, `etl/doc_scheme.py`. ~13 PDF nahraných.
- **E4 PDF auto-linking — hotové (D-041).** `etl/pdf_link.py` (PyMuPDF, 3 dôverové vrstvy),
  ~193 element-väzieb (`source='pdf_link (E4)'`). Viewer: `drawing-list`, `drawing-elements`.
- **E5 ICDD export — ZÁMER (nescaffoldované).** Skript `etl/icdd_export.py` **neexistuje**
  v repe (§10). Len navrhnuté v D-015/D-032.
- **E6 Validácia (IDS) — parkované.** Conformance report; až keď bude treba.
- **DV Interaktívna prehliadačka výkresov — hotové (D-042/D-043).** Fázy A–D:
  `_drawing_links`, `etl/pdf_annotate.py`, in-app route `/drawing/[id]` (react-pdf +
  overlay, `components/drawing-viewer.tsx`), obojsmernosť `?focus=&page=`.

### Feature sprinty (F1–F10)

- **F1 Meta-model vzťahov — hotové, na prod (D-051).** Generická `relationships` + manifest
  + kanonické views + validačný trigger. Migrácia `20260707150000`.
- **F2 Geom containment + IDS — plánované (D-052).** Nezávislé od F1.
- **F3 Upload + verifikácia — plánované (D-053).** Ťaží z F2.
- **F4 PDF prehliadačka rework — hotové kadencie 1–3 (D-054).** Zoom/pinch/pan/fullscreen,
  Range/lazy loading veľkých PDF. Overené live (Playwright).
- **F5 3D/IFClite feature port — plánované (D-055).** Quick-win kandidát.
- **F6 LLM rozhranie — kritická cesta, kadencia 1 hotová + program presnosti.** Provider
  vrstva `lib/llm/` (Anthropic + Gemini + mock), tools nad whitelist views, agentická
  slučka `/api/ask` (`MAX_TOOL_ROUNDS=8`, `MAX_TOKENS=4000`), UI dock (`ask-dock`).
  Program presnosti D-057–D-063 (eval, grounding slovníky, fulltext, agregácie, obsah
  dokumentov). STT `/api/transcribe` (D-069). Rate limit + origin guard (D-068,
  `lib/api-guard.ts`). **Čaká:** `supabase db push` migrácií 20260711–20260716 na prod
  (§10 — neoverené), eval porovnanie modelov (D-062), import vodného modelu pre ventilový
  use-case.
- **F7 Georeferencované podklady — na vetve (D-072).** M0–M4, `@ifc-lite/drawing-underlay`,
  `PATCH /api/underlay` (env brána `UNDERLAY_WRITE_ENABLED`). Čaká review/merge.
- **F8 Reality Capture — na vetve (D-073).** Migrácia 20260716, bucket `captures` + `sharp`
  thumbnaily, `POST /api/captures` (env brána `CAPTURE_WRITE_ENABLED`), galéria na
  `/node/[id]`, Photo Sphere Viewer, 3D piny vo forku. Ostáva 3D-click authoring (WebGPU).
- **F9 Dokumentácia v jednom rozhraní — na vetve (D-075).** Prepínač 3D/2D/Split, documents
  panel, adapter `fetchProjectDocuments` (`lib/data/documents.ts`). M1–M3 hotové, M4 neskôr.
- **F10 AIM inspector viewer-first — hotové na vetve (D-077).** `AimPanelData v2`
  (`lib/aim-panel.ts`), per-GUID badge dekorácie stromu (`lib/data/decorations.ts`,
  bridge `AIM_TREE_DECORATIONS`), host sidebar sa na `/ifc` nerenderuje (`sidebar-gate.tsx`),
  jednotný `AimPanelView`, `filter-bar.tsx` zmazaný.

### Reálne routy (App Router)

| Route | Render | Účel |
|---|---|---|
| `/` (viewer home) | statické | výzva vybrať uzol |
| `/node/[id]` | ISR 60 | generický detail uzla (asset/space/floor/person/org/system/document) |
| `/type/[id]` | ISR 60 | detail asset_type |
| `/drawing/[id]` | ISR 60 | in-app PDF prehliadačka výkresu s overlay linkami |
| `/ifc` | force-dynamic | 3D/2D IFClite viewer (embed forku), federácia ASR+VZT |
| `/health` | force-dynamic | health check |
| `/api/ask` | route | LLM agentická slučka nad grafom |
| `/api/transcribe` | route | STT (Gemini) |
| `/api/element/[id]` | route | detail prvku pre viewer (Cache-Control SWR) |
| `/api/space-siblings/[objectId]` | route | súrodenci v priestore |
| `/api/underlay/[documentId]` | route (PATCH) | zápis georeferencie (env-gated) |
| `/api/captures` + `/[id]` + `/[id]/media` + `/summary` | route | reality capture CRUD (env-gated) |
| `/api/filter` | route | **mŕtvy** verejný endpoint bez volajúceho (§10) |

### Data-access moduly (`lib/data/`)

`spatial` (strom, React `cache()`), `nav`, `object` (meta/person/org/document/system/summary),
`asset` (+ asset_type), `relations` (sekcie/dokumenty/zodpovednosti/GUID/drawings/system
membership), `documents`, `filter`, `drawing` (+ georef validácia), `captures` (+ placement),
`decorations` + `decoration-counts`, `ifc` (modely + GUID mapa), `pagination`, `constants`.
Ďalej `lib/llm/*` (provider/anthropic/gemini/mock/tools), `lib/stt/*`, `lib/aim-panel`,
`lib/api-guard`, `lib/object-type`, `lib/viewer-api`.

### Cache stratégia

**Cachujú sa dáta, nie routy.** Väčšina data-access fetcherov je obalená
`unstable_cache(..., ['kľúč'], AIM_CACHE)` s `AIM_CACHE = {revalidate:60, tags:['aim']}`.
Stránky navyše nesú `export const revalidate = 60` (ISR); `/ifc` a `/health` sú
`force-dynamic`. `spatial.ts` používa request-scoped React `cache()`. Po zápise (ETL load
alebo write API) sa volá `revalidateTag("aim", {expire:0})`. Niektoré API vracajú
`Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`. Write routy
sú za env bránami (`UNDERLAY_WRITE_ENABLED`, `CAPTURE_WRITE_ENABLED`).

### Deploy

GitHub `AssetinSpace/AIMviewer` → Vercel auto-deploy z `main`. Supabase Cloud prod
`acwoupricatirhlfkhvk`. IFC súbory v public Storage bucketoch `ifc` / `documents` /
`captures`. Fork `AssetinSpace/ifc-lite` deployuje viewer app samostatne
(`ifc-lite-viewer.vercel.app`), AIMviewer ho embeduje cez iframe + `aim-bridge`.
`main` je momentálne na merge PR #40 (D-076 identifikátorové hyperlinky).

---

## 5. ETL vetva

Python pipeline `etl/` (IFC → Supabase), architektúra D-031. Spúšťa sa z koreňa repa:
`python -m etl.main --file <ifc> [--dry-run|--reset|--federate]`.

### Čo scaffold vie (hotové)

- **Extrakcia + mapovanie** (`extract.py`, `transform.py`, `model.py`): IFC → staged model
  podľa SCHEMA §4. `--dry-run` vypíše coverage report (SNIM pokrytie vs. fallback po triedach).
- **Kódovacia schéma** (`scheme.py`): field-source resolver, `object_ref` z SNIM (Assembly
  Code + Type Mark + Mark), `ScopePolicy` (čo je asset, D-034), konsolidácia podlaží (D-035).
- **Idempotentný load** (`db.py`, `ids.py`): upsert cez `object_ref` (UNIQUE), deterministické
  UUID pre hrany/GUID/systémy, `ON CONFLICT (id)`. Re-run rovnakého modelu neduplikuje.
  `--reset` = TRUNCATE CASCADE (výmena seedu za reálne dáta). `--federate` = pridá
  disciplinárny model (VZT) na existujúce podlažia bez emitu spatial koreňov (D-049).
- **Manifest vzťahov** (`manifest.py`): `rel_type` spec overený proti IFC schéme cez
  `ifcopenshell`; `--check` / `--sql` (generuje INSERT do `relationship_types`).
- **Statický slovník psetov** (`pset_manifest.py`): definície štandardných psetov z bSDD/psd
  šablón, LEN triedy projektu → `ifc_property_definitions` (D-061).
- **Dokumenty** (`doc_upload.py`, `doc_scheme.py`): CDE naming (ISO 19650), upload do bucketu.
- **PDF linking** (`pdf_link.py`): auto-linking kódov na prvky (E4). `pdf_annotate.py` (URI
  anotácie). `pdf_text.py`: extrakcia textu per strana → `document_pages` (D-063).
- **QA** (`ifc_qa.py`): kontrola placeholder hodnôt. `ifc_upload.py`: upload IFC do Storage.
- **Testy** (`etl/tests/`): pytest, čisto lokálne (stub kurzor, bez DB) — parsovanie
  manifestu, GUID história, doc upload write logika.

### Čo chýba / blockery

- **ICDD export (E5) neexistuje** — `icdd_export.py` nie je v repe; len navrhnuté (D-015/D-032).
- **IDS validácia (E6)** — parkované, žiadny kód.
- **`transform.py` má `TODO(model)`** miesta (zber dokumentov riadok ~509, aktorov ~543) —
  časti mapovania sú model-špecifické a doladené na jeden konkrétny IFC.
- **Prerekvizity behu:** reálny IFC súbor v `etl/data/` (gitignored), `DATABASE_URL`
  v `.env.local`, Python 3.9 + `ifcopenshell 0.8.4`, `PYTHONUTF8=1` na Windows.
- **Import vodného modelu (ÚK/ZTI)** je prerekvizita headline LLM use-casu „najbližší
  uzatvárací ventil" (D-047/D-049) — zatiaľ neimportované.
- **Krehkosti (z auditu, neoverené v prod):** hrany na neimportované entity môžu zhodiť load;
  `object_ref` závisí od poradia iterácie (riziko tichého presunu identity pri re-exporte);
  ETL kontakty sa lokálne zahadzujú proti AGENTS.md konvencii.

---

## 6. Princípy a vzory, ktoré sa osvedčili

Abstrahované poučenia použiteľné pri návrhu ďalších modulov platformy:

1. **Aditívna evolúcia schémy.** Migrácie sa NIKDY nemažú ani needitujú — len pridávajú.
   14 migrácií, každá je čistý prírastok (`storage_type`, `spaces`, indexy, meta-model,
   fulltext, agregácie, slovníky, capture). Nová funkcia = nová migrácia + nový `object_type`
   / `rel_type` / view, nie refaktor existujúceho.
2. **Views ako jediný zdroj pravdy pre merge/union pravidlá.** Dedičnosť type→occurrence a
   union klasifikácií žijú v `v_asset_effective` / `v_asset_classifications`, nie v aplikačnom
   kóde. Aplikácia aj LLM čítajú výsledok, nepočítajú ho. Kanonické views navyše slúžia ako
   bezvýpadkový compat layer nad zmenou base tabuľky (rel_* views nad `relationships`).
3. **Route-first navigácia.** Každý uzol má URL (`/node/[id]`, `/type/[id]`); výber, focus,
   3D operácie sú v query parametroch (`?focus=&ops=&r=&doc=`). Stav je zdieľateľný,
   prefetchovateľný, deep-linkovateľný. LLM vracia deep-linky, nie prózu.
4. **Cachovať dáta, nie routy.** Fetchery obalené `unstable_cache` s tagom `aim`;
   invalidácia jedným `revalidateTag("aim")` po zápise. ISR robí warm navigáciu takmer
   okamžitou bez vlastnej cache logiky v komponentoch.
5. **Capture-don't-structure.** Keď schéma pre niečo ešte nemá tvar (adresy, org-väzby,
   georef, ukotvenie capture), ETL/API uloží surové dáta do rezervovaného `_kľúča`
   v `properties` namiesto zahodenia. Povýšenie na štruktúru je neskôr čistá migrácia.
6. **Server-only prístup k DB namiesto RLS.** Čítanie výhradne server-side cez `service_role`
   (Server Components / route handlers); DB nie je vystavená verejným API, anon kľúč sa do
   prehliadača nedáva. RLS je aditívna vrstva odložená spolu s auth — nie predčasná komplexita.
7. **Geometria je ephemerálna klient-side.** Postgres sa geometrie nikdy nedotýka; 3D beží
   vo WASM v prehliadači, IFC súbor tab neopustí. Spojka scéna↔dáta je IFC GUID. Umožňuje
   federáciu viacerých modelov bez ukladania meshov.
8. **Manifest ako zdroj pravdy overený proti externej schéme.** `relationship_types` a
   `ifc_property_definitions` sú generované a validované proti IFC schéme (`ifcopenshell`) —
   jeden manifest poháňa validačný trigger, ETL routing aj export. Referenčné dáta, nie
   hardcode v aplikácii.
9. **IFC-first naming (D-046).** Nový atribút/hrana/enum až po kontrole IFC4.3 ekvivalentu;
   ak existuje, prevziať názov aj hodnoty doslovne, inak zapísať ako deklarovanú extenziu.
   Drží schému interoperabilnou a pripravenou na IFC5/IFCX.
10. **Trust loop pri LLM.** Zdroje sa zbierajú deterministicky server-side z tool výsledkov
    (nie z modelu); model nemá prístup k SQL ani zápisu, len k whitelistovaným read-only
    tools s row-capmi a max počtom kôl. Eval harness so zlatými otázkami stráži regresiu.
11. **Rozhodnutie = záznam.** Žiadna funkcia bez zodpovedajúceho D-xxx v `DECISIONS.md`;
    každé D nesie kontext, alternatívy a stav. Dokumentácia je jeden strom (`AGENTS.md`
    ako zdroj pravdy, tenké pointery pre jednotlivé nástroje).

---

## 7. Otvorené otázky a odložené rozhodnutia

| Téma | Stav | Podmienka znovuotvorenia |
|---|---|---|
| Vlastná doména + verejné spustenie | odložené (S4) | keď je demo pripravené na verejnosť |
| Auth + RLS | odložené (D-025/D-026) | príchod multi-user / verejného zápisu |
| Actor model C (org↔org hierarchia, štruktúrované adresy, intrinsic roly) | plánované aditívne (D-024) | keď to import/projekt vyžiada; dáta dovtedy v `_contact`/`_org` |
| `rel_supersedes` (revízie dokumentov) | odložené (D-032/§7) | keď treba explicitné verzie namiesto name+valid_from |
| `property_set_templates` (bSDD validácia) | odložené (D-022) | pri validácii handoveru |
| Výber produkčného LLM modelu | procedúra pripravená (D-062) | po nasadení migrácií 20260711–15 + eval beh |
| Multi-projekt / `project` entita | kandidát (D-064) | pri druhom projekte |
| Pasportizácia existujúcej budovy | kandidát (D-065) | potvrdená zákazka |
| Geom cross-file containment + IDS (F2) | zámer (D-052) | štart sprintu |
| Live upload + verifikácia (F3) | zámer (D-053) | po F2 |
| ICDD export (E5) + IDS (E6) | zámer/parkované | potreba handover výstupu |
| Import vodného modelu (ÚK/ZTI) | prerekvizita | odomkne ventilový LLM use-case |
| Skladby S1–S9 ako plný uzol (možnosť A) | odložené (D-043) | ak značky potrebujú vlastnú identitu |
| `object_ref` tie-break (poradie iterácie) | otvorené (audit) | pred produkčným QR použitím |
| Sémantická unikátnosť `relationships (rel_type, from_id, to_id)` | otvorené (audit) | do SCHEMA.md, ak treba tvrdý constraint |
| Duálne viewer komponenty (`ifc-viewer` vs mŕtvy `ifc-viewer-embed`) | otvorené (audit) | rozhodnúť ktorý prežije + preniesť FOCUS queue |

> Nezmergované vetvy čakajúce na review/merge: F7 (underlay), F8 (reality capture),
> F9 (dokumenty vo viewri), F10 (AIM inspector) a nočný audit
> (`claude/overnight-repo-audit-vky8t5`, opravy paginácie / pdf_text / GUID rotácie).

---

## 8. Explicitné hranice scope — čo sme vedome NErobili

- **Geometria / meshe / RepresentationMaps v DB** — trvalo mimo scope (D-044). Postgres sa
  geometrie nedotýka ani s príchodom 3D; rendering je ephemerálna klient-side WASM vrstva.
- **RLS + auth** — vedome vypnuté (D-025), server-only prístup cez `service_role`. Doplní sa
  aditívne s multi-user režimom.
- **Actor model C** — org-hierarchia, štruktúrované adresy (IfcPostalAddress/TelecomAddress),
  intrinsic roly ako entity. Zatiaľ len úroveň B; dáta sa nestrácajú (capture-don't-structure).
- **`property_set_templates` / bSDD validácia** — až pri validácii handoveru (D-022).
- **Graph databáza** — graf je modelovaný v relačnom Postgrese (uzly = `objects`, hrany =
  `relationships`); žiadny Neo4j/RDF store. RDF/ICDD je len **export**, nie interné úložisko.
- **IFC ako priama implementácia** — schéma je IFC-*aligned*, nie STEP v Postgrese. Preberáme
  identitu/granularitu IfcRel*, nie serializačnú štruktúru N-árnych objektifikovaných entít
  (D-046/D-048/D-051). Postgres lowercasuje identifikátory (CamelCase by škodil text-to-SQL).
- **OCR skenovaných PDF** — mimo scope (D-063); extrahuje sa len natívny text PDF.
- **Federácia naprieč IFC súbormi ako natívny IFC koncept** — dnes cez Master UUID + GUID
  history + normalizáciu podlažia; natívna federácia až IFC5 (deklarovaná extenzia).

---

## 9. Extensibility body — kde je architektúra pripravená bez refaktoru

1. **Nové `object_type` hodnoty.** `object_type` je voľný text s indexom; nový typ uzla =
   nová hodnota + (voliteľne) tenká 1:1 prípona s FK na `objects(id)`. Takto pribudli
   `system` (D-047), `capture` / `capture_media` (D-073) bez dotyku existujúcich tabuliek.
2. **Nové `rel_type` hrany.** Pridanie riadku do manifestu `relationship_types` + kanonický
   view rovnakého názvu → nová hrana bez novej tabuľky. Namespace `rel` (IFC-kanonické) vs
   `aim` (rozšírenie); prvé `aim_` hrany pribudli pri capture (D-073). Validačný trigger
   automaticky vynúti povolené `object_type` oboch strán z manifestu.
3. **Nové prípony.** Vzor `floors`/`documents`/`persons`/`spaces`/`captures` — pridaj tabuľku
   s `id` FK CASCADE, `objects` sa nemení. Atribúty IfcDocumentInformation sa dopĺňajú
   aditívne (`intended_use`, `scope`, `editors`… keď treba).
4. **Nové views.** `v_documents`/`v_assets`/… sú čisto aditívne (§8 SCHEMA). Nové merge/union
   pravidlo = nový view, čítacia vrstva ho konzumuje bez zmeny base tabuliek.
5. **Nové rezervované `_kľúče`.** Capture-don't-structure: ľubovoľné zachytené dáta idú do
   `properties._<meta>` (deklarovať v SCHEMA §4), povýšenie na stĺpce/tabuľky je neskôr
   čistá migrácia (`_contact`→Actor C, `_georef`, `_capture`, `_drawing_links`).
6. **Export vrstvy.** `relationship_types.export_path` (`ifcrel`/`resource`/`icdd`/`ifcx`)
   je pripravený per-hranu smerovať export — ICDD linksety pre `aim_` extenzie, do budúcna
   IFCX layer komponenty. Serializátor (Python) číta manifest, nie hardcode.
7. **Multi-model federácia.** `getIfcModels()` + `NEXT_PUBLIC_IFC_URLS` a `--federate`
   v ETL umožnia pridať disciplinárny model (ARCH/VZT/ÚK/ZTI) do jednej scény bez zmeny
   schémy; identitu drží GUID, podlažie sa normalizuje na spoločný label.
8. **LLM tools.** Nový tool = nová položka v `TOOL_DEFINITIONS` + dispatch v `AskToolRuntime`
   nad existujúcim view/RPC; grounding slovníky (`v_property_dictionary`,
   `ifc_property_definitions`) sú data-driven, takže LLM vrstva rastie s dátami bez zmeny promptu.
9. **Bitemporalita.** `valid_from`/`valid_until` na hranách a `ifc_guid_history` už existujú;
   časové dotazy a UI „História" (D-077) sú prvé využitie — schéma to nesie odjakživa.

---

## 10. Rozpory dokumentácia vs. realita

Overené priamo v kóde/repe; kde stav prod DB nevieme z repa potvrdiť, označené **neoverené**.

1. **Prod dataset ≠ dokumentovaný príklad.** `README.md` uvádza `seed = 13 objects`;
   `etl/README.md` a D-002/D-035 opisujú ako running example **ASR.ifc „diplomka"**
   (admin. budova, 681 assetov / ~926 uzlov). No `eval/questions.json` (verifikované SQL
   proti prod **2026-07-11**) opisuje živý dataset ako **„Polyfunkčný objekt"** s klasifikáciou
   **Uniformat** (97 dverí, 3 VZT jednotky, 139 vyústok, 89 miestností, 5 podlaží, 13
   dokumentov, 0 ventilov). Zápis v SCHEMA.md/ROADMAP z 2026-07-02 zasa spomína „Office
   centrum Brno, IFC4X3_ADD2, 903 objects". → **Produkčný model bol viackrát vymenený**;
   `seed.sql` (13 hardcoded uzlov, VZT AHU-5000) je len lokálny demo seed, nie prod obsah.

2. **ICDD export skript neexistuje.** D-015/D-032 aj ROADMAP hovoria o `etl/icdd_export.py`
   (rdflib, ISO 21597). Súbor **nie je v repe** — E5 je čistý zámer, nie scaffold.

3. **Nenasadené migrácie na prod (neoverené).** SCHEMA.md §8 tvrdí „nasadené na Supabase
   prod, 8 migrácií sync" (stav F1). V repe je **14 migrácií**; podľa ROADMAP program presnosti
   `20260711`–`20260716` (F6 slovníky/fulltext/agregácie/document_pages + F8 capture) ešte
   čaká `supabase db push`. **Z repa sa aktuálny stav prod DB overiť nedá** — treba potvrdiť
   v Supabase. (Nekonzistentné s tým, že eval z 2026-07-11 fakty overil SQL priamo.)

4. **Počty hrán/uzlov sa v dokumentoch líšia.** F1 hlási „4461 hrán" (SCHEMA.md), E2 „776
   located_in + 644 defined_by_type + 602 classification", 2026-07-02 „~198 element-väzieb",
   E4 „193 väzieb", DV „197 väzieb / 414 regiónov". Čísla sú z rôznych momentov a rôznych
   modelov → berať ako rádové, nie ako aktuálny stav.

5. **D-042 titul „plánované", ale implementované.** Hlavička D-042 nesie „*plánované*", no
   fázy A–D interaktívnej prehliadačky sú hotové (route `/drawing/[id]` existuje). Titul
   nebol aktualizovaný.

6. **D-045 nemá sekciu.** V `DECISIONS.md` chýba `### D-045`; referencované len v changelogu
   a v D-046/D-065. Tému fakticky prebralo D-065.

7. **Mŕtvy kód.** `/api/filter` + `lib/data/filter.ts` (`fetchByIfcType`,
   `fetchByClassificationPrefix`) je živý verejný endpoint bez volajúceho (filter bar zmazaný
   v D-077). `components/ifc-viewer-embed.tsx` (~343 r.) je podľa auditu mŕtvy, hoci obsahuje
   správnu FOCUS pending-queue, ktorú živý `ifc-viewer.tsx` nemá.

8. **Hardcoded prod projekt.** `lib/data/ifc.ts` má natvrdo
   `https://acwoupricatirhlfkhvk.supabase.co/storage/v1/object/public/ifc` (Storage base) —
   viazané na jeden Supabase projekt, prekáža multi-projektu (D-064).

---

*Zostavené 2026-07-20 z HEAD vetvy `claude/aimviewer-state-doc-2jfi3p`
(main @ merge PR #40, D-076). Fakty o prod DB, ktoré sa nedajú overiť zo súborov repa,
sú označené „neoverené".*
