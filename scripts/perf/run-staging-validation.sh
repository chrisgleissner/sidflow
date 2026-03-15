#!/usr/bin/env bash
# Run the Phase 4 staging validation profile against a remote SIDFlow deployment.
# This wraps the journey-based performance runner with the reviewed journeys and scale profile.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BASE_URL="${1:-${SIDFLOW_PERF_BASE_URL:-}}"
PROFILE="${SIDFLOW_PERF_PROFILE:-scale}"
RESULTS_DIR="${SIDFLOW_PERF_RESULTS_DIR:-${REPO_ROOT}/performance/results}"
TMP_DIR="${SIDFLOW_PERF_TMP_DIR:-${REPO_ROOT}/performance/tmp}"
EXECUTORS="${SIDFLOW_PERF_EXECUTORS:-k6}"

if [[ -z "${BASE_URL}" ]]; then
  echo "usage: $0 <base-url>" >&2
  echo "or set SIDFLOW_PERF_BASE_URL=https://your-staging-app.example" >&2
  exit 1
fi

if [[ -z "${SIDFLOW_PERF_ADMIN_BASIC_AUTH:-}" ]]; then
  echo "SIDFLOW_PERF_ADMIN_BASIC_AUTH is required for authenticated admin journeys." >&2
  echo "export SIDFLOW_PERF_ADMIN_BASIC_AUTH=\"\$(printf '%s:%s' \"\$SIDFLOW_ADMIN_USER\" \"\$SIDFLOW_ADMIN_PASSWORD\" | base64 -w0)\"" >&2
  exit 1
fi

cd "${REPO_ROOT}"

bun run perf:run -- \
  --env remote \
  --enable-remote \
  --base-url "${BASE_URL}" \
  --profile "${PROFILE}" \
  --results "${RESULTS_DIR}" \
  --tmp "${TMP_DIR}" \
  --journey play-start-stream \
  --journey search-favorite-stream \
  --journey admin-classify-queue \
  --executor "${EXECUTORS}" \
  --execute