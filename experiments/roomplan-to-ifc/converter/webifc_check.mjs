#!/usr/bin/env node
// Headless web-ifc smoke check: confirm the parser AIM Viewer's engine family uses
// can open the generated IFC files, find the entities and build their geometry.
// Not a viewer integration — just "does web-ifc choke on our output". Run:
//   node webifc_check.mjs            (after python3 test_roundtrip.py filled ./out/)
import { readFileSync, readdirSync } from "node:fs";
import * as WebIFC from "web-ifc";

const TYPES = {
  IfcWall: WebIFC.IFCWALL,
  IfcDoor: WebIFC.IFCDOOR,
  IfcWindow: WebIFC.IFCWINDOW,
  IfcFurnishingElement: WebIFC.IFCFURNISHINGELEMENT,
  IfcSpace: WebIFC.IFCSPACE,
};

const api = new WebIFC.IfcAPI();
await api.Init();

let failed = false;
const files = readdirSync("out").filter((f) => f.endsWith(".ifc")).sort();
if (files.length === 0) {
  console.error("no .ifc files in ./out — run test_roundtrip.py first");
  process.exit(1);
}

for (const file of files) {
  const modelID = api.OpenModel(readFileSync(`out/${file}`));
  const counts = Object.fromEntries(
    Object.entries(TYPES).map(([name, t]) => [name, api.GetLineIDsWithType(modelID, t).size()])
  );
  let meshes = 0;
  api.StreamAllMeshes(modelID, () => meshes++);
  const products =
    counts.IfcWall + counts.IfcDoor + counts.IfcWindow + counts.IfcFurnishingElement;
  // web-ifc also meshes the IfcSpace body; require at least one mesh per product
  const ok = api.GetModelSchema(modelID) === "IFC4" && meshes >= products && products > 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${file}: schema=${api.GetModelSchema(modelID)} meshes=${meshes}`,
    counts
  );
  api.CloseModel(modelID);
}

console.log(failed ? "\nFAILED — web-ifc could not fully parse the output"
                   : `\nPASS — web-ifc (${WebIFC.IFC_API_VERSION ?? "?"}) parsed all ${files.length} files`);
process.exit(failed ? 1 : 0);
