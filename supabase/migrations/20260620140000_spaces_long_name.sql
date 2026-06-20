-- =============================================================================
-- AIM Platform — migrácia: prípona `spaces` (IfcSpace.LongName) — D-040
-- =============================================================================
-- Aditívna migrácia (CLAUDE.md: migrácie sa nikdy nemažú ani needitujú).
--
-- `IfcSpace` má dva textové atribúty: `Name` = číslo miestnosti (`2.04`,
-- → objects.name) a `LongName` = popis funkcie (`Serverovňa`, `WC Muži`,
-- `Openspace - Západ`). Doteraz sa LongName nikde neukladal — priestory mali
-- vo Vieweri len číslo bez názvu.
--
-- Per konvencia (CLAUDE.md): IFC atribúty = stĺpce; typovo-špecifické → tenká
-- 1:1 prípona s `id` ako FK na objects(id) (ako `floors`/`documents`/`persons`).
-- =============================================================================

create table if not exists spaces (   -- IfcSpace (D-040); objects.name = číslo miestnosti
  id        uuid primary key references objects(id) on delete cascade,
  long_name text                       -- IfcSpace.LongName — popis funkcie miestnosti
);

comment on table spaces is
  'Prípona priestoru — IfcSpace.LongName (popis funkcie). objects.name = číslo (D-040).';

-- v_spaces — analogicky k v_floors (CLAUDE.md SCHEMA §2: "v_spaces… analogicky").
create or replace view v_spaces as
  select o.*, s.long_name from objects o join spaces s using (id);
