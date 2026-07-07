import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (default in Next.js 16). IFClite WASM sa servuje z public/ cez fetch.
  // `laz-perf` (LAZ point-cloud dekodér, tranzitívne cez @ifc-lite/renderer) má emscripten
  // web loader s phantom importmi (env/wasi_snapshot_preview1/WASM_PATH), ktoré Turbopack
  // nevie resolvnúť. Point clouds nepoužívame → alias na prázdny stub (D-055).
  turbopack: {
    resolveAlias: {
      "laz-perf": "./lib/laz-perf-stub.cjs",
      // Phantom importy emscripten web-loadera laz-perf — Turbopack ich nevie
      // resolvnúť. CJS stub → named importy `undefined` (point-cloud kód sa nevolá).
      env: "./lib/laz-perf-stub.cjs",
      wasi_snapshot_preview1: "./lib/laz-perf-stub.cjs",
      WASM_PATH: "./lib/laz-perf-stub.cjs",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
