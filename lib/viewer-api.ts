import type { SectionPlane } from "@ifc-lite/renderer";
import type { SQLResult } from "@ifc-lite/query";

/** Jeden načítaný model v scéne (pre panel Modely / navigátor). */
export interface LoadedModel {
  /** Stabilné id modelu (= `IfcModel.id`). */
  id: string;
  /** Ľudský názov. */
  name: string;
  /** Aktuálna viditeľnosť v scéne. */
  visible: boolean;
  /** Počet prvkov s geometriou. */
  elementCount: number;
}

/** Preset pohľadu kamery (WebGPU renderer). */
export type ViewPreset = "top" | "bottom" | "front" | "back" | "left" | "right";

/** Uzol IFClite-native stromu (SPATIAL tab). `expr`/`exprs` sú GLOBÁLNE (federačné) id. */
export interface NavTreeNode {
  key: string;
  label: string;
  /** Selektovateľné globálne expressId (spatial uzol / prvok). */
  expr?: number;
  /** Všetky globálne expressId v podstrome — pre highlight. */
  exprs: number[];
  children: NavTreeNode[];
}

/** Skupina prvkov (TYPE / MATERIAL / CLASS tab). `exprs` = globálne id. */
export interface NavGroup {
  label: string;
  count: number;
  exprs: number[];
}

/** Navigátor dáta jedného modelu — plnené VÝHRADNE z IFClite (follow-IFClite, D-055). */
export interface NavigatorModel {
  id: string;
  name: string;
  spatial: NavTreeNode[];
  types: NavGroup[];
  materials: NavGroup[];
  classifications: NavGroup[];
}

/** Detail prvku z naparsovaného IFC (keď GUID nie je v DB — fallback panel). */
export interface IfcElementInfo {
  guid: string | null;
  name: string | null;
  objectType: string | null;
  modelName: string;
  psets: Array<{ name: string; props: Array<{ name: string; value: string }> }>;
}

/** Contract between IFCWorkspace and the WebGPU scene inside IFCViewer.
 *  Populated by IFCViewer after model load; null before load and after unmount. */
export interface ViewerApi {
  /** Highlight a set of DB objects in the 3D scene (rest fades). Replaces previous filter. */
  highlightFilter: (objectIds: ReadonlyArray<string>, excludeOid?: string) => void;
  /** Remove all filter highlights. Does not affect pick selection. */
  clearFilter: () => void;
  /** Focus (highlight + zoom) an element by IFC GUID — reactive, can be called post-mount. */
  focusObject: (guid: string) => void;
  /** Highlight sibling assets in the same space (alias for highlightFilter). */
  highlightSiblings: (objectIds: ReadonlyArray<string>, excludeOid?: string) => void;
  /** Toggle visibility of a whole federated model (D-050). */
  setModelVisible: (modelId: string, visible: boolean) => void;
  /** Set (or clear with null) an axis section plane. */
  setSectionPlane: (plane: SectionPlane | null) => void;
  /** Snap camera to a preset orthographic-ish view. */
  setView: (preset: ViewPreset) => void;
  /** Reset camera to fit all visible geometry. */
  resetView: () => void;
  /** Highlight a set of elements by GLOBAL expressId (navigátor → 3D; rest fades). */
  highlightExprs: (globalExprs: ReadonlyArray<number>) => void;
  /** Select + focus a single element by GLOBAL expressId (navigátor → 3D + karta/IFC props). */
  selectExpr: (globalExpr: number) => void;
  /** `@ifc-lite/query` nad primárnym modelom: prvky daných IFC tried → GLOBÁLNE expressId. */
  queryByType: (ifcTypes: string[]) => number[];
  /** SQL nad primárnym modelom (DuckDB-WASM, lazy) — základ pre F6. */
  runSql: (query: string) => Promise<SQLResult>;
  /** Raw IFC STEP buffer of the primary model — for `@ifc-lite/query`. Null before load. */
  getIfcBuffer: () => Uint8Array | null;
}
