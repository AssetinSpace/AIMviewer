# AIM ETL — IFC → Supabase

Python pipeline, ktorá načíta IFC model a naplní Supabase schému (`objects` +
`rel_*` + klasifikácie + GUID história) podľa `../SCHEMA.md` a konvencií v
`../AGENTS.md`. Architektúra a rozhodnutia: **D-031** v `../DECISIONS.md`.

> **Stav (E2):** mapovanie doladené na model diplomky (`ASR.ifc`) — rozsah importu
> (D-034), konsolidácia podlaží (D-035), 18 SNIM kategórií, psety/klasifikácie/GUID.
> `--dry-run` overený (681 assetov, 5 podlaží, 89 priestorov). Reálny load nahrádza
> `../supabase/seed.sql` (`--reset`). VZT.ifc, dokumenty a ICDD export sú ďalšie E-sprinty.

## Štruktúra
| Súbor | Účel |
|---|---|
| `extract.py` | otvorenie IFC + nízkoúrovňové helpery (ifcopenshell) |
| `scheme.py` | kódovacia schéma — field-source resolver + SNIM definícia (`object_ref`, D-033) |
| `transform.py` | IFC → staged model (mapovanie podľa SCHEMA/§4) |
| `model.py` | medziľahlé dataclassy (staged riadky) + `CoverageReport` |
| `db.py` | idempotentný upsert do Postgresu v poradí FK |
| `ids.py` | deterministické UUID pre tabuľky bez prirodzeného unique |
| `config.py` | načítanie `DATABASE_URL` |
| `main.py` | CLI (`--file`, `--dry-run`) |

## Predpoklady
- **Python 3.9+** (overené s 3.9 + `ifcopenshell 0.8.4`).
- `DATABASE_URL` v `../.env.local` — Supabase → Project Settings → Database →
  Connection string (URI). Tajné, gitignored.

## Inštalácia a spustenie
```bash
python -m venv etl/.venv && source etl/.venv/Scripts/activate   # Windows: etl/.venv/Scripts/activate
pip install -r etl/requirements.txt

# IFC súbor daj do etl/data/ (gitignored), potom z koreňa repa:
python -m etl.main --file etl/data/model.ifc --dry-run   # náhľad, bez zápisu
python -m etl.main --file etl/data/model.ifc             # zápis do Supabase (upsert)
python -m etl.main --file etl/data/model.ifc --reset     # vyprázdni AIM dáta, potom load
```

> **Windows:** konzola je `cp1250` → spúšťaj s `PYTHONUTF8=1` (inak padne na diakritike).

### `--reset` (nahradenie seedu, E2)
`--reset` pred loadom `TRUNCATE ... CASCADE` vyprázdni AIM dáta (riadky, nie schému) —
použité raz pri výmene ručného seedu za reálne ETL dáta. Seed je reprodukovateľný
z `../supabase/seed.sql`, takže je to vratné. Bez `--reset` ide čistý idempotentný
upsert (re-run rovnakého modelu nič neduplikuje).

## Idempotencia (D-031)
- `objects` upsert cez `object_ref` (UNIQUE) → `id` ostáva DB-generované (D-010).
- Hrany / systémy / GUID história → deterministické UUID (`ids.py`), `ON CONFLICT (id)`.
- Re-run rovnakého modelu nič neduplikuje. Pri zmene dát mimo revalidačného okna
  Viewera viď `revalidateTag("aim")` (D-030).

## `object_ref` zo schémy (E1, D-033)
`object_ref` sa skladá z **kódovacej schémy projektu** (`scheme.py`), nie z IFC `Tag`.
SNIM: `Assembly Code` (TSP+PSP) + `Type Mark` (UOT) + `Mark` (INST) → type `DD01.06`,
inštancia `DD01.06.03`. Kategóriu určuje **prefix `Assembly Code`** (čítané naprieč
psetmi). Fallback na `ifc_guid` len keď kód chýba/nie je unikátny. `--dry-run` vypíše
**coverage report** (pokrytie SNIM kódom vs. fallback, po IFC triedach). Iný projekt =
iná `CodingScheme` v `scheme.py`, kód sa nemení.

## Rozsah importu — policy (D-034)
Čo je `asset` **nie je hardcoded** v `transform.py`, ale `ScopePolicy` v `scheme.py`:
asset = **top-level** prvok (`get_aggregate` = priestor/None) mínus voidy
(`IfcFeatureElement`) a sub-komponenty (vnorené stĺpiky/panely fasády, vrstvy strechy,
ramená schodov); **výnimka** = vnorené `IfcDoor`/`IfcWindow` ostávajú asset. `asset_type`
sa tvorí **len pre typy referencované assetom** (žiadny `IfcSpaceType`/typy vyradených
komponentov). Na ASR: **681 assetov** z 2706 `IfcElement`.

## Konsolidácia podlaží (D-035)
Pomocné Revit úrovne (`1NP_SH_ZD`, `2NP_HH_STROP`, `Dojazd_výťahov`, …) sa NEemitujú
ako `floor` uzly — premapujú sa na reálne podlažie (`^\d+NP$` / má priestory) podľa
NP-prefixu názvu, inak najbližšej elevácie. ASR: 18 storeys → **5 podlaží** (`1NP`–`5NP`).

## SNIM kategórie (`scheme.py`)
18 kategórií: 8 z `SNIM - Hierarchia.pdf` (DD, SN, FS, PH, ST, PD, ZV, KV) + 10
doplnených v E2 (OV, PL, LP, ZD, DZ, SD, IH, VT, SH, TV). Coverage report už nehlási
„TSP mimo schémy". Väčšina kategórií má len typové kódovanie (bez `Mark`) → inštancia
ide na GUID fallback (správne — netlačí sa inštančný tag).
