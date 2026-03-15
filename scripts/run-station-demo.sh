#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ARTIFACT_DB="${ROOT_DIR}/workspace/artifacts/similarity-export/hvsc-full-sidcorr-1-2026-03-14/sidcorr-hvsc-full-sidcorr-1.sqlite"
DEFAULT_REPO_DB="${ROOT_DIR}/data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite"

DB_PATH=""
HVSC_PATH="${ROOT_DIR}/workspace/hvsc"
FEATURES_PATH="${ROOT_DIR}/data/classified/features_2026-03-14_13-03-41-920.jsonl"
PLAYBACK_MODE="local"
PLAYBACK_MODE_SET="false"
C64U_HOST=""
EXTRA_ARGS=()

if [[ -f "${DEFAULT_ARTIFACT_DB}" ]]; then
  DB_PATH="${DEFAULT_ARTIFACT_DB}"
else
  DB_PATH="${DEFAULT_REPO_DB}"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      DB_PATH="$2"
      shift 2
      ;;
    --hvsc)
      HVSC_PATH="$2"
      shift 2
      ;;
    --features-jsonl)
      FEATURES_PATH="$2"
      shift 2
      ;;
    --playback)
      PLAYBACK_MODE="$2"
      PLAYBACK_MODE_SET="true"
      shift 2
      ;;
    --c64u-host)
      C64U_HOST="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/run-station-demo.sh [options] [-- additional station-demo args]

Defaults:
  --db               workspace/artifacts/.../sidcorr-hvsc-full-sidcorr-1.sqlite when present
                     otherwise data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite
  --hvsc             workspace/hvsc
  --features-jsonl   data/classified/features_2026-03-14_13-03-41-920.jsonl
  --playback         local

Wrapper-specific options:
  --db <path>
  --hvsc <path>
  --features-jsonl <path>
  --playback <local|c64u|none>
  --c64u-host <host>

Any remaining arguments are passed through to:
  scripts/sidflow-play station-demo
EOF
      exit 0
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -n "${C64U_HOST}" && "${PLAYBACK_MODE_SET}" != "true" ]]; then
  PLAYBACK_MODE="c64u"
fi

CMD=(
  "${ROOT_DIR}/scripts/sidflow-play"
  station-demo
  --db "${DB_PATH}"
  --hvsc "${HVSC_PATH}"
  --features-jsonl "${FEATURES_PATH}"
  --playback "${PLAYBACK_MODE}"
)

if [[ -n "${C64U_HOST}" ]]; then
  CMD+=(--c64u-host "${C64U_HOST}")
fi

CMD+=("${EXTRA_ARGS[@]}")

exec "${CMD[@]}"