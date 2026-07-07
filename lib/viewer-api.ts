import type { SectionPlane } from "@ifc-lite/renderer";

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
  /** Raw IFC STEP buffer of the primary model — for `@ifc-lite/query`. Null before load. */
  getIfcBuffer: () => Uint8Array | null;
}
