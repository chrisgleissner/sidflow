#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HVSC_PATH="${ROOT_DIR}/workspace/hvsc"
LOCAL_DB_PATH=""
FORCE_LOCAL_DB="false"
FEATURES_PATH=""
PLAYBACK_MODE="local"
PLAYBACK_MODE_SET="false"
C64U_HOST=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db|--local-db)
      LOCAL_DB_PATH="$2"
      shift 2
      ;;
    --force-local-db)
      FORCE_LOCAL_DB="true"
      shift
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
  similarity DB      latest cached sidflow-data release bundle
  --hvsc             workspace/hvsc
  --playback         local

Wrapper-specific options:
  --local-db <path>  Specific local similarity SQLite bundle
  --db <path>        Deprecated alias for --local-db
  --force-local-db   Use the latest local export under data/exports
  --hvsc <path>
  --features-jsonl <path>  Optional local provenance path to display in the TUI
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
  --hvsc "${HVSC_PATH}"
  --playback "${PLAYBACK_MODE}"
)

if [[ -n "${LOCAL_DB_PATH}" ]]; then
  CMD+=(--local-db "${LOCAL_DB_PATH}")
elif [[ "${FORCE_LOCAL_DB}" == "true" ]]; then
  CMD+=(--force-local-db)
fi

if [[ -n "${FEATURES_PATH}" ]]; then
  CMD+=(--features-jsonl "${FEATURES_PATH}")
fi

if [[ -n "${C64U_HOST}" ]]; then
  CMD+=(--c64u-host "${C64U_HOST}")
fi

CMD+=("${EXTRA_ARGS[@]}")

exec "${CMD[@]}"
