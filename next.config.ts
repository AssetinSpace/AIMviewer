import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (default in Next.js 16). WASM is served from public/ via fetch — no bundler config needed.
  turbopack: {},
};

export default nextConfig;
