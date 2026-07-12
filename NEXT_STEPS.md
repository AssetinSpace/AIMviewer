# NEXT_STEPS — nočný audit 2026-07-12

Prioritizované odporúčania z auditu (vetva `claude/overnight-repo-audit-vky8t5`).
Čo už je opravené, je v `MORNING_REPORT.md`. Odhady: S < 1 h, M = 1–4 h, L = deň+.

## Kritické

1. **Rate limit / ochrana `/api/ask`** (M) — endpoint bez auth, origin checku a limitu
   spúšťa až 9 volaní LLM providera × 4000 tokenov na request (`app/api/ask/route.ts`,
   `maxDuration = 60`). Na verejnom Verceli priamy vektor na vyčerpanie kreditu /
   DoS. Vyžaduje D-0xx rozhodnutie (Turnstile? IP limit v middleware? auth?), preto
   neopravené autonómne.

2. **ETL: hrany na neimportované entity zhodia celý load** (M) —
   `_collect_documents`/`_collect_actors` (`etl/transform.py:534-558`) emitujú hranu
   pre KAŽDÝ objekt s GlobalId, aj pre prvky mimo importu (otvory, sub-komponenty,
   federate spatial roots). `refs.ref()` alokuje ref bez staged objektu →
   `_resolve_cross_file_refs` hodí ValueError a transakcia sa rollbackne.
   Guard existuje pre `assigns_to_group` (`transform.py:438-441`) — treba ho
   zovšeobecniť + malé D-0xx či dokumenty na vylúčených prvkoch zahadzovať alebo mapovať.

## Stredné

3. **`object_ref` závislý od poradia iterácie** (L, D-0xx) — pri kolízii mien/Markov
   rozhoduje poradie `model.by_type()`, ktorý prvok dostane `Name` vs `Name-2`
   (`etl/transform.py:101-159`). `object_ref` je upsert konfliktný kľúč — po
   re-exporte sa identita (QR kódy!) môže ticho presunúť na iný fyzický prvok.
   Návrh: tie-break GlobalId-om alebo hard-fail pri ambiguite. Architektonické.

4. **Duálne viewer komponenty + stale-closure race** (M) — `components/ifc-viewer.tsx`
   (živý) vs `components/ifc-viewer-embed.tsx` (mŕtvy, 343 riadkov, iný env var
   `NEXT_PUBLIC_VIEWER_URL`). Mŕtvy embed pritom má správnu pending-queue pre
   FOCUS pred MODELS_LOADED, živý komponent príkaz v tom okne zahodí (klik na
   „3D: N prvkov" počas parsovania = nič). Rozhodnúť, ktorý prežije, preniesť
   queue, druhý zmazať (zmaže aj lint warning v `hooks/use-ifc-query.ts`).

5. **Mŕtvy filter reťazec** (S) — `components/filter-bar.tsx` (nepoužívaný) →
   `app/api/filter/route.ts` (živý verejný endpoint bez volajúceho) →
   `fetchByIfcType`/`fetchByClassificationPrefix`. Zmazať celý reťazec, alebo
   FilterBar vrátiť do UI. Kým sa nerozhodne, endpoint zbytočne visí vonku.

6. **ETL kontakty sa zahadzujú (proti AGENTS.md)** (M) — `_person_object` nikdy
   nevyplní email/telefón a adresy/roly z `IfcPerson`/`IfcOrganization` sa
   nezachytia do `_contact`/`_org` (`etl/transform.py:578-602`), hoci konvencia
   to vyžaduje. Zároveň sa person/org staguje duplicitne pre každú
   `IfcRelAssignsToActor` (neškodné, ale zbytočné upserty).

7. **ETL N+1 zápisy** (M) — každý objekt/hrana/strana = samostatný `cur.execute`
   round-trip (`etl/db.py`, `etl/pdf_text.py`). Nad vzdialeným Supabase škáluje
   s WAN latenciou. Hrany/história/stránky → `executemany`/`COPY`.

8. **react-hooks lint chyby** (S) — `drawing-viewer.tsx:358` a
   `element-info-panel.tsx:64` volajú setState synchrónne v efekte (kaskádové
   rendery). Refaktor na odvodený stav / event handler.

9. **npm audit: postcss cez next** (S–M) — moderate (GHSA-qx2v-qp2m-jg93);
   oprava = bump next na verziu s postcss ≥ 8.5.10, otestovať build.

## Kozmetické / nice-to-have

10. **`aggregate_objects` fallback ORDER BY 1** (S) — v `return_rows` móde bez
    `prop_path` sa radí ordinálom (JSONB stĺpec 1) a tvári sa to ako ranking
    (`20260713120000:156`). Nová migrácia s `order by o.name` alebo bez ORDER.
    (Zmena DB = migrácia, preto nie autonómne.)
11. **Hardcoded Supabase projekt v `lib/data/ifc.ts:12`** (S) — presunúť do env
    defaultu (`NEXT_PUBLIC_IFC_URLS` už existuje ako override).
12. **`page` query param bez clampu** (S) — `drawing/[id]/page.tsx` akceptuje
    `page=-5` → react-pdf error state namiesto strany 1.
13. **Nepoužívané deps** (S) — `three`, `@types/three`, `@ifc-lite/geometry|query|wasm`
    + `postinstall` kopírujúci multi-MB wasm do `public/`, ktorý nič nenačíta
    (3D beží v iframe ifc-lite viewera). Ak sa neplánuje in-app render, vyhodiť.
    Súvisí s rozhodnutím v bode 4.
14. **`fetchSpaceSiblings` maskuje DB chybu ako „bez súrodencov"** (S) —
    `lib/data/filter.ts:66`.
15. **Duplicitné typy v `element-info-panel.tsx`** (S) — importovať `NodeSummary`
    / `TYPE_LABEL` z `lib/data/object.ts` / `lib/object-type.ts`.
16. **`style_in_3d` URL dĺžka** (S) — až 400 GUIDov (~9,5 kB) v jednej `/ifc?ops=`
    URL + `finalActions` ich spája; pridať cap pri merge.
17. **Rozšíriť unit testy** (M) — teraz existuje pytest (`etl/tests`) aj vitest
    (`npm test`): pokryť `scheme.py` resolver, `doc_scheme.parse_container_name`,
    `pdf_link.detect_codes`, `sanitizeQuery`/`clampLimit` a `parseOps`
    (`ifc-viewer.tsx`), `buildPropertySets`, `normalizeRegion`.
18. **`relationships` bez sémantickej unikátnosti `(rel_type, from_id, to_id)`**
    (S, len dokumentácia) — dedup drží len deterministické UUID v ETL; seed +
    ETL hrana pre ten istý pár koexistujú. Zaznamenať do `SCHEMA.md`.

## Overené a čisté (bez akcie)

- LLM RPC vrstva (`search_everything`, `aggregate_objects`, `search_documents`):
  read-only, whitelisty, `format('%I'/'%L')`, `set search_path` — injection
  vektor nenájdený (D-059/D-060 dodržané).
- Žiadne secrets v kóde; service_role len server-side (`server-only`), D-026 drží.
- Žiadne `dangerouslySetInnerHTML`; AIM_NAVIGATE validuje host-relative cesty.
- Event listenery/intervaly sa čistia; AIM panel fetch má AbortController guard.
