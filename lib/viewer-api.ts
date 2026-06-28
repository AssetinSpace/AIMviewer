/** Contract between IFCWorkspace and the Three.js scene inside IFCViewer.
 *  Populated by IFCViewer after model load; null before load and after unmount. */
export interface ViewerApi {
  /** Highlight a set of DB objects in the 3D scene (blue). Replaces previous filter. */
  highlightFilter: (objectIds: ReadonlyArray<string>, excludeOid?: string) => void;
  /** Remove all filter highlights. Does not affect pick selection. */
  clearFilter: () => void;
  /** Focus (highlight + zoom) an element by IFC GUID — reactive, can be called post-mount. */
  focusObject: (guid: string) => void;
  /** Highlight sibling assets in the same space (alias for highlightFilter, same color). */
  highlightSiblings: (objectIds: ReadonlyArray<string>, excludeOid?: string) => void;
  /** Raw IFC STEP buffer — for @ifc-lite/query (Phase 4). Null before model loads. */
  getIfcBuffer: () => Uint8Array | null;
}
