import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const webRoot = fileURLToPath(new URL("./", import.meta.url));
const ffmpegStubRelativePath = path.relative(webRoot, path.resolve(webRoot, "ffmpeg-core-stub.js"));
const ffmpegStubModuleSpecifier = ffmpegStubRelativePath.startsWith(".")
  ? ffmpegStubRelativePath
  : `./${ffmpegStubRelativePath}`;
const disableRender = process.env.SIDFLOW_DISABLE_RENDER === '1';

const serverExternalPackages = [
  'vectordb',
  '@sidflow/classify', 
  'ws', 
  '@ffmpeg/ffmpeg', 
  '@ffmpeg/core',
  // Prevent ffmpeg WASM loader from being bundled
  '@ffmpeg/core/dist/ffmpeg-core.wasm',
  '@ffmpeg/core/dist/ffmpeg-core.wasm_.loader.mjs',
];

// Always stub ffmpeg for client-side builds to prevent WASM loader issues
const ffmpegStubAliases: Record<string, string | string[] | Record<string, string | string[]>> = {
  "@ffmpeg/ffmpeg": ffmpegStubModuleSpecifier,
  "@ffmpeg/core": ffmpegStubModuleSpecifier,
  "@ffmpeg/core/dist/ffmpeg-core.js": ffmpegStubModuleSpecifier,
  "@ffmpeg/core/dist/ffmpeg-core.wasm": ffmpegStubModuleSpecifier,
  "@ffmpeg/core/dist/ffmpeg-core.wasm_.loader.mjs": ffmpegStubModuleSpecifier,
  "@ffmpeg/core/dist/ffmpeg-core.worker.js": ffmpegStubModuleSpecifier,
};

const nextConfig: NextConfig = {
  // Exclude server-only packages with native modules from client bundle
  serverExternalPackages,
  // Turbopack configuration for Next.js 16+
  turbopack: {
    resolveAlias: {
      // Stub Node-only module that libsidplayfp.js tries to import during SSR
      // This prevents the WASM wrapper from being bundled into error pages
      module: { browser: "./empty-stub.js" },
      // Stub ws module which is used by ffmpeg in Node.js environments
      ws: "./empty-stub.js",
      ...ffmpegStubAliases,
    },
  },
  // Keep webpack config for legacy builds
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      module: false,
    };
    if (disableRender) {
      const stubPath = path.resolve(webRoot, "ffmpeg-core-stub.js");
      config.resolve.alias = {
        ...config.resolve.alias,
        "@ffmpeg/ffmpeg": stubPath,
        "@ffmpeg/core/dist/ffmpeg-core.js": stubPath,
        "@ffmpeg/core/dist/ffmpeg-core.wasm": stubPath,
        "@ffmpeg/core/dist/ffmpeg-core.wasm_.loader.mjs": stubPath,
        "@ffmpeg/core/dist/ffmpeg-core.worker.js": stubPath,
      };
    }
    return config;
  },
};

export default nextConfig;
