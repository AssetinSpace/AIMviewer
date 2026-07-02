-- =============================================================================
-- PRECHODNÉ backward-compat views (expand/contract) — D-048 bezvýpadkový cutover
-- =============================================================================
-- Starý nasadený kód (main) dopytuje pôvodné názvy hrán. Po aplikovaní D-048 na
-- cloud by padol (tabuľky premenované/rozseknuté). Tieto views vystavia staré
-- názvy nad novými IFC-kanonickými tabuľkami (len na ČÍTANIE — appka je read-only),
-- takže:
--   • cloud sa dá migrovať kedykoľvek bez rozbitia živého viewera (main),
--   • preview build vetvy prejde (nový kód číta reálne tabuľky),
--   • po nasadení nového kódu (merge → main) tieto views zahodí cleanup migrácia.
--
-- NIE je súčasť cieľovej schémy — je to dočasný shim. Zahodiť po cutovere.
-- =============================================================================

begin;

-- rel_located_in = zjednotenie rozseknutých spatial hrán (bez `role`, ako pôvodne)
create view rel_located_in as
  select id, from_id, to_id, valid_from, valid_until, source from rel_aggregates
  union all
  select id, from_id, to_id, valid_from, valid_until, source from rel_contained_in_spatial_structure;

-- čisté 1:1 premeny — rovnaké stĺpce, stačí select *
create view rel_defined_by_type   as select * from rel_defines_by_type;
create view rel_has_document       as select * from rel_associates_document;
create view rel_has_classification as select * from rel_associates_classification;
create view rel_responsible_for    as select * from rel_assigns_to_actor;

commit;
