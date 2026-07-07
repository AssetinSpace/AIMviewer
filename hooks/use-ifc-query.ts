"use client";

import { IfcQuery, type SQLResult } from "@ifc-lite/query";
import type { IfcDataStore } from "@ifc-lite/parser";

/** Handle nad `@ifc-lite/query` (aktivované, D-055). Základ pre F6 (LLM geometrické dotazy). */
export interface IfcQueryHandle {
  /** LOKÁLNE expressId prvkov daných IFC tried (`IfcDoor`, `IfcWall`…). */
  ofType: (...ifcTypes: string[]) => number[];
  /** SQL nad modelom cez DuckDB-WASM (lazy init pri prvom volaní). */
  sql: (query: string) => Promise<SQLResult>;
}

/** Postaví `IfcQuery` handle nad naparsovaným store. Volá ho viewer nad primárnym
 *  modelom; DuckDB sa inicializuje lenivo až pri prvom `sql()`. */
export function buildIfcQueryHandle(store: IfcDataStore): IfcQueryHandle {
  const q = new IfcQuery(store);
  return {
    ofType: (...types) => q.ofType(...types).execute().map((e) => e.expressId),
    sql: (query) => q.sql(query),
  };
}
