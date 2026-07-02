# ROADMAP.md — AIM Viewer (fázy a priority)

> Sprintový plán prvého use case **AIM Viewer** (D-003).
> Princíp: **každý sprint končí niečím demovateľným**, poradie ide podľa
> narastajúcej „previazanosti" dát — to je celé posolstvo demo (D-003).
> Konvencie a rozhodnutia: `CLAUDE.md` + `DECISIONS.md` (D-026 = Viewer stack).

---

## Stav (2026-06-28)

> 🔍 **Konsolidačná / review fáza prebieha — vetvy zjednotené do `main`.** S0–S3 + E1–E4
> hotové. Počas review passu sa (a) dotiahol **sprint DV** (interaktívna prehliadačka
> výkresov, D-042 fázy A–D + D-043) a (b) **3D IFC viewer (S5, D-044)** sa zjednotil
> z paralelných vetiev a doviedol až na **úroveň 3 — query bridging** (floor filter,
> obojsmerný DB↔3D filter, Escape deselect). Zlúčené aj code-review optimalizácie
> (error boundaries + DB indexy). **E5 (ICDD export) ostáva odložené.** Cieľ nezmenený:
> stabilný, vyladený demovateľný stav.
>
> **Zjednotenie 2026-06-28:** `main` = 3D baseline (Phase 1+2) + `query-bridging-phase-3`
> (Phase 3) + `code-review-optimization`; superseded `ifclite-library-review` zahodená
> (prenesený len konfigurovateľný back-label). Pridaný kandidát **D-045** (pasportizácia).

- ✅ Schéma + iniciálna migrácia (`20260616120000_init_aim_schema.sql`, D-025)
- ✅ Seed dáta (`supabase/seed.sql`) — plná previazanosť: hierarchia, type–occurrence, aktori, dokumenty, klasifikácie, GUID história
- ✅ S0 — Next.js skeleton + Vercel deploy + Supabase connection (D-026)
- ✅ S1 — Priestorová hierarchia: strom + route per uzol (D-027)
- ✅ S2 — Asset karta: dedičnosť + provenance, klasifikácie, type route (D-028)
- ✅ S3 — Dokumenty + zodpovednosti + GUID história, generický object route (D-029)
- 🟢 **Teraz:** S4 — polish & launch (reálne dáta **naloadené** z ETL; ostáva doména + polish)
- 🟢 ETL pipeline (Python + ifcopenshell, D-031) — **E2 hotový**: reálny load z `ASR.ifc` do Supabase (926 uzlov, 5 podlaží), Viewer beží na reálnej budove namiesto seedu
- 🟡 Dokumenty + coding scheme (D-032/D-033) — **rozhodnuté**, rozpísané do E-sprintov (E1–E6); **E1–E4 hotové** (E4 = PDF výkres auto-linking, D-041, 193 element-väzieb + Viewer sekcie)
- ⏸️ **E5 (ICDD export) — odložené** do uzavretia review pass (viď poznámka v Stave)
- ✅ **DV — Interaktívna prehliadačka výkresov** (klikateľné SNIM kódy, obojsmerne) —
  **HOTOVÉ** (D-042 fázy A–D + doladenia, D-043 skladby). Headline demo feature na
  odprezentovanie previazanosti (D-003). **197 element-väzieb / 414 link-regiónov.**
- ✅ **S5 — IFC 3D viewer** (D-044): **fáza 1+2+3 hotové a zjednotené v `main`** — IFClite
  WASM klient-side, obojsmerná selekcia 3D↔dáta cez IFC GUID, **query bridging** (floor
  filter, DB↔3D filter bar, Escape deselect). Schéma DB sa nemení.
- 📋 **D-045 — Pasportizácia + dynamika** (kandidát) — brainstorm, čaká na reálnu zákazku
- ⏸️ LLM interface — **parkované** (S-LLM), doladíme neskôr

**Máme:** Supabase Cloud (projekt `acwoupricatirhlfkhvk`) + GitHub repo (`AssetinSpace/AIMviewer`) + Vercel deploy (auto-deploy z `main`). **Chýba zatiaľ:** vlastná doména (príde v S4).

---

## Stack rozhodnutia (D-026)

- **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui** — vibecoding-friendly (D-006).
- **Dátový prístup cez Server Components / route handlers so `service_role` kľúčom**
  (server-only). DB ostáva nevystavená, **RLS sa nezapína** (línia D-025).
  Anon kľúč sa do prehliadača nedáva, kým nepríde auth + RLS.
- **Hosting Vercel** (D-006) — projekt sa zakladá v S0; vlastná doména až keď bude demo verejné.

---

## Sprinty

| Sprint | Cieľ (demovateľný výstup) | Kľúčové dáta |
|---|---|---|
| **S0 — Skeleton & deploy** ✅ | Next.js app beží lokálne aj na Verceli (default `*.vercel.app`), Supabase klient pripojený, test-fetch z `objects`. Repo prepojené s Vercelom (auto-deploy z `main`). | `objects` |
| **S1 — Priestorová hierarchia** ✅ | Strom Site→Building→Floor→Space→Asset; klik na space → zoznam assetov. Data-access vrstva nad `objects` / `rel_located_in`. | `rel_located_in`, `v_floors` |
| **S2 — Asset karta (jadro)** ✅ | Detail assetu: properties s provenance (vlastné/zdedené/prepísané), zdedený `predefined_type`, link na type `/type/[id]`, breadcrumb, klasifikácie s badge `occurrence`/`type`. **Tu sa ukáže dedičnosť.** | `v_asset_effective`, `v_asset_classifications` |
| **S3 — Dokumenty + zodpovednosti** ✅ | Na karte (a genericky na každom uzle): dokumenty (`rel_has_document`), zodpovedné osoby/firmy s rolami a platnosťou (`rel_responsible_for`, `rel_member_of`), panel histórie IFC GUID. Klikateľné detaily person/organization/document — generický object route (D-029). | `documents`, `persons`, `ifc_guid_history` |
| **S4 — Polish & launch** 🟢 | Vizuálny polish, responsivita, empty states; výmena seedu za reálne ETL dáta z diplomky; vlastná doména + verejné spustenie. | — |
| **S5 — IFC 3D viewer** ✅ fáza 1–3 | 3D panel (IFClite, klient-side WASM); **obojsmerná selekcia**: klik na element v 3D → asset karta (`/node/[id]`), klik v strome/karte → zvýraznenie v 3D; **query bridging** (floor filter cez STEP containment, DB↔3D filter bar, Escape deselect). Spojka = IFC GUID cez `ifc_guid_history`. Schéma DB nezmenená. | D-044, `ifc_guid_history` |

### Detail

**S0 — Skeleton & deploy**
- `create-next-app` (TS, App Router, Tailwind), pridať shadcn/ui.
- Supabase JS klient, server-only `service_role` v env (`.env.local`, na Verceli ako secret).
- Založiť Vercel projekt z GitHub repa, auto-deploy z `main`.
- Akceptačné: stránka na `*.vercel.app` zobrazí `select count(*) from objects`.

**S1 — Priestorová hierarchia**
- Query helpery nad `objects` + `rel_located_in` (rekurzia/úrovne).
- Navigovateľný strom; výber space → assety v ňom.
- Akceptačné: prejdem z site až po konkrétny asset cez seed dáta.

**S2 — Asset karta (jadro previazanosti)** ✅ (D-028)
- Čítať `v_asset_effective` (merge + dedičnosť), `v_asset_classifications` (union faset).
- Properties zoskupené podľa psetu; `Pset_`/`Qto_` = štandard, ostatné = custom; `_kľúče` skryté.
- Provenance per property (vlastné/zdedené/prepísané) z diffu raw type↔occurrence; link na type → `/type/[id]`.
- Akceptačné ✅: AHU-01 ukáže `AirFlowRate:4800` (override) + zdedené z type + obe klasifikácie.

**S3 — Dokumenty + zodpovednosti** ✅ (D-029)
- `rel_has_document` → `documents`; `rel_responsible_for` (role, platnosť) + `rel_member_of`.
- Panel `ifc_guid_history` (aktívny + archivované). Sekcie generické na každom uzle.
- Generický object route `/node/[id]` (person/organization/document detail) + obojsmerné
  prelinkovanie; `asset_type` → redirect na `/type/[id]`.
- Akceptačné ✅: na AHU-01 vidno manuál (link), Jána Nováka (operator, člen TZB Servis)
  a 2 GUID záznamy; klik na osobu → jej 2 zodpovednosti + členstvo; klik na dokument →
  „pripojené k AHU-01".
- Polish (D-030): sidebar nav na typy/osoby/organizácie/dokumenty; ISR cache
  (`unstable_cache`, revalidate 60 s) + `loading.tsx` — TTFB na Verceli ~1.9 s → ~0.3 s.

**S4 — Polish & launch**
- Závisí od ETL vetvy (reálne dáta). Doména + verejné spustenie (D-007 otvorená otázka).

**S5 — IFC 3D viewer** ✅ fáza 1–3 hotové (D-044)
> Paralelná vetva — zjednotená do `main` 2026-06-28. Predpoklad: GUIDs v DB zodpovedajú
> renderovanému IFC. E2 ETL naloadoval ASR.ifc → triviálne splnené; ten istý súbor na
> render aj ako zdroj GUIDov v DB (D-044, zámer). Route `/ifc` (`app/(viewer)/ifc/page.tsx`),
> render `components/ifc-viewer.tsx`, orchestrácia `ifc-workspace.tsx`, GUID mapa `lib/data/ifc.ts`.
- **Fáza 1 — Embedded 3D panel ✅:** IFClite (`@ifc-lite/wasm`, WebGL/Three.js template)
  vložený do Viewera; zobrazuje ASR.ifc klient-side (`exportGlb` → GLTFLoader). Izolovaný
  modul (`ssr: false`) — jeho pád nezhodí dátový viewer. WASM self-hostovaný z `public/`.
- **Fáza 2 — Obojsmerná selekcia ✅** *(cieľový demo moment):* klik/raycast na element v 3D →
  asset karta (`/node/[id]`) v bočnom paneli + highlight; `?focus=<guid>` z karty/stromu →
  zvýraznenie + zoom v 3D. Spojka = IFC GUID (`exprToGuid` z STEP textu ↔ `guidMap` z
  `ifc_guid_history`). Touch picking na mobile. Mapovacia funkcia znovupoužiteľná pre fázu 3.
- **Fáza 3 — Query bridging ✅:** floor filter (STEP containment parse + Three.js visibility),
  obojsmerný DB↔3D filter bar (`components/filter-bar.tsx`, `/api/filter`, `lib/data/filter.ts`),
  priestorový kontext picknutého prvku (`/api/space-siblings`), Escape = zruš výber. Autorita
  dotazu zostáva v DB (`v_asset_effective`, D-028).
- **Guardraily:** Postgres sa geometrie nedotýka (žiadny mesh/cache v DB); pin verzia
  IFClite (nie `latest`); Three.js WebGL template (nie WebGPU).
- Akceptačné ✅ (fáza 2): klik na konkrétne dvere v 3D → asset karta s provenance,
  zodpovednosťami, výkresom; klik v strome → zvýraznená v 3D. Schéma DB sa **nemení**.

---

## Parkované / paralelné

- **S5 — IFC 3D viewer** (paralelná vetva, D-044): IFClite WASM/Three.js, obojsmerná
  selekcia 3D↔dáta cez IFC GUID. Nezačína kým nie je S4 uzavretý; **neblokuje S4/DV**.
  Schéma DB sa nemení (geometria klient-side, Postgres sa jej nedotýka).
- **S-LLM — LLM interface** (parkované, doladíme neskôr): chat nad dátami,
  Claude text-to-SQL (D-005) s guardrailmi (read-only, whitelist views, row limit).
  Model sa vyberie pri spustení (`claude-opus-4-8` vs lacnejší pre demo).
- **ETL pipeline** (paralelná vetva, D-031): `ifcopenshell` IFC → `objects`/`rel_*`,
  nahradí ručný seed reálnymi dátami z diplomky (vstup pre S4). **Scaffold v `etl/`**
  (extract/transform/load, idempotentný upsert, CLI) hotový a syntakticky overený;
  ostáva doladiť mapovanie (`TODO(model)`) a spustiť end-to-end na reálnom IFC.

## ETL + Dokumenty — paralelný track (E-sprinty)

> Samostatný track popri Viewer sprintoch (S0–S4). Rovnaký princíp: **každý sprint
> končí niečím demovateľným**, poradie ide podľa závislostí. Všetko sa páruje cez
> `object_ref`, takže ten musí byť správny **prvý** (E1 je prerekvizita ostatných).
> Vstup: `podklady/FINAL/` (IFC ASR+VZT, výkresy PDF, SNIM hierarchia).
> Rozhodnutia: D-031 (ETL), D-032 (dokumenty), D-033 (coding scheme).
>
> **IDS validácia nie je v near-term scope** — coding scheme teraz slúži len na
> extrakciu `object_ref`. Conformance/IDS je parkované (E6).

| Sprint | Cieľ (demovateľný výstup) | Kľúčové |
|---|---|---|
| **E1 — Coding scheme + object_ref** ✅ | `etl/scheme.py` (field-source resolver + SNIM definícia) a prepis `_RefAllocator` → `object_ref` zo schémy. `--dry-run` na ASR IFC vypíše objekty so SNIM kódom + **coverage report** (% prvkov s platným kódom vs fallback GUID). | D-033 |
| **E2 — ETL load reálnych dát** ✅ | Rozsah importu policy (D-034) + konsolidácia podlaží (D-035) + 18 SNIM kategórií + doladené mapovanie (hierarchia, psety, klasifikácie, GUID). Idempotentný `--reset` load do Supabase. Viewer beží na **reálnej budove z IFC** namiesto seedu. | D-031/D-034/D-035 |
| **E3 — Document storage + upload** ✅ | Naming convention = **CDE štandard** (D-036, `doc_scheme.py`); migrácia `documents.storage_type`; public bucket `documents/`; `etl/doc_upload.py` (manifest `docs.csv` → upload + document uzly + `rel_has_document`). **13 PDF nahraných**, viditeľné na karte budovy/podlažia vo Vieweri. | D-032/D-036 |
| **E4 — PDF výkres auto-linking** ✅ | **PyMuPDF** text + bbox; regex **odvodený zo schémy**; **tri dôverové vrstvy matchu** (`full`/`proximity`/`bare`, D-041) — proximity bez zhody = šum (padli `OV01.00.00`/`ZV01.02` bez straty dverí), `bare` → prefix-match na typy. `etl/pdf_link.py` (výkresy `VD` z `docs.csv`, `--dry-run`/`--show-unmatched`). **193 element-väzieb zapísaných** (`source='pdf_link (E4)'`, idempotentné, E3 nedotknuté). Viewer: „Zobrazený vo výkrese" (asset/type) + „Prvky vo výkrese" (podlažie/budova). | D-032/D-033/D-041 |
| **E5 — ICDD export** | `etl/icdd_export.py` (rdflib): `linkset.ttl` z `rel_has_document`, `payload_documents/`, prepínač `--embed-payloads`. **Stiahnuteľný ISO 21597 kontajner.** | D-015/D-032 |
| **E6 — Validácia** ⏸️ parkované | Coding scheme + IDS súbory → conformance report (čo nesedí proti požiadavkám). Až keď bude treba. | D-033 |
| **DV — Interaktívna prehliadačka výkresov** ✅ hotové | Klikateľné SNIM kódy vo výkrese → detail prvku, **obojsmerne** (z karty prvku → výkres so zvýraznením). Na **odprezentovanie previazanosti** (D-003). Fázy **A–D hotové** (`pdf_link.py` → `_drawing_links` → `pdf_annotate.py` → in-app react-pdf `/drawing/[id]` → obojsmernosť) + D-043 skladby. **197 element-väzieb / 414 link-regiónov.** Bez zmeny schémy. | D-042, D-043 |

### Detail

**E1 — Coding scheme + object_ref** ✅ HOTOVÝ
- `etl/scheme.py`: field-source resolver (`from: property|attribute|classification|type_property`,
  voliteľné `extract` regex + `format` s `pad`), `applies_to` per IFC trieda.
- SNIM definícia z `SNIM - Hierarchia.pdf` (dvere, steny, podlahy, podhľady, strechy,
  fasáda, zámočnícke/klampiarske výrobky) — 8 kategórií kľúčovaných podľa TSP prefixu.
- Prepis `_RefAllocator` v `transform.py`: `object_ref` zo schémy (type `DD01.06` +
  instance `DD01.06.03`, zero-pad číselných polí); fallback `ifc_guid` len keď kód chýba.
- Coverage report pri `--dry-run` (NIE IDS — len pokrytie).
- **Akceptačné ✅:** `--dry-run` na ASR IFC ukáže `asset_type`/`asset` so SNIM `object_ref`
  (overené `DD01.06` / `DD01.06.03`); 3189 uzlov, všetky `object_ref` unikátne; coverage:
  135 inštančných SNIM kódov (83 dvere + 52 podlahy), 59 zdieľaných typových kódov z 109
  IFC typov, fallback dôvody (bez Assembly Code / bez Mark / TSP mimo schémy / kolízia)
  rozpísané po IFC triedach. `py_compile` čistý.
- **Zistené (vstup pre E2):**
  - SNIM kategóriu určuje **prefix `Assembly Code` (TSP), nie IFC trieda ani pset** —
    fasáda `FS*` aj strecha `ST*` žijú v psete `IFC_Steny` na `IfcWall`; polia preto
    čítame naprieč psetmi.
  - **Typové entity nemajú vlastné psety** → typový kód sa odvodzuje z occurrence;
    viac Revit typov s rovnakým SNIM kódom sa zlučuje do jedného `asset_type`.
  - Steny/strechy/podhľady/zámočníctvo majú v modeli **len typové kódovanie** (bez
    `Mark`) → inštancie idú na GUID fallback (správne — nemajú tlačený inštančný tag).
  - V modeli sú aj TSP **mimo 8 definovaných kategórií** (OV, PL, ZD, DZ, SD, VT, SH,
    LP, IH, TV — z `SNIM - Výpis skladieb`); coverage ich hlási na doplnenie do `scheme.py`.
  - `model.by_type("IfcTypeObject")` stále tvorí `asset_type` aj z `IfcSpaceType`/
    `IfcMemberType` (generický ref) — zúženie rozsahu `asset`/`asset_type` je E2.

**E2 — ETL load reálnych dát** ✅ HOTOVÝ
- **Rozsah importu (D-034)** — `ScopePolicy` v `scheme.py` (nie hardcoded): asset =
  top-level prvok (`get_aggregate` = priestor/None) mínus voidy (`IfcFeatureElement`)
  a sub-komponenty (vnorené `IfcMember`/`IfcPlate`/panely fasády/vrstvy strechy/ramená
  schodov); **výnimka** vnorené `IfcDoor`/`IfcWindow`. `asset_type` len pre typy
  referencované assetom (žiadny `IfcSpaceType`). ASR: **681 assetov** z 2706 `IfcElement`.
- **Konsolidácia podlaží (D-035)** — 18 Revit storeys → **5 reálnych podlaží** (`1NP`–`5NP`);
  pomocné úrovne sa premapujú (NP-prefix / najbližšia elevácia), assety sa nestrácajú.
- **18 SNIM kategórií** v `scheme.py` (8 z Hierarchie + 10 z Výpisu skladieb: OV, PL, LP,
  ZD, DZ, SD, IH, VT, SH, TV) — coverage už nehlási „TSP mimo schémy".
- **Mapovanie** doladené: hierarchia (Site→Building→Floor→Space→Asset), psety
  (Pset_/Qto_=štandard, inak custom, žiadne `_`-kľúče), klasifikácie (Uniformat, na type →
  union do occurrence cez `v_asset_classifications`), GUID história. Aktori/dokumenty v ASR
  nie sú (0 — žiadny šum). VZT.ifc zatiaľ NEloadovaný (E3+).
- **Load** — `etl/db.py` opravený (`valid_from` `coalesce(…, now())`, idempotentný
  `ON CONFLICT`); nový `--reset` (nahradenie seedu). 
- **Akceptačné ✅:** `--reset` load → 926 uzlov (681 asset + 149 asset_type + 89 space +
  5 floor + building + site), 776 `located_in`, 644 `defined_by_type`, 602
  `has_classification` (Uniformat, 36 referencií), 926 GUID histórie; jediný koreň `site`
  (asset_type bez polohy). Re-run bez `--reset` = **identické počty** (idempotencia).
  Live `/health` na Verceli ukazuje `count(*) = 926` (reálna budova namiesto 15-uzl. seedu).

**E3 — Document storage + upload** ✅ HOTOVÝ (D-036)
- **Naming convention** — prebratý reálny **CDE štandard** (Jihočeský kraj, ISO 19650):
  `Projekt_StupeňPD_ČástDíla_Profese_TypSouboru_Číslo_Popis`. `etl/doc_scheme.py`
  (pozičné polia + CDE slovníky + parser názvu, mirror `scheme.py`) + manifest
  `podklady/docs.csv` (väzba cez `target_ref` → building/floor; element-level = E4).
- **Storage** — migrácia `20260620120000_documents_storage_type.sql` (`storage_type`
  `supabase|external|unresolved`, aditívna); public bucket `documents/`.
- **`etl/doc_upload.py`** — manifest → upload (stdlib urllib, `x-upsert`) + `objects(document)`
  (object_ref = CDE názov) + `documents` prípona + `rel_has_document(role z TypSouboru)`.
  Idempotentné (object_ref / deterministické UUID), `--dry-run`, validačný report.
- **Akceptačné ✅:** 13 PDF nahraných → 13 `documents` (storage_type=supabase) + 13
  `rel_has_document` (9 na building, 1NP×2, 2NP, 3NP); public URL HTTP 200; re-run =
  identické počty (idempotencia). Viewer (`SpatialView` → `NodeSections`) zobrazí PDF
  na karte budovy/podlažia, klik otvorí súbor. `py_compile` čistý.

**E4 — PDF výkres auto-linking** ✅ HOTOVÝ (D-041)
- `etl/pdf_link.py`: PyMuPDF slová+bbox → detekcia SNIM kódov (regex zo `scheme.py`,
  platné TSP prefixy) → match na `object_ref` (asset/asset_type) → `rel_has_document(prvok
  → výkres, role='drawing', source='pdf_link (E4)')`. Vstup = výkresy `VD` z `docs.csv`.
- **Tri dôverové vrstvy matchu (D-041)** namiesto ladenia `PROXIMITY_PT`: `full` (kód
  s vytlačenou bodkou) = exact, bez zhody = reálna medzera; `proximity` (poskladaný z 2
  tokenov) = exact, bez zhody = šum → zahoď (padli false-pos `OV01.00.00`/`ZV01.02` bez
  straty jediného z 83 dverí, ktoré vznikajú práve proximity); `bare` (holý `SN11`) =
  prefix-match na typy `SN11.*`. `--show-unmatched` oddeľuje „medzeru" od „ignorovaného
  proximity". Dôsledok: dvere (majú `Mark`) linkujú inštanciu, steny/fasáda typ — vecne OK.
- **Zápis:** deterministické `edge_id` → idempotentné; E3 väzby (`source='doc_upload (D-036)'`)
  nedotknuté. **193 element-väzieb** (1NP 57, 2NP 39, 3NP 37, strecha 24, Rez-A 36).
- **Viewer:** `lib/data/relations.ts` (`fetchElementDrawings`/`fetchFloorDrawings`,
  diskriminátor `source`) + `components/drawing-list.tsx`/`drawing-elements.tsx`:
  „Zobrazený vo výkrese" na karte asset/asset_type (PDF link), „Prvky vo výkrese" na karte
  podlažia/budovy (výkres → zoznam prvkov v ňom; prázdny výkres skrytý). `tsc`+`lint` čisté.
- **Akceptačné ✅:** výber pôdorysu 1NP → 57 prvkov z ARS výkresu (PBR výkres 0 → skrytý);
  karta dverí `DD01.02.01` → „Zobrazený vo výkrese: Pudorys-1NP"; typ steny `SN11.01` →
  výkresy 1NP/2NP/3NP; budova → strecha (24) + Rez-A (36). Re-run = identických 193.

**E5 — ICDD export**
- Akceptačné: vygenerovaný `.icdd` ZIP otvoriteľný, linkset drží väzby dokument↔prvok.

**DV — Interaktívna prehliadačka výkresov** ✅ hotové (D-042, D-043)
> Cieľ na **odprezentovanie previazanosti** (D-003): klikateľný výkres + obojsmerné
> prvok↔výkres. Detekcia je už hotová z E4 (`pdf_link.py` má bbox) — kostra rozhodnutá,
> detaily sa **doladia počas sprintu**. Odhad ~4,5–6 dní.
- **Fáza A — dáta (ETL, ~0,5–1 d):** `pdf_link.py` zapíše link regióny do
  `documents.properties._drawing_links` (`{page, bbox, page_size, target_id, target_route,
  layer, label}`, PDF bottom-left súradnice). Bez migrácie. Prerekvizita B aj C.
  Akceptačné: 5 výkresov má `_drawing_links`, súčet sedí na 193.
- **Fáza B — MVP klikateľné PDF (ETL, ~1 d):** `etl/pdf_annotate.py` zapečie URI-link
  anotácie (`page.insert_link` → `${SITE_URL}/node/{id}`) → klikateľné v každom prehliadači.
  Akceptačné: klik na kód dverí v PDF → detail assetu.
- **Fáza C — in-app prehliadačka (Viewer, ~2–3 d):** route `app/(viewer)/drawing/[id]`,
  react-pdf render + overlay `<Link>` boxov, hover highlight + zoom + stránkovanie; názvy
  výkresov v kartách vedú na `/drawing/[id]`. Akceptačné: 1NP → 57 klikateľných boxov.
- **Fáza D — obojsmernosť (Viewer, ~1 d):** `/drawing/[id]?focus={ref}&page={n}` z karty
  prvku → odscrolluje/zoomne + zvýrazní. Akceptačné: z karty dverí `DD01.06.03` → otvorí
  Pudorys-1NP nascrollovaný a zvýraznený.
- **Riziká:** súradnice (y-flip + rotácia výkresov), pdf.js worker v Next 16/Turbopack,
  bundle ~1 MB (lazy). **Vzťah k D-038:** užšia podmnožina bez 3D/georeferencingu.

Otvorené body (INST padding, multi-projekt scoping, `rel_supersedes`, AI matching,
naming convention finálny tvar) sú v DECISIONS §7.

## Mimo scope (zatiaľ)
- Auth + RLS (príde s verejným/multi-user prístupom — aditívne, D-025).
- Geometria v DB / mesh ukladanie — Postgres sa geometrie nedotýka (trvalo mimo scope,
  D-044). 3D rendering je plánovaný ako S5 — ephemerálna klient-side vrstva cez IFClite,
  nie dáta v DB.

---
*Posledná aktualizácia: 2026-07-02 — **Online 3D model vymenený.** Do Supabase Storage `ifc/ASR.ifc` (upsert cez `etl.ifc_upload --file "podklady/Office centrum Brno.ifc"`) nahraný **vyčistený re-export ASR** (IFC4X3_ADD2, **5 podlaží**, projekt „Office centrum Brno / OCB", reklasifikované — výsledok asr-ifc-cleanup). Object key aj `getIfcUrl` default (`lib/data/ifc.ts`) nezmenené → živý viewer renderuje nový model okamžite, bez zmeny frontendu/env. Rovnaké `IfcProject` GUID `2Xj8NwiwHD_hFSIx764rKm` ako pôvodný ASR. **DB reload HOTOVÝ (2026-07-02):** `etl.main --reset` na nový model → **objects 1012** (999 IFC + 13 dok), aktívne GUIDy 999, **3D↔DB bridge 999/999** (predtým 60 nových prvkov nerozlíšených — to bolo „nejde to"); `doc_upload` obnovil 13 dokumentov (`docs.csv` ref budovy opravený `POLYFUNKčNÝ OBJEKT`→`Polyfunkčný objekt`). **SNIM object_ref + E4 (vyriešené 2026-07-02):** čistenie zapieklo plný SNIM kód do IFC `Name` prvkov (dvere `DD02.05.04`, okno `LP01.44`, stena `SN07`), nie do „Assembly Code". Adaptovaný `etl/scheme.py` — tri `CodePart`-y čítajú segmenty z `Name` cez `extract` regex (výstup identický: typ `TSP·PSP[.UOT]`, inštancia `+.INST`); doplnená kategória `SL` (stĺpy) a `IfcWindow` do `LP`. Coverage: **149 inštančných + 81 typových** SNIM kódov. `pdf_link` obnovený: **198 element-väzieb + 418 regiónov** (predtým 197/414). Objects 903 (694 asset, 100 asset_type po zlúčení cez SNIM, 13 dok). **3D↔DB bridge zdravý** — steny/dvere/okná/stĺpy/strechy/podhľady/fasáda/VZT/nábytok/schody/zábradlia 100 % rozlíšia; nerozlíšené len D-034 sub-komponenty (IfcMember/IfcPlate mullióny+panely, vrstvy strechy). Systém klasifikácie sa v Revite nepremenoval (stále `Uniformat`) — kozmetické. Predtým 2026-06-28 — **Zjednotenie vetiev do `main`.** S5 (3D viewer, D-044) dotiahnuté na **fázu 3 — query bridging** (floor filter cez STEP containment, obojsmerný DB↔3D filter bar `/api/filter` + `/api/space-siblings`, Escape deselect) zlúčením `query-bridging-phase-3`; zlúčené aj `code-review-optimization` (error boundaries `app/**/error.tsx`, migrácia `20260628120000_missing_indexes.sql`, dedup refactory). Superseded `ifclite-library-review` zahodená (prenesený len konfigurovateľný back-label panela). **Sprint DV** (D-042 A–D + D-043) potvrdený ako hotový (**197 väzieb / 414 regiónov**). Pridaný kandidát **D-045** (pasportizácia + dynamika; prečíslované z kolízie D-044 na passport vetve). Predtým 2026-06-22 — Pridaný **S5 — IFC 3D viewer** (**D-044**, paralelná vetva): IFClite WASM/Three.js, obojsmerná selekcia 3D↔dáta cez IFC GUID cez `ifc_guid_history`; tri fázy (embedded panel → obojsmerná selekcia → query bridging); neblokuje S4 ani DV; Postgres sa geometrie nedotýka. Superceduje kandidáta D-037. Aktualizovaná zmienka „Mimo scope" (geometria v DB = trvalo mimo scope; 3D rendering = S5 aplikačná vrstva). Predtým 2026-06-20 — E4 (PDF výkres auto-linking) hotový (**D-041**): `etl/pdf_link.py` deteguje SNIM kódy z výkresov (PyMuPDF), matchuje v troch dôverových vrstvách (`full`/`proximity`/`bare`) — odfiltrované false-pos `OV01.00.00`/`ZV01.02` bez straty dverí, prefix-match holých typových kódov; **193 element-väzieb** zapísaných (`source='pdf_link (E4)'`, idempotentné, E3 nedotknuté). Viewer: sekcie „Zobrazený vo výkrese" (asset/asset_type) a „Prvky vo výkrese" (podlažie/budova) — `relations.ts` + `drawing-list.tsx`/`drawing-elements.tsx`. Predtým E3: 13 PDF (CDE naming, D-036). **Ďalej: konsolidačná / review fáza** — postupné kontrolované dopilovanie hotového (S0–S3 + E1–E4) podľa feedbacku; **E5 (ICDD export) odložené** do uzavretia review pass. Naplánovaný sprint **DV — Interaktívna prehliadačka výkresov** (**D-042**, klikateľné SNIM kódy obojsmerne) ako demo feature na odprezentovanie previazanosti — kostra rozhodnutá, detaily sa doladia počas sprintu (fázy A dáta → B MVP → C in-app → D obojsmernosť).*
