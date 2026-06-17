# DECISIONS.md — Architektonické rozhodnutia AIM Platform

> Tento dokument je živý log rozhodnutí prijatých počas brainstormu.
> Každé rozhodnutie má kontext a dôvod — nie len výsledok.
> Pred akýmkoľvek návrhom schémy alebo feature — prečítaj celý dokument.

---

## 1. Produkt a stratégia

### D-001 — Biznis model
**Rozhodnutie:** Primárna aktivita je BIM konzultácia. Nástroj vzniká paralelne ako vedľajší produkt konzultačnej práce.
**Dôvod:** Konzultácia je distribučný kanál — zákazníci vidia reálne výsledky nástroja v praxi bez cold outreach.
**Dôsledok:** Nástroj musí byť použiteľný v reálnych projektoch od začiatku, nie len demo.

### D-002 — Demo projekt
**Rozhodnutie:** Administratívna budova z diplomovej práce ako verejný sandbox.
**Dôvod:** Reálna budova, žiadne autorské obmedzenia, dobre ohraničený rozsah.
**Dôsledok:** IFC model bude upravený tak aby bol ideálny pre tento účel.

### D-003 — Prvý use case: AIM Viewer
**Rozhodnutie:** Prvý cieľ je ukážka konečného stavu — správne previazané dáta a možnosti práce s nimi. Nie ukážka procesov.
**Dôvod:** Zákazník musí vidieť KAM to smeruje, nie AKO sa tam dostane.
**Dôsledok:** Viewer zobrazuje priestorovú hierarchiu, asset karty, dokumenty, zodpovednosti a LLM interface.

### D-004 — Vibecoding prístup
**Rozhodnutie:** Claude Code (primárne) + Cursor ako hlavné vývojové nástroje.
**Dôvod:** Minimálne skúsenosti s kódom — spolieháme sa na kvalitne nastavené AI nástroje.
**Dôsledok:** Kvalita CLAUDE.md a dokumentácie je kritická. Každý kontext musí byť jasný.

---

## 2. Technický stack

### D-005 — Databáza: Supabase / Postgres
**Rozhodnutie:** Supabase ako primárne úložisko (Postgres pod kapotou).
**Dôvod:** Backend as a Service — databáza, API, auth, storage out of the box. Vibecoding friendly. LLM text-to-SQL funguje. Migrovateľné na Azure Postgres ak treba.
**Alternatívy zvažované:** Azure, AWS (príliš veľa DevOps overhead pre túto fázu), Neo4j (slabší LLM tooling).
**Dôsledok:** Nie sme locked-in. Postgres je štandard.

### D-006 — Frontend: Next.js + Vercel
**Rozhodnutie:** Next.js na Vercel, vlastná doména cez Websupport DNS.
**Dôvod:** Štandardný stack, dobrá dokumentácia, Vercel má priameho sprievodcu pre Websupport DNS.
**Dôsledok:** Doména nasmerovaná na Vercel cez A record alebo CNAME.

### D-007 — IFC Parser: ifcopenshell (Python)
**Rozhodnutie:** ifcopenshell ako ETL nástroj pre import z IFC do Supabase.
**Dôvod:** De facto štandard pre IFC parsing v Pythone. Open source, aktívna komunita.
**Dôsledok:** Python ETL pipeline: IFC → transformácia → Supabase.

### D-008 — RDF / ICDD ako export formát
**Rozhodnutie:** RDF nie je interná databáza — je to výstupný formát pre handover a archiváciu.
**Dôvod:** LLM text-to-SQL je vyriešený, text-to-SPARQL nie. Interná práca zostáva v Postgres.
**Nástroj:** Python rdflib pre generovanie RDF súborov z Postgres dát.
**Dôsledok:** Export do ICDD kontajnera (ISO 21597) pre interoperabilitu so štandardmi.

---

## 3. Databázová architektúra

### D-009 — Schéma navrhnutá ako graph v relačnej DB
**Rozhodnutie:** Tabuľky sú uzly, rel_ tabuľky sú hrany s atribútmi. Myslíme v trojiciach.
**Dôvod:** IFC je prirodzene graph. Relačná DB to simuluje ale zachováva LLM kompatibilitu. Migrácia na graph DB neskôr je mechanická transformácia — nie rewriting.
**Dôsledok:** Každá rel_ tabuľka má typ hrany, atribúty vzťahu a históriu.

### D-010 — Trojvrstvová identita objektu
**Rozhodnutie:** Každý objekt má tri vrstvy identity:
1. **Master UUID** — generovaný tvojou DB, nikdy sa nemení, kotva pre všetko
2. **Classification ID / object_ref** — ľudsky čitateľný, fyzicky použiteľný (QR kód), stabilný
3. **IFC GUID** — len atribút s históriou zmien, nie primárna identita
**Dôvod:** IFC GUID sa mení pri reexporte, prepísaní objektu alebo zmene softvéru. Tvoja DB musí vlastniť identitu.
**Dôsledok:** Tabuľka `ifc_guid_history` pre sledovanie zmien GUIDov v čase.

### D-011 — Klasifikačný systém: flexibilný
**Rozhodnutie:** Žiadny pevne daný klasifikačný systém. IFC entity `IfcClassification` a `IfcClassificationReference` — môže ich byť viac naraz.
**Dôvod:** Každý projekt môže mať iný systém (Uniclass, OmniClass, CCI, vlastný).
**Dôsledok:** Schéma podporuje viacero klasifikácií na jeden objekt bez zmeny štruktúry.

### D-012 — IFC-aligned schéma, nie priama IFC implementácia
**Rozhodnutie:** Schéma je inšpirovaná IFC 4.3 ale nie je priama implementácia. Vlastné tabuľky s ifc_guid stĺpcom a JSONB pre property sety.
**Dôvod:** Priama IFC implementácia je príliš komplexná pre vibecoding fázu. IFC-aligned schéma umožňuje prirodzený import/export bez lock-in.
**Dôsledok:** Každá tabuľka ktorá má IFC ekvivalent má `ifc_guid` stĺpec a `ifc_type` stĺpec.

---

## 4. Ontológia a štandardy

### D-013 — Priestorová hierarchia podľa IFC
**Rozhodnutie:** Site → Building → Floor → Space → Asset. Priamo z IFC priestorovej hierarchie.
**Dôvod:** Štandardizovaná, dobre zdokumentovaná, prirodzená pre import z IFC modelu.

### D-014 — Dokumenty podľa IfcDocumentInformation logiky
**Rozhodnutie:** Dokumenty majú: Identification, Name, Location (URL), Purpose, Revision, DocumentOwner, ValidFrom, ValidUntil, Status.
**Dôvod:** IfcDocumentInformation pokrýva všetky potrebné atribúty. Prepojenie na ľubovoľný objekt cez rel_ tabuľku.

### D-015 — ICDD (ISO 21597) ako export štandard
**Rozhodnutie:** Keď zákazník chce dáta odniesť — generujeme ICDD kontajner s RDF prepojeniami.
**Dôvod:** ISO štandard, vendor-neutral, podporovaný buildingSMART ekosystémom.
**Štruktúra:** ZIP s index.rdf, payload_documents/, payload_triples/.

---

## 5. Vývojový proces

### D-016 — Typy chatov
**Rozhodnutie:** Striktné oddelenie typov konverzácií:
- **Brainstorm chat** — strategické rozhodnutia, nový chat pre každú tému
- **Planning chat** — návrh konkrétnej časti, výstup je MD dokument
- **Execution chat** — Claude Code implementácia podľa plánu, nový chat pre každý feature
**Dôvod:** Zmiešanie plánovania a exekúcie degraduje kontext a kvalitu výstupu.

### D-017 — Dokumentačná štruktúra projektu
```
projekt/
├── CLAUDE.md          ← max 100 riadkov, core kontext
├── docs/
│   ├── DECISIONS.md   ← tento dokument
│   ├── SCHEMA.md      ← databázová schéma (živý dokument)
│   ├── STACK.md       ← technologické rozhodnutia
│   └── ROADMAP.md     ← fázy a priority
└── .claude/
    └── commands/      ← slash commandy pre opakované workflow
```

---

## 6. Schéma AIM Viewer (návrh dátového modelu)

### D-018 — Objektový model: centrálna `objects` + typové prípony
**Rozhodnutie:** Všetky uzly (site, building, floor, space, asset, asset_type, document, person, organization) sú riadky v jednej tabuľke `objects` (Master UUID, `object_type`, `object_ref`, `ifc_guid`, `ifc_type`, `properties`). Typovo-špecifické stĺpce žijú v tenkých 1:1 príponách (`floors`, `documents`, `persons`) s `id` ako FK na `objects(id) ON DELETE CASCADE`. Hrany `rel_` majú čisté FK na `objects(id)`.
**Dôvod:** Master UUID vlastní jedna tabuľka — skutočná „kotva pre všetko" (D-010). Čisté FK dávajú referenčnú integritu a cascade (žiadne osirelé hrany). Pridanie nového typu uzla aj vzťahu je čisto aditívne. Viewer aj LLM čítajú ľubovoľný uzol jedným dotazom na `objects`. Migrácia do graph DB ostáva mechanická: `objects` = uzly, `rel_*` = hrany, `object_type` = label.
**Alternatívy zvažované:** Polymorfné hrany (`from_table`/`from_id`) — graph-faithful, ale bez integrity na strane subjektu a s kostrbatými JOINmi; samostatná tabuľka pre každý typ — fragmentuje identitu.
**Dôsledok:** `object_type` validuje ETL/app (nie CHECK), aby pridanie typu zostalo aditívne.

### D-019 — Klasifikácia: dvojúrovňová, referenčné dáta
**Rozhodnutie:** `classification_systems` (IfcClassification) a `classification_references` (IfcClassificationReference). Nie sú to objekty. Väzba objektu na kód cez `rel_has_classification`.
**Dôvod:** Jeden kód (napr. `Ss_25_30_20`) zdieľa veľa objektov a systém má vlastné metadáta (edícia, vydavateľ) — jedna tabuľka by ich opakovala a sťažila viac systémov naraz (D-011). V IFC tiež nie sú `IfcRoot` (nemajú GUID), patria medzi referenčné dáta.
**Dôsledok:** Spresňuje pôvodnú jednu `classifications` tabuľku na dve.

### D-020 — Zodpovednosti od v1
**Rozhodnutie:** Aktori sú typ objektu; zodpovednosť cez hranu `rel_responsible_for` s `role` (IfcActorRole) a platnosťou `valid_from`/`valid_until`.
**Dôvod:** Prenos zodpovednosti pri handovere (zhotoviteľ → prevádzkovateľ) je jadro BIM→FM prechodu, ktorý AIM demonštruje (D-003). Mapuje sa na `IfcRelAssignsToActor`.
**Dôsledok:** `documents.document_owner` (text) je dočasné a neskôr ho nahradí `rel_responsible_for(role='owner')`. Granularitu aktorov spresňuje D-024.

### D-021 — Type–Occurrence vzor
**Rozhodnutie:** Type aj occurrence sú uzly v `objects`. Occurrence (`object_type='asset'`) má polohu (`rel_located_in`); type (`object_type='asset_type'`) **nikdy** nie je v priestorovej štruktúre. Väzba `rel_defined_by_type` (occurrence → type), 1:N. Dedičnosť **s prepisom**: type nesie zdieľané, occurrence prepíše. Effective hodnoty počíta `v_asset_effective` (merge properties + PredefinedType).
**Dôvod:** IFC stojí na Generic–Specific–Occurrence paradigme cez `IfcRelDefinesByType`. Type nesie spoločné property sety a parametre, occurrence polohu/sériové číslo/dátum. Pri kolízii type vyhráva, pokiaľ occurrence neprepíše; rovnako PredefinedType (occurrence ho použije len ak je type `NOTDEFINED`). Ukladať type hodnoty na occurrence (Revit workaround) zahadzuje zdieľanú vrstvu.
**Dôsledok:** `ObjectType`/`ElementType` (USERDEFINED) je IFC **atribút**, nie entita → stĺpec `user_defined_type`. Vzor je generický (process/resource types) — neskôr použijú tú istú hranu.

### D-022 — Properties: tri vrstvy, rozlíšené názvom
**Rozhodnutie:** (1) IFC **atribúty** → stĺpce na `objects`; (2) **štandardné psety** (buildingSMART, názov `Pset_`/`Qto_`) a (3) **custom psety** (akýkoľvek iný názov) → spolu v jednom `properties` JSONB, vnorené podľa názvu psetu. Štandard vs custom sa rozlišuje prefixom názvu.
**Dôvod:** IFC nemá pre štandard/custom samostatný príznak — diskriminátorom je názov psetu; `Pset_`/`Qto_` sú rezervované pre buildingSMART. Jeden JSONB priestor drží round-trip do IFC triviálny a merge type→occurrence beží nad jedným priestorom.
**Dôsledok:** ETL: čo nezačína `Pset_`/`Qto_`, je custom. Kľúče začínajúce `_` nie sú psety, ale meta/zachytené dáta. Voliteľná `property_set_templates` (bSDD validácia) odložená.

### D-023 — Klasifikácia na type aj occurrence (union faset)
**Rozhodnutie:** `rel_has_classification` povolená na type aj occurrence. Efektívna klasifikácia occurrence = **zjednotenie** vlastných + zdedených z type (`v_asset_classifications`), nie override.
**Dôvod:** `IfcRelAssociatesClassification` priraďuje klasifikáciu k `IfcObjectDefinition` (typy aj occurrence). V praxi nesú rôzne fasety: produktový kód (Uniclass Pr) na type, systémový/lokačný (Ss, SL) na occurrence — nekonkurujú si, hromadia sa.
**Dôsledok:** Schéma sa nemení. Líši sa logika oproti properties: properties = merge s prepisom, klasifikácia = union.

### D-024 — Actor model: B teraz, C plánované
**Rozhodnutie:** Aktori na úrovni **B**: `person` (prípona `persons`: given_name, family_name, email, phone) a `organization` (`objects` riadok, name = názov firmy), väzba `rel_member_of` (person → organization) ≙ `IfcPersonAndOrganization`. `rel_responsible_for` ide z osoby aj z organizácie. Úroveň **C** (org↔org hierarchia, štruktúrované adresy, intrinsic roly ako entita) **budeme implementovať v budúcnosti** ako aditívne rozšírenie.
**Dôvod:** Objektový model (D-018) robí prechod B→C čisto aditívnym — nič v B sa neprerába. Demo ukazuje previazanosť, nie úplnosť (D-003); reálny náklad C nie je schéma, ale ETL + Viewer + testovacie dáta + bloat kontextu, ktoré by sme nevyužili. Jediné riziko odloženia je strata adries/org-väzieb pri importe.
**Dôsledok:** Spresňuje D-020 (`object_type='actor'` → `person`/`organization`). Dve miesta rolí: `rel_responsible_for.role` (acting rola) vs `rel_member_of.role` (rola vo firme). **Capture-don't-structure**: kým nie je C, ETL uloží surové adresy/org-väzby do `_contact`/`_org` v `properties`.

### D-025 — Iniciálna migrácia: rozsah a implementačné rozhodnutia
**Rozhodnutie:** SCHEMA.md §2 je implementovaná ako jediná aditívna migrácia
`supabase/migrations/20260616120000_init_aim_schema.sql`. Pri implementácii:
(1) **RLS sa nezapína** — doplní sa aditívne s auth/frontendom; (2) implementované
sú **len 4 explicitne menované views**, „analogické" (`v_documents`/`v_assets`/
`v_spaces`) prídu neskôr; (3) `updated_at` triggery len na tabuľkách s tým stĺpcom
(`objects`, `classification_systems`, `classification_references`).
**Dôvod:** Držať scope iniciálnej migrácie presne na §2; RLS aj doplnkové views sú
čisto aditívne (D-018) a viažu sa na komponenty, ktoré ešte neexistujú — pridať ich
teraz by znamenalo hádať politiky/tvary bez konzumenta.
**Verifikácia:** Docker nebol dostupný → namiesto `supabase db reset` overené na
čistej lokálnej PostgreSQL 17 cez `psql` (aplikácia migrácie, dedičnosť
`v_asset_effective`, partial-unique `uniq_active_location`, `updated_at` trigger).
**Dôsledok:** Detail odchýlok je v SCHEMA.md §8. Ďalšie zmeny schémy = nové migrácie,
táto sa nikdy needituje ani nemaže.

### D-026 — AIM Viewer: stack a dátový prístup
**Rozhodnutie:** Viewer je **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**
na **Verceli** (D-006). Dáta sa čítajú **server-side** (Server Components / route
handlers) cez Supabase `service_role` kľúč; anon kľúč sa do prehliadača nedáva.
Sprintový plán je v `ROADMAP.md` (S0–S4; LLM interface a ETL sú parkované/paralelné).
**Dôvod:** Server-only `service_role` necháva DB nevystavenú a umožňuje **odložiť RLS**
presne v línii D-025 (RLS sa doplní aditívne s auth). shadcn/ui + Tailwind je
vibecoding-friendly a bez runtime lock-inu. Sprinty idú podľa narastajúcej
previazanosti dát (hierarchia → asset karta s dedičnosťou → dokumenty/zodpovednosti),
aby každý mal demovateľný výstup (D-003) a jadro (dedičnosť/union) prišlo skoro.
**Dôsledok:** Kým nie je auth, žiadny verejný endpoint nečíta DB s anon kľúčom.
LLM interface (text-to-SQL, D-005) a vlastná doména sa riešia až po S3. Reálne dáta
z ETL nahradia seed v S4 — dovtedy Viewer stavia na `supabase/seed.sql`.

### D-027 — Viewer navigácia: route per uzol
**Rozhodnutie:** Priestorová hierarchia (S1) je **route-first**: perzistentný sidebar
so stromom (`app/(viewer)/layout.tsx`) + detail uzla na samostatnej URL
`app/(viewer)/node/[id]`. Výber uzla žije v URL, nie v React state. Connection-test
z S0 presunutý na `/health`. Data-access vrstva `lib/data/spatial.ts` (server-only)
načíta `objects` + aktívne `rel_located_in` + `floors` jedným setom dotazov a poskladá
strom v pamäti (~15 uzlov, žiadna rekurzia v DB).
**Dôvod:** S2/S3 sú celé o detaile assetu (dedičnosť, klasifikácie, dokumenty,
zodpovednosti) — prirodzene server-rendered stránky s vlastnou URL. Voľbou route-first
sa strom píše raz a detail v S2 sa nemení na „presun výberu do URL"; navyše dostávame
zdieľateľné odkazy a deep-linking zadarmo. Alternatíva (výber v React state) by si
v S2 vyžiadala prepis dátového toku detailu.
**Dôsledok:** Klik na asset v S1 vedie na placeholder („detail príde v S2"). Strom je
jediný client komponent (expand/collapse, zvýraznenie aktívneho cez `usePathname`);
zvyšok je server-side.

### D-028 — AIM Viewer S2: asset karta (dedičnosť, provenance, type route)
**Rozhodnutie:** Asset karta žije vo vetve existujúcej route `/node/[id]`
(`object_type='asset'`), type detail na novej route `/type/[id]` — obe v `(viewer)`
skupine so sidebarom. Data-access `lib/data/asset.ts` (server-only).
Dedičnosť type→occurrence (D-021) sa číta z `v_asset_effective` (efektívny
`predefined_type`/`user_defined_type`, väzba na type), klasifikácie z
`v_asset_classifications` (union faset, D-023). **Provenance** properties
(vlastné / zdedené / prepísané) sa z view NEodvodzuje — view vracia už zmergované
`properties`. Načítajú sa raw `properties` typu aj occurrence a diff sa robí v TS:
kľúč len v occ = *vlastné*, len v type = *zdedené*, v oboch a rôzny = *prepísané*
(zobrazí pôvodnú hodnotu z typu), v oboch a rovnaký = *zdedené*. `ifc_guid`
(vo `v_asset_effective` chýba) sa dobral z `objects`. Properties zoskupené podľa
psetu, `Pset_`/`Qto_` = štandard vs custom (D-022), `_kľúče` skryté; klasifikácie
s badge `occurrence`/`type`.
**Dôvod:** ROADMAP S2 explicitne „tu sa ukáže dedičnosť" — samotné effective
hodnoty z view by pôvod stratili, preto provenance dopočítavame z raw vrstiev.
Merge/union RULE ostáva v DB (views = jediný zdroj pravdy); Viewer pridáva len
anotáciu pôvodu. Type route doplnená, lebo `fetchNode` (S1) filtruje len
`SPATIAL_TYPES` → `asset_type` route nemal a „link na type" by spadol na
`notFound()`. Route-first (D-027) sa drží: každý uzol má vlastnú URL.
**Dôsledok:** S3 (dokumenty, zodpovednosti, GUID história) sa pridá ako ďalšie
sekcie karty — schéma sa nemení. Generický „object route" sa zatiaľ nezavádza
(asset = provenance, type = zdieľané psety + occurrences sa líšia obsahom);
zjednotenie sa zváži, ak v S3 pribudnú detaily document/person/organization.
**Verifikácia:** lokálny dev proti Supabase Cloud seedu. AHU-01: `AirFlowRate=4800`
(prepísané, z typu 5000), HeatRecovery/Manufacturer/Pset_… zdedené, SerialNumber
vlastné, AIRHANDLER zdedený, klasifikácie `Pr_70_65_04` (type) + `Ss_55_70_70`
(occurrence). AHU-02: čistá dedičnosť (žiadny override, len `Pr_` zdedená). CERP-01:
bez typu, všetko vlastné, žiadne klasifikácie. `tsc --noEmit` + `eslint` čisté.

### D-029 — AIM Viewer S3: dokumenty, zodpovednosti, GUID história + generický object route
**Rozhodnutie:** S3 pridáva tri **generické** sekcie nad ľubovoľný `objects` uzol:
dokumenty (`rel_has_document` → `documents`), zodpovednosti (`rel_responsible_for`,
pri osobe doplnené firmou cez `rel_member_of`) a história IFC GUID (`ifc_guid_history`).
Data-access `lib/data/relations.ts` (server-only); sekcie sa zobrazia na asset karte
**aj** na priestorových uzloch (site/building/floor/space). Zároveň sa otvára
**generický „object route"**: `/node/[id]` obslúži všetky objekty okrem `asset_type`
— spatial cez `fetchNode` (S1), a `person`/`organization`/`document` cez nové detail
views (`lib/data/object.ts`). `asset_type` **redirectuje** na `/type/[id]` (S2 sémantika
ostáva oddelená). Dispatch je lacný: skús `fetchNode` (spatial graf); ak `null`,
`fetchObjectMeta` rozhodne typ. Aktori aj dokumenty sú **klikateľné na vlastný detail**
— z osoby vidno firmu (`rel_member_of`) aj všetky jej zodpovednosti (reverz
`rel_responsible_for`), z dokumentu „pripojené k" (reverz `rel_has_document`) — tým sa
graf uzatvára obojsmerne. Zobrazujú sa len **aktívne** väzby (`valid_until IS NULL`),
konzistentne s S1/S2. Surové `_contact` (capture-don't-structure, D-024) sa na org
detaile ukáže ako „zachytené" raw údaje.
**Dôvod:** ROADMAP S3 = „dokumenty + zodpovednosti + GUID história" — jadro BIM→FM
previazanosti (D-003, D-020). Generické sekcie + obojsmerné prelinkovanie ukazujú
*previazanosť*, nie izolovanú kartu. D-028 odložilo generický object route „kým
nepribudnú detaily document/person/organization" — S3 ich pridáva, takže route sa
zavádza teraz. `/type` ostáva oddelený, lebo type nie je occurrence (zdieľané psety +
zoznam occurrences vs. provenance/sekcie).
**Dôsledok:** Schéma sa **nemení** (potvrdené SCHEMA.md §8) — S3 je čisto aplikačná
vrstva. `OBJECT_TYPE_LABEL` rozšírený o `asset_type`/`person`/`organization`/`document`
(dnes len spatial). Handover (ukončené zodpovednosti cez `valid_until`) sa ukáže až s
reálnymi ETL dátami (S4); seed má len aktívne väzby. Voliteľné views
`v_documents`/`v_actors` zostávajú neimplementované — priame dotazy stačia (línia S2).
**Verifikácia:** lokálny dev proti Supabase Cloud seedu. AHU-01: manuál (link na
`/node/{doc}`), Ján Novák (operator, člen TZB Servis s.r.o.), 2 GUID záznamy (aktívny
`6ahu01…` + archív `6ahuOLD…` so zdrojom). AHU-02: maintainer Ján Novák, bez dokumentu,
bez GUID histórie (empty states). `/node/{person}`: členstvo + 2 zodpovednosti
(operator AHU-01, maintainer AHU-02). `/node/{org}`: člen Ján + `_contact`. `/node/{doc}`:
metadáta + „pripojené k AHU-01". Priestorové uzly: prázdne sekcie. `next build` +
`tsc --noEmit` + `eslint` čisté.

### D-030 — Viewer výkon (ISR cache) + navigácia ne-priestorových uzlov
**Rozhodnutie:** (1) **Sidebar navigácia**: pod priestorovým stromom (D-027) pribudli
ploché zoznamy ne-priestorových uzlov — typy assetov, osoby, organizácie, dokumenty
(`lib/data/nav.ts` + `components/sidebar-nav.tsx`). Typy vedú na `/type/[id]`, ostatné
na `/node/[id]`. Strom ostáva jediný zdroj priestorovej hierarchie; tieto uzly polohu
nemajú, preto ploché zoznamy. (2) **Výkon**: page-level čítania v `lib/data/*` sú obalené
do `unstable_cache` (revalidate 60 s, tag `"aim"`): `fetchSpatialTree`, `fetchNode`,
`fetchSidebarNav`, `fetchAsset`, `fetchAssetType`, `fetchNodeSections`, `fetchObjectMeta`,
`fetchPerson`, `fetchOrganization`, `fetchDocument`. Doplnkovo: React `cache()` na
`loadGraph` (per-request dedupe layout↔page), `loading.tsx` skeleton, paralelizácia
nezávislých dotazov (`Promise.all`). Stránky `(viewer)` majú `revalidate = 60`;
`/health` ostáva `force-dynamic` (živý connection test).
**Dôvod:** Pôvodné `force-dynamic` + sekvenčné Supabase dotazy dávali na Verceli TTFB
~1.9 s na klik. Kľúčové zistenie: samotný `revalidate` necachuje — Supabase fetche sú
v Next 16 *uncached*, takže routy ostávajú dynamické (`X-Vercel-Cache: MISS`). Cachovať
treba **dáta** (`unstable_cache`) → pri opakovanom prístupe sa Supabase netrafí. Viewer
je verejný read-only (žiadne auth/cookies/per-user dáta), takže cache je bezpečná.
Výsledok: TTFB ~1.9 s → ~0.3 s (≈6×), `loading.tsx` dáva okamžitú odozvu na klik.
**Dôsledok:** Daň je staleness — zmena seedu sa v prevádzke prejaví po ≤60 s (v `next dev`
sa cache neuplatní, build je čerstvý). Sub-50 ms (edge `X-Vercel-Cache HIT`) by si vyžiadalo
`generateStaticParams` — **neurobené zámerne**, lebo S4 vymení seed za ETL dáta a prerender
konkrétnych ID by sa zahodil. Pri zmene dát mimo revalidačného okna existuje `revalidateTag("aim")`.
Schéma sa nemení (čisto aplikačná vrstva).

---

## 7. Otvorené otázky (ešte neriešené)

- **IFC model diplomky** — doladiť property sety, klasifikácie, priestorovú hierarchiu (prerekvizita ETL)
- **LLM interface** — konkrétne queries ktoré demo ukáže (schéma to zvládne); parkované do S-LLM (D-026)
- **Verejné spustenie** — termín a forma (LinkedIn, standalone URL)
- **Ďalší rozvoj po AIM Vieweri** — procesy, MIDP/TIDP generovanie
- **property_set_templates** — voliteľná referenčná tabuľka pre bSDD validáciu psetov (až pri validácii handoveru)
- **Actor model C** — org-hierarchia, štruktúrované adresy, intrinsic roly (plánované aditívne, viď D-024)

**Vyriešené počas návrhu schémy:** dátový model AIM Viewer (D-018–D-024), type vs occurrence (D-021), actor granularita (D-024).

---

*Posledná aktualizácia: 2026-06-17 — S0–S3 hotové + deploy na Verceli (D-026–D-030). Ďalej: S4 (polish & launch — čaká na ETL reálne dáta + doménu).*
