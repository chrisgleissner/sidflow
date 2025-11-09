import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack configuration for Next.js 16+
  turbopack: {
    resolveAlias: {
      // Stub Node-only module that libsidplayfp.js tries to import during SSR
      // This prevents the WASM wrapper from being bundled into error pages
      module: { browser: "./empty-stub.js" },
    },
  },
  // Keep webpack config for legacy builds
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      module: false,
    };
    return config;
  },
};

export default nextConfig;
