# ROADMAP.md — AIM Viewer (fázy a priority)

> Sprintový plán prvého use case **AIM Viewer** (D-003).
> Princíp: **každý sprint končí niečím demovateľným**, poradie ide podľa
> narastajúcej „previazanosti" dát — to je celé posolstvo demo (D-003).
> Konvencie a rozhodnutia: `CLAUDE.md` + `DECISIONS.md` (D-026 = Viewer stack).

---

## Stav (2026-06-17)

- ✅ Schéma + iniciálna migrácia (`20260616120000_init_aim_schema.sql`, D-025)
- ✅ Seed dáta (`supabase/seed.sql`) — plná previazanosť: hierarchia, type–occurrence, aktori, dokumenty, klasifikácie, GUID história
- ✅ S0 — Next.js skeleton + Vercel deploy + Supabase connection (D-026)
- ✅ S1 — Priestorová hierarchia: strom + route per uzol (D-027)
- ✅ S2 — Asset karta: dedičnosť + provenance, klasifikácie, type route (D-028)
- ✅ S3 — Dokumenty + zodpovednosti + GUID história, generický object route (D-029)
- 🟢 **Teraz:** S4 — polish & launch (čaká na ETL reálne dáta + doménu)
- ⏸️ ETL pipeline (Python + ifcopenshell) — **paralelná vetva**, nie blocker
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

---

## Parkované / paralelné

- **S-LLM — LLM interface** (parkované, doladíme neskôr): chat nad dátami,
  Claude text-to-SQL (D-005) s guardrailmi (read-only, whitelist views, row limit).
  Model sa vyberie pri spustení (`claude-opus-4-8` vs lacnejší pre demo).
- **ETL pipeline** (paralelná vetva): `ifcopenshell` IFC → `objects`/`rel_*`,
  nahradí ručný seed reálnymi dátami z diplomky (vstup pre S4).

## Mimo scope (zatiaľ)
- Auth + RLS (príde s verejným/multi-user prístupom — aditívne, D-025).
- 3D / IFC.js geometria (D-007: sme dátový viewer, nie geometrický).

---
*Posledná aktualizácia: 2026-06-17 — S0–S3 hotové, deploy na Verceli. Ďalej: S4 (polish & launch — čaká na ETL reálne dáta + doménu).*
