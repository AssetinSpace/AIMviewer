# AIM ETL — IFC → Supabase

Python pipeline, ktorá načíta IFC model a naplní Supabase schému (`objects` +
`rel_*` + klasifikácie + GUID história) podľa `../SCHEMA.md` a konvencií v
`../CLAUDE.md`. Architektúra a rozhodnutia: **D-031** v `../DECISIONS.md`.

> **Stav:** scaffold (štruktúra, DB/upsert vrstva, generický IFC walk) syntakticky
> overený. End-to-end beh + doladenie mapovania (`TODO(model)` v `transform.py`)
> čaká na reálny IFC z diplomky. Do S4 ostáva `../supabase/seed.sql` zdrojom dát.

## Štruktúra
| Súbor | Účel |
|---|---|
| `extract.py` | otvorenie IFC + nízkoúrovňové helpery (ifcopenshell) |
| `transform.py` | IFC → staged model (mapovanie podľa SCHEMA/§4) |
| `model.py` | medziľahlé dataclassy (staged riadky) |
| `db.py` | idempotentný upsert do Postgresu v poradí FK |
| `ids.py` | deterministické UUID pre tabuľky bez prirodzeného unique |
| `config.py` | načítanie `DATABASE_URL` |
| `main.py` | CLI (`--file`, `--dry-run`) |

## Predpoklady
- **Python 3.9+** odporúčané (ifcopenshell wheels; lokálne je 3.8 — možno treba upgrade).
- `DATABASE_URL` v `../.env.local` — Supabase → Project Settings → Database →
  Connection string (URI). Tajné, gitignored.

## Inštalácia a spustenie
```bash
python -m venv etl/.venv && source etl/.venv/Scripts/activate   # Windows: etl/.venv/Scripts/activate
pip install -r etl/requirements.txt

# IFC súbor daj do etl/data/ (gitignored), potom z koreňa repa:
python -m etl.main --file etl/data/model.ifc --dry-run   # náhľad, bez zápisu
python -m etl.main --file etl/data/model.ifc             # zápis do Supabase
```

## Idempotencia (D-031)
- `objects` upsert cez `object_ref` (UNIQUE) → `id` ostáva DB-generované (D-010).
- Hrany / systémy / GUID história → deterministické UUID (`ids.py`), `ON CONFLICT (id)`.
- Re-run rovnakého modelu nič neduplikuje. Pri zmene dát mimo revalidačného okna
  Viewera viď `revalidateTag("aim")` (D-030).

## Čo doladiť na model diplomky (`TODO(model)`)
- Zdroj `object_ref` (Tag / Name / GlobalId) — stabilný a unikátny.
- Ktoré IFC triedy považovať za „asset".
- Názvy psetov a klasifikačného systému (Uniclass / CCI / vlastný).
