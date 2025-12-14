#!/usr/bin/env bash
set -euo pipefail

# Prepares a minimal SID "collection" under ./workspace/hvsc so that:
# - /api/search results from data/classified/sample.jsonl can be played via /api/play
# - Performance journeys can run on CI/public runners without downloading HVSC
#
# Idempotent: safe to run repeatedly.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

HVSC_ROOT="${REPO_ROOT}/workspace/hvsc"
SOURCE_SID="${REPO_ROOT}/test-data/C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid"
TARGET_DIR="${HVSC_ROOT}/Test_Artist"
TARGET_SID="${TARGET_DIR}/Ambient_Dream.sid"

mkdir -p "${TARGET_DIR}"

if [[ ! -f "${SOURCE_SID}" ]]; then
  echo "[perf] ERROR: missing source SID fixture: ${SOURCE_SID}" >&2
  exit 1
fi

# Prefer a symlink (fast, no repo bloat). If symlinks are unavailable, fall back to a copy.
if [[ -e "${TARGET_SID}" ]]; then
  echo "[perf] OK: ${TARGET_SID} already exists"
  exit 0
fi

if ln -s "${SOURCE_SID}" "${TARGET_SID}" 2>/dev/null; then
  echo "[perf] Created symlink: ${TARGET_SID} -> ${SOURCE_SID}"
else
  cp "${SOURCE_SID}" "${TARGET_SID}"
  echo "[perf] Symlink not available; copied fixture to ${TARGET_SID}"
fi

