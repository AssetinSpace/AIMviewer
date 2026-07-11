-- =============================================================================
-- D-058 — Slovník psetov z reálnych dát: view `v_property_dictionary`
-- =============================================================================
-- Grounding pre LLM rozhranie (D-056/D-057): model nemá HÁDAŤ JSONB cesty do
-- `objects.properties` — view agreguje, ktoré psety × property v dátach reálne
-- existujú (per object_type × ifc_type), akého typu sú hodnoty, koľko objektov
-- ich nesie a ako hodnoty vyzerajú (vzorky + min/max pre numeriku).
--
-- Pokrýva štandardné (Pset_/Qto_) AJ custom psety (D-022 vrstva 3) — statická
-- IFC schéma custom psety nepozná, tento view áno (dopĺňa sa s D-061, statický
-- IFC slovník definícií). Rezervované `_kľúče` (meta, D-022) nie sú psety →
-- vynechané (`p.key !~ '^_'`).
--
-- Výkon: full scan + dvojité jsonb_each — pri ~10^3 objektoch jednotky ms.
-- Pri raste nad ~10^5 objektov prejsť na materialized view s refreshom po ETL
-- loade (poznámka v D-058); definícia sa tým nemení.
--
-- Migrácie sú ADITÍVNE — tento súbor sa nikdy needituje; staré sa nemažú.

begin;

create view v_property_dictionary as
select
  o.object_type,
  o.ifc_type,
  p.key                                as pset,
  a.key                                as property,
  jsonb_typeof(a.value)                as value_type,
  count(*)::int                        as object_count,
  count(distinct a.value)::int         as distinct_values,
  -- vzorky hodnôt (scalár bez JSON úvodzoviek, orezané na 60 znakov, max 5)
  (array_agg(distinct left(a.value #>> '{}', 60)))[1:5] as sample_values,
  min(case when jsonb_typeof(a.value) = 'number'
           then (a.value #>> '{}')::numeric end)        as min_number,
  max(case when jsonb_typeof(a.value) = 'number'
           then (a.value #>> '{}')::numeric end)        as max_number
from objects o
cross join lateral jsonb_each(o.properties) p
cross join lateral jsonb_each(p.value) a
where p.key !~ '^_'
  and jsonb_typeof(p.value) = 'object'
group by o.object_type, o.ifc_type, p.key, a.key, jsonb_typeof(a.value);

comment on view v_property_dictionary is
  'D-058: slovník psetov z reálnych dát (grounding LLM filtrov properties->Pset->>Key).';

commit;

-- PostgREST musí nový view vidieť bez reštartu (Supabase).
notify pgrst, 'reload schema';
