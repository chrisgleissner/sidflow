#!/usr/bin/env bash
# Build script for Docker images - optimized for multi-arch builds

set -euo pipefail

echo "[build] Architecture: $(uname -m)"
echo "[build] Node version: $(node --version)"
echo "[build] Bun version: $(bun --version)"

# Install dependencies
echo "[build] Installing dependencies..."
node scripts/run-bun.mjs install --frozen-lockfile

# Check WASM upstream
echo "[build] Checking WASM upstream..."
node scripts/run-bun.mjs run wasm:check-upstream

# Run TypeScript compilation
# Note: We must run tsc -b to generate dist/ outputs for monorepo packages
# Next.js imports from @sidflow/common, @sidflow/classify etc require these
echo "[build] Running TypeScript compilation..."
npx tsc -b

echo "[build] Build complete"
