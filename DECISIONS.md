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

**Dodatok (klientsky výkon prehliadačky výkresov):** D-030 riešilo *server* TTFB; po D-042
sa ťažisko presunulo na *klienta* (PDF prehliadačka). Tri opravy:
(1) **pdf.js worker self-hostovaný** — `drawing-viewer.tsx` ho už neťahá z `unpkg.com`,
ale cez `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`; bundler ho
vyemituje ako hashovaný same-origin asset (verzia automaticky zhodná s API → žiadny
version mismatch). Pôvodný unpkg pridával pri *každom* otvorení výkresu externé
DNS+TLS+stiahnutie ~1 MB pred parsovaním PDF (a vedel visieť / byť rate-limitovaný) —
to bola hlavná príčina „pomalého načítavania dokumentov". (2) **Preconnect** na origin
Supabase Storage (`/drawing/[id]`) — TCP/TLS handshake na PDF beží paralelne s načítaním
react-pdf bundlu, nie až po ňom (React 19 hoistne `<link rel=preconnect>`). (3) **Cache-Control**
na `/api/element/[id]` (`public, max-age=60, s-maxage=60, stale-while-revalidate=300`) —
opakovaný klik na ten istý kód vo výkrese je okamžitý, bez HTTP round-tripu (server-side
už cachované cez `unstable_cache`, toto pridáva browser/CDN vrstvu).
**Dôvod:** dáta sú malé a server-render rýchly (logy: 60–470 ms); reálna latencia bola
v klientskom PDF pipeline, dominantne externý worker z unpkg.
**Dôsledok:** žiadna zmena schémy ani dát; worker sa verzovo viaže na nainštalovaný
`pdfjs-dist` automaticky (pri upgrade netreba ručne kopírovať súbor).
**Verifikácia:** `tsc --noEmit` čisté; dev preview — worker sa načíta z
`/_next/static/media/pdf.worker.min.*.mjs` (žiadny unpkg request), výkres „Rez A" sa
vyrenderuje s 102 klikateľnými regiónmi, `/api/element/[id]` vracia očakávanú
`Cache-Control` hlavičku.

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

**Dodatok (D-042/D-043 ladenie linkovania): `IfcRailing` → `nested_keep`.** Pri overovaní
nezhôd vo výkresoch sa ukázalo, že `ZV01.02` (madlo) **je v IFC**, no chýbal v DB: všetky
madlá/zábradlia (`IfcRailing`, ZV + TV) sú modelované **vnorené v `IfcStair`**, takže
ich `_is_asset` zahadzoval ako sub-komponenty (prežil len 1 top-level kus → `ZV01.01`).
Riešenie: `IfcRailing` doplnené do `nested_keep` (vedľa `IfcDoor`/`IfcWindow`) — funkčne
samostatný prvok s vlastným SNIM kódom a informačnou požiadavkou, rovnaký dôvod ako dvere.
Zámerne **nepridané** `IfcSlab` (vrstvy strechy ST — reálne sub-komponenty; typy `ST01.*`
sú už z top-level `IfcRoof`) ani `IfcStairFlight` (ramená SH). Efekt: +11 railing assetov
(IfcRailing 1→12), nový typ `ZV01.02`; re-load ETL bez `--reset` (idempotentný upsert cez
`object_ref`) + re-run `pdf_link` → element-väzby 193→197, regióny 404→414. Pozn.: kódy
`KV*`, `ZV03/04/05`, `OV05` z výkresov **nie sú v IFC vôbec** (reálna medzera modelu, nie
import) a `OV01.00.00` je placeholder generickej legendy „POPISKA" — tieto ostávajú nelinknuté.

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
    identita, IFC typ, PredefinedType, typ (pri asset), klasifikácie/výskyty, **zoznam
    všetkých priradených dokumentov** (klikateľné na `/node/[id]`, badge „výkres" pre E4)
    + „Otvoriť celý detail". Dáta z `GET /api/element/[id]` (`fetchNodeSummary`, cachované,
    `documents` = dedupe `rel_has_document`). Plochu drží
    `drawing-workspace.tsx` (riadený `selectedId`, `onSelect`); `?focus=` predvyberie
    prvok. Ctrl/⌘-klik na box stále otvorí celý detail v novej karte. `drawing-viewer-
    loader.tsx` nahradený `drawing-workspace.tsx`. Overené v preview (1440px): klik →
    panel vpravo, žiadna navigácia, render pri ratio 2×.
  - **Prehliadačka = kanonické zobrazenie každého dokumentu:** `/drawing/[id]` slúži pre
    **ľubovoľný PDF dokument** (všetkých 13 v seede je PDF), nielen výkresy. PDF vľavo
    (overlay boxov len ak má `_drawing_links`), vpravo panel: **predvolene info o
    dokumente** (`document-info-panel.tsx` — Metadáta + „Pripojené k", mirror pôvodnej
    detail-stránky), po kliku na kód **detail prvku** so „← Späť na dokument"
    (`ElementInfoPanel onBack`). Staré `/node/[docId]` (object_type=document) **presmeruje**
    na `/drawing/[id]`; `DocumentView` odstránený. Odkazy na dokumenty (sidebar „Dokumenty",
    `document-list`, `drawing-list`/`drawing-elements` názvy) vedú na `/drawing/[id]`. Dáta:
    `fetchDocument` (panel) + `fetchDrawing` (PDF+regióny) paralelne v route. Badge hlavičky
    „Výkres"/„Dokument" podľa prítomnosti kódov. Overené: výkres (panel dokumentu →
    klik kódu → prvok → späť), bežné PDF bez kódov (badge Dokument, 0 boxov, panel),
    redirect `/node/[doc]`→`/drawing`.
  - **Filter „Pripojené k" podľa typu objektu:** panel dokumentu zoskupuje naviazané
    objekty podľa `object_type` (D-018) a ponúka filter-chipy (Podlažie / Asset / Typ
    assetu / Dokument…) s počtami + „Všetko"; zoznam má max-výšku so scrollom. Pri 1NP:
    58 = 1 podlažie + 33 asset + 24 typ assetu. Overené v preview.
  - **Región = fyzický výskyt, nie prvok (oprava dedupe):** pôvodný `pdf_link.py` robil
    dedupe regiónov per `target_id` → ten istý kód opakovaný vo výkrese (napr. `ST01.21`
    4×, `FS01.10` 3×) mal **len jeden** klikateľný hotspot, ostatné výskyty boli „mŕtve".
    Dedupe sa presunul na úroveň **(strana, bbox, target_id)** → každý fyzický výskyt =
    vlastný región; hrana `rel_has_document` ostáva 1 na prvok (sémantická väzba cez
    `matched_ids`). Frontend to už zvládal (`pageLinks` renderuje všetky, `key` s indexom).
    Efekt (`--dry-run`): regiónov **193 → 378** (Rez-A 36 → 82), väzieb stále 193.

---

### D-043 — Skladby (kompozičné značky `S1`–`S9`) ako vlastný systém značenia
**Status:** **rozhodnuté — možnosť C (link na Výpis skladieb)**, implementované. Vyvolané
diagnostikou pokrytia odkazov vo výkresoch (Rez-A). Možnosť A (skladba ako uzol) ostáva
ako budúce bohatšie rozšírenie.

**Kontext:** Vo výkresoch (najmä rezoch/detailoch) existujú **dva paralelné systémy
značenia**, ktoré sme doteraz nerozlišovali:
1. **SNIM element-kódy** (`FS01.10`, `ST01.21`, `PD02.50`…) — Assembly Code + Type Mark
   + Mark, párujú sa na `object_ref` (D-010). E4/D-041 ich deteguje a linkuje.
2. **Skladbové značky** `S1`–`S9` (hexagónové bubliny s odkazovými čiarami) — odkazujú na
   **skladby konštrukcií** (build-up vrstiev), definované vo „Výpise skladieb"
   (`D.1.1.09`, dokument `OCB_DPS_SO01_ARS_VV_109`). Sú to **kompozície vrstiev**, nie
   konkrétne prvky.

**Problém:** Skladbové značky sa **nikdy nedetegujú ani nelinkujú**, lebo (a) nesedia na
regex SNIM kódu (`^[A-Z]{2}\d{2}…` vs. `S` + 1 číslica), (b) `S` nie je TSP prefix v
schéme, a hlavne (c) **v DB neexistuje uzol skladby** — nie je sa na čo naviazať. Vizuálne
to pôsobí ako „veľa odkazov chýba", hoci ide o iný dátový druh, ktorý sme nikdy nemodelovali.

**Zvažované možnosti:**
- **A — skladba ako uzol (`object_type='assembly'`, aditívne k D-018).** Každá skladba =
  riadok v `objects`, vrstvy do `properties`, väzba prvok↔skladba. Najbohatšie, ale nový
  uzol + seed + detail UI. **Odložené ako budúce rozšírenie.**
- **B — mimo rozsah (status quo).** `S#` sa neriešia. Zamietnuté (demo nevie ukázať skladby).
- **C — link na Výpis skladieb (PDF strana). ✅ zvolené.** Bublina `S#` sa nelinkuje na
  objekt, ale **na dokument Výpis skladieb otvorený na strane danej skladby**. Reuse
  existujúcej prehliadačky (D-042) — žiadny nový `object_type`, žiadna migrácia.

**Rozhodnutie (C — implementované):**
- **Žiadny uzol skladby, žiadna hrana.** Skladba je čistý **navigačný región** v
  `_drawing_links` výkresu: `target_route='drawing'`, `target_id` = `objects.id` dokumentu
  Výpis skladieb, **`target_page`** = strana skladby, `layer='skladba'`, `label='S#'`.
  `rel_has_document` sa pre skladby **netvorí** (smer D-014 je objekt→dokument; skladba
  nemá objekt). Cena: jeden navigačný hop, nulová zmena schémy/grafu.
- **Detekcia mimo SNIM matchera (D-033 čistota).** `S#` značky riešené samostatne
  (`detect_skladby`, whitelist značiek z Výpisu) — **nie** hackom do SNIM regexu.
- **Mapa `S#` → strana z Výpisu (`read_skladby`).** Každá skladba = jedna strana; značka sa
  identifikuje kotvou: token `S#`, ktorý má vo svojej hlavičke „Skladba …" (vertikálny pás
  < 18 pt) — odfiltruje textové „S4" v špecifikácii materiálu (napr. pás „PV 200 S4 N").
  Zistené: `S1→3 … S9→10` (bez S7). Overené end-to-end v preview: klik `S1` v Reze →
  Výpis na strane 3 (vegetačná strecha, ST01.20).
- **Frontend (`drawing-viewer.tsx`):** skladbový región = `<a href="/drawing/{id}?page={n}">`
  (bežná navigácia, **bez** bočného panela/`onSelect`), vizuálne **jantárová** farba odlišuje
  skladby od prvkových kódov (primárna). `DrawingRegion` rozšírený o `targetPage` a route `drawing`.
- **Efekt (`--dry-run`/zápis):** +26 skladbových regiónov (Rez-A +20, Pôdorys strechy +6);
  spolu **378 → 404** regiónov. Element-väzby (193) nedotknuté.

**Budúce (možnosť A) — otvorené:** ak bude treba štruktúrované dáta skladby (vrstvy,
materiály, hrúbky ako uzol + väzba prvok↔skladba „z čoho je strecha zložená"), spraviť
aditívne nad C: `object_type='assembly'`, vrstvy parsované z tabuľky Výpisu, región `S#`
prepnúť z dokumentu na uzol skladby. C ostáva fallback.

---

### D-044 — IFC 3D viewer (IFClite): geometria ako ephemerálny kontajner viazaný cez GUID

**Rozhodnutie:** Do AIM Viewer sa integruje **IFC 3D prehliadačka cez IFClite**
(LTplus AG / Louis Trümpler, MPL-2.0). Kľúčový architektonický princíp:
> **Postgres drží perzistentnú pravdu o dátach. Prehliadač drží ephemerálnu geometriu**
> (parsovanú klient-side — IFC súbor neopustí browser tab). Spája ich **IFC GUID**.
> **Postgres sa geometrie NIKDY nedotkne** — žiadne meshe, žiadny geometrický cache v DB.

Toto NEporušuje D-007 (sme dátový viewer, nie geometrický): geometria sa neukladá ani
nerozoberá ako dáta — len sa renderuje klient-side a **orchestruje ako informačný
kontajner** (referencovaný, prepojený cez GUID, zabaliteľný do ICDD pri handoveri, D-015).
Orchestrovať kontajner ≠ spracovať geometriu ako dáta.

**Technológia (IFClite):**
- Rust+WASM core, `@ifc-lite/wasm` npm/CDN (**pre-built WASM — nevyžaduje Rust
  toolchain**, vibecoding-friendly, D-004); WebGL/Three.js rendering template (WebGPU
  voliteľne neskôr); ~260 KB gzip.
- Podporuje IFC2X3/IFC4/IFC4X3/IFC5 (IFCX); MPL-2.0 (použitie/úprava/redistribúcia OK).
- Modulárne (30+ TS balíkov, 5 Rust crates) — berie sa len potrebné.
- Parsing a rendering oddelené: IFClite vie len podať meshe do existujúceho scene graphu.
- Relevantné neskôr: `drawing-2d` (rezy/pôdorysy → kryje S5/S6 split-screen zámer
  D-038), `IfcQuery`+DuckDB-WASM, IDS validátor.

**Tri úrovne ambície (fázovanie S5):**
1. **Embedded 3D panel** — zobrazí IFC, žiadna väzba na dáta (najslabší príbeh;
   postačí pre vizuálny trust signal).
2. **Obojsmerná selekcia** *(cieľový demo moment)* — klik na element v 3D → asset
   karta (`/node/[id]`, D-027); klik v strome (D-027) alebo na karte (D-028) →
   zvýraznenie prvku v 3D. Spojka = IFC GUID cez `ifc_guid_history` (D-010). Mapovacia
   vrstva `Master UUID ↔ GUID` sa stavia ako **znovupoužiteľná funkcia** (volá ju aj
   úroveň 3 aj prípadný LLM interface, D-005).
3. **Query bridging** — geometrický/priestorový výber v IFClite → dotaz na DB; opačne
   dátový filter → zvýraznenie v 3D. Autorita dotazu zostáva v DB (`v_asset_effective`/
   `v_asset_classifications` = jediný zdroj pravdy, D-028); IFClite query len na to, čo
   DB nevie (geometria, priestorová proximita). Prepojiteľné s LLM interface neskôr.

**Dôvod (strategický rámec — dve publiká, jeden zážitok):**
Demo číta dve roviny toho istého toku:
- **Vyšší manažment:** farebný 3D model = trust signal, dôkaz schopnosti pokrytia
  všetkých typov informácií vrátane geometrickej. Jednoduchý vstup do dát.
- **Praktici s reálnymi dátami:** za každým prvkom — dedičnosť, GUID história,
  zodpovednosti, klasifikačné fasety (D-028/D-029/D-041). Druhá rovina rovnakého kliku.
Posolstvo nie je „vieme renderovať IFC" (komodita), ale „vieme každý typ informácie —
geometrickú, dokumentovú, vlastnostnú, klasifikačnú, zodpovednostnú — držať prepojený
okolo jednej stabilnej identity a odovzdať ako štandardný kontajner" (CDE/ISO 19650,
D-003). **3D je brána do dát a dôkaz pokrytia, nie jadro.** Dramaturgia: pekný model
upúta → klik na element → odhalí informačnú hĺbku. Obe roviny v jednom plynulom toku,
nie ako oddelené záložky.

**Riziká a mitigácie:**
- **Rozmazanie identity produktu:** 3D nesmie byť landing page — demo začína dátami,
  3D vedie späť do dát; sémantika Viewera sa nemení.
- **Scope creep:** tvrdé pravidlo — Postgres sa geometrie nedotkne (žiadny mesh/cache
  v DB). 3D je izolovaný modul; jeho pád nesmie zhodiť dátový viewer.
- **GUID bridging krehký:** IFC GUIDs nestabilné pri reexporte (D-010). Pre prvé demo:
  použiť **ten istý IFC súbor** (ASR.ifc) na render aj ako zdroj GUIDov v DB (E2 ETL)
  → GUIDs sedí triviálne; triviálnosť je zámer, nie náhoda. GUID história ako „wow" ukázať
  až s dvoma verziami IFC a otestovaným párovaním cez `ifc_guid_history`.
- **Maturita závislosti:** IFClite je mladý projekt (1.x, jeden hlavný autor); pin verziu
  (nie `latest`), preferovať `threejs` (WebGL) template pred WebGPU pre naprieč-
  prehliadačovú kompatibilitu.

**Dôsledok:**
- Logicky **S5 — paralelná vetva**, nezačína kým nie je S4 polish uzavretý, ale
  **neblokuje S4 ani DV sprint** (D-042). Schéma DB sa **nemení** (geometria nie je v DB
  — čisto aplikačná vrstva).
- Predpoklad úrovne 2: GUIDs v DB zodpovedajú renderovanému IFC. E2 ETL naloadoval
  ASR.ifc → triviálne splnené pre prvé demo (D-031); žiadny ďalší ETL nie je potrebný.
- Konkretizuje a superceduje kandidáta **D-037** (§8). Budúce D-038/D-039 (split-screen,
  georeferencing) závisia od S5 úrovne 2+.

### D-046 — IFC alignment stratégia: IFC4.3 slovník teraz, pripravenosť na IFC5/IFCX

**Rozhodnutie:** Platforma sa **sémanticky aj terminologicky zarovnáva na IFC4.3**
(dnešný súborový openBIM svet: IFC súbory, ICDD, COBie), a zároveň sa stavia tak,
aby **prechod na IFC5/IFCX bol relatívne bezbolestný**. Kľúčový posun v chápaní:
> Postgres je **engine/index nad IFC sémantikou**, nie vlastný konceptuálny model.
> Fyzický zápis (tabuľky, snake_case) je implementačný detail; pojmový model je IFC.
> „Vlastné" ostáva len to, čo IFC4.3 vyjadriť nevie — a to deklarovane a úzko.

**1. IFC-first naming (tvrdé pravidlo):**
Nový atribút/hrana/enum sa **nesmie pridať bez kontroly, či IFC4.3 pojem už má**.
Ak má → prevziať názov (snake_case per D-012) aj hodnoty enumu doslovne. Ak nemá →
deklarovaná extenzia so zápisom, kam patrí pri exporte (ICDD linkset dnes, IFCX
komponent zajtra). Zoznam extenzií žije v SCHEMA.md §5. Zabraňuje driftu synoným —
falošná „skoro-zhoda" so štandardom je horšia než priznaná extenzia.

**2. Audit proti IFC4.3 — stav a dlh:**
`documents` už je zarovnaná na `IfcDocumentInformation` (D-014): `identification`,
`description`, `location`, `purpose`, `revision`, `document_owner`, `status`,
`valid_from`, `valid_until` = priamo jej atribúty. Overené proti IFC4.3 docs
(2026-07-02): `IfcDocumentInformation` má 17 atribútov — chýbajúce (`intended_use`,
`scope`, `editors`, `creation_time`, `last_revision_time`, `electronic_format`,
`confidentiality`) sa pridajú **aditívne až keď budú treba**; `status` hodnoty
zarovnať na `IfcDocumentStatusEnum` (DRAFT/FINAL/REVISION/NOTDEFINED) — pokrýva aj
ISO 19650 stavové ambície. Hierarchia/verzie dokumentov: IFC má `IsPointer`/
`IsPointedTo` (dokument→dokument) a `HasDocumentReferences` (odkaz na časť dokumentu)
— keď príde verziovanie dokumentov, modelovať podľa toho, nie vymýšľať.

**3. Deklarované extenzie (úplný zoznam toho, čo IFC4.3 nevie):**
- **Metadáta na hrane** — `valid_from`/`valid_until`/`source`/dôverové vrstvy (D-041)
  na `rel_*`; `IfcRelAssociatesDocument` a spol. nenesú platnosť ani provenance väzby
  (pozor: `IfcDocumentInformation.ValidFrom` = platnosť *dokumentu*, nie *väzby*).
- **Identita naprieč verziami súborov** — `ifc_guid_history`, Master UUID (D-010).
- **Väzby naprieč IFC súbormi** (ARCH↔TZB federácia) — jeden IFC súbor je uzavretý
  svet; toto dnes rieši naša DB + ICDD linksety, natívne to prinesie až IFC5.

**4. Pripravenosť na IFC5/IFCX:**
IFC5 (alfa 2025/2026) = ECS model, JSON, **kompozícia vrstiev** — účastník pridáva
vlastnú vrstvu nad cudzí model bez jeho modifikácie. Naša DB je **konceptuálne presne
takáto vrstva** (procesná vrstva nad dizajnovými modelmi, ktorá ich nemení) — čiže
architektúra už dnes zodpovedá IFC5 patternu; prechod = nová serializácia, nie
prestavba. Konkrétne: sledovať alfu, **nestavať produkčné úložisko na alfe**, po
stabilizácii prototyp exportu procesnej vrstvy ako IFCX layer („naše dáta si zložíte
ako vrstvu na svoj model" — silný interop príbeh). ICDD (D-015) ostáva handover
formát dneška; obe cesty vychádzajú z tej istej sémantickej izomorfie.

**5. Build vs. borrow — update k IFClite (rozširuje D-044):**
IFClite medzičasom narástol: 2D výkresy (`drawing-2d` — pôdorysy/rezy/pohľady),
IfcQuery + DuckDB-WASM (SQL nad modelom), **IDS validácia**, BCF, federácia modelov,
editácia properties, exporty (glTF/CSV/JSON-LD/Parquet), server/desktop/Python.
Deliaca čiara: **všetko „čítanie/zobrazovanie/validácia IFC" = prebrať z IFClite;
vyrábame len identitu + procesnú vrstvu + provenance + verziovanie + cross-model
linkset** (= moat, nedá sa stiahnuť — je to dátová governance, nie softvér). Konkrétne
dôsledky: (a) **IDS = kandidátny formát pre LOIN validáciu úplnosti** (D-045) namiesto
custom pravidiel — štandardné, prenositeľné; (b) `drawing-2d` môže výrazne zlacniť
D-038/D-039 (pracovný 2D pohľad z modelu zadarmo; autorizované PDF s pečiatkou ostáva);
(c) vlastný STEP containment parsing (S5 fáza 3) časom nahradiť IFClite query API.
Riziko maturity trvá (jeden hlavný autor): pin verzií, izolovaný modul, tenká vlastná
interface vrstva.

**6. GUID stratégia pri zmene zdrojového IFC (konkretizuje D-010/D-044):**
- **Na zdroji:** v Revit export zapnúť „Store IFC GUID in element parameter" —
  povinný krok cleanup workflow (doplniť do postupu z `asr-ifc-cleanup`).
- **Primárny párovací kľúč = `object_ref`** zapísaný v modeli (IFC Name, commit
  7e87625) — naša identita, round-tripuje autoring nástrojom, prežije aj jeho výmenu.
  GUID = fallback, nie základ.
- **Matching pipeline pri reloade novej verzie** (budúci E-sprint): (a) `object_ref`
  match → (b) GUID match, pri zmene zápis do `ifc_guid_history` → (c) heuristika
  (ifc_type + name + priestorové zaradenie) → (d) manual review queue. Nespárované
  **nikdy nemazať** — označiť `valid_until` (vzor lifecycle events, D-045).

**Dôvod:** Pôvodná úvaha „vlastný slovník + mapovanie na hranici" podcenila, koľko
z našich potrieb IFC4.3 už pokrýva (viď audit §2) a kam smeruje IFC5 (vrstvy = náš
pattern). Zdieľaný štandardný slovník šetrí prácu všetkým účastníkom a robí export
serializáciou namiesto prekladu. Zároveň prax aj literatúra potvrdzujú, že IFC ako
*fyzické úložisko* je slepá ulička (riedke tabuľky, výkon) — hybrid relačné properties
+ grafové hrany, čo `objects`+`rel_*` presne je. Sémantika štandardná, engine náš.

**Dôsledok:** Schéma sa **nemení** (žiadna migrácia teraz) — `documents` už je IFC-shaped,
zvyšok je pravidlo do budúcna + aditívne doplnky. SCHEMA.md §5 rozšírená o atribútové
zarovnanie a zoznam extenzií; CLAUDE.md doplnené o IFC-first pravidlo. Follow-up
kandidáti (nie záväzky): E-sprint GUID matching pipeline (odomkne „wow" GUID histórie
z D-044 s dvoma verziami IFC), IDS/LOIN validácia cez IFClite (viaže sa na D-045),
`status` enum zarovnanie pri najbližšej práci s dokumentmi.

### D-047 — Demo north-star: LLM nad grafom + trust loop; ETL na distribučné systémy

**Rozhodnutie:** Ťažiskom dema (wow efekt) je **prirodzený jazyk nad naším grafom** —
nie hotové CDE workflow, nie GUID verziovanie (to je **podporné**, ukáže sa mimochodom).
Naratív dema predáva **disciplínu, nie nástroj**: *„keď sú vaše dáta správne previazané
(konvencia D-036 + identifikátory D-010 + IFC vzťahy), toto zvládnu aj vaše dáta."*

**Headline dotaz (must):** *„na tomto `IfcDistributionSystem` nájdi uzatvárací `IfcValve`
a v ktorej je miestnosti."* Kľúčové zistenie (over. proti IFC4.3 docs 2026-07-02): **je to
grafový dotaz, nie geometria.** Rozklad na IFC vzťahy — všetky relačné, ETL-ovateľné do
`objects`+`rel_*` bez geometrie:

| Časť dotazu | IFC4.3 mechanizmus | U nás |
|---|---|---|
| „uzatvárací" | `IfcValve`/`IfcValveType`, `PredefinedType = ISOLATING` (+ `Pset_ValveTypeIsolating.IsNormallyOpen`) | `predefined_type` stĺpec (už je) + pset do `properties` |
| „na tomto systéme" | `IfcRelAssignsToGroup` → `IfcDistributionSystem` (inverz `IsGroupedBy`) | nová hrana (IFC-kanonický názov) + uzol `object_type='system'` |
| „v ktorej miestnosti" | `IfcRelContainedInSpatialStructure` → `IfcSpace` | `rel_contained_in_spatial_structure` → `spaces.long_name` |

Fyzická konektivita „na presne tomto potrubí" existuje v IFC4.3 relačne (`IfcDistributionPort`
vnorené cez `IfcRelNests`, spojené cez `IfcRelConnectsPorts` SOURCE→SINK) — **odložené ako
rozšírenie**; must-have stojí na členstve v systéme, nie na portoch.

**LLM = vlastné rozhranie (Claude, D-005), NIE IFClite LLM.** IFClite LLM medzičasom existuje
(scripting agent, model selector Claude/GPT/Devstral), ale beží **sandboxovaný nad jedným IFC
súborom** — nevidí našu DB, PDF-ká, názvy miestností, zodpovednosti, provenance, klasifikačné
únie. Wow-odpoveď je náš graf → mozog musí byť náš. **IFClite = oči a ruky** (render, highlight,
volaný nástroj na čisto geometrický fallback), nie mozog. Autorita dotazu v DB (D-028),
guardraily D-005 (read-only, whitelist views, row limit).

**Trust loop (najväčšia hodnota):** každá odpoveď je **dohľadateľná** — deep-link do 3D
(highlight prvku cez IFClite) + do zdrojového dokumentu (región/riadok, na to už máme
`_drawing_links`, D-042). Nie „ver mi", ale „ventil V-03, systém ÚK, miestnosť 2.14 — tu je
v 3D, tu v pôdoryse, tu zdroj". Bez väzieb nie je čo citovať — a to je práve pointa pitchu.

**Dôsledok:**
- **S-LLM z parkoviska → kritická cesta.** GUID verziovanie demoté na podporné.
- **ETL rozšírenie (aditívne, D-018/D-046):** `IfcDistributionSystem` (→ `system` uzol,
  `IfcDistributionSystemEnum` → `predefined_type`), `IfcRelAssignsToGroup` (→ nová hrana),
  `IfcValve`/`IfcValveType` predefined type + psety. Containment cez existujúci `rel_contained_in_spatial_structure`.
  Názvy nových hrán = **IFC-kanonické** (viď D-046 IFC-first + pripravované sprísnenie na
  IFC-kanonickú identitu vzťahov). Schéma sa **nemení** — len nové `object_type`/hrana.
- **Upload/parse UI** = samostatná vetva (počítané, potrebné pre onboarding-naratív).

**Dôvod:** Ťažiskom hodnoty nie je render (komodita — vie ho IFClite) ani samotný LLM
(vie ho každý), ale **graf, nad ktorým sa dá pýtať a ktorého odpovede sú dohľadateľné až
k zdroju** — a ten graf existuje len ak sú zdrojové dáta poriadne štruktúrované. Demo je
dôkaz tejto tézy naživo.

### D-048 — IFC-kanonická vrstva vzťahov (rozseknutie `rel_located_in`, plné zarovnanie)

**Rozhodnutie:** Vrstva hrán sa **prestaví na IFC-kanonickú identitu** — každá hrana =
konkrétny IFC `IfcRelationship` podtyp, pomenovaná podľa neho, s **granularitou akú
rozlišuje IFC** (ISO 16739). Konkrétne `rel_located_in` sa **rozsekne** na dva vzťahy,
ktoré IFC zámerne oddeľuje. Prijímame vyššiu cenu (refaktor ETL/app/views/seed, dlhšie
trvanie) za správny fundament od začiatku. Sprísňuje D-046 (IFC-first naming) na plnú
IFC-kanonickú identitu.

**KRITICKÁ DELIACA ČIARA (aby sme si to „poriadnym" neposkazili):**
Preberáme z IFC **identitu, pomenovanie a granularitu** vzťahov. **NEpreberáme fyzickú
serializačnú štruktúru IFC.** IFC modeluje vzťahy ako *objektifikované N-árne entity*
(jeden `IfcRel` s vlastným GlobalId spája 1 subjekt s N objektmi). My držíme **binárne
hrany `from_id→to_id` + vlastné stĺpce** (`valid_from`/`valid_until`/`source`/`role`).
Toto je zámerná odchýlka a je **lepšia pre nás**: per-hrana platnosť a provenance je náš
moat (D-046 deklarovaná extenzia), binárne hrany sa lepšie dopytujú (aj pre LLM
text-to-query, D-047). „IFC ako fyzické úložisko" = doložená slepá ulička (riedke tabuľky,
zlý výkon, LLM-nepriateľské). Sme **index nad IFC sémantikou** (D-046), nie STEP v Postgrese.

**Cieľová tabuľka hrán (from = subjekt, to = objekt — naša konvencia ostáva):**

| Hrana | IFC relationship | IFC rodina | from_id | to_id | Pozn. (IFC Relating = to_id ak nie inak) |
|---|---|---|---|---|---|
| `rel_aggregates` | `IfcRelAggregates` | `IfcRelDecomposes` | časť (spatial child) | celok (spatial parent) | Site→Building→Floor→Space dekompozícia |
| `rel_contained_in_spatial_structure` | `IfcRelContainedInSpatialStructure` | `IfcRelConnects` | prvok (asset) | priestor/podlažie | element umiestnený v štruktúre |
| `rel_defines_by_type` | `IfcRelDefinesByType` | `IfcRelDefines` | occurrence | type | dedičnosť (D-021) |
| `rel_associates_document` | `IfcRelAssociatesDocument` | `IfcRelAssociates` | objekt | document | + `role` |
| `rel_associates_classification` | `IfcRelAssociatesClassification` | `IfcRelAssociates` | objekt | classification_reference | `to_id`→`classification_references` |
| `rel_assigns_to_actor` | `IfcRelAssignsToActor` | `IfcRelAssigns` | actor (person/org) | objekt | + `role`; smer = IFC (Relating=from_id) |
| `rel_assigns_to_group` | `IfcRelAssignsToGroup` | `IfcRelAssigns` | člen (element) | system (group) | **nová** (D-047, distribučné systémy) |
| `rel_member_of` | `IfcPersonAndOrganization` | — (**resource, NIE IfcRel**) | person | organization | poctivo mimo IfcRel taxonómie — nenasilu IFC názov |

**Namespace `aim_` pre naše rozšírenia (rozširuje D-022 na vrstvu vzťahov):** Hrany
**bez prefixu = IFC-kanonické** (serializujú sa na `IfcRel*`). Hrany, pre ktoré IFC
**nemá žiadny koncept**, dostanú prefix **`aim_`** (`aim_rel_*`) — snake_case kvôli D-012
(nie CamelCase `AimRel`). Prefix zároveň kóduje **export cestu**: `rel_*` → `IfcRel`;
`aim_*` → nie je IFC-serializovateľné, ide do ICDD linksetu / IFCX vrstvy. **Rezervované
pre skutočnú absenciu IFC konceptu**, nie pre IFC koncept realizovaný inak: `rel_member_of`
ostáva `rel_` (IFC ho pozná ako resource `IfcPersonAndOrganization`, len nie ako `IfcRel`).
**Dnes to nepremenováva nič** — celá súčasná sada hrán má IFC domov (validácia, že
zarovnanie je zdravé). `aim_` je **dopredná konvencia** pre budúce hrany bez IFC ekvivalentu
(napr. `aim_rel_supersedes` — verziovanie dokumentov; cross-model federačné väzby ARCH↔TZB).

**Smerová konvencia — rozhodnuté ponechať `subjekt→objekt`:** IFC používa per-vzťah
orientáciu `Relating/Related` (napr. `IfcRelContainedInSpatialStructure.RelatingStructure`
= kontajner). My držíme jednotné `from=subjekt→to=objekt` naprieč všetkými hranami
(konzistentné, query- a LLM-friendly); ktorý koniec je IFC `Relating`, je zachytené
v mapovaní vyššie. Neprevraciame smer per-vzťah — bola by to obrovská churn v ETL/app
bez zisku.

**Rozdeľovacie pravidlo (`rel_located_in` → dve tabuľky):**
`from_id.object_type ∈ {building, floor, space}` → `rel_aggregates` (spatial dekompozícia);
`from_id.object_type = asset` → `rel_contained_in_spatial_structure` (fyzický prvok v štruktúre).
Unikátny aktívny rodič (`where valid_until is null`) sa zachová na oboch (`from_id`).
Neskôr aditívne: `IfcRelReferencedInSpatialStructure` (sekundárna príslušnosť), `IfcRelNests`
+ `IfcRelConnectsPorts` (porty, D-047 konektivita) — obe majú miesto v tejto taxonómii.

**Migračná stratégia:** nová forward migrácia (`nikdy nemazať migrácie` — D nesmieme
prepisovať init): `ALTER TABLE RENAME` pre čisté 1:1 premeny; `CREATE` + `INSERT…SELECT`
(rozdeľovacie pravidlo) + `DROP` pre split `rel_located_in`; nová `rel_assigns_to_group`;
recreate views (`v_asset_effective`, `v_asset_classifications`). Dáta sú **regenerovateľné**
(ETL z IFC, D-031 + seed) → žiadne riziko straty. Pre-prod, žiadne RLS/externí konzumenti.

**Postupnosť implementácie (vetva `ifc-canonical-relations`):**
1. Migrácia (DDL + backfill split + views + indexy/uniq). 2. ETL (`etl/transform.py`,
`model.py`, `db.py`) — split spatial hrán, premenované hrany, `system`+`assigns_to_group`.
3. App (`lib/data/*.ts`, komponenty) — repoint názvov, split spatial dotazov. 4. Seed
(`supabase/seed.sql`) — alebo spoľahnúť sa na ETL. 5. Docs (SCHEMA §2.5/§5). 6. Verify
(viewer: strom, karty, 3D). Až na čistej báze staviame D-047 ETL (ventily/systémy) a S-LLM.

**Dôsledok:** Model z D-018 (`objects` + tenké prípony + typované hrany) sa **koncepčne
nemení** — mení sa počet a názvy hrán (aditívne v duchu, breaking v implementácii).
`object_type='system'` = ďalšia hodnota (validuje app/ETL, nie CHECK — D-018). CLAUDE.md
a SCHEMA.md aktualizované na cieľový stav.

### D-049 — Federácia disciplinárnych modelov (VZT) + reframe D-047 north-star

**Kontext:** D-047 určil headline dotaz „uzatvárací `IfcValve` na `IfcDistributionSystem`
+ miestnosť". Používateľ dodal `podklady/VZT.ifc` (IFC4X3_ADD2, čistý Revit re-export).
Sken modelu (2026-07-03) ukázal, že je to **čisto vzduchotechnika**: 9× `IfcDistributionSystem`
(`Prívod/Odvod-1..3NP`, `Nasávanie`, `Výfuk`, `Odpadné hospodárstvo`; `VENTILATION`/`EXHAUST`)
+ 9× `IfcRelAssignsToGroup` (členstvo hotové); ~1000 prvkov (495 `IfcDuctSegment`,
383 `IfcDuctFitting`, 139 `IfcAirTerminal`, 3 `IfcUnitaryEquipment`); 2053 portov +
1020 `IfcRelConnectsPorts`. **0 `IfcValve`, 0 `IfcSpace`.** Vlastný site/building/storey
s **inými GlobalId** než naložený ARCH model (0 zhoda GUID).

**Rozhodnutie 1 — reframe north-star:** VZT teraz pokryje **členstvo v systéme** (dotaz
„systém → prvky/jednotka", „ktorý systém obsluhuje tento prvok a na akom podlaží").
**Ventil + miestnosť ostáva cieľom**, splní sa po dodaní vodného modelu (ÚK/ZTI), ktorý
ventily aj priestorové väzby nesie. Must-have dotaz sa dočasne zužuje, cieľ sa nemení.

**Rozhodnutie 2 — federačný princíp:** Disciplinárny model sa **nefederuje cez zdieľané
GUID** (Revit exportuje disciplíny nezávisle — overené 0 zhoda), ale **napojením na
existujúcu priestorovú štruktúru cez normalizovaný názov podlažia**. Spatial korene druhého
modelu (site/building/storey/space) sa **neemitujú**; jeho prvky sa zavesia na **už
existujúce floor uzly** (VZT `1NP_VZT` → `np_key` → existujúci floor `object_ref='1NP'`;
fallback najbližšia elevácia). Cross-file väzba je **hrana, ktorej endpoint už je v DB** —
`load` ju rozrieši dotazom, neemituje duplicitný uzol. Ostávame na IFC-kanonických hranách
(containment aj membership majú IFC domov); `aim_rel_*` federačné hrany (D-048) sa zavedú
až pri väzbe bez IFC konceptu.

**Rozhodnutie 3 — MEP scope (rozšírenie D-034):** `IfcDistributionElement` sa importuje
**celý** (faithful), ale **priestorové containment (floor) dostanú len inštančne-relevantné
prvky** (`IfcAirTerminal`, `IfcUnitaryEquipment`/`IfcFlowTerminal`); potrubie a tvarovky
(`IfcDuctSegment`/`IfcDuctFitting`/`IfcPipeSegment`) sú **len členmi systému**
(`rel_assigns_to_group`), nie v priestorovom strome — „grouping" (nezáleží na inštancii).
Realizované ako **policy v `scheme.py`** (`ScopePolicy`, nie hardcode). MEP prvky nemajú
SNIM kód v `Name` → `object_ref` = GUID fallback (správne).

**Dôsledok:** Schéma sa **nemení** (`rel_assigns_to_group` existuje z D-048;
`object_type='system'` je aditívny). ETL dostane federačný režim (`--federate`, bez
`--reset`, aditívny upsert). `IfcDistributionSystemEnum` → `predefined_type`.

**Dôvod:** Jeden koherentný AIM graf (nie dve budovy v strome) je predpoklad dôveryhodného
dema (D-003) aj text-to-query (D-047). Name+elevačný match je pre tento pár modelov
(rovnaký Revit projekt) deterministický; ako všeobecný princíp ho drží konfigurovateľná
policy. Port-konektivita (`IfcRelConnectsPorts`) je odložené rozšírenie (D-047).

### D-050 — S-LLM architektúra: tool-calling nad grafom + provider-agnostická vrstva

**Kontext:** D-047 určil S-LLM (prirodzený jazyk nad grafom + trust loop) ako kritickú
cestu; D-049 dodal ETL základ (systémy + členstvo). Sprint S-LLM sa rozbieha. Dve
architektonické voľby bolo treba zafixovať pred kódom.

**Rozhodnutie 1 — tool-calling, NIE SQL-generovanie:** LLM **nedostane SQL ani DB
schému**. Namiesto toho volá uzavretú sadu **whitelistovaných grafových nástrojov**
(`lib/llm/tools.ts`), ktoré sú tenké wrappery nad existujúcou data-access vrstvou
(`lib/data/*`). Guardraily D-005 (read-only, whitelist views, row limit) sú tak splnené
**konštrukciou** — model nikdy neskladá dotaz, len vyberá z nástrojov a ich argumentov.
Tool-calling loop (zavolaj model → spusti nástroje → vráť výsledky → opakuj) žije
v **provider-neutrálnom orchestrátore** (`lib/llm/orchestrator.ts`). SQL-generovanie
ostáva dokumentovaná budúca extenzia, ak dotazy prerastú sadu nástrojov.

**Rozhodnutie 2 — provider-agnostická vrstva (plug-in „barsaký" model cez API):**
Model/provider sa vyberá **cez env, bez zmeny kódu**. Tri vrstvy:
- **Orchestrátor** (neutral) — normalizované typy `ChatMessage`/`ToolSpec`/`ProviderTurn`.
- **Adaptér** (`lib/llm/providers/*`) — preklad do/z konkrétneho API. Dva stačia na
  prakticky ľubovoľný model: `anthropic` (`/v1/messages`, tool_use/tool_result bloky)
  a `openai-compat` (`/chat/completions`, `tools`/`tool_calls`). OpenAI-kompatibilný
  adaptér + konfigurovateľná `LLM_BASE_URL` obslúži OpenAI, OpenRouter, Groq, Together,
  DeepSeek, lokálne vLLM/Ollama/LM Studio.
- **Kľúč = univerzálny kontrakt:** JSON-schema definície nástrojov sú prenosné naprieč
  providermi — `tools.ts` je provider-neutrálny, líši sa len drôtový formát v adaptéri.

**Implementačné poznámky:**
- Bez novej npm závislosti — adaptéry volajú API cez `fetch` (obe API sú jednoduché HTTP).
  Menej lock-inu, menšia plocha, funguje aj offline/lokálny endpoint.
- Env: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` (voliteľné),
  `LLM_MAX_TOKENS`, `LLM_TEMPERATURE`. Factory `getLlmProvider()` číta env; **žiadny
  model-id natvrdo v kóde** (chýbajúci `LLM_MODEL`/`LLM_API_KEY` → jasná chyba).
- Kľúč je **server-only** (route handler `app/api/ask`), nikdy do prehliadača (D-025/D-026).
- **Trust loop:** každá odpoveď nesie `citations[]` (objekt → `/node/{id}`, 3D `?focus=<guid>`
  cez `ifc_guid`, dokument → výkres). Citácie skladá orchestrátor z tool-výsledkov —
  deterministicky z dát, nie parsovaním textu. System-prompt vynucuje „odpovedaj len
  z výsledkov nástrojov; ak nič, povedz to; cituj zdroj".

**Dôsledok:** Schéma sa **nemení**. Nová vrstva `lib/llm/*` + `lib/data/systems.ts`
(D-049 dotazy) + `app/api/ask/route.ts`. Fázy: F1 rúra (adaptéry + orchestrátor + API +
prvé nástroje) → F2 D-049 jadro → F3 UI panel → F4 polish. Prompted-JSON fallback pre
modely bez natívneho tool-callingu = neskoršie rozšírenie adaptéra.

**Dôvod:** Hodnota dema je graf a dohľadateľnosť (D-047), nie konkrétny model — preto
model vymeniteľný a mozog (výber nástrojov + citácia) náš. Tool-calling drží guardraily
lacno a robí citácie deterministickými.

---

## 8. Budúce rozhodnutia (D-037+)

> Brainstorm smerov, ešte **nerozhodnuté** — sú to kandidáti, nie záväzky.
> Číslovanie rezervované; finálne rozhodnutie sa zapíše až keď príde na rad
> (najskôr post-S4, po funkčnom ETL s reálnym IFC z diplomky).

### D-037 — 3D IFC Viewer integrácia *(→ rozhodnuté ako D-044)*
**Status: supercedovaný D-044** — rozhodnutie prijaté, viď D-044 (IFClite, S5,
paralelná vetva, obojsmerná selekcia cez IFC GUID). Predpoklad ETL (S4) splnený (E2 ✅).
**Kontext (zachovaný pre históriu):** AIM Viewer je momentálne čisto dátový (S0–S3). Keď príde čas na geometrickú
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

### D-045 — Pasportizácia existujúcich budov + posun k dynamike *(kandidát)*
**Status:** brainstorm — strategické smery rozhodnuté, konkrétna zákazka nepotvrdená.

**Kontext:** Nový use-case — pasportizácia existujúcej budovy pre prevádzku a údržbu
(priestorový, technický/TZB, stavebný pasport, vybavenie). Zákazka v hre (zákazník bez
CAFM), ale nie dotiahnutá — preto kandidát, nie finálne rozhodnutie.
Odborný rámec overený: MPO ČR Pravidlá pre prevádzkovú pasportizáciu 2024 (statické dáta
→ pasport; dynamické → CAFM); COBie handover štandard (Facility/Floor/Space/Type/Component/
System/Contact/Document ≈ 1:1 s `objects` schémou → export prirodzený); USIBD LOA (measured
vs represented accuracy) + LOIN/LOI (ISO 19650) pre provenance/kvalitu; v praxi provenance
na úrovni scan session / survey batch, nie per-property.

**Rozhodnuté (platí bez ohľadu na zákazku):**
1. **Zostávame data/CDE provider (D-001)** — Nestávame sa CAFM. Funkcie delíme: statické
   dáta (čo budova je) = naše; dynamické (čo sa s ňou deje) = operatíva.
2. **Platform features (patria do platformy):** 360° fotky naviazané na space/asset (vizuálna
   provenance zamerania), prepojenie 360°/2D/3D na IFC model (reálny diferenciátor, S5/S6
   vízia), pasportizačný register s provenance/LOA, validácia úplnosti (LOIN-driven), export
   do CAFM (COBie/ICDD, D-015).
3. **Dynamika = hybrid — Cesta A teraz, dvere k B.** Cesta A = governance/monitoring nad
   operatívou (sledovanie, či sa pravda v pasporte nerozchádza s realitou). Cesta B =
   vlastnené dynamické dáta = neskôr, až keď reálna prevádzka povie, čo treba postaviť.
4. **Pre zákazku — Odoo as-is** (žiadna prestavba). Odoo berie prevádzkový náklad (24/7);
   my platíme len lacnú integráciu. Prestavba zamietnutá — tretí stack, verziová pasca,
   slabší vibecoding leverage; ak investovať vývoj do operatívy, tak do vlastného stacku
   (Cesta B), nie do cudzieho frameworku. Zákazka = field study pre budúcu vlastnú vrstvu.
5. **Deliaca čiara** (lacné vyriešiť, vysoká hodnota): identita/lokácia/typové vlastnosti/
   klasifikácie/dokumenty → pasport (naše); stav/work orders/servisy/náklady → operatíva.
   Toto je governance diferenciátor.

**Dôsledok pre schému:** ŽIADNA zmena. Nové `object_type` hodnoty (napr. `door`/`window`
ako maintainable assets, povrchy ako properties priestoru), nové `rel_*` hrany, lifecycle
events (vzor `ifc_guid_history` s `valid_from`/`valid_until`) + integračná vetva na Odoo =
všetko aditívne. Model z D-018 to drží.

**Otvorené (do potvrdenia zákazky):** granularita provenance (objekt vs session batch),
stavebný pasport (povrchy ako properties priestoru vs samostatné objects), mapa vlastníctva
polí pasport↔Odoo, metóda zamerania (3D scan/Matterport/ručne — zatiaľ neurčené).

**Závislosť:** Vyžaduje reálnu zákazku (field study) + funkčný ETL pipeline (D-031).

---

*Posledná aktualizácia: 2026-07-02 — Pridané **D-047** (Demo north-star): ťažisko dema = LLM nad naším grafom + trust loop (dohľadateľné odpovede), nie CDE workflow ani GUID verziovanie (podporné). Headline dotaz „uzatvárací ventil na systéme + miestnosť" = grafový dotaz (over. IFC4.3: `IfcValveType.ISOLATING`, `IfcRelAssignsToGroup`→`IfcDistributionSystem`, containment→space), ETL-ovateľný bez geometrie. LLM = vlastné rozhranie (D-005), NIE IFClite LLM (sandbox nad IFC súborom, nevidí našu DB/PDF/miestnosti); IFClite = oči, nie mozog. S-LLM → kritická cesta; ETL rozšírenie na distribučné systémy/ventily (aditívne). Otvorené: sprísnenie IFC-kanonickej identity vzťahov (rename vs. per-row `ifc_class` diskriminátor pre `rel_located_in`) — čaká na potvrdenie. Predtým 2026-07-02 — Pridané **D-046** (IFC alignment stratégia): IFC4.3 slovník teraz + pripravenosť na IFC5/IFCX. Overené proti IFC4.3 docs: `documents` už zarovnané na `IfcDocumentInformation` (D-014, vrátane `valid_from`/`valid_until` — sú to IFC atribúty); deklarované extenzie zúžené na metadáta-na-hrane, GUID históriu a cross-file väzby (export: ICDD dnes, IFCX layer zajtra); IFC-first naming pravidlo (nový atribút až po kontrole IFC4.3); build-vs-borrow update k IFClite (IDS→LOIN kandidát pre D-045, `drawing-2d` zlacňuje D-038/D-039); GUID stratégia pri re-exporte (`object_ref` primárny kľúč, Revit store-GUID parameter, matching pipeline ako budúci E-sprint). Schéma sa nemení. Predtým 2026-06-28 — **Zjednotenie vetiev do `main`**: 3D viewer (D-044) dotiahnutý na **úroveň 3 — query bridging** (floor filter cez STEP containment + Three.js visibility, Escape = zruš výber, obojsmerný DB↔3D filter bar, `/api/filter` + `/api/space-siblings`, `lib/data/filter.ts`); zlúčené aj code-review optimalizácie (error boundaries `app/**/error.tsx`, migrácia `20260628120000_missing_indexes.sql`, dedup refactory v `lib/data/*`). Superseded vetva `ifclite-library-review` zahodená (jej obsah je podmnožinou query-bridging; prenesený len konfigurovateľný back-label panela). Pridané **D-045** (kandidát): Pasportizácia existujúcich budov + posun k dynamike — brainstorm (zostávame data/CDE provider, platform features 360°/register/LOIN/COBie, dynamika Cesta A teraz + B neskôr, Odoo as-is, deliaca čiara pasport↔operatíva); ŽIADNA zmena schémy. Predtým 2026-06-22 — **sprint DV hotový**: D-042 fázy A–D (interaktívna prehliadačka výkresov, klikateľné SNIM kódy, obojsmerne) + doladenia (bočný info-panel, prehliadačka = kanonické zobrazenie PDF, filter „Pripojené k", región = fyzický výskyt kódu) + **D-043** (skladby `S1`–`S9` → Výpis skladieb) + **D-030 dodatok** (klientsky výkon: self-hostovaný pdf.js worker, preconnect Storage, cache `/api/element`) + **D-034 dodatok** (`IfcRailing` ako asset, madlá ZV 1→12). Linking: **197 element-väzieb / 414 link-regiónov**. Predtým 2026-06-22 — Pridané **D-044** (IFC 3D viewer — IFClite): geometria ako ephemerálny kontajner klient-side (Rust+WASM, WebGL/Three.js template); princíp Postgres=dáta / prehliadač=ephemerálna geometria / spojka IFC GUID cez `ifc_guid_history`; tri úrovne ambície (embedded panel → obojsmerná selekcia → query bridging); zariadené ako S5 paralelná vetva (neblokuje S4/DV). Superceduje kandidáta D-037. Schéma DB sa nemení. Predtým 2026-06-20 — E3 hotový (**D-036**): dokumentová naming convention = CDE štandard Jihočeského kraja (ISO 19650: `Projekt_StupeňPD_ČástDíla_Profese_TypSouboru_Číslo_Popis`, väzba cez `target_ref` v manifeste). Postavené: `etl/doc_scheme.py` (parser + CDE slovníky), `podklady/docs.csv`, migrácia `documents.storage_type` (aditívna), public bucket `documents/`, `etl/doc_upload.py` (13 PDF nahraných + zapísaných do grafu, idempotentné). Brainstorm §8 prečíslovaný na **D-037/D-038/D-039**. Pridané **D-040** (priestory: `IfcSpace.LongName` → prípona `spaces`, Viewer zobrazí „číslo — popis"; migrácia `spaces` + `v_spaces`, re-load ETL bez `--reset`, placeholder „Space" sa berie ako prázdny — 75/89 reálnych názvov). Pridané **D-041** (E4 PDF výkres auto-linking hotový): tri dôverové vrstvy matchu (`full`/`proximity`/`bare`) — odfiltrované false-pos `OV01.00.00`/`ZV01.02` bez straty dverí, prefix-match holých typových kódov; **193 element-väzieb** (`source='pdf_link (E4)'`, idempotentné, E3 nedotknuté); Viewer sekcie „Zobrazený vo výkrese" (asset/type) a „Prvky vo výkrese" (podlažie/budova). Pridané **D-042** (plánované) — interaktívna prehliadačka výkresov s klikateľnými SNIM kódmi (obojsmerné prvok↔výkres) na **odprezentovanie previazanosti**: link regióny v `documents.properties._drawing_links` (bez zmeny schémy, D-022), detekcia ostáva jeden pipeline (`pdf_link.py` plní hrany aj regióny), fázy A (dáta) → B (MVP URI-anotácie) → C (in-app react-pdf) → D (obojsmernosť); užšia podmnožina D-038 bez 3D/georeferencingu. Detaily sa doladia počas sprintu „DV".*
