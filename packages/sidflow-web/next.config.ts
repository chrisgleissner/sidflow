import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const classifyDistEntry = fileURLToPath(new URL("../sidflow-classify/dist/index.js", import.meta.url));

const nextConfig: NextConfig = {
  // Turbopack configuration for Next.js 16+
  turbopack: {
    resolveAlias: {
      // Stub Node-only module that libsidplayfp.js tries to import during SSR
      // This prevents the WASM wrapper from being bundled into error pages
      module: { browser: "./empty-stub.js" },
      "@sidflow/classify": path.relative(
        fileURLToPath(new URL("./", import.meta.url)),
        classifyDistEntry
      ),
    },
  },
  // Keep webpack config for legacy builds
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@sidflow/classify": classifyDistEntry,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      module: false,
    };
    return config;
  },
};

export default nextConfig;
