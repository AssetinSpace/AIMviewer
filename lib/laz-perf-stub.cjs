// Stub pre `laz-perf` (LAZ point-cloud WASM dekodér, tranzitívne cez
// @ifc-lite/pointcloud → @ifc-lite/renderer). Point clouds nepoužívame (D-055),
// a emscripten `.wasm_.loader.mjs` importuje phantom moduly (`env`,
// `wasi_snapshot_preview1`, `WASM_PATH`), ktoré Turbopack nevie staticky resolvnúť.
// Prázdny CJS modul → default `{}`, ľubovoľné named importy `undefined` (nikdy sa
// nevykonajú, keďže dekódovanie point cloudov sa nevolá).
module.exports = {};
