# MORNING_REPORT — nočný audit AIMviewer, 2026-07-12

Vetva: `claude/overnight-repo-audit-vky8t5` (z tipu `main`, d9c16c5).
**Nič nie je zmergované do main, nič nie je nasadené** — všetko čaká na tvoje review.
Sesterský report je v repe ifc-lite (auditovali sa oba, aj AIM iframe bridge na strane viewera).

## Ako audit prebehol

1. Prečítané `AGENTS.md`, `DECISIONS.md`, `SCHEMA.md`, `ROADMAP.md`, `etl/README.md`.
2. Kompletný audit frontendu (app/components/lib/hooks, ~60 súborov), ETL (18 modulov)
   a Supabase migrácií vrátane LLM RPC vrstvy (D-059/D-060).
3. Baseline pred zmenami: `tsc` čistý, lint 2 chyby + 1 warning (existujúce),
   `npm audit` 1 moderate (postcss cez next).

## Čo sa našlo (súhrn)

**Kritické (5):** rotácia IFC GUID zhadzovala celý ETL load; `pdf_text` ticho
spracoval 0 PDF (komentáre v manifeste); 3× chýbajúca paginácia nad PostgREST
limitom 1000 (spatial hrany → prvky miznú zo stromu; GUID mapa → 3D klik bez
AIM karty; `get_model_stats` → LLM grounding na podhodnotených číslach).

**Stredné:** `/api/ask` bez rate limitu (LLM cost abuse); ETL hrany na
neimportované entity = crash loadu; `object_ref` závislý od poradia iterácie
(riziko tichého presunu identity/QR); re-upload dokumentu mazal `_drawing_links`;
únik DB hlások cez API; fail-open postMessage origin pri misconfigurácii;
duálne viewer komponenty (mŕtvy `ifc-viewer-embed.tsx` má pritom správnu
FOCUS queue); žiadne unit testy v celom repe.

**Čisté (overené):** LLM RPC funkcie bez injection vektora, žiadne secrets,
service_role len server-side (D-026 drží), XSS povrch čistý, listener hygiena OK.

## Čo je opravené (commity, chronologicky)

| Commit | Čo a prečo |
|---|---|
| `8f6ccd2` | **fix(etl): pdf_text nefiltroval `#` komentáre manifestu** — spracoval 0 PDF, `search_documents` (D-063) nikdy nič nevrátil. Zjednotené všetky 3 parsery (utf-8-sig + filter). |
| `efa89e4` | **fix(etl): rotácia IFC GUID** — nový aktívny záznam bez uzavretia predošlého → unique violation na `uniq_active_guid` → rollback celého loadu. Presne workflow, pre ktorý D-010 história existuje. |
| `7668ba9` | **fix(etl): re-upload E3 mazal `_drawing_links` z E4** — upsert nahrádzal celý properties JSONB; teraz sa mení len pset `CDE`. |
| `69832e0` | chore(etl): chybová hláška uploadu (konštanta vs. argument), UTF-8 guard v main.py, 2 mŕtve polia CoverageReport. |
| `ad911e4` | **fix(data): paginácia hrán, GUID mapy a `get_model_stats`** — zdieľaný `fetchAllPages` helper; bez neho PostgREST ticho orezával na 1000 riadkov (prvky nad limit vypadli zo stromu / bez AIM karty / zlé LLM štatistiky). |
| `9adb6ca` | **fix(app): API hygiena + fail-closed origin** — UUID validácia v space-siblings, generické error hlášky, catch na fire-and-forget fetch, viewer bridge sa pri zlej `NEXT_PUBLIC_IFC_VIEWER_URL` zatvorí namiesto `targetOrigin: '*'`. |
| `8f00156` | chore(data): `AIM_CACHE` z constants (dedup). |
| `4941d71` | chore(app): `element-info-panel` importuje kanonický `NodeSummary`/labely; + `NEXT_STEPS.md`. |

**Nová testovacia infraštruktúra** (predtým žiadna): pytest pre ETL
(`python -m pytest etl/tests`, 9 testov; `etl/requirements-dev.txt`) a vitest
pre frontend (`npm test`, 6 testov). Každá oprava logiky má regresný test.

## Verifikácia

- `npx tsc --noEmit` ✅ · `npm run lint` ✅ (len 2+1 baseline problémy, viď nižšie)
- `npm test` ✅ 6/6 · `python -m pytest etl/tests` ✅ 9/9
- `npx next build` — padá už na prerenderi `/` pre **chýbajúce Supabase env
  premenné v audit kontajneri** (guard v `lib/supabase/server.ts`); nie je to
  regresia tejto vetvy — rovnaké prostredie by nezbuildovalo ani `main`.
  Na Verceli s env premennými build prebehne; kompiláciu zmien kryje `tsc`.
- DB/schéma/migrácie/produkčné konfigy **nedotknuté** (líniu D-026/D-025 nič nemení)

## Čo čaká na tvoje rozhodnutie (a prečo som to nerobil)

Plný zoznam s odhadmi je v `NEXT_STEPS.md`; top položky:

1. **Rate limit `/api/ask`** — potrebuje D-0xx (mechanizmus: Turnstile/IP/auth).
2. **ETL hrany na neimportované entity** — guard je mechanický, ale či dokumenty
   na vylúčených prvkoch zahadzovať alebo premapovať je malé D-0xx.
3. **`object_ref` poradie iterácie** — mení identitu existujúcich refov (QR kódy),
   architektonické.
4. **Ktorý viewer komponent prežije** — `ifc-viewer.tsx` (živý) vs
   `ifc-viewer-embed.tsx` (mŕtvy, ale so správnou FOCUS queue); po rozhodnutí
   sa dá preniesť queue a zmazať ~350 riadkov + mŕtvy filter reťazec
   (`filter-bar.tsx` → `/api/filter`) + nepoužívané deps (`three`,
   `@ifc-lite/*` + multi-MB wasm v `public/`).
5. **2 baseline lint chyby** (setState v efekte v `drawing-viewer`/`element-info-panel`)
   — vyžadujú malý refaktor efektov, nechcel som bez testov meniť správanie UI.
6. **npm audit: next/postcss** moderate — bump next, treba otestovať build.

Poznámka k dokumentácii: podľa AGENTS.md by opravené D-010/D-031 správanie ETL
zaslúžilo zmienku v ROADMAP changelogu — nechávam na teba pri merge (nechcel som
autonómne editovať vrstvu 2 dokumenty).

## AIM bridge — druhá strana (ifc-lite repo)

Vo viewri (ifc-lite vetva `claude/overnight-repo-audit-vky8t5`) sú opravené:
`resetColors(refs)` ignoroval refs (FOCUS mazal aktívny filter), validácia
payloadu správ, `e.source` guard, FOCUS echo (už sa nevracia ako
ENTITY_SELECTED), MODELS_LOADED latch, autoload `?models=` hardening.
**Pozor:** `flyTo` je stále no-op (kamera sa pri FOCUS nehýbe) — architektonické
rozhodnutie, viď `NEXT_STEPS.md` bod 1 v ifc-lite repe. A MODELS_LOADED sa
stále hlási po prvom z N modelov (deep-link na VZT prvok sa môže stratiť).
