-- =============================================================================
-- D-051 — Meta-model vzťahov B: generická `relationships` + kanonické views + manifest
-- =============================================================================
-- Revízia D-048: per-vzťah tabuľky `rel_*` sú SUPERSEDOVANÉ jednou generickou
-- tabuľkou `relationships` (diskriminátor `rel_type`, symetricky k `objects`).
-- Vlastný IFC meta-model je trojtabuľkový: objects (IfcObjectDefinition) +
-- relationships (IfcRelationship, objektifikovaný) + properties (IfcPropertyDefinition).
-- B škáluje na celé IFC bez migrácie za každý vzťah.
--
-- KRITICKÁ DELIACA ČIARA (D-048 ostáva v platnosti): preberáme z IFC identitu,
-- pomenovanie a granularitu vzťahov, NIE fyzickú serializačnú štruktúru. Hrany
-- ostávajú **binárne** `from_id→to_id` + naše meta stĺpce (valid_from/until/source/
-- role). N-árne = N riadkov (leaning binárne, D-051) — drží idempotenciu (D-031)
-- aj LLM-friendly views.
--
-- Manifest (`relationship_types`) = jeden zdroj pravdy o `rel_type` (smer/IFC
-- Relating strana, povolené object_type oboch strán, namespace rel/aim, export
-- cesta, unique-active-parent). Generovaný a overený proti IFC schéme cez
-- `ifcopenshell` (etl/manifest.py, IFC-first D-046). Poháňa validačný trigger,
-- ETL routing aj export.
--
-- Bezvýpadkový cutover (vzor D-048): kanonické views nesú ROVNAKÉ názvy ako dnešné
-- tabuľky `rel_*` → čítacia vrstva (viewer/3D/filter) sa nemení vôbec. Zápis (ETL,
-- seed) ide na base tabuľku `relationships`.
--
-- Partície ODLOŽENÉ: `LIST` partícia podľa `rel_type` nesie constraint „PK musí
-- obsahovať partičný kľúč" → kolízia s `ON CONFLICT (id)` idempotenciou (D-031).
-- Zavedie sa len ak to objem vyžiada (dnes tisíce hrán → index na rel_type stačí).
--
-- Migrácie sú ADITÍVNE — tento súbor sa nikdy needituje; staré sa nemažú.
-- Dáta hrán sú regenerovateľné (ETL D-031 + seed) → split/backfill je bezpečný.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Manifest vzťahov — referenčná tabuľka `relationship_types` (D-051)
--    Generované z etl/manifest.py (`python -m etl.manifest --sql`), overené proti
--    IFC4X3 schéme. Regenerácia = ten skript; tu je commitnutý deterministický výstup.
-- -----------------------------------------------------------------------------
create table relationship_types (
  rel_type            text primary key,      -- diskriminátor v `relationships`
  ifc_entity          text,                  -- IFC kotva (IfcRelAggregates…); null = čisto aim_
  ifc_family          text,                  -- rodina (IfcRelDecomposes…); null pre resource
  is_ifc_rel          boolean not null,      -- true → serializuje sa na IfcRel*; false → resource/aim
  relating_end        text not null,         -- 'from' | 'to' — ktorý koniec je IFC Relating
  from_object_types   text[] not null,       -- povolené object_type subjektu (from_id)
  to_object_types     text[] not null,       -- povolené object_type objektu (to_id); prázdne pri klasifikácii
  to_is_classification boolean not null default false,  -- výnimka: to_id → classification_references
  namespace           text not null,         -- 'rel' (IFC-kanonické) | 'aim' (naše rozšírenie, D-048)
  export_path         text not null,         -- 'ifcrel' | 'resource' | 'icdd' | 'ifcx'
  unique_active_from  boolean not null default false,   -- unique-active-parent (1 aktívny rodič na from_id)
  description         text,
  check (relating_end in ('from', 'to')),
  check (namespace in ('rel', 'aim')),
  check (export_path in ('ifcrel', 'resource', 'icdd', 'ifcx'))
);

insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('rel_aggregates', 'IfcRelAggregates', 'IfcRelDecomposes', true, 'to', array['building', 'floor', 'space'], array['site', 'building', 'floor'], false, 'rel', 'ifcrel', true, 'Spatial dekompozícia Site→Building→Floor→Space (D-013).'),
  ('rel_contained_in_spatial_structure', 'IfcRelContainedInSpatialStructure', 'IfcRelConnects', true, 'to', array['asset'], array['floor', 'space'], false, 'rel', 'ifcrel', true, 'Fyzický prvok (asset) umiestnený v priestorovej štruktúre.'),
  ('rel_defines_by_type', 'IfcRelDefinesByType', 'IfcRelDefines', true, 'to', array['asset'], array['asset_type'], false, 'rel', 'ifcrel', true, 'Type–occurrence dedičnosť (D-021).'),
  ('rel_associates_document', 'IfcRelAssociatesDocument', 'IfcRelAssociates', true, 'to', array['site', 'building', 'floor', 'space', 'asset', 'asset_type'], array['document'], false, 'rel', 'ifcrel', false, 'Väzba objekt → dokument (D-014); role=''drawing'' pre E4.'),
  ('rel_associates_classification', 'IfcRelAssociatesClassification', 'IfcRelAssociates', true, 'to', array['asset', 'asset_type'], array[]::text[], true, 'rel', 'ifcrel', false, 'Klasifikácia na type aj occurrence (D-023). to_id → classification_references.'),
  ('rel_assigns_to_actor', 'IfcRelAssignsToActor', 'IfcRelAssigns', true, 'from', array['person', 'organization'], array['site', 'building', 'floor', 'space', 'asset', 'asset_type', 'document'], false, 'rel', 'ifcrel', false, 'Zodpovednosti (D-020); role = acting rola.'),
  ('rel_assigns_to_group', 'IfcRelAssignsToGroup', 'IfcRelAssigns', true, 'to', array['asset'], array['system'], false, 'rel', 'ifcrel', false, 'Členstvo prvku v distribučnom systéme (D-047).'),
  ('rel_member_of', 'IfcPersonAndOrganization', null, false, 'from', array['person'], array['organization'], false, 'rel', 'resource', false, 'Osoba v organizácii (D-024) — IFC resource, nie IfcRel.');


-- -----------------------------------------------------------------------------
-- 2) Generická tabuľka hrán `relationships` (D-051)
--    Binárna from→to. `to_id` je POLYMORFNÉ (objects ALEBO classification_references)
--    → zámerne bez FK; integritu rieši validačný trigger z manifestu (nižšie).
--    `from_id` má FK+CASCADE na objects → reset (TRUNCATE objects CASCADE) aj
--    mazanie uzla ostáva bez osirelých hrán.
-- -----------------------------------------------------------------------------
create table relationships (
  id          uuid primary key default gen_random_uuid(),
  rel_type    text not null references relationship_types(rel_type),
  from_id     uuid not null references objects(id) on delete cascade,  -- subjekt
  to_id       uuid not null,                                           -- objekt (objects/classification_references)
  role        text,                                                    -- len kde to typ vzťahu nesie
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,
  source      text
);
create index on relationships (rel_type);
create index on relationships (from_id);
create index on relationships (to_id);
create index on relationships (rel_type, from_id);


-- -----------------------------------------------------------------------------
-- 3) Views závislé od premenovaných tabuliek zrušíme, na konci obnovíme
-- -----------------------------------------------------------------------------
drop view if exists v_asset_classifications;
drop view if exists v_asset_effective;


-- -----------------------------------------------------------------------------
-- 4) Backfill z ôsmich per-vzťah tabuliek → `relationships`
--    id sa ZACHOVÁVA (stabilita, D-031). `role` len tam, kde ho tabuľka má.
--    Trigger ešte NEexistuje → backfill sa nevaliduje (dôveruje existujúcim dátam).
-- -----------------------------------------------------------------------------
insert into relationships (id, rel_type, from_id, to_id, role, valid_from, valid_until, source)
  select id, 'rel_aggregates',                     from_id, to_id, null, valid_from, valid_until, source from rel_aggregates
  union all
  select id, 'rel_contained_in_spatial_structure', from_id, to_id, null, valid_from, valid_until, source from rel_contained_in_spatial_structure
  union all
  select id, 'rel_defines_by_type',                from_id, to_id, null, valid_from, valid_until, source from rel_defines_by_type
  union all
  select id, 'rel_associates_document',            from_id, to_id, role, valid_from, valid_until, source from rel_associates_document
  union all
  select id, 'rel_associates_classification',      from_id, to_id, null, valid_from, valid_until, source from rel_associates_classification
  union all
  select id, 'rel_assigns_to_actor',               from_id, to_id, role, valid_from, valid_until, source from rel_assigns_to_actor
  union all
  select id, 'rel_assigns_to_group',               from_id, to_id, null, valid_from, valid_until, source from rel_assigns_to_group
  union all
  select id, 'rel_member_of',                       from_id, to_id, role, valid_from, valid_until, source from rel_member_of;

-- Guard: žiadny riadok sa nesmie stratiť ani zdvojiť (identické počty pred/po).
do $$
declare
  n_old int;
  n_new int;
begin
  select
    (select count(*) from rel_aggregates)
  + (select count(*) from rel_contained_in_spatial_structure)
  + (select count(*) from rel_defines_by_type)
  + (select count(*) from rel_associates_document)
  + (select count(*) from rel_associates_classification)
  + (select count(*) from rel_assigns_to_actor)
  + (select count(*) from rel_assigns_to_group)
  + (select count(*) from rel_member_of)
    into n_old;
  select count(*) into n_new from relationships;
  if n_old <> n_new then
    raise exception 'D-051 backfill: počet hrán sa nezhoduje (staré=%, nové=%)', n_old, n_new;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 5) Zahodenie starých per-vzťah tabuliek (ruší aj ich indexy/uniq)
-- -----------------------------------------------------------------------------
drop table rel_aggregates;
drop table rel_contained_in_spatial_structure;
drop table rel_defines_by_type;
drop table rel_associates_document;
drop table rel_associates_classification;
drop table rel_assigns_to_actor;
drop table rel_assigns_to_group;
drop table rel_member_of;


-- -----------------------------------------------------------------------------
-- 6) Kanonické views = ROVNAKÉ názvy ako dnešné tabuľky (bezvýpadkový cutover)
--    Zrkadlia pôvodné stĺpce (role len tam, kde ho tabuľka mala) → žiadny drift
--    pre čítaciu vrstvu. LLM/whitelist dotazuje LEN tieto views, nie base tabuľku.
-- -----------------------------------------------------------------------------
create view rel_aggregates as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_aggregates';

create view rel_contained_in_spatial_structure as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_contained_in_spatial_structure';

create view rel_defines_by_type as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_defines_by_type';

create view rel_associates_document as
  select id, from_id, to_id, role, valid_from, valid_until, source
  from relationships where rel_type = 'rel_associates_document';

create view rel_associates_classification as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_associates_classification';

create view rel_assigns_to_actor as
  select id, from_id, to_id, role, valid_from, valid_until, source
  from relationships where rel_type = 'rel_assigns_to_actor';

create view rel_assigns_to_group as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_assigns_to_group';

create view rel_member_of as
  select id, from_id, to_id, role, valid_from, valid_until, source
  from relationships where rel_type = 'rel_member_of';


-- -----------------------------------------------------------------------------
-- 7) Integrita: parciálne unique + hot-path indexy (per rel_type literál)
--    unique-active-parent (D-021/D-048): 1 aktívny rodič na from_id pre
--    aggregates/contained/defines_by_type (`unique_active_from` v manifeste).
-- -----------------------------------------------------------------------------
create unique index uniq_active_aggregate on relationships (from_id)
  where rel_type = 'rel_aggregates' and valid_until is null;
create unique index uniq_active_contained on relationships (from_id)
  where rel_type = 'rel_contained_in_spatial_structure' and valid_until is null;
create unique index uniq_active_defines_by_type on relationships (from_id)
  where rel_type = 'rel_defines_by_type' and valid_until is null;

-- E4 auto-linking hot-path (D-041): from_id výkresových väzieb (ekvivalent
-- pôvodného idx_rel_associates_document_e4_from).
create index idx_relationships_e4_from on relationships (from_id)
  where rel_type = 'rel_associates_document' and source = 'pdf_link (E4)';


-- -----------------------------------------------------------------------------
-- 8) Obnova odvodených views (nezmenená sémantika; čítajú kanonické views)
-- -----------------------------------------------------------------------------
create view v_asset_effective as
  select occ.id, occ.object_ref, occ.name, occ.ifc_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.predefined_type else occ.predefined_type end   as predefined_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.user_defined_type else occ.user_defined_type end as user_defined_type,
    jsonb_deep_merge(typ.properties, occ.properties)              as properties,
    typ.id as type_id, typ.name as type_name
  from objects occ
  left join rel_defines_by_type r on r.from_id = occ.id and r.valid_until is null
  left join objects typ on typ.id = r.to_id
  where occ.object_type = 'asset';

create view v_asset_classifications as
  select occ.id as object_id, rc.to_id as classification_ref_id, 'occurrence' as level
  from objects occ
  join rel_associates_classification rc on rc.from_id = occ.id and rc.valid_until is null
  where occ.object_type = 'asset'
  union
  select occ.id, rc.to_id, 'type'
  from objects occ
  join rel_defines_by_type dt on dt.from_id = occ.id and dt.valid_until is null
  join rel_associates_classification rc on rc.from_id = dt.to_id and rc.valid_until is null
  where occ.object_type = 'asset';


-- -----------------------------------------------------------------------------
-- 9) Validačný trigger z manifestu (integrita bez polymorfného FK)
--    Vytvorený AŽ PO backfille → existujúce dáta sa nevalidujú; platí pre nové
--    a upravené hrany (ETL/seed/app). Náš objem = tisíce hrán → per-row lacné.
-- -----------------------------------------------------------------------------
create or replace function relationships_validate()
returns trigger language plpgsql as $$
declare
  m         relationship_types%rowtype;
  from_type text;
  to_type   text;
begin
  select * into m from relationship_types where rel_type = new.rel_type;
  if not found then
    raise exception 'relationships: neznámy rel_type "%"', new.rel_type;
  end if;

  -- from endpoint = objects riadok povoleného typu
  select object_type into from_type from objects where id = new.from_id;
  if from_type is null then
    raise exception 'relationships(%): from_id % nie je v objects', new.rel_type, new.from_id;
  end if;
  if cardinality(m.from_object_types) > 0 and not (from_type = any(m.from_object_types)) then
    raise exception 'relationships(%): from object_type "%" nie je povolený %',
      new.rel_type, from_type, m.from_object_types;
  end if;

  -- to endpoint: classification_references (výnimka) alebo objects
  if m.to_is_classification then
    if not exists (select 1 from classification_references where id = new.to_id) then
      raise exception 'relationships(%): to_id % nie je v classification_references', new.rel_type, new.to_id;
    end if;
  else
    select object_type into to_type from objects where id = new.to_id;
    if to_type is null then
      raise exception 'relationships(%): to_id % nie je v objects', new.rel_type, new.to_id;
    end if;
    if cardinality(m.to_object_types) > 0 and not (to_type = any(m.to_object_types)) then
      raise exception 'relationships(%): to object_type "%" nie je povolený %',
        new.rel_type, to_type, m.to_object_types;
    end if;
  end if;

  return new;
end $$;

create trigger trg_relationships_validate
  before insert or update on relationships
  for each row execute function relationships_validate();

commit;
