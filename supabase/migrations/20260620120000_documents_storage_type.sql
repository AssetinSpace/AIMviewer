-- =============================================================================
-- AIM Platform — migrácia: documents.storage_type (D-032 / D-036, E3)
-- =============================================================================
-- Aditívna migrácia (CLAUDE.md: migrácie sa nikdy nemažú ani needitujú).
--
-- Pridáva `documents.storage_type` — ako má Viewer/Export narábať s `location`
-- bez parsovania URL schémy (D-032):
--   * supabase   — súbor nahraný do nášho Storage bucketu `documents/`;
--                  `location` = verejná (public) URL.
--   * external   — odkaz na cudzí systém (SharePoint/web/BIM server) as-is.
--   * unresolved — dokument existuje (napr. z IFC), súbor nie je dostupný.
--
-- TEXT validovaný v app/ETL (nie CHECK) — línia D-018 (rozšírenie typu = aditívne).
-- Default 'unresolved' je bezpečný pre existujúce riadky (zatiaľ bez súboru).
-- =============================================================================

alter table documents
  add column if not exists storage_type text not null default 'unresolved';

comment on column documents.storage_type is
  'supabase | external | unresolved — ako narábať s location (D-032/D-036).';
