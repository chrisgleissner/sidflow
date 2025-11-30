#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STANDALONE_DIR="${ROOT_DIR}/packages/sidflow-web/.next/standalone"
STANDALONE_SERVER_DIR="${STANDALONE_DIR}/packages/sidflow-web"
SERVER_ENTRY="${STANDALONE_SERVER_DIR}/server.js"

# Load local environment overrides (e.g., SIDFLOW_ADMIN_PASSWORD) from .env if present
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ROOT_DIR}/.env"
  set +a
fi

if [[ ! -f "${SERVER_ENTRY}" ]]; then
  cat >&2 <<'EOF'
FATAL: Production build not found.
Run `bun run build` from the repo root, then `cd packages/sidflow-web && bun run build`
before packaging or starting the release server.
EOF
  exit 1
fi

export NODE_ENV="${NODE_ENV:-production}"
# Set SIDFLOW_ROOT to the actual repo root, not the standalone dir
export SIDFLOW_ROOT="${SIDFLOW_ROOT:-${ROOT_DIR}}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export SIDFLOW_ADMIN_USER="${SIDFLOW_ADMIN_USER:-admin}"
export SIDFLOW_ADMIN_PASSWORD="${SIDFLOW_ADMIN_PASSWORD:-change-me}"

echo "Starting SIDFlow release server on http://${HOST}:${PORT}"
echo "  SIDFLOW_ROOT=${SIDFLOW_ROOT}"
echo "  Working directory: ${STANDALONE_SERVER_DIR}"
cd "${STANDALONE_SERVER_DIR}"
exec node server.js
