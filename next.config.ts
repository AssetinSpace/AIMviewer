import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (default in Next.js 16). WASM is served from public/ via fetch — no bundler config needed.
  turbopack: {},
  experimental: {
    // Klientská router cache: opakovaná navigácia na nedávno navštívený /
    // prefetchnutý uzol sa vykreslí z cache bez server round-tripu. Viewer je
    // verejný read-only s ISR 60 s, takže krátka klientská staleness je OK.
    staleTimes: { dynamic: 30, static: 300 },
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
      {
        // IFClite WASM (~3 MB, pinovaná verzia — mení sa len s bump-om balíka):
        // deň v cache + týždeň stale-while-revalidate = opakovaný vstup do 3D
        // nečaká na download; po deployi novej verzie sa potichu obnoví.
        source: "/ifc-lite_bg.wasm",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
