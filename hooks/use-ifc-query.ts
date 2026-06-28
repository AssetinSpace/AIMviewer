"use client";

import type { ViewerApi } from "@/lib/viewer-api";

/** Placeholder for @ifc-lite/query geometric query handle (Phase 4). */
export interface IfcQueryHandle {
  /** Query elements by type and return expressIds. Phase 4 — geometric/STEP queries. */
  queryByType: (...ifcTypes: string[]) => Promise<number[]>;
  /** Query elements inside a 3D bounding box. Phase 4. */
  queryInBounds: (min: [number, number, number], max: [number, number, number]) => Promise<number[]>;
}

/**
 * Lazy-init hook for @ifc-lite/query (Phase 4 scaffolding).
 *
 * Phase 3: returns null — no parsing overhead.
 * Phase 4: uncomment the block below.
 *
 * How to activate:
 *   1. `npm install @ifc-lite/parser` (pulled transitively by @ifc-lite/query already).
 *   2. Uncomment the block below.
 *   3. IfcQuery API: .ofType(...types), .walls(), .doors(), .inBounds(aabb),
 *      .onStorey(storeyId), .raycast(origin, direction).
 *   4. Each EntityQuery resolves to expressIds via `.expressIds()` or `.entities()`.
 */
export function useIfcQuery(_viewerApi: ViewerApi | null): IfcQueryHandle | null {
  // Phase 4 implementation — uncomment to activate:
  //
  // const handleRef = useRef<IfcQueryHandle | null>(null);
  //
  // useEffect(() => {
  //   if (!_viewerApi) return;
  //   let cancelled = false;
  //   (async () => {
  //     const buffer = _viewerApi.getIfcBuffer();
  //     if (!buffer) return;
  //     const { ColumnarParser } = await import("@ifc-lite/parser");
  //     const { IfcQuery } = await import("@ifc-lite/query");
  //     const store = await ColumnarParser.parse(buffer);  // IFC STEP → IfcDataStore
  //     const q = new IfcQuery(store);
  //     if (!cancelled) {
  //       handleRef.current = {
  //         queryByType: async (...types) =>
  //           q.ofType(...types).entities().map((e) => e.expressId),
  //         queryInBounds: async (min, max) =>
  //           q.inBounds({ min, max }).entities().map((e) => e.expressId),
  //       };
  //     }
  //   })();
  //   return () => { cancelled = true; handleRef.current = null; };
  // }, [_viewerApi]);
  //
  // return handleRef.current;

  return null;
}
