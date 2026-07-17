# Audit: AIM Viewer ↔ IFC-lite — duplicita panelov a konsolidácia info vrstvy

*Analytický dokument, 2026-07-17. Nič v kóde sa nemení; výstupom je zistený stav,
návrh konsolidácie a draft záznamu do DECISIONS.md.*

---

## Krok 0 — Predchádzajúci kontext

- **`AssetinSpace/design-kit`**: obsahuje len brand tokeny, CSS primitívy a logá
  (D-070). Duplicita panelov ani info vrstva sa tam neriešila.
- **GitHub issues**: v `aimviewer` aj `ifc-lite` je 0 issues — žiadne UX testovanie
  tam zaznamenané nie je.
- **DECISIONS.md**: téma sa už **čiastočne riešila a rozhodla** — kľúčové je
  **D-067** (2026-07-12): po prechode na embed viewer mal vybraný prvok dva panely
  (natívny properties panel viewera + plávajúci `ElementInfoPanel` hosta) a bolo
  rozhodnuté „jeden panel" — DB súhrn sa posiela cez bridge ako **AIM karta** do
  natívneho panela viewera. Nadväzujú D-071 (fork stratégia s izolovanou
  `aim/` vrstvou), D-074 (zoskupenie stromu podľa IFC triedy), D-075 (dokumenty
  v jednom rozhraní, Dalux-like; M1–M3 na vetve).

**Záver kroku 0:** hypotéza „zjednotená vrstva nad IFC-lite" nie je nová — je to
presne línia D-067→D-075 a čiastočne už beží. Audit teda odpovedá na otázku *čo
z duplicít ešte zostalo a ako vrstvu dotiahnuť*, nie „či ju zaviesť".

---

## Krok 1 — Mapa repozitára AIMviewer

**Stack:** Next.js 16 (App Router, ISR) + Supabase/Postgres + Vercel; shadcn/Tailwind 4
+ `@assetinspace/design-kit`.

**Route skupina `app/(viewer)`** (spoločný layout `app/(viewer)/layout.tsx`):

| Route | Obsah |
|---|---|
| `/` | domovská stránka |
| `/node/[id]`, `/type/[id]` | SSR detail uzla/typu — karty: `PropertySets`, `ClassificationList`, `DocumentList`, `DrawingList`, `ResponsibilityList`, `ResponsibilityOfList`, `GuidHistory`, `CaptureGallery` |
| `/drawing/[id]` | 2D prehliadačka výkresov (`DrawingWorkspace` + `DrawingViewer` + `ElementInfoPanel`) |
| `/ifc` | full-bleed 3D (`IFCWorkspace` → embed ifc-lite viewer) |

**Panelové komponenty hosta:**

- `components/sidebar-shell.tsx` — ľavý rám (šírka + zbalenie v localStorage), renderovaný **na všetkých routách** vrátane `/ifc`.
- `components/spatial-tree.tsx` — ľavý strom elementov **z DB** (spatial hierarchia D-013, zoskupenie podľa `ifc_type` D-074), navigácia na `/node/[id]`.
- `components/sidebar-nav.tsx` — ploché zoznamy ne-priestorových uzlov (typy, osoby, systémy, dokumenty).
- `components/ask-dock.tsx` — globálny AI chat (D-056/D-066), vie ovládať 3D (focus/ops).
- `components/element-info-panel.tsx` — plávajúci panel detailu prvku; **už len v 2D** (`drawing-workspace.tsx:68`), z 3D odstránený rozhodnutím D-067.
- `components/filter-bar.tsx` — **mŕtvy kód**: z `/ifc` odstránený (komentár v `ifc-workspace.tsx:35`), nikde sa neimportuje.

**Kde žije IFC-lite — dva rôzne vzťahy:**

1. **npm balíky** `@ifc-lite/geometry|query|wasm` (package.json; postinstall kopíruje WASM do `public/`) — používa ich ETL/query vrstva a starší in-process kód.
2. **Fork `AssetinSpace/ifc-lite`** (D-071): viewer app `apps/viewer` nasadená na
   `ifc-lite-viewer.vercel.app`, embednutá cez **iframe** v
   `components/ifc-viewer-embed.tsx` (postMessage bridge `aim-bridge`). Vlastná AIM
   vrstva žije izolovane v `apps/viewer/src/aim/` (AimBridge, AimCard,
   aimPanelStore, CapturePinLayer, bridge-protocol); napojenia do upstream súborov
   sú označené sentinelom `// >>> AIM-FORK`.

---

## Krok 2 — Integrácia s IFC-lite (dátový tok)

**Čo si viewer číta sám z IFC súboru** (in-iframe WASM parse): geometria, priestorový
strom (`HierarchyPanel`), natívne psety/quantities (`PropertiesPanel`), vyhľadávanie
a filtre nad IFC dátami.

**Čo dopĺňa host z DB** (Supabase, bitemporal graf): súhrn uzla
(`GET /api/element/[id]` → `NodeSummary`), dokumenty (`rel_associates_document`),
zodpovednosti, Reality Capture, klasifikácie, GUID históriu, trojvrstvové properties
s provenance (D-022).

**Bridge protokol** (`ifc-viewer-embed.tsx` ↔ `apps/viewer/src/aim/bridge-protocol.ts`):

- viewer → host: `READY`, `MODELS_LOADED`, `ENTITY_SELECTED{guid}`, `ENTITY_DESELECTED`, `AIM_NAVIGATE{href}`
- host → viewer: `FOCUS`, `HIGHLIGHT_FILTER`, `CLEAR_FILTER`, `AIM_PANEL_DATA{guid,data}`, `AIM_PANEL_EMPTY`
- - dátové kanály `UNDERLAYS_LOAD` (D-072), `DOCUMENTS_LOAD`/`DOCUMENT_OPEN` (D-075), `CAPTURES_LOAD`/`CAPTURE_PIN_CLICK` (D-073)

**Join key = IFC GlobalId** (D-044/D-050): host drží `guidMap` (guid→objectId) z DB,
mapuje oboma smermi. Elementy bez DB záznamu → `AIM_PANEL_EMPTY(no-mapping)`.

**AIM karta (D-067):** po `ENTITY_SELECTED` host dotiahne DB súhrn a pošle
**generickú, verzovanú render schému** (`lib/aim-panel.ts`, `version: 1` — title,
badges, sections, documents, actions). Viewer ju vykreslí **navrchu
`PropertiesPanel`** (`AimCard.tsx`, `PropertiesPanel.tsx:1441`); linky sa bouncujú
späť cez `AIM_NAVIGATE` a naviguje parent. Nové polia = len host deploy.

**Prekrývanie zodpovedností UI vrstiev:** viewer aj host dnes zobrazujú (a) strom
elementov, (b) psety, (c) dokumenty, (d) vyhľadávanie — každý zo svojho zdroja.
Detaily v kroku 3.

---

## Krok 3 — Duplicity: potvrdenie/vyvrátenie

### 3.1 Dva ľavé panely s elementmi — POTVRDENÉ (na `/ifc`)

Na `/ifc` sú súčasne dva ľavé stromy elementov:

| | Host strom | Viewer strom |
|---|---|---|
| Komponent | `AIMviewer/components/spatial-tree.tsx` | `ifc-lite/apps/viewer/src/components/viewer/HierarchyPanel.tsx` |
| Kde | ľavý sidebar layoutu (`app/(viewer)/layout.tsx:22-25`) | ľavý slot viewera v iframe (`ViewerLayout.tsx:638-644`, panel `hierarchy` v `lib/panels/registry.ts`) |
| Zdroj dát | DB (spatial graf, D-013/D-074) | IFC súbor (parse v prehliadači) |
| Kliknutie | navigácia na `/node/[id]` (opustí 3D) | selekcia entity v 3D + AIM karta |

**Prečo vznikli:** layout renderuje sidebar pre celú route skupinu; `/ifc` je
full-bleed, ale sidebar ostal **zámerne** — komentár v `app/(viewer)/ifc/page.tsx`:
*„navigácia a strom ostávajú v ľavom sidebari"*. Nie je to nehoda, ale vedomé
provizórium: každý strom robí niečo iné (route-navigácia vs 3D selekcia), no pre
používateľa sú to dva takmer rovnaké stromy vedľa seba s **rozdielnym správaním
kliku a potenciálne rozdielnou množinou elementov** (DB vs file).

### 3.2 Duplicitné property panely — ČIASTOČNE VYRIEŠENÉ (D-067), zvyšok trvá

- Pôvodná duplicita (natívny panel + plávajúci `ElementInfoPanel` nad iframom) je
  vyriešená AIM kartou — v 3D je jeden panel. ✅
- **Zostáva:** `ElementInfoPanel` ďalej žije v 2D (`drawing-workspace.tsx:68`) —
  `/drawing/[id]` má iný vzor detailu prvku než 3D (plávajúci panel vs AIM karta
  v paneli). Dve UI pre ten istý koncept „detail vybraného prvku".
- **Psety dvakrát, z dvoch zdrojov:** viewer `PropertiesPanel` číta psety z IFC
  súboru; `/node/[id]` `PropertySets` číta psety z DB (tri vrstvy + provenance,
  D-022). Zobrazenia nie sú nijako prepojené a hodnoty sa môžu rozísť (verzia
  súboru vs ETL import) — nikde nie je diff ani odkaz „pozri natívne/DB psety".

### 3.3 Ďalšie duplicity

- **Vyhľadávanie:** viewer má `SearchInline`/`SearchModal`/`CommandPalette` (nad IFC
  dátami v iframe); host má AskDock (LLM nad DB grafom, D-056) a fulltext
  `search_everything` (D-059). Na `/ifc` teda existujú dve vyhľadávania s rôznym
  záberom, bez vzájomného povedomia.
- **Dokumenty — traja konzumenti:** in-viewer `DocumentsPanel` (D-075),
  `DocumentList` na `/node/[id]`, standalone `/drawing/[id]`. D-075 to explicitne
  rieši (drawing ostáva standalone flow), ale AIM karta a Documents panel vo viewri
  zobrazujú prieniky toho istého zoznamu.
- **`filter-bar.tsx`** — mŕtvy súbor po D-066 (kandidát na zmazanie).

### 3.4 Nekonzistencie dátový model ↔ IFC-lite (nad rámec zadania)

1. **Dva zdroje pravdy pre psety** (IFC file vs DB s survivorship) — viď 3.2.
   Viewer nevie o provenance vrstvách (own/inherited/overridden), DB nevidí
   „čerstvé" hodnoty zo súboru, ktorý používateľ práve pozerá.
2. **Množiny elementov sa nemusia kryť:** host strom ukazuje DB objekty (aj bez
   geometrie), viewer strom ukazuje file entity (aj bez DB záznamu →
   `AIM_PANEL_EMPTY(no-mapping)`). Používateľ nemá indikáciu, ktorá strana chýba.
3. **Bitemporalita sa v UI nevyužíva:** hrany majú `valid_from/valid_until`,
   `guid_history` existuje (D-029), ale AIM karta aj `/node` zobrazujú len current
   state; time-travel nie je nikde.
4. Známy, zdokumentovaný duplikát `TYPE_ORDER` (klient) vs `SPATIAL_TYPES`
   (server-only) — dôsledok D-074.

---

## Krok 4 — Návrh konsolidovanej info vrstvy

**Princíp:** nezavádzať nič nové „vedľa", ale **povýšiť existujúcu AIM kartu (D-067)
na plnohodnotný AIM inspector** v natívnom paneli viewera. AIM karta je už dnes tá
„vrstva nad IFC-lite" — je len obsahovo tenká (súhrn + zoznam dokumentov + akcia
„Otvoriť celý detail").

**Cieľový stav jedného inspectora (pravý panel viewera):**

```
┌─ PropertiesPanel (fork) ────────────────┐
│ [AIM]  [IFC]                ← taby      │
│                                         │
│ AIM tab (dáta z DB cez bridge):         │
│   hlavička: názov, object_ref, badge    │
│   ▸ Prehľad (typ, klasifikácie)         │
│   ▸ Dokumenty (n) → AIM_NAVIGATE        │
│   ▸ Zodpovednosti (n)                   │
│   ▸ Reality Capture (n) → galéria       │
│   ▸ História (GUID, valid_from/until)   │
│   [Otvoriť celý detail]  → /node/[id]   │
│                                         │
│ IFC tab: natívne psety zo súboru        │
│   (existujúci upstream obsah, read-only)│
└─────────────────────────────────────────┘
```

- **Drill-down** ostáva ako dnes: záznam v AIM tabe → `AIM_NAVIGATE` → SSR detail
  (`/node/[id]`) s plnými kartami. Inspector je „index", stránka je „záznam" —
  vzor „link v paneli, záznam v module" (viď rešerš, Bimplus/ACC/Dalux).
- **Mechanika už existuje:** stačí rozšíriť `AimPanelData` na `version: 2`
  (typované sekcie: `documents`, `persons`, `captures`, `history` + `tabs` hint).
  Schéma je data-driven — obsah sa mení len host deployom, fork sa dotkne raz
  (render v2 + tab v `PropertiesPanel`, v rámci existujúcich AIM-FORK sentinelov).
- **Vizuálna hranica pôvodu dát:** IFC tab read-only (zo súboru), AIM tab s edit
  afordanciami v budúcnosti (z DB). To priamo mapuje source_priority/survivorship
  logiku — „čo hovorí model" vs „čo hovorí databáza" — a zhoduje sa s praxou
  všetkých skúmaných CDE.

**Kompatibilita s dátovým modelom:** žiadna zmena schémy. Všetko číta existujúce
views (`NodeSummary`, `rel_associates_document`, `guid_history`, capture prípony).
Bitemporalita dostane prvé UI využitie („História" sekcia z `valid_from/valid_until`
+ `guid_history`) — čisto read-only, bez migrácie. Decisions tabuľka/ADR: nový
záznam (draft D-076 nižšie).

**Strom (ľavá strana):** konsolidácia inspectora nerieši dva stromy — to riešia
varianty v kroku 6 (odporúčanie: na `/ifc` host sidebar defaultne zbaliť; neskôr
poslať DB strom do viewera ako alternatívnu hierarchiu).

---

## Krok 5 — Rešerš CDE/BIM nástrojov

*(Overované cez oficiálne dokumentácie/release notes 2023–2026; poznámka: viaceré
help centrá blokujú priamy fetch, claims overené cez search-extrakty konkrétnych
oficiálnych stránok.)*

| Nástroj | Natívne vs externé dáta | Navigácia | Kde sú cross-ref (dokumenty, osoby, fotky) |
|---|---|---|---|
| **Autodesk ACC / BIM 360** | Read-only Properties panel; app dáta (Assets, Issues) v samostatných selection-driven flyoutoch; klasický BIM 360 mal Equipment ako extra tab v Properties dialógu | zoznam → pravý flyout s tabmi Details / References / Activity; plytké vrstvenie | „References" tab na zázname assetu/issue (Files, Forms, Issues, Photos, Sheets…); plný detail = navigácia do modulu |
| **Bentley iTwin** | Widget-per-domain: Property Grid len BIM; Issues panel, foto-markery v scéne, vrstvy (IoT/reality/GIS) ako samostatné widgety; dokumenty len ako URL link-out | dockovateľné tabované panely; v gride ancestor-navigácia | sibling panely + 3D markery; **Unified Selection** synchronizuje strom ↔ viewport ↔ properties |
| **Trimble Connect** | **Hybrid**: Properties panel = natívne IFC (read-only) + **editovateľné DB property sety v tom istom paneli**; dokumenty/ToDo = „Object Attachments" mimo panela (ikony na objektoch v 3D) | selection toolbar dole → stacked panely (list → detail panel), nie taby | attachment ikony v scéne + globálny Attachments panel + ToDo detail panel (obojsmerná navigácia element ↔ ToDo) |
| **Dalux** | Element callout: BIM properties (read-only, podľa psetov) a registrácie/dokumenty ako paralelné akcie; FM asset záznam v FM DB, dosiahnuteľný z objektu | klik na objekt → kompaktný popup → drill-down do panelov/formulárov | dokumenty kontextovo na objekte (3D object groups); úlohy/fotky dual-home (piny v modeli + Field modul); BIM polia sa mapujú do šablón úloh |
| **Solibri** | Tabovaný Info view len pre IFC dáta (BIM Data / Std Properties / Quantities / Other / Custom); výsledky kontrol, issues, BCF v samostatných views/layoutoch; **Hyperlink tab** = jediné externé dáta v inspectore | persistentný multi-view workspace, tab-in-tab; žiadny breadcrumb | sibling dockable views koordinované selekciou a kamerou; issue info ako overlay strip pod 3D |
| **Speckle** | Tvrdá separácia: Selection info panel = len natívne properties; komenty/issues v Discussions paneli, ukotvené v geometrii; jediný most = „Add as filter" | plávajúci overlay panel; ľavé full-height swapovacie panely (Models/Filters/Discussions) | v konverzačnom vlákne (markupy pri issue), nie na elemente; žiadne per-element dokumenty |
| **Allplan Bimplus** | **Jeden merged panel**: properties paleta elementu má accordion sekcie Comments / Attachments / Hyperlinks / Links to documents | stacked accordion v pravej palete; moduly cez ľavý icon sidebar | **„link v paneli, záznam v module"**: odkaz v palete, plný záznam (dokument s revíziami, task s assignee/BCF) v Documents/Issue Manager module |

**Syntéza — opakujúce sa vzory:**

1. **Nikto nemieša externé DB dáta do zoznamu IFC psetov.** Hranica je vždy
   viditeľná: iný tab, iná sekcia, iný panel. (Najbližšie k merge je Trimble —
   ale aj tam ako oddelené, editovateľné pset skupiny.)
2. **„Link v paneli, záznam v module"** (Bimplus, ACC, Dalux, Trimble ToDo) je
   dominantný vzor pre dokumenty/zodpovednosti/fotky — presne váš use-case
   s Assetin Archives. Breadcrumb drill-down nepoužíva nikto; vyhráva tabovaný
   flyout/inspector alebo stacked panely.
3. **Jeden zdroj selection state** (iTwin „Unified Selection") je predpoklad
   synchronizácie strom ↔ 3D ↔ inspector.
4. **Stabilný join key** medzi geometriou a DB: ACC používa element ID a má známe
   problémy pri zmene medzi verziami. AIM už používa IFC GlobalId + `guid_history`
   — architektonicky lepšie než ACC.
5. **Read-only = z modelu, editovateľné = z DB** ako lacná vizuálna konvencia
   pôvodu dát (ACC, Trimble, Dalux).

---

## Krok 6 — Architektonické varianty

### Variant A — „Dotiahnuť D-067": AIM inspector + upratať zvyšky *(odporúčaný)*

**Popis:** AIM karta → tabovaný AIM/IFC inspector v `PropertiesPanel`
(`AimPanelData v2`, sekcie dokumenty/zodpovednosti/capture/história). Na `/ifc`
host sidebar defaultne zbalený (mechanika v `sidebar-shell.tsx` už existuje).
2D `ElementInfoPanel` prejde na render tej istej `AimPanelData` schémy (jeden
zdroj pravdy pre „detail prvku"). Zmazať `filter-bar.tsx`.

- **Výhody:** priama línia D-067/D-071/D-075; fork sa mení minimálne (jedna v2
  render zmena v `aim/`); obsah ďalej riadi host bez redeployu viewera; vzor
  overený rešeršou (ACC/Bimplus). Žiadna zmena DB.
- **Nevýhody:** dva stromy zostávajú (len sa skryjú); psety ostávajú z dvoch
  zdrojov bez diffu.
- **Dopad na dátový model:** žiadny.
- **Náročnosť:** nízka (dni; hlavne `lib/aim-panel.ts`, `AimCard.tsx`,
  `element-info-panel.tsx`).

### Variant B — Jeden strom: DB hierarchia do viewera

**Popis:** nadstavba A. Host pošle DB strom cez bridge (`AIM_TREE_LOAD`, vzor
`DOCUMENTS_LOAD`) a fork `HierarchyPanel` dostane prepínač hierarchie „IFC / AIM"
(vzor Solibri Model Tree: Containment/Component/…). Klik v AIM hierarchii =
selekcia v 3D; „Otvoriť detail" = `AIM_NAVIGATE`. Host sidebar sa na `/ifc`
nerenderuje vôbec.

- **Výhody:** zmizne používateľsky viditeľná duplicita stromov; jeden strom
  ukáže aj mismatch DB↔file (elementy bez mapovania označené); jeden selection
  state (iTwin vzor).
- **Nevýhody:** zásah do upstream súboru `HierarchyPanel.tsx` (nový AIM-FORK
  touchpoint → náklad na upstream sync, D-071); strom mimo `/ifc` (na `/node`
  stránkach) ďalej treba — `spatial-tree.tsx` nezaniká, len sa nezobrazuje popri 3D.
- **Dopad na dátový model:** žiadny (číta existujúci `fetchSpatialTree`).
- **Náročnosť:** stredná (1–2 týždne vrátane fork testov a sync réžie).

### Variant C — Full workspace convergence: viewer = celé UI

**Popis:** celé AIM UI presunúť do forku — viewer sa stane shellom (stromy, detail,
dokumenty, AI chat), host zostane len data-API + auth. `/node`/`/type` stránky
postupne deprecated v prospech in-viewer záznamov.

- **Výhody:** definitívne nulová duplicita; jeden vizuálny jazyk; žiadne
  iframe-hranice v UX.
- **Nevýhody:** popiera D-071 (izolovaná tenká AIM vrstva, minimálne touchpointy)
  — fork by divergoval plošne a upstream sync by sa stal trvalým nákladom; stráca
  sa SSR/ISR výhoda Next stránok (SEO, rýchle route-detaily, deep-linky); LLM dock
  a Supabase vrstva by sa museli portovať do Vite appky.
- **Dopad na dátový model:** žiadny priamy, ale API by muselo pokryť všetko, čo
  dnes robia SSR stránky.
- **Náročnosť:** vysoká (mesiace) + trvalá údržbová prirážka.

### Odporúčanie

**Variant A hneď, B ako nadstavbu keď bude bolieť dvojstrom, C nerobiť.**
A je najkratšia cesta k „jednej zjednotenej vrstve s drill-downom", nemení dátový
model, drží fork disciplínu D-071 a zodpovedá konvergentnému vzoru trhu („link
v paneli, záznam v module"). B riešiť až po validácii A na používateľoch — pridáva
fork náklad, ktorý sa oplatí len ak dvojstrom reálne prekáža aj po zbalení sidebaru.

---

## Draft záznamu do DECISIONS.md

### D-076 — AIM inspector: konsolidovaná info vrstva nad IFC-lite *(kandidát)*
**Status:** návrh (2026-07-17).

**Kontext:** audit potvrdil zvyškové duplicity po D-067: na `/ifc` dva ľavé stromy
elementov (host `spatial-tree.tsx` z DB + fork `HierarchyPanel` z IFC súboru),
dva vzory detailu prvku (AIM karta v 3D vs `ElementInfoPanel` v 2D), psety
zobrazované z dvoch zdrojov bez prepojenia, dve vyhľadávania, mŕtvy
`filter-bar.tsx`. Rešerš CDE nástrojov (ACC, iTwin, Trimble, Dalux, Solibri,
Speckle, Bimplus) ukazuje konvergentný vzor: natívne IFC dáta a DB dáta sa nikdy
nemiešajú do jedného zoznamu; dokumenty/zodpovednosti/fotky sa viažu na element
ako „link v paneli, záznam v module" s tabovaným inspectorom.

**Rozhodnutie:**
1. AIM karta (D-067) sa povýši na **AIM inspector**: `AimPanelData` `version: 2`
   s typovanými sekciami (documents, persons, captures, history) a tab layoutom
   **AIM | IFC** v natívnom `PropertiesPanel` forku (render v `aim/`, existujúce
   sentinely). IFC tab = natívne psety zo súboru (read-only), AIM tab = DB dáta
   s drill-down cez `AIM_NAVIGATE` na `/node/[id]`.
2. `ElementInfoPanel` (2D) renderuje tú istú `AimPanelData` schému — jeden zdroj
   pravdy pre „detail prvku" naprieč 2D/3D.
3. Host sidebar (strom + nav) sa na `/ifc` defaultne zbalí; mimo `/ifc` ostáva.
4. `filter-bar.tsx` sa maže.
5. Zjednotenie stromov (DB hierarchia ako prepínateľná hierarchia vo fork
   `HierarchyPanel`, bridge `AIM_TREE_LOAD`) sa odkladá ako nadstavbový míľnik —
   podmienený UX validáciou po bode 3.

**Dôvod:** najkratšia cesta k jednej info vrstve bez zmeny dátového modelu a bez
rozširovania fork touchpointov (D-071); zodpovedá overenému vzoru trhu.

**Dôsledok:** bitemporalita dostane prvé UI využitie (sekcia História z
`guid_history` + `valid_from/valid_until`), zatiaľ read-only. Psety zostávajú
z dvoch zdrojov (file vs DB) — vedomé; prípadný diff/indikátor rozdielov je
samostatný budúci bod.
