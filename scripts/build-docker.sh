#!/usr/bin/env bash
# Build script for Docker images - optimized for multi-arch builds
# Skips TSC when SIDFLOW_SKIP_TSC=1 (TypeScript checking already done in CI)

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

# Run TypeScript compilation unless SIDFLOW_SKIP_TSC is set
if [ "${SIDFLOW_SKIP_TSC:-}" = "1" ]; then
  echo "[build] Skipping TypeScript type checking (SIDFLOW_SKIP_TSC=1)"
  echo "[build] Type checking already performed in CI pipeline"
else
  echo "[build] Running TypeScript compilation..."
  tsc -b
fi

echo "[build] Build complete"
