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

### D-031 — ETL pipeline: architektúra a idempotencia
**Rozhodnutie:** ETL žije v podadresári **`etl/`** tohto repa (zdieľa SCHEMA/DECISIONS
kontext). Stack **Python + ifcopenshell**; zápis **priamo do Supabase Postgresu cez
`psycopg`** (nový server-only secret `DATABASE_URL`, nie REST — bulk upsert). Moduly:
`extract.py` (IFC → medziľahlé dicty), `transform.py` (→ riadky `objects`/`rel_*` podľa
SCHEMA + CLAUDE konvencií), `load.py` (upsert v poradí FK závislostí), `main.py`
(`--file`, `--dry-run`), `ids.py`/`db.py`/`config.py`.
**Idempotencia (re-run je stabilný):**
- `objects` → `ON CONFLICT (object_ref) DO UPDATE`; `id` ostáva **DB-generované**
  (`gen_random_uuid()`) a stabilné — verné D-010 (Master UUID vlastní DB, nie odvodené
  z volatilného IFC GUID). Po loade sa drží mapa `object_ref → id`.
- Prípony (`floors`/`documents`/`persons`) upsert podľa `id` (z mapy).
- Hrany `rel_*` nemajú prirodzený unique → **deterministické `id = UUIDv5(from_ref|to_ref|edge_type)`**,
  `ON CONFLICT (id) DO UPDATE`. `classification_systems` `id = UUIDv5(name)`,
  `classification_references` `ON CONFLICT (system_id, identification)`. `ifc_guid_history`
  `id = UUIDv5(object_ref|ifc_guid)`.
**Mapovanie** (1:1 podľa SCHEMA/§4 + CLAUDE): IFC atribúty → stĺpce; psety
(`util.element.get_psets`) → `properties`, `Pset_`/`Qto_` = štandard, ostatné custom,
`_`-kľúče sa negenerujú z psetov; type↔occurrence cez `IfcRelDefinesByType`; klasifikácie
dvojúrovňovo (`IfcRelAssociatesClassification` na type aj occurrence); GUID história
(aktívny záznam = `objects.ifc_guid`); aktori B (`IfcActor`/`IfcRelAssignsToActor`,
`_contact` capture-don't-structure, D-024).
**Dôvod:** Priamy psycopg upsert dáva rýchlu iteráciu, plnú SQL kontrolu a idempotenciu
bez SQL-artefaktu navyše (`--dry-run` SQL vypíše). `object_ref` ako konflikt-kľúč drží
`objects.id` DB-owned (D-010) namiesto odvodzovania z GUID, ktorý sa pri reexporte mení.
**Dôsledok:** ETL nahradí `supabase/seed.sql` v S4; dovtedy seed ostáva pre dev/Viewer.
**Prerekvizita (blocker):** reálny IFC z diplomky musí mať (a) stabilný zdroj pre
`object_ref` (Tag/Name; fallback GlobalId), (b) aspoň jednu klasifikáciu, (c) čistú
priestorovú hierarchiu — doladenie modelu je otvorená otázka §7.
**Verifikácia:** scaffold syntakticky overený (`py_compile`); end-to-end (IFC → DB →
Viewer ukazuje reálne dáta) až po dodaní IFC súboru.

### D-032 — PDF dokumenty: úložisko, model, prepojenie, export
**Kontext:** `documents.location` je zatiaľ len textová URL. Treba uchopiť reálne PDF
end-to-end: kam ich uložiť, ako ich zapísať do dátového modelu a ako ich exportovať.
Validované o ICDD prax (ISO 21597) aj o Daluxov produktový prístup (file naming +
metadata + hyperlinks).

**Rozhodnutie (úložisko — hybrid s explicitnou typológiou):**
- **Supabase Storage** pre nami nahrané súbory; `location` = hostovaná URL (signed).
- **Externé URL** (SharePoint/web/BIM server) — držíme len odkaz as-is.
- **Neresolvnuté** — dokument existuje (napr. z IFC), ale súbor nie je dostupný.
- Nový stĺpec **`documents.storage_type`** (`supabase | external | unresolved`), aby
  Viewer/Export vedel s `location` narábať bez parsovania URL schémy. Pridá sa **novou
  migráciou** (aditívne, nikdy needitujeme existujúcu — viď SCHEMA §7/§8).

**Rozhodnutie (model — ideme ďalej než Dalux):** dokument je **prvotriedny uzol grafu**,
nie len vizuálny hyperlink nad PDF. Využíva existujúci D-014 model:
`objects(object_type='document')` + prípona `documents` (IfcDocumentInformation polia) +
typovaná hrana `rel_has_document(from=asset/floor/building, to=document, role)`. Výhoda
oproti Daluxu: vzťah je **dotazovateľný, verziovaný a exportovateľný** (nie nakreslený na
papieri). Schéma sa nemení (okrem `storage_type`).

**Rozhodnutie (revízie/platnosť):** každá revízia = samostatný `objects` riadok
(`documents.revision`, `valid_from/until` = platnosť obsahu; `rel_has_document.valid_*`
= platnosť väzby). Supersession **implicitne** teraz (verzie s rovnakým name/identification
zoradené podľa `valid_from`); explicitná hrana `rel_supersedes` je odložená (otvorené §7).

**Rozhodnutie (export):** nový skript `etl/icdd_export.py` (rdflib) generuje ICDD
kontajner (D-015): `linkset.ttl` z `rel_has_document` (IRI z `object_ref`),
`payload_documents/` podľa prepínača **`--embed-payloads`** (embed = self-contained
handover; reference = malý balík závislý na online dostupnosti).
- `storage_type=supabase` → stiahnuť z Storage do payloadu (alebo IRI pri reference).
- `storage_type=external` → IRI na externú URL (embed voliteľný).
- `storage_type=unresolved` → len link záznam s poznámkou, mimo payloadu.

**Dôsledok:** nový Storage bucket `documents/`; nový ETL `etl/doc_upload.py` (viď D-033
pre matching); `storage_type` migrácia; ICDD export skript. Implementácia až po D-033
identity spine (object_ref musí byť zdieľaný kľúč).

### D-033 — Coding scheme: field-source resolver, object_ref a prepojenie dokumentov
**Kontext:** dokument a prvok sa musia stretnúť na rovnakom kľúči = `object_ref`. ETL ho
teraz skladá z IFC `Tag` (Revit interné číslo, napr. `959314`) — nepoužiteľné na
párovanie s výkresmi. Reálny model diplomky používa **SNIM** (6-pozičný kód
TSP·PSP·UOT·INST), kde dáta sú v psete (dvere: `IFC_Dvere.Assembly Code` = `DD01`,
`Type Mark`=6→`06`, `Mark`=3→`03` ⇒ `DD01.06.03`, presne ako na výkrese). V inom projekte
môže byť kód v `Name`, klasifikácii či inom psete. Diplomka už má aj **IDS** na validáciu.

**Rozhodnutie (field-source resolver, projektovo-nezávislý):** kódovacia schéma sa
definuje **pred projektom** (z informačných požiadaviek / EIR) ako **usporiadané typované
polia + delimitery**, nie jeden hardcoded regex (poučené z Daluxových file naming
templates). Každé pole má **deskriptor zdroja** — ETL má sadu resolverov, config ich
zapojí:
- `from: property` (pomenovaný pset alebo naprieč všetkými), `attribute` (`Name`/`Tag`/
  `ObjectType`/`Description`), `classification` (system+identification), `type_property`
  (z `IfcTypeObject`).
- voliteľné `extract:` (regex capture — pre kódy zapečené v texte, napr. `Name` = `…CC:DD02.05…`)
  a `format:` (number→text, **zero-pad** šírkou podľa výkresu, case, trim).
- `applies_to` (applicability per IFC trieda) — rovnaká štruktúra ako IDS.

**Rozhodnutie (object_ref):** `object_ref` sa **skladá zo schémy**, nie z `Tag`. Type-level
(`DD01.06` → `asset_type`) aj instance-level (`DD01.06.03` → `asset`) — inštančné
kódovanie v diplomke je kompletné (skorší blocker padol; išlo o zámenu IFC `Tag` atribútu
s property `Mark`). Fallback na `ifc_guid` len keď kód v zdroji chýba. **Nahrádza
provizórne určenie `object_ref` z D-031** (Tag/Name fallback GUID).

**Rozhodnutie (jeden zdroj pravdy):** tá istá definícia (applicability + polia) poháňa
**extrakciu** (ETL: odkiaľ čítať) aj **validáciu** (IDS: či to tam je) — obe z požiadaviek
projektu. ETL sa dodáva generické; per-projekt dostane config (časom odvoditeľný z IDS).
Žiadny nový štandard nevyžaduje zmenu kódu, len inú definíciu schémy.

**Rozhodnutie (prepojenie dokument↔prvok — bez ručného IFC):** explicitný
`IfcRelAssociatesDocument` sa v praxi nepoužíva → **zavrhnuté ako primárna cesta**.
Primárne dve cesty:
1. **Naming convention súborov** — pozičné polia + delimiter (Dalux štýl); pri uploade sa
   názov rozseká → `object_ref` + `role`. Pre legacy archívy fallback **`links.csv`** manifest.
2. **PDF text scan** (výkresy) — `pdfplumber` vyťahuje text + bounding boxy; regex je
   **odvodený zo schémy**. Bublina na výkrese nie je jeden reťazec (`DD01` a `06.03`
   zvlášť) → **proximity match** (tokeny v okruhu poskladané do kódu) + viacúrovňovo
   (`DD01` = type/podlažie stačí; `.06.03` upresní inštanciu). Match na string zložený
   z DB voči tomu, čo je v PDF (Daluxov caveat: fonty/medzery/bold ovplyvňujú detekciu).
- AI content matching (LLM nad obsahom PDF) = budúce rozšírenie, nie teraz.

**Dôsledok:** nový `etl/scheme.py` (field-source model + SNIM definícia z
`SNIM - Hierarchia.pdf`); prepis `_RefAllocator` v `etl/transform.py` (object_ref zo
schémy + padding + validačný report = náš mini-IDS); až potom dáva zmysel D-032 pipeline.
**Poradie implementácie: identity spine (object_ref) → document pipeline → ICDD export.**

### D-034 — Rozsah importu = informačné požiadavky (čo je „asset")
**Kontext:** ETL dnes berie ako `asset` **každý `IfcElement`** (mínus otvory) a ako
`asset_type` **každý `IfcTypeObject`**. Na reálnom modeli diplomky (`ASR.ifc`) to dáva
2643 „assetov" a 437 „typov" — z toho väčšina je šum: **1378× `IfcMember` (stĺpiky
fasády), 126× `IfcPlate` (výplne), 398× vnorený `IfcCurtainWall` (panely)**, a medzi
typmi **89× `IfcSpaceType` / 159× `IfcMemberType`**. Každý model je pritom iný — pevný
zoznam tried v kóde by sa pri ďalšom projekte rozsypal.

**Zistené (sken ASR IFC):** prirodzená hranica je **dekompozícia `IfcRelAggregates`**:
- **Top-level** (645) = prvok visí priamo v priestore (`ue.get_aggregate` = priestor/None)
  → reálne spravovateľné prvky (steny, dvere, strechy, dosky, VZT terminály, stĺpy,
  podhľady, fasáda ako 19 celkov, schody).
- **Nested** (1998) = prvok je *časť* iného elementu → build-up rodiča (stĺpiky, výplne,
  panely fasády, vrstvy strechy). **NIE samostatný asset.**
- **Výnimka:** `IfcWindow` (26) a `IfcDoor` (10) majú v tomto modeli rodiča
  `IfcCurtainWall` (osadené vo fasáde), ale **funkčne sú samostatné** (tých 10 dverí má
  SNIM kód) → patria medzi assety napriek vnoreniu.

**Rozhodnutie (princíp):** *„asset = to, na čo máme vypísanú informačnú požiadavku."*
Rozsah importu **nie je hardcoded v kóde**, ale vychádza z **požiadaviek projektu**
(EIR → kódovacia schéma `applies_to` / IDS applicability). Tá istá definícia tak poháňa
**tri** veci z jedného zdroja pravdy (rozširuje D-033): **(1) čo importovať** (scope),
**(2) čo dostane kódovaný `object_ref`** (extrakcia), **(3) čo sa validuje** (IDS, E6).
Priestorová kostra (site/building/floor/space) sa importuje **vždy** (aj keď nie je
„požadovaný asset" — je to skelet hierarchie). Princíp **„mimo scope ≠ zahodiť"**: prvok
sa buď neimportne, alebo importne s príznakom out-of-scope + `_`-capture (analógia
capture-don't-structure, D-024), aby sa dal neskôr promovať.

**Dôvod:** každý model je špecifický; jediný udržateľný filter je *čo projekt požaduje*,
nie zoznam tried v kóde. Zjednotenie scope+extrakcia+validácia pod jednu definíciu drží
konzistenciu a robí pridanie štandardu/triedy otázkou **inej definície, nie zmeny kódu**
(línia D-033). Štruktúrne kritérium (top-level vs sub-komponent) je IFC-natívne a nezávisí
od kvality kódovania (okná v tomto modeli **nemajú** `Assembly Code`, no stále ich chceme).

**Dôsledok (fázovanie, prevažne aditívne):**
- **Teraz (E2):** `_is_asset`/`asset_type` rozsah **číta z policy v `scheme.py`** (nie
  hardcoded): default = applicability schémy **∪** štruktúrne pravidlo (top-level +
  blacklist `IfcMember`/`IfcPlate`/vnorené panely + výnimka `IfcDoor`/`IfcWindow`).
  `IfcSpaceType` sa **nikdy** nestáva `asset_type` (priestor nie je asset).
- **Neskôr (platforma):** zdroj scope = **parsovaný IDS** projektu; viaže sa na
  *multi-projekt scoping* (§7) — každý projekt = vlastná schéma + IDS config. Výmena
  zdroja scope je aditívna, kód `_is_asset` sa nemení.
- Schéma DB sa **nemení** (čisto ETL/aplikačná vrstva).

### D-035 — Konsolidácia podlaží: pomocné Revit úrovne → reálne podlažie
**Kontext:** `ASR.ifc` má **18 `IfcBuildingStorey`**, ale len 5 sú reálne podlažia
(`1NP`–`5NP`). Zvyšok sú pomocné Revit referenčné/konštrukčné úrovne
(`1NP_SH_ZD`, `1NP_HH_ZD`, `2NP_SH_STROP`, `2NP_HH_STROP`, …, `Dojazd_výťahov`,
`0_Prahy_základová_špára`, `Spadova vrstva`). Tieto úrovne **nesú reálne assety**
(napr. `1NP_HH_ZD` 45 prvkov, `Spadova vrstva` 73), takže ich nemožno len zahodiť —
ale ako samostatné „floor" uzly by Viewer (strom triedený podľa elevácie, D-027)
zobrazil 18 kryptických podlaží = **šum** (cieľ E2 je „bez šumových uzlov").

**Rozhodnutie:** ETL **konsoliduje** podlažia (`etl/transform.py:_resolve_floors`):
- **Reálne podlažie** = názov `^\d+NP$` **alebo** aggreguje aspoň jeden `IfcSpace`.
- Pomocné úrovne sa **nepublikujú** ako `floor` uzly; ich assety/priestory sa
  premapujú na reálne podlažie podľa **NP-prefixu názvu** (`2NP_HH_STROP` → `2NP`),
  inak (názov bez NP: `Dojazd_výťahov`, `Spadova vrstva`) podľa **najbližšej elevácie**.
- `located_in` pre asset/priestor ide vždy na premapované reálne podlažie.
- Fallback: ak model nemá rozpoznateľné reálne podlažia (iný projekt), ETL ponechá
  všetky storeys (neriskuje stratu skeletu).

**Dôvod:** princíp **„mimo scope ≠ zahodiť"** (D-034) — assety z pomocných úrovní sa
zachovajú, len sa zavesia na zmysluplné podlažie. Štruktúrne kritérium (reálne =
má priestory / `NP` názov) je IFC/projektovo robustné a deterministické; demo dostane
čistú 5-podlažnú hierarchiu namiesto 18 Revit-artefaktov. Pravidlo je ETL-lokálne
(žiadna zmena DB schémy ani Viewera).

**Dôsledok:** ASR → **5 podlaží** (`1NP`–`5NP`), 89 priestorov, 681 assetov; jediný
koreň `site`. Väčšina assetov je `located_in` priamo podlažie (model ich kontajneruje
v storey, nie v space) — priestory tak môžu byť poloprázdne, čo zodpovedá modelu.
Mapovanie pomocných úrovní podľa **názvu** je závislé na Revit konvencii projektu;
iný projekt s inou konvenciou pomenovania levelov dostane vlastnú heuristiku (aditívne).

---

## 7. Otvorené otázky (ešte neriešené)

- **IFC model diplomky** — doladiť property sety, klasifikácie, priestorovú hierarchiu (prerekvizita ETL)
- **LLM interface** — konkrétne queries ktoré demo ukáže (schéma to zvládne); parkované do S-LLM (D-026)
- **Verejné spustenie** — termín a forma (LinkedIn, standalone URL)
- **Ďalší rozvoj po AIM Vieweri** — procesy, MIDP/TIDP generovanie
- **property_set_templates** — voliteľná referenčná tabuľka pre bSDD validáciu psetov (až pri validácii handoveru)
- **Actor model C** — org-hierarchia, štruktúrované adresy, intrinsic roly (plánované aditívne, viď D-024)
- **Multi-projekt scoping** — dnes 1 Supabase = 1 budova; pre platformu pridať `project`
  entitu + coding-scheme config per projekt (D-033/D-034). Aditívne, rieši sa pri 2. projekte.
- **IDS-driven import scope** — strojové odvodenie rozsahu importu z IDS applicability
  (D-034); teraz config-driven default v `scheme.py`, plné parsovanie IDS až s platformou.
- **`rel_supersedes`** — explicitná väzba revízií dokumentov (D-032); zatiaľ implicitne
  cez name + `valid_from`.
- **Instance-level INST padding** — šírka číselných polí (`Mark` `03` vs generický `001`)
  potvrdiť per pole podľa toho, čo je vytlačené na výkrese (D-033 `format.pad`).
- **AI/LLM matching dokumentov** — content-based párovanie PDF↔prvok keď naming/scan
  nestačí (D-033); až s reálnymi dátami z viacerých projektov.

**Vyriešené počas návrhu schémy:** dátový model AIM Viewer (D-018–D-024), type vs occurrence (D-021), actor granularita (D-024).
**Vyriešené v dokumentovom brainstorme:** úložisko + model + export PDF (D-032), coding scheme + object_ref + linking (D-033). Z otvorených odstránené „dokument-element linking" a spresnený zdroj `object_ref`.

---

## 7b. Dokumentová identita (E3)

### D-036 — Dokumentová naming convention = CDE štandard (ISO 19650)
**Kontext:** D-032/D-033 odložili „naming convention finálny tvar" ako otvorený bod.
Pri prvkoch je identity spine `object_ref` (coding scheme, E1); pri dokumentoch je ním
**naming convention** — názov súboru sám nesie metadáta a `doc_upload.py` ho rozseká
(rovnaký princíp ako `scheme.py` pri `object_ref`). Namiesto generického ISO 19650
preberáme **konkrétny reálny CDE štandard** (Jihočeský kraj, „Standard CDE — Společné
datové prostředí", v ISO 19650 línii) — je autoritatívny, používaný v praxi a slovník
kódov je hotový.

**Rozhodnutie (konvencia — 7 pozícií, oddeľovač `_`):**
```
Projekt _ StupeňPD _ ČástDíla _ Profese _ TypSouboru _ Číslo _ Popis
 OCB    _  DPS     _  SO01    _  ARS    _  VD        _ 101   _ Pudorys-1NP
```
- **Projekt** — jeden spoločný identifikátor (`OCB` = Office centrum Brno).
- **Stupeň PD** — fáza dokumentácie: `ADS` štúdia · `DPZ` pre povolenie · `DPS` pre
  prevedenie · `DSPS` skutočné prevedenie · `PAS` pasport · `XX` obecný. *(Priamo náš
  use-case „návrh → výstavba → prevádzka".)*
- **Část Díla** — členenie diela: `SO01` stavebný objekt / `PS01` prevádzkový súbor.
  *(Najhrubšia štruktúrovaná väzba na uzol — u nás 1 budova → `SO01` → building.)*
- **Profese** — odbor (zo zvoleného dátového štandardu, potvrdí BEP): `ARS` archi ·
  `STA` statika · `TZB`/`VZT` technika prostredia · `ZTI` zdravotech · `ELT` elektro ·
  `POZ` požiar · `STF` stavebná fyzika.
- **Typ souboru** — forma: `VD` výkres · `RP` report/správa · `SP` špecifikácia ·
  `TL` technický list · `VV` výkaz výmer · `KAL` výpočty · `SC` schéma · `DiMS` model ·
  `TP` technologický predpis · `ST` štúdia · `XX` neurčené.
- **Číslo** — poradové (`101`); môže odrážať kapitolu vyhlášky (`D-1-2-3-b-01`).
- **Popis** — ľudský, max 20 znakov, medzery/bodky → `-`.

**Pravidlá zápisu (z CDE):** oddeľovač `_` (U+005F); premenlivá dĺžka pozícií; **bez
diakritiky**; všetko VEĽKÝMI okrem Popisu; chýbajúci údaj → zástupný `X`; celá cesta
≤ 256 znakov; Popis ≤ 20 znakov.

**Status / revízia (mimo názvu):** ISO 19650 stavy `WIP → S1–S4 (zdieľané) → A1/B1
(publikované) → AB (as-built)` sa **nekódujú do názvu** — držia sa v `documents.status`
+ `documents.revision` + `valid_from` (D-032), aby názov ostal stabilný (jeden zdroj
pravdy). Mapuje sa do `documents.status`.

**Rozhodnutie (väzba dokument↔uzol):** CDE konvencia **nemá pole pre podlažie** — údaj
„1NP" žije vo voľnom Popise, nie v štruktúrovanej pozícii. Preto sa väzba **nederivuje
z názvu**, ale ide **explicitným stĺpcom `target_ref` v manifeste** (`docs.csv`):
object_ref cieľového uzla (`SO.01 - Office centrum Brno` = building, `1NP`–`5NP` = floor,
neskôr SNIM `DD01.06.03` = asset). Názov nesie metadáta, manifest nesie väzbu — čisté
oddelenie. Element-level väzba z obsahu výkresu ostáva E4 (PDF scan).

**Dôsledok:** nový `etl/doc_scheme.py` (mirror `scheme.py`: typované pozičné polia +
CDE slovníky + parser názvu → `DocumentMeta` + odvodenie `role` z Typ souboru) a
manifest `podklady/docs.csv`. Iný projekt = iný slovník v `doc_scheme.py`, kód sa nemení
(línia D-033). Konvencia rieši otvorený bod „naming convention finálny tvar" z §7.
**Referencia:** `Standard_CDE_Společné_datové_prostředí.docx` (Jihočeský kraj, v1.12.2025).

### D-040 — Priestory: zachytenie `IfcSpace.LongName` (prípona `spaces`)
**Kontext:** Vo Vieweri sa priestory (miestnosti) zobrazovali len ako číslo (`2.04`)
bez názvu. `IfcSpace` má dva textové atribúty: `Name` = číslo miestnosti a **`LongName`
= popis funkcie** (`Serverovňa`, `WC Muži`, `Openspace - Západ`). ETL ukladal len `Name`
(→ `objects.name`), `LongName` sa nikde nezachytával (v ASR má LongName všetkých 89/89
priestorov; `IfcZone` v modeli nie sú).

**Rozhodnutie:** `LongName` ide do **tenkej prípony `spaces`** (`id` FK na `objects(id)`,
`long_name text`) — verné konvencii (CLAUDE.md: IFC atribúty = stĺpce, typovo-špecifické
→ 1:1 prípona ako `floors`/`documents`/`persons`). `objects.name` ostáva číslo miestnosti
(IFC `Name`), `object_ref` tiež číslo (generický ref ho už takto rozlišuje). Pridaný
`v_spaces` (analogicky k `v_floors`). Migrácia aditívna.

**Zobrazenie (Viewer):** priestor sa renderuje ako **„číslo — popis"** (`2.04 — Serverovňa`);
label sa skladá v data-vrstve (`lib/data/spatial.ts`, join `spaces.long_name`), takže
strom, breadcrumb, deti aj hlavička uzla ho zdieľajú.

### D-041 — PDF výkres auto-linking: dôverové vrstvy matchu + element-väzby (E4)
**Kontext:** dokončenie D-032/D-033 pipeline (`etl/pdf_link.py`): PyMuPDF vytiahne slová +
bboxy z výkresov, regex **odvodený zo schémy** deteguje SNIM kódy, match na `object_ref` →
`rel_has_document(prvok → výkres)`. Bublina prvku nie je vždy jeden reťazec (`SN11` a `01`
zvlášť) → **proximity match** spojí holý Assembly Code s blízkym číselným fragmentom. Prvý
beh mal false-positives: `OV01.00.00` (výšková kóta ±0.000), `ZV01.02` (číslo osi/iného
Marku) — proximity bral aj kóty a čísla osí. Zdvihnúť `PROXIMITY_PT` nešlo: **všetkých 83
inštancií dverí** (`DD01.06.03`…) vzniká práve proximity matchom (Mark je vedľa kódu).

**Rozhodnutie (tri dôverové vrstvy podľa pôvodu detekcie, nie ladenie prahu):**
- **`full`** — celý kód s **vytlačenou bodkou** (`PD02.31`, `DD01.06.03`): dôveryhodný
  dôkaz zámeru → **exact match** na `object_ref`; bez zhody = **reálna medzera** (reportuj).
- **`proximity`** — poskladaný z dvoch blízkych tokenov (heuristika): **exact match**; bez
  zhody v DB = **šum → zahoď** (dva nesúvisiace tokeny náhodou blízko netrafia reálny ref).
  Týmto padli `OV01.00.00` aj `ZV01.02` bez straty jediného reálneho dverového matchu.
- **`bare`** — holý Assembly Code bez Marku (`SN11`, `FS01`): **prefix-match** na **typy**
  `SN11.*` (výkres ukazuje typ prvku, nie konkrétnu inštanciu — Mark na bubline chýba).

Princíp: *kód s vytlačenou bodkou je dôkaz; proximity je dohad — dohad bez cieľa v DB je
šum z kót/osí.* Žiadny SNIM hardcode mimo `scheme.py` — len logika dôvery nad detekciou.
Dôsledok: párovanie prvkov sa správa podľa toho, ako je model kódovaný — **dvere** (majú
`Mark`) linkujú na úrovni **inštancie** (`asset`), **steny/fasáda** (len typové kódovanie)
na úrovni **typu** (`asset_type`). Oboje je vecne správne.

**Rozhodnutie (zápis a idempotencia):** hrany nesú `source='pdf_link (E4)'` a `role='drawing'`,
smer **prvok → výkres** (D-014). Deterministické `edge_id(from,to,'has_document')` (`ids.py`)
→ re-run je idempotentný a **nepoškodí E3** väzby (`source='doc_upload (D-036)'`, iný `from_id`
→ iné `id`). ASR: **193 element-väzieb** (1NP 57, 2NP 39, 3NP 37, strecha 24, Rez-A 36).

**Rozhodnutie (Viewer):** E4 väzby majú **vlastnú sekciu**, oddelenú od bežných dokumentov
(diskriminátor = `source`, nie `role` — E3 aj E4 používajú `role='drawing'`):
- **asset / asset_type** → „**Zobrazený vo výkrese**" (PDF link); vyňaté z generickej
  „Dokumenty", nech sa nezdvojuje (`fetchElementDrawings`).
- **podlažie / budova** → „**Prvky vo výkrese**" — výkresy uzla + prvky auto-detegované
  v každom (`fetchFloorDrawings`); výkres bez prvkov sa skryje (PBR pôdorys 1NP = 0 prvkov).

**Dôsledok:** `etl/pdf_link.py` (tiering v `detect_codes`/`process_drawing` + prefix-index
typov `_types_by_assembly`); `lib/data/relations.ts` (+`DrawingLink`/`ElementInDrawing`/
`FloorDrawing`, `fetchElementDrawings`/`fetchFloorDrawings`); komponenty `drawing-list.tsx`,
`drawing-elements.tsx`. Schéma DB sa **nemení** (čisto ETL/aplikačná vrstva). Reportovacie
vrstvy (medzera vs. ignorovaný proximity) sú v `--show-unmatched` oddelené.

### D-042 — Interaktívna prehliadačka výkresov (klikateľné SNIM kódy) — *plánované*
**Status:** návrh na **odprezentovanie previazanosti dát** (D-003) — kostra rozhodnutá,
implementačné detaily sa **doladia počas sprintu** (pracovne sprint „DV", ROADMAP).
Nadväzuje priamo na E4 (D-041).

**Kontext:** E4 (`etl/pdf_link.py`) deteguje SNIM kódy vo výkresoch (PyMuPDF) **aj
s bounding boxmi** a rozparuje ich na `object_ref` → objekt, no dnes z toho zapíše len
hranu `rel_has_document` a **bbox zahodí**. Tým je drahá časť (detekcia + rozparovanie)
hotová; chýba len uchovať súradnice a vykresliť klikateľnú vrstvu.

**Rozhodnutie (cieľ):** výkres v appke, kde sú detegované kódy **klikateľné** → vedú na
detail prvku (`/node/[id]` / `/type/[id]`), a **opačne** z karty prvku („Zobrazený vo
výkrese") sa otvorí výkres **so zvýrazneným prvkom**. Vizuálne ukazuje práve previazanosť,
ktorá je jadro dema.

**Rozhodnutie (dáta — bez zmeny schémy):** link regióny sa uchovajú v
`documents.properties._drawing_links` (JSONB, `_`-kľúč = meta/zachytené dáta, NIE pset —
konvencia D-022). Per región: `{page, bbox, page_size, target_id, target_route, layer,
label}`. Súradnice sa ukladajú v **PDF bottom-left** + rozmer strany — y-flip a rotácia
sa riešia raz, na zdroji. **Detekcia ostáva jeden pipeline**: `pdf_link.py` plní hrany
(E4) **aj** regióny (D-042), žiadna druhá detekčná logika v JS.

**Rozhodnutie (fázovanie — MVP najprv):**
- **A — dátový základ (ETL):** `pdf_link.py` zapíše `_drawing_links` (prerekvizita B aj C).
- **B — MVP (ETL):** `etl/pdf_annotate.py` zapečie URI-link anotácie do PDF
  (`page.insert_link` → `${SITE_URL}/node/{id}`) → kódy klikateľné v **akomkoľvek**
  prehliadači, nula frontendu. URL z configu (env-špecifické).
- **C — plná in-app prehliadačka (Viewer):** route `app/(viewer)/drawing/[id]`, render
  **react-pdf** (pdf.js), overlay priehľadných `<Link>` boxov z `_drawing_links`
  (`viewport.convertToViewportRectangle`), hover highlight + zoom + stránkovanie.
- **D — obojsmernosť (Viewer):** `/drawing/[id]?focus={ref}&page={n}` z karty prvku →
  odscrolluje/zoomne na box a zvýrazní ho.

**Dôsledok / vzťah k D-038:** toto je **užšia podmnožina** parkovaného D-038 (PDF
split-screen) — **bez 3D geometrie a georeferencingu**; D-038/D-039 ostávajú kandidáti.
Schéma DB sa **nemení** (čisto ETL/aplikačná vrstva). Holý typový kód = N inštancií →
región mieri na stránku **typu** (1 cieľ). Otvorené (nie blokujúce): hĺbka zoom/pan
(mobil/touch odložiť), či zobrazovať aj `proximity`/nezhodné kódy slabšie (zatiaľ nie).

**Implementačné rozhodnutia počas sprintu DV:**
- *Fáza A (hotová):* `pdf_link.py` plní `_drawing_links` v **tom istom** pipeline ako E4
  hrany — bbox sa nesie cez `Hit`, y-flip raz cez `_to_bottom_left` (PyMuPDF top-left →
  PDF bottom-left). **Jeden región na previazaný prvok** (dedupe per `target_id`, poradie
  dôvery `full > proximity > bare`) → súčet regiónov = počet E4 zhôd (193). `jsonb_set`
  s `create_missing` = idempotentný prepis blobu, ostatné `properties`/hrany netknuté.
  0-regiónový výkres (PBR pôdorys) dostane `_drawing_links: []` (kľúč prítomný).
- *Fáza B (hotová):* `etl/pdf_annotate.py` číta `_drawing_links` (žiadna druhá detekcia)
  a cez `page.insert_link` zapečie URI-linky `${SITE_URL}/{target_route}/{target_id}`.
  **Úložisko (vyriešená otvorená otázka):** *samostatná cesta*, nie prepis — anotované
  PDF idú do `podklady/ANNOTATED/` (zrkadlí `source_path`, zdroj v `FINAL/` netknutý;
  `podklady/` je gitignored). `SITE_URL` z `etl/config.py` (env-špecifické, default =
  produkčná Vercel URL). 0-regiónový výkres sa preskočí (nevytvára prázdnu kópiu).
  Overené: 193 URI-linkov, round-trip box ↔ text kódu 23/23 (rotácia 0, offset mediaboxu
  rieši PyMuPDF interne).
- *Fáza C (hotová):* in-app prehliadačka. Route `app/(viewer)/drawing/[id]` (server) →
  `lib/data/drawing.ts` (`fetchDrawing`: `documents.location` = zdrojové PDF zo Supabase
  Storage + `_drawing_links`). Render `react-pdf` (pdf.js) v client komponente
  `drawing-viewer.tsx`, načítanej cez `drawing-viewer-loader.tsx` (`next/dynamic`,
  `ssr:false` — pdf.js potrebuje DOM/Worker). pdf.js **worker z CDN** (unpkg, viazaný na
  `pdfjs.version`) — robustné pod Turbopackom, bez bundler-špecifického riešenia.
  Klikateľné boxy = absolútny overlay nad `<Page>`; bbox (PDF bottom-left) sa škáluje na
  renderované px (`onRenderSuccess` dims, `pageSize` báza), y-flip v UI. Box = `<Link>` na
  `/{target_route}/{target_id}` + hover highlight. Toolbar: stránkovanie + zoom (0,5–3×;
  pan = scroll, touch/pinch **odložené** ako v D-042). Vstup do prehliadačky: odkaz
  „Prehliadačka" na karte prvku (`drawing-list.tsx`) aj podlažia (`drawing-elements.tsx`).
  Nová závislosť: `react-pdf@10` (+`pdfjs-dist@5`). Overené v dev/preview: 1NP render,
  57 boxov presne na kódoch, klik → detail typu, build zelený.
- *Fáza D (hotová):* obojsmernosť. Route prijíma `?focus=<id>&page=<n>`; karty prvku
  („Zobrazený vo výkrese", `drawing-list.tsx`) podávajú odkaz „Prehliadačka" s
  `?focus=<objects.id>` (id uzla dotiahnuté cez `NodeSectionsCards`/type page). Viewer
  zacieli región podľa `targetId === focus`, skočí na jeho stranu, priblíži (250 %),
  odscrolluje na box (`scrollIntoView` center) a krátko ho rozpulzuje + trvalý `ring-2`
  highlight. Soft-navigácia s iným `?focus=` znovu zacieli (`useEffect([focus])`).
  **Odchýlka od D-042 (`focus={ref}`):** focus je `objects.id`, nie `object_ref` —
  presná zhoda na `target_id` regiónu (dedupe per prvok), bez encodovania bodiek/medzier
  v object_ref. Overené end-to-end v preview: klik „Prehliadačka" → výkres so zoomom,
  zvýraznený a vycentrovaný box; opačný smer (klik kódu → detail) z fázy C.
- *Doladenie (po spätnej väzbe):*
  - **Ostrosť zoomu:** strana sa renderuje pri `devicePixelRatio` až 2× (strop
    `MAX_RENDER_PX` chráni pred obrími canvasmi), `ZOOM_MAX` zdvihnutý na 5×. Tenké
    čiary/drobný text ostávajú čitateľné (predtým raster pri ~1.25× = zubaté). Plne
    vektorový render by chcel iný engine (pdf.js SVG backend je odstránený) — zámerne nie.
  - **Bočný info-panel namiesto novej stránky:** klik na kód prvok **vyberie** (nevyskočí
    na celú stránku) a vpravo sa zobrazí kompaktný panel (`element-info-panel.tsx`):
    identita, IFC typ, PredefinedType, typ (pri asset), počty väzieb + „Otvoriť celý
    detail". Dáta z `GET /api/element/[id]` (`fetchNodeSummary`, cachované). Plochu drží
    `drawing-workspace.tsx` (riadený `selectedId`, `onSelect`); `?focus=` predvyberie
    prvok. Ctrl/⌘-klik na box stále otvorí celý detail v novej karte. `drawing-viewer-
    loader.tsx` nahradený `drawing-workspace.tsx`. Overené v preview (1440px): klik →
    panel vpravo, žiadna navigácia, render pri ratio 2×.

---

## 8. Budúce rozhodnutia (D-037+)

> Brainstorm smerov, ešte **nerozhodnuté** — sú to kandidáti, nie záväzky.
> Číslovanie rezervované; finálne rozhodnutie sa zapíše až keď príde na rad
> (najskôr post-S4, po funkčnom ETL s reálnym IFC z diplomky).

### D-037 — 3D IFC Viewer integrácia *(kandidát)*
**Kontext:** AIM Viewer je momentálne čisto dátový (S0–S3). Keď príde čas na geometrickú
vrstvu, kandidát je IFClite (`@ifc-lite/geometry` + Three.js integrácia do existujúceho
Next.js). WebGPU renderer alebo Three.js podľa browser support požiadaviek.
**Otvorené otázky:** Kedy (post-S4), ako hlboko (read-only viewer vs. mutácie), server
mód pre veľké súbory.
**Závislosť:** Vyžaduje funkčný ETL s reálnym IFC z diplomky (S4).

### D-038 — PDF / DWG výkres vedľa IFC viewera (split-screen) *(kandidát)*
**Kontext:** Stavebný sektor je závislý na 2D autorizovaných výkresoch (pečiatka).
Minimálne riešenie: split-screen — PDF viewer (`react-pdf`) na jednej strane, IFC viewer
na druhej, používateľ si porovnáva manuálne.
**Výhoda DWG oproti PDF:** DXF obsahuje vektorové entity so súradnicami, georeferencing
je potenciálne automatický. DWG → DXF konverzia zadarmo (DWG TrueView), render cez
`three-dxf`.
**Závislosť:** Vyžaduje D-037 (3D viewer).

### D-039 — Georeferencing PDF/DWG výkresov do IFC priestoru *(kandidát)*
**Kontext:** Prepojenie 2D výkresu s 3D IFC modelom cez spoločný referenčný systém.
Základný prístup: manuálne označenie bodu v PDF + zodpovedajúci bod v IFC scéne →
transform matica. Z súradnica z `floors.elevation`. Transform sa uloží do
`documents.properties` ako `_georef` — jednorazová práca per výkres.
**Algoritmizovateľná alternatíva:** IFC nesie `IfcGridAxis` (osová sieť s presnými XY
súradnicami). PDF nesie tie isté osi nakreslené v mierke (1:50, 1:100...). Flow:
extrakcia `IfcGridAxis` z IFC → detekcia osí v PDF (OCR + čiary alebo AI vision) →
párovanie minimálne 2 priesečníkov → homografia → transform matica. Mierka sa dopočíta
automaticky.
**AI potenciál:** `GPT-4 Vision` alebo špecializovaný model na detekciu osovej siete
v PDF výkrese — eliminuje manuálnu prácu pri párovaní.
**Závislosť:** Vyžaduje D-038 (split-screen), ideálne `IfcGridAxis` v ETL pipeline.

---

*Posledná aktualizácia: 2026-06-20 — E3 hotový (**D-036**): dokumentová naming convention = CDE štandard Jihočeského kraja (ISO 19650: `Projekt_StupeňPD_ČástDíla_Profese_TypSouboru_Číslo_Popis`, väzba cez `target_ref` v manifeste). Postavené: `etl/doc_scheme.py` (parser + CDE slovníky), `podklady/docs.csv`, migrácia `documents.storage_type` (aditívna), public bucket `documents/`, `etl/doc_upload.py` (13 PDF nahraných + zapísaných do grafu, idempotentné). Brainstorm §8 prečíslovaný na **D-037/D-038/D-039**. Pridané **D-040** (priestory: `IfcSpace.LongName` → prípona `spaces`, Viewer zobrazí „číslo — popis"; migrácia `spaces` + `v_spaces`, re-load ETL bez `--reset`, placeholder „Space" sa berie ako prázdny — 75/89 reálnych názvov). Pridané **D-041** (E4 PDF výkres auto-linking hotový): tri dôverové vrstvy matchu (`full`/`proximity`/`bare`) — odfiltrované false-pos `OV01.00.00`/`ZV01.02` bez straty dverí, prefix-match holých typových kódov; **193 element-väzieb** (`source='pdf_link (E4)'`, idempotentné, E3 nedotknuté); Viewer sekcie „Zobrazený vo výkrese" (asset/type) a „Prvky vo výkrese" (podlažie/budova). Pridané **D-042** (plánované) — interaktívna prehliadačka výkresov s klikateľnými SNIM kódmi (obojsmerné prvok↔výkres) na **odprezentovanie previazanosti**: link regióny v `documents.properties._drawing_links` (bez zmeny schémy, D-022), detekcia ostáva jeden pipeline (`pdf_link.py` plní hrany aj regióny), fázy A (dáta) → B (MVP URI-anotácie) → C (in-app react-pdf) → D (obojsmernosť); užšia podmnožina D-038 bez 3D/georeferencingu. Detaily sa doladia počas sprintu „DV".*
