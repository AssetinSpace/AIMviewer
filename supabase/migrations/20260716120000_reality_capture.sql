-- =============================================================================
-- D-073 — Reality Capture v1 (fotky + statické 360° panorámy)
-- =============================================================================
-- Aditívna migrácia (AGENTS.md: migrácie sa nikdy nemažú ani needitujú).
--
-- Vizuálna pasportizácia reality naviazaná na model (D-065 „platform feature":
-- 360°/2D/3D prepojené na IFC). Model presne v duchu „ako dokumenty" (D-014/D-032):
--   * capture point  = objects riadok object_type='capture'  + tenká prípona `captures`.
--                      Ukotvenie (2D plán pin + 3D world pin) žije v rezervovanom
--                      properties._capture JSONB (vzor _georef, D-072) — bez stĺpcov,
--                      versioned + validované v app vrstve.
--   * capture médium = objects riadok object_type='capture_media' + prípona
--                      `capture_media` (analóg `documents`: location=verejná URL,
--                      storage_type, rozmery, captured_at, valid_from/valid_until).
-- Verzovanie tej istej lokácie v čase = viac capture_media na jeden capture point,
-- append-only (valid_until IS NULL = aktuálna verzia; nič sa needituje in-place).
--
-- HRANY (D-051 meta-model): dve NOVÉ `aim_`-namespace položky v manifeste
-- `relationship_types`. IFC pre „reality-capture bod s verzovaným médiom" nemá
-- čistý koncept → `aim_` namespace + export do ICDD linksetu (D-015/D-048 konvencia;
-- toto sú PRVÉ aim_ hrany, dovtedy len dopredná konvencia). Zámerne NErozširujeme
-- `rel_contained_in_spatial_structure` o object_type 'capture' — držíme captures mimo
-- IFC-kanonických asset/priestorových čítaní (žiadny leak do „prvky v priestore").
--   * aim_rel_capture_located  capture → space|floor  (kde capture je; unique-active)
--   * aim_rel_capture_media     capture → capture_media (jeho snímky/verzie; 1:N)
-- Obojsmernosť („fotky priestoru" ↔ „priestor fotky") padá z hrany zadarmo.
--
-- Úložisko: verejný Supabase Storage bucket `captures` (vzor `documents`/`ifc`) —
-- bucket sa zakladá idempotentne z app upload route (nie SQL migráciou; Storage
-- žije mimo public schémy). Serving = priama public CDN URL v capture_media.location.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Typové prípony (1:1 k objects, ON DELETE CASCADE) — štýl documents/floors
-- -----------------------------------------------------------------------------

-- Capture point: registrácia lokácie. `kind` diskriminuje médium; ukotvenie
-- (plán/world/yaw) je v objects.properties._capture (rezervovaný _kľúč, §4).
create table captures (
  id   uuid primary key references objects(id) on delete cascade,
  kind text not null                 -- 'photo' | 'pano360' (validované v app/ETL, nie CHECK — D-018)
);

-- Jedna snímka / verzia viazaná na capture point (analóg IfcDocumentInformation).
create table capture_media (
  id               uuid primary key references objects(id) on delete cascade,
  location         text,             -- verejná URL originálu (Supabase Storage)
  preview_location text,             -- zmenšený equirect/foto náhľad (rýchle načítanie)
  thumb_location   text,             -- thumbnail (galéria / pin)
  storage_type     text not null default 'supabase',   -- ako documents.storage_type (D-032)
  media_type       text,             -- 'image/jpeg' | 'image/png' …
  width            int,
  height           int,
  captured_at      timestamptz,      -- DÁTUM SNÍMANIA → poradie verzií lokácie v čase
  valid_from       timestamptz not null default now(),
  valid_until      timestamptz       -- NULL = aktuálna verzia (append-only, nikdy nemazať)
);
create index on capture_media (valid_until);

-- -----------------------------------------------------------------------------
-- 2) Manifest hrán — dve nové aim_ položky (D-051/D-048)
--    is_ifc_rel=false, namespace='aim', export_path='icdd' (ICDD linkset, D-015).
--    ifc_entity/ifc_family = null (IFC nemá koncept).
-- -----------------------------------------------------------------------------
insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('aim_rel_capture_located', null, null, false, 'to',
   array['capture'], array['space', 'floor'], false,
   'aim', 'icdd', true,
   'Reality-capture bod umiestnený v priestore/podlaží (D-073). unique-active: 1 aktívny priestor na capture.'),
  ('aim_rel_capture_media', null, null, false, 'from',
   array['capture'], array['capture_media'], false,
   'aim', 'icdd', false,
   'Reality-capture bod → jeho snímky/verzie (D-073). 1:N, append-only cez valid_from/valid_until.');

-- -----------------------------------------------------------------------------
-- 3) Kanonické views (rovnaký vzor ako rel_* views) — čítacia vrstva captures
--    dotazuje tieto, nie base `relationships`.
-- -----------------------------------------------------------------------------
create view aim_rel_capture_located as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'aim_rel_capture_located';

create view aim_rel_capture_media as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'aim_rel_capture_media';

-- -----------------------------------------------------------------------------
-- 4) Integrita + hot-path indexy (per rel_type literál, vzor §2.6)
-- -----------------------------------------------------------------------------
-- unique-active-parent: 1 aktívny priestor na capture (zodpovedá unique_active_from).
create unique index uniq_active_capture_located on relationships (from_id)
  where rel_type = 'aim_rel_capture_located' and valid_until is null;

-- „médiá tohto capture pointu" (galéria/verzie) — časté čítanie po from_id.
create index idx_relationships_capture_media_from on relationships (from_id)
  where rel_type = 'aim_rel_capture_media';

-- „captures v tomto priestore" (obojsmernosť) — čítanie po to_id.
create index idx_relationships_capture_located_to on relationships (to_id)
  where rel_type = 'aim_rel_capture_located';

commit;
