/**
 * Testy `fetchAllPages` — regresia: dotazy na spatial hrany, GUID mapu
 * a štatistiky modelu nestránkovali, PostgREST (`db-max-rows` = 1000) ich
 * ticho orezal a prvky nad limit zmizli zo stromu / 3D↔DB mapovania.
 */
import { describe, expect, it } from "vitest";

import { fetchAllPages } from "./pagination";

/** Fake stránkovaného zdroja s `total` riadkami {i}. */
function fakeSource(total: number, calls: [number, number][]) {
  return async (from: number, to: number) => {
    calls.push([from, to]);
    const data = Array.from(
      { length: Math.max(0, Math.min(to + 1, total) - from) },
      (_, k) => ({ i: from + k })
    );
    return { data, error: null };
  };
}

describe("fetchAllPages", () => {
  it("zlepí všetky stránky nad limitom 1000 (nič sa nesmie orezať)", async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(fakeSource(2345, calls));
    expect(rows).toHaveLength(2345);
    expect(rows[0]).toEqual({ i: 0 });
    expect(rows[2344]).toEqual({ i: 2344 });
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("presný násobok stránky urobí jednu prázdnu stránku navyše a skončí", async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(fakeSource(2000, calls));
    expect(rows).toHaveLength(2000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("pod limitom spraví jediný dotaz", async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(fakeSource(681, calls));
    expect(rows).toHaveLength(681);
    expect(calls).toEqual([[0, 999]]);
  });

  it("prázdny výsledok vráti []", async () => {
    const calls: [number, number][] = [];
    expect(await fetchAllPages(fakeSource(0, calls))).toEqual([]);
  });

  it("chyba PostgREST sa propaguje ako throw", async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: "boom" } }))
    ).rejects.toThrow("boom");
  });

  it("rešpektuje vlastnú veľkosť stránky", async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(fakeSource(5, calls), 2);
    expect(rows).toHaveLength(5);
    expect(calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});
