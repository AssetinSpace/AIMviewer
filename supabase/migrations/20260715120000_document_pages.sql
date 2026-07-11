-- =============================================================================
-- D-063 — Obsah dokumentov: `document_pages` + RPC `search_documents`
-- =============================================================================
-- Dokumenty boli doteraz len metadáta (CDE názov, D-036) + E4 regióny — otázky
-- na OBSAH PDF (legendy, špecifikácie, popisky) boli principiálne
-- nezodpovedateľné. Extrakciu textu robí `etl/pdf_text.py` (PyMuPDF — už je
-- ETL závislosť, D-041), per strana; vyhľadáva RPC (FTS, rovnaká normalizácia
-- ako D-059: lower + f_unaccent).
--
-- Poctivé očakávanie (D-063): výkresy sú prevažne vektorová grafika — text je
-- riedky (legendy, rohové pečiatky, popisky). OCR mimo scope. Dokument bez
-- lokálneho zdrojového PDF stránky nemá — tool to povie.
--
-- Migrácie sú ADITÍVNE — tento súbor sa nikdy needituje.

begin;

create table document_pages (
  document_id uuid not null references objects(id) on delete cascade,
  page        int  not null check (page >= 1),
  text        text not null,     -- normalizovaný text strany (extrahovaný, nie OCR)
  primary key (document_id, page)
);

comment on table document_pages is
  'D-063: extrahovaný text PDF strán (etl/pdf_text.py) — fulltext nad obsahom dokumentov.';

-- Rovnaká normalizácia ako search_text (D-059): unaccent → lower.
create index idx_document_pages_tsv on document_pages
  using gin (to_tsvector('simple', lower(f_unaccent(text))));

-- RPC pre LLM tool (parametrizované, row-cap 50). Vracia aj identitu dokumentu
-- (join na objects) — jeden call, žiadne dohľadávanie mien.
create or replace function search_documents(
  q text,
  max_rows int default 10
)
returns table (
  document_id uuid,
  document_ref text,
  document_name text,
  page int,
  rank real,
  snippet text
)
language sql stable
set search_path = public
as $$
  with nq as (
    select lower(f_unaccent(btrim(q))) as t
  )
  select dp.document_id,
         o.object_ref,
         o.name,
         dp.page,
         ts_rank(to_tsvector('simple', lower(f_unaccent(dp.text))),
                 websearch_to_tsquery('simple', (select t from nq)))::real as rank,
         ts_headline('simple', lower(f_unaccent(dp.text)),
                     websearch_to_tsquery('simple', (select t from nq)),
                     'MaxFragments=2, MaxWords=14, MinWords=4') as snippet
  from document_pages dp
  join objects o on o.id = dp.document_id
  where length((select t from nq)) >= 2
    and to_tsvector('simple', lower(f_unaccent(dp.text)))
        @@ websearch_to_tsquery('simple', (select t from nq))
  order by rank desc, dp.page
  limit least(greatest(coalesce(max_rows, 10), 1), 50);
$$;

comment on function search_documents(text, int) is
  'D-063: fulltext nad extrahovaným textom PDF strán (document_pages), so snippetom a identitou dokumentu.';

commit;

-- PostgREST musí novú tabuľku/RPC vidieť bez reštartu (Supabase).
notify pgrst, 'reload schema';
