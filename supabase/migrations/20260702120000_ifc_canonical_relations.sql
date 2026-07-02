-- =============================================================================
-- D-048 — IFC-kanonická vrstva vzťahov
-- =============================================================================
-- Prestavba hrán na IFC IfcRelationship podtypy s granularitou akú rozlišuje IFC.
--   • rel_located_in  → rel_aggregates (IfcRelAggregates)
--                     + rel_contained_in_spatial_structure (IfcRelContainedInSpatialStructure)
--   • rel_defined_by_type   → rel_defines_by_type            (IfcRelDefinesByType)
--   • rel_has_document       → rel_associates_document        (IfcRelAssociatesDocument)
--   • rel_has_classification → rel_associates_classification  (IfcRelAssociatesClassification)
--   • rel_responsible_for    → rel_assigns_to_actor           (IfcRelAssignsToActor)
--   • rel_member_of                                           (IfcPersonAndOrganization — bez zmeny)
--   • + rel_assigns_to_group (nová, IfcRelAssignsToGroup — systémy, D-047)
--
-- Fyzicky binárne hrany + meta stĺpce (NIE objektifikované N-árne IFC entity):
-- preberáme identitu/granularitu IFC, nie serializačnú štruktúru (D-046/D-048).
-- Dáta sú regenerovateľné (ETL D-031 + seed); split zachováva existujúce riadky (id).
-- =============================================================================

begin;

-- 0) Views závislé od premenovaných/rozseknutých tabuliek zrušíme, na konci obnovíme
drop view if exists v_asset_classifications;
drop view if exists v_asset_effective;

-- 1) Čisté 1:1 premenovania (dáta + indexy cestujú s tabuľkou) ----------------
alter table rel_defined_by_type   rename to rel_defines_by_type;
alter table rel_has_document       rename to rel_associates_document;
alter table rel_has_classification rename to rel_associates_classification;
alter table rel_responsible_for    rename to rel_assigns_to_actor;

-- pomenované indexy z predošlých migrácií → držať názov = tabuľka (tidy)
alter index idx_rel_has_classification_to_id rename to idx_rel_associates_classification_to_id;
alter index idx_rel_has_document_to_id       rename to idx_rel_associates_document_to_id;
alter index idx_rel_has_document_e4_from     rename to idx_rel_associates_document_e4_from;

-- 2) Split rel_located_in → rel_aggregates + rel_contained_in_spatial_structure
create table rel_aggregates (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,     -- spatial child
  to_id   uuid not null references objects(id) on delete restrict,    -- spatial parent
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

create table rel_contained_in_spatial_structure (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,     -- asset
  to_id   uuid not null references objects(id) on delete restrict,    -- space/floor (IFC RelatingStructure)
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Backfill podľa object_type subjektu (from_id):
--   spatial štruktúra (building/floor/space) → dekompozícia = rel_aggregates
--   fyzický prvok (asset)                    → obsiahnutie  = rel_contained_in_spatial_structure
insert into rel_aggregates (id, from_id, to_id, valid_from, valid_until, source)
  select l.id, l.from_id, l.to_id, l.valid_from, l.valid_until, l.source
  from rel_located_in l join objects o on o.id = l.from_id
  where o.object_type in ('building', 'floor', 'space');

insert into rel_contained_in_spatial_structure (id, from_id, to_id, valid_from, valid_until, source)
  select l.id, l.from_id, l.to_id, l.valid_from, l.valid_until, l.source
  from rel_located_in l join objects o on o.id = l.from_id
  where o.object_type = 'asset';

-- Guard: žiadny riadok sa nesmie stratiť (neočakávaný object_type subjektu)
do $$
declare n_missing int;
begin
  select count(*) into n_missing
  from rel_located_in l join objects o on o.id = l.from_id
  where o.object_type not in ('building', 'floor', 'space', 'asset');
  if n_missing > 0 then
    raise exception 'D-048 split rel_located_in: % riadkov s neočakávaným object_type subjektu', n_missing;
  end if;
end $$;

drop table rel_located_in;   -- ruší aj uniq_active_location + auto indexy

create index on rel_aggregates (from_id);                       create index on rel_aggregates (to_id);
create index on rel_contained_in_spatial_structure (from_id);   create index on rel_contained_in_spatial_structure (to_id);
create unique index uniq_active_aggregate on rel_aggregates                     (from_id) where valid_until is null;
create unique index uniq_active_contained on rel_contained_in_spatial_structure (from_id) where valid_until is null;

-- 3) Nová hrana: členstvo v systéme (D-047). IFC: IfcRelAssignsToGroup ---------
create table rel_assigns_to_group (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,     -- člen (element)
  to_id   uuid not null references objects(id) on delete restrict,    -- system (IFC RelatingGroup)
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);
create index on rel_assigns_to_group (from_id);
create index on rel_assigns_to_group (to_id);

-- 4) Obnova views na IFC-kanonické názvy --------------------------------------
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

commit;
