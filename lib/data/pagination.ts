/**
 * Stránkované načítanie všetkých riadkov cez PostgREST `range()`.
 *
 * Supabase capuje každú odpoveď na `db-max-rows` (1000) BEZ ohľadu na
 * `.limit()` — dotaz, ktorý môže vrátiť viac riadkov, MUSÍ stránkovať,
 * inak PostgREST výsledok ticho orezáva (žiadna chyba). Po federácii VZT
 * (D-049) je assetov aj hrán > 1000, takže sa to týka objektov, spatial
 * hrán aj GUID mapy.
 *
 * `page` dostane rozsah `[from, to]` (inclusive) a musí nad dotazom držať
 * stabilné poradie (`order(...)`), inak stránky nie sú deterministické.
 */
export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
