# SCHEMA.md — AIM Platform (v0.4 — IMPLEMENTOVANÁ)

> Scope: **priestorová hierarchia · assets · dokumenty · zodpovednosti · type–occurrence · aktori (B)**
> Model: centrálna `objects` + tenké typové prípony + čisté FK hrany.
> Konvencie: `CLAUDE.md` + `DECISIONS.md` (D-009–D-025).
>
> **Stav:** §2 implementovaná ako iniciálna migrácia
> `supabase/migrations/20260616120000_init_aim_schema.sql` (D-025).
> Odchýlky implementácie vs. text §2 → viď §8.

---

## 1. Prehľad

```
objects  ──┐  (jeden uzlový priestor, Master UUID = kotva)
           ├─ floors    (elevation)
           ├─ documents (IfcDocumentInformation polia)
           └─ persons   (meno, kontakt)   ── organization = objects riadok

HRANY (objects → objects, čisté FK):
  rel_located_in        Site→Building→Floor→Space→Asset   (type NIKDY nemá polohu)
  rel_defined_by_type   occurrence → type                 (IfcRelDefinesByType)
  rel_member_of         person → organization             (IfcPersonAndOrganization)
  rel_has_document      objekt → dokument
  rel_responsible_for   person|organization → objekt      (role, platnosť = handover)

KLASIFIKÁCIA (referenčné dáta):
  classification_systems ◄─ classification_references
  rel_has_classification  objekt(type aj occurrence) → reference
```

---

## 2. SQL DDL

### 2.0 Pomocné

```sql
create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Hĺbkový merge psetov: occurrence (b) prepíše type (a) na úrovni skalárov
create or replace function jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select case
    when a is null then b
    when b is null then a
    when jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then b
    else (select jsonb_object_agg(k,
            case when (a ? k) and (b ? k) then jsonb_deep_merge(a->k, b->k)
                 when (b ? k) then b->k else a->k end)
          from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) keys)
  end $$;
```

### 2.1 Centrálna tabuľka uzlov

```sql
create table objects (
  id                uuid primary key default gen_random_uuid(),   -- Master UUID (D-010/1)
  object_type       text not null,     -- 'site','building','floor','space','asset','asset_type',
                                        -- 'document','person','organization'
  object_ref        text unique,       -- ľudsky čitateľná identita / QR (D-010/2)
  name              text,              -- IFC Name (atribút)
  ifc_guid          text,              -- IFC GlobalId — len atribút, nullable (D-010/3)
  ifc_type          text,              -- IFC entita: IfcPump, IfcPumpType, IfcSpace…
  predefined_type   text,              -- IFC PredefinedType enum; dedí sa type→occ
  user_defined_type text,              -- IFC ObjectType(occ)/ElementType(type) pri USERDEFINED
  properties        jsonb not null default '{}',   -- property sety + rezervované _kľúče (§4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on objects (object_type);
create index on objects (ifc_guid);
create index on objects (predefined_type);
```

### 2.2 Typové prípony (1:1 k `objects`)

```sql
create table floors (
  id        uuid primary key references objects(id) on delete cascade,
  elevation numeric
);

create table documents (        -- IfcDocumentInformation (D-014); .Name žije v objects.name
  id              uuid primary key references objects(id) on delete cascade,
  identification  text, description text, location text, purpose text, revision text,
  document_owner  text,         -- dočasné; neskôr rel_responsible_for(role='owner')
  status          text,
  valid_from      timestamptz,  -- platnosť revízie (≠ platnosť väzby)
  valid_until     timestamptz
);

create table persons (          -- IfcPerson (D-024); objects.name = zobrazované meno
  id          uuid primary key references objects(id) on delete cascade,
  given_name  text,
  family_name text,
  email       text,
  phone       text
);
-- organization = obyčajný objects riadok (name = názov firmy)
-- štruktúrované adresy + org-hierarchia = C (plánované, §7)
```

### 2.3 Klasifikácia (D-011, D-019 — referenčné dáta)

```sql
create table classification_systems (         -- IfcClassification
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- 'Uniclass 2015'
  source       text, edition text, edition_date date, location text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table classification_references (      -- IfcClassificationReference
  id              uuid primary key default gen_random_uuid(),
  system_id       uuid not null references classification_systems(id) on delete restrict,
  identification  text not null,              -- 'Pr_60_50_10' (produkt) / 'Ss_…' (systém)
  name            text, location text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (system_id, identification)
);
```

### 2.4 História IFC GUIDov (D-010)

```sql
create table ifc_guid_history (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references objects(id) on delete cascade,
  ifc_guid    text not null,
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,          -- NULL = aktuálny
  source      text,
  created_at  timestamptz not null default now()
);
create unique index uniq_active_guid on ifc_guid_history (object_id) where valid_until is null;
```

### 2.5 Hrany (D-009)

```sql
-- Priestorová väzba (D-013). IFC: IfcRelAggregates + IfcRelContainedInSpatialStructure
create table rel_located_in (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,
  to_id   uuid not null references objects(id) on delete restrict,
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Type–occurrence (D-021). IFC: IfcRelDefinesByType. 1:N
create table rel_defined_by_type (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,    -- occurrence
  to_id   uuid not null references objects(id) on delete restrict,   -- type
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Osoba v organizácii (D-024). IFC: IfcPersonAndOrganization
create table rel_member_of (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,    -- person
  to_id   uuid not null references objects(id) on delete restrict,   -- organization
  role    text,              -- rola v rámci firmy (IfcPersonAndOrganization.Roles)
  valid_from timestamptz not null default now(),   -- obdobie zamestnania
  valid_until timestamptz, source text
);

-- Dokument (D-014)
create table rel_has_document (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,
  to_id   uuid not null references objects(id) on delete restrict,
  role text,                 -- 'manual','certificate','as-built'…
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Klasifikácia (D-011, D-023). Cieľ = referenčná tabuľka. Type aj occurrence
create table rel_has_classification (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,
  to_id   uuid not null references classification_references(id) on delete restrict,
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Zodpovednosti (D-020). IFC: IfcRelAssignsToActor + IfcActorRole
-- from_id = person ALEBO organization
create table rel_responsible_for (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete restrict,   -- actor (person|organization)
  to_id   uuid not null references objects(id) on delete cascade,    -- objekt
  role text not null,        -- acting role: 'owner','operator','maintainer','manufacturer'…
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);
```

### 2.6 Indexy + integrita hrán

```sql
create index on rel_located_in (from_id);          create index on rel_located_in (to_id);
create index on rel_defined_by_type (from_id);     create index on rel_defined_by_type (to_id);
create index on rel_member_of (from_id);           create index on rel_member_of (to_id);
create index on rel_has_document (from_id);         create index on rel_has_document (to_id);
create index on rel_has_classification (from_id);
create index on rel_responsible_for (from_id);      create index on rel_responsible_for (to_id);

create unique index uniq_active_location on rel_located_in     (from_id) where valid_until is null;
create unique index uniq_active_type     on rel_defined_by_type(from_id) where valid_until is null;
```

### 2.7 Pohľady (Viewer / LLM)

```sql
-- Effective asset: dedičnosť type→occurrence (occurrence prepíše)
create view v_asset_effective as
  select occ.id, occ.object_ref, occ.name, occ.ifc_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.predefined_type else occ.predefined_type end   as predefined_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.user_defined_type else occ.user_defined_type end as user_defined_type,
    jsonb_deep_merge(typ.properties, occ.properties)              as properties,
    typ.id as type_id, typ.name as type_name
  from objects occ
  left join rel_defined_by_type r on r.from_id = occ.id and r.valid_until is null
  left join objects typ on typ.id = r.to_id
  where occ.object_type = 'asset';

-- Effective klasifikácia: UNION vlastných + zdedených z type (D-023)
create view v_asset_classifications as
  select occ.id as object_id, rc.to_id as classification_ref_id, 'occurrence' as level
  from objects occ
  join rel_has_classification rc on rc.from_id = occ.id and rc.valid_until is null
  where occ.object_type = 'asset'
  union
  select occ.id, rc.to_id, 'type'
  from objects occ
  join rel_defined_by_type dt on dt.from_id = occ.id and dt.valid_until is null
  join rel_has_classification rc on rc.from_id = dt.to_id and rc.valid_until is null
  where occ.object_type = 'asset';

create view v_floors as select o.*, f.elevation from objects o join floors f using (id);
create view v_actors as select * from objects where object_type in ('person','organization');
-- v_documents, v_assets, v_spaces… analogicky
```

### 2.8 Triggery `updated_at`

```sql
create trigger trg_objects_updated before update on objects
  for each row execute function set_updated_at();
-- + classification_systems, classification_references
```

---

## 4. Konvencia `properties` (D-022)

`properties` JSONB obsahuje **property sety**, vnorené podľa názvu. IFC **atribúty**
sem NEPATRIA (sú stĺpce).

| Vrstva | Kde | Rozlíšenie |
|---|---|---|
| 1 — IFC atribúty | stĺpce na `objects` | pevný zoznam zo schémy |
| 2 — štandardné psety | `properties[<názov>]` | názov `Pset_` / `Qto_` |
| 3 — custom psety | `properties[<názov>]` | čokoľvek iné (bez `Pset_`/`Qto_`) |

**Rezervované `_kľúče`:** názvy začínajúce `_` nie sú psety, ale meta/zachytené dáta
(napr. `_contact`, `_org` pri capture-don't-structure — §7). Psety nikdy nezačínajú `_`.

---

## 5. Mapovanie názvov ↔ IFC (D-009, D-012)

Schéma je IFC-aligned, nie priama implementácia (Postgres lowercasuje identifikátory;
CamelCase by vyžadoval úvodzovky a škodil LLM text-to-SQL). IFC väzba cez
`ifc_type`/`ifc_guid` a export.

| Náš objekt / hrana | IFC |
|---|---|
| `objects` (occurrence) | IfcObject (IfcProduct…) |
| `object_type='asset_type'` | IfcTypeObject / IfcElementType |
| `object_type='person'` / `'organization'` | IfcPerson / IfcOrganization |
| `rel_located_in` | IfcRelAggregates + IfcRelContainedInSpatialStructure |
| `rel_defined_by_type` | IfcRelDefinesByType |
| `rel_member_of` | IfcPersonAndOrganization |
| `rel_has_document` | IfcRelAssociatesDocument |
| `rel_has_classification` | IfcRelAssociatesClassification |
| `rel_responsible_for` | IfcRelAssignsToActor (+ IfcActorRole) |
| `classification_systems` / `_references` | IfcClassification / IfcClassificationReference |
| `documents` (prípona) | IfcDocumentInformation (atribútovo 1:1, viď nižšie) |

**Atribútové zarovnanie `documents` ↔ `IfcDocumentInformation` (IFC4.3, D-046):**
`identification`, `description`, `location`, `purpose`, `revision`, `document_owner`,
`status`, `valid_from`, `valid_until` = priamo IFC atribúty (snake_case). Chýbajúce
(`intended_use`, `scope`, `editors`, `creation_time`, `last_revision_time`,
`electronic_format`, `confidentiality`) sa pridajú aditívne, keď budú treba. `status`
hodnoty zarovnať na `IfcDocumentStatusEnum` (DRAFT/FINAL/REVISION/NOTDEFINED).
Verzie/hierarchia dokumentov v budúcnosti podľa `IsPointer`/`IsPointedTo`;
odkaz na časť dokumentu podľa `HasDocumentReferences`.

**IFC-first naming (D-046):** nový atribút/hrana/enum až po kontrole IFC4.3
ekvivalentu — ak existuje, prevziať názov aj enum doslovne.

**Deklarované extenzie nad IFC4.3 (D-046) — úplný zoznam:**
- metadáta na hrane: `valid_from`/`valid_until`/`source`/dôverové vrstvy na `rel_*`
  (IFC vzťahy nenesú platnosť ani provenance väzby),
- `ifc_guid_history` + Master UUID (identita naprieč verziami súborov),
- väzby naprieč IFC súbormi (federácia — natívne až IFC5).
Pri exporte ich IFC nenesie → ICDD linksety (D-015), do budúcna IFCX layer komponenty.

---

## 6. Návrhové rozhodnutia (zhrnutie)

- **R1** Centrálna `objects` + typové prípony + typované FK hrany (D-018).
- **R2** Klasifikácia dvojúrovňová, referenčné dáta (D-019).
- **R3** `object_ref` ≠ klasifikačný kód (D-010/2).
- **R4** Zodpovednosti od v1 cez aktorov + `rel_responsible_for` (D-020, spresnené D-024).
- **R5** Štíhle uzly; stĺpec sa povýši migráciou až keď treba.
- **R6** Type–occurrence: `rel_defined_by_type`, dedičnosť s prepisom (D-021).
- **R7** `properties` = tri vrstvy, rozlíšené prefixom názvu (D-022).
- **R8** Klasifikácia na type aj occurrence; efektívna = union faset (D-023).
- **R9** Aktori: teraz **B** (person + organization + `rel_member_of`), **C** plánované
  ako aditívne rozšírenie (D-024).

---

## 7. Plánované (C — aditívne) a trvalo mimo scope

**Aktori sú teraz B (D-024).** Nasledovné je **plánované ako C** — pridá sa aditívne,
bez refaktoru čohokoľvek z B, keď to projekt/import bude potrebovať:
- **Org↔org hierarchia** — hrana `rel_part_of_org` (IfcOrganizationRelationship, oddelenia/dcéry)
- **Štruktúrované adresy** — tabuľky pre IfcPostalAddress / IfcTelecomAddress
- **Intrinsic roly** osoby/firmy ako entita (IfcPerson.Roles / IfcOrganization.Roles)

Dovtedy **capture-don't-structure**: ETL uloží surové adresy/org-väzby do
rezervovaných kľúčov (`_contact`, `_org`) v `properties`, nech sa dáta zo zdroja
nestratia. Povýšenie na štruktúru (C) je neskôr čistá migrácia.

**Plánované aditívne — dokumenty (D-032):**
- **`documents.storage_type`** `text` (`supabase | external | unresolved`) — ako narábať
  s `location`. Pridá sa **novou migráciou** (existujúca sa needituje).
- Voliteľne neskôr **`rel_supersedes`** (revízie dokumentov) — zatiaľ implicitne cez
  name + `valid_from`.

**Plánované aditívne — coding scheme (D-033):** `object_ref` sa skladá z projektovej
kódovacej schémy (field-source resolver: pset / atribút / klasifikácia + `extract`/`format`),
nie z IFC `Tag`. Definícia schémy žije v ETL/projektovom configu (`etl/scheme.py`), nie
nutne v DB. Multi-projekt `project` entita + per-projekt schéma = aditívne pri 2. projekte.

**Trvalo mimo scope:** geometria v DB / mesh ukladanie / RepresentationMaps — Postgres sa
geometrie nedotýka ani s príchodom 3D renderingu; IFClite (D-044) je aplikačná klient-side
vrstva, geometria zostáva ephemerálna v prehliadači. `property_set_templates` (bSDD
validácia) — až pri validácii handoveru.

---

## 8. Implementačný stav a odchýlky (migrácia 20260616120000)

§2 je 1:1 prenesená do migrácie `supabase/migrations/20260616120000_init_aim_schema.sql`.
Vedomé rozhodnutia pri implementácii (odsúhlasené, viď D-025):

- **RLS sa NEzapína.** SCHEMA.md ho nešpecifikuje; politiky sú aditívne a doplnia sa
  spolu s auth/frontendom v ďalšom chate. Do tej doby DB nie je vystavená cez verejné API.
- **Views — len 4 explicitne menované** (`v_asset_effective`, `v_asset_classifications`,
  `v_floors`, `v_actors`). `v_documents`/`v_assets`/`v_spaces` („analogicky" v §2.7)
  sa doplnia neskôr podľa potreby Viewera — sú čisto aditívne.
- **Indexy presne podľa §2.6.** `rel_has_classification` má index len na `from_id`
  (nie `to_id`) — držané podľa schémy, nie opomenutie.
- **`updated_at` triggery** sú na 3 tabuľkách s týmto stĺpcom: `objects`,
  `classification_systems`, `classification_references`. Prípony (floors/documents/
  persons) ani `ifc_guid_history` stĺpec `updated_at` nemajú → bez triggera.
- **Jediný migračný súbor** (nie logické rozdelenie) — initial schema, poradie
  rešpektuje FK závislosti.

**Verifikácia:** Docker nie je dostupný → namiesto `supabase db reset` overené na
čistej lokálnej PostgreSQL 17 cez `psql` (`ON_ERROR_STOP=1`). Otestované: aplikácia
celej migrácie, deep-merge dedičnosť v `v_asset_effective`, partial-unique
`uniq_active_location` (2. aktívna poloha zlyhá, archivovaná + nová prejde),
`updated_at` trigger. Pri prvom `supabase db reset` s Dockerom musí prejsť rovnako.

---
*v0.4 — §2 implementovaná (migrácia 20260616120000). Seed hotový (`supabase/seed.sql`). Viewer S0–S3 nasadený na Verceli. Schéma sa od iniciálnej migrácie nemenila — všetky nové features (Viewer S1–S3: hierarchia, asset karta, dokumenty/zodpovednosti/GUID + generický object route, D-027–D-029) sú čisto na aplikačnej vrstve. Ďalšia migrácia príde s S4 (ETL reálne dáta) alebo aditívnymi features (RLS, actor model C).*
