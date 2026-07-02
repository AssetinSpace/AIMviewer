-- =============================================================================
-- Cleanup po D-048 cutovere — zahodenie prechodných backward-compat views
-- =============================================================================
-- Nový kód (nasadený na main) číta IFC-kanonické tabuľky priamo. Prechodné views
-- so starými názvami (20260702130000) už nikto nepoužíva → zahodíme ich.
-- Tým je expand/contract dokončený a schéma je v cieľovom stave.
-- =============================================================================

begin;

drop view if exists rel_located_in;
drop view if exists rel_defined_by_type;
drop view if exists rel_has_document;
drop view if exists rel_has_classification;
drop view if exists rel_responsible_for;

commit;
