#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONFIG_PATH="${ROOT_DIR}/.sidflow.json"
DEFAULT_HVSC_PATH="${ROOT_DIR}/workspace/hvsc"
HVSC_PATH="${DEFAULT_HVSC_PATH}"
LOCAL_DB_PATH=""
FORCE_LOCAL_DB="false"
FEATURES_PATH=""
PLAYBACK_MODE="local"
PLAYBACK_MODE_SET="false"
C64U_HOST=""
CONFIG_PATH=""
EXTRA_ARGS=()
TEMP_CONFIG_PATH=""
FETCH_ATTEMPTED="false"

cleanup() {
  if [[ -n "${TEMP_CONFIG_PATH}" && -f "${TEMP_CONFIG_PATH}" ]]; then
    rm -f "${TEMP_CONFIG_PATH}"
  fi
}

trap cleanup EXIT

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

resolve_source_config() {
  if [[ -n "${CONFIG_PATH}" ]]; then
    printf '%s\n' "${CONFIG_PATH}"
    return
  fi

  if [[ -n "${SIDFLOW_CONFIG:-}" ]]; then
    printf '%s\n' "${SIDFLOW_CONFIG}"
    return
  fi

  printf '%s\n' "${DEFAULT_CONFIG_PATH}"
}

ensure_temp_config() {
  if [[ -n "${TEMP_CONFIG_PATH}" ]]; then
    return
  fi

  local source_config
  source_config="$(resolve_source_config)"
  [[ -f "${source_config}" ]] || fail "SIDFlow config not found: ${source_config}"

  TEMP_CONFIG_PATH="$(mktemp "${TMPDIR:-/tmp}/sidflow-station-config-XXXXXX.json")"
  bun -e 'import { readFileSync, writeFileSync } from "node:fs";
const [sourcePath, destinationPath, hvscPath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(sourcePath, "utf8"));
config.sidPath = hvscPath;
writeFileSync(destinationPath, `${JSON.stringify(config, null, 2)}\n`);' -- \
    "${source_config}" \
    "${TEMP_CONFIG_PATH}" \
    "${HVSC_PATH}"
}

append_config_arg() {
  if [[ -n "${TEMP_CONFIG_PATH}" ]]; then
    printf '%s\n' "${TEMP_CONFIG_PATH}"
    return
  fi

  if [[ -n "${CONFIG_PATH}" ]]; then
    printf '%s\n' "${CONFIG_PATH}"
  fi
}

hvsc_available() {
  [[ -d "${HVSC_PATH}" ]] || return 1
  find "${HVSC_PATH}" -mindepth 1 -print -quit >/dev/null 2>&1
}

fetch_hvsc() {
  local reason="$1"
  local config_arg=""

  printf 'HVSC bootstrap: %s\n' "${reason}" >&2

  if [[ "${HVSC_PATH}" != "${DEFAULT_HVSC_PATH}" || -n "${CONFIG_PATH}" ]]; then
    ensure_temp_config
  fi

  config_arg="$(append_config_arg || true)"

  local fetch_cmd=("${ROOT_DIR}/scripts/sidflow-fetch")
  if [[ -n "${config_arg}" ]]; then
    fetch_cmd+=(--config "${config_arg}")
  fi

  "${fetch_cmd[@]}"
}

ensure_hvsc_present() {
  if hvsc_available; then
    return
  fi

  FETCH_ATTEMPTED="true"
  fetch_hvsc "local SID collection missing at ${HVSC_PATH}; downloading HVSC first"
}

build_station_demo_cmd() {
  local config_arg=""

  if [[ "${HVSC_PATH}" != "${DEFAULT_HVSC_PATH}" || -n "${CONFIG_PATH}" ]]; then
    ensure_temp_config
  fi

  config_arg="$(append_config_arg || true)"

  CMD=(
    "${ROOT_DIR}/scripts/sidflow-play"
    station
  )

  if [[ -n "${config_arg}" ]]; then
    CMD+=(--config "${config_arg}")
  fi

  CMD+=(
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
}

run_station_demo() {
  local stderr_log
  stderr_log="$(mktemp "${TMPDIR:-/tmp}/sidflow-station-stderr-XXXXXX.log")"

  build_station_demo_cmd

  if "${CMD[@]}" 2> >(tee "${stderr_log}" >&2); then
    rm -f "${stderr_log}"
    return 0
  fi

  local exit_code=$?
  local missing_sid_message="SID file not found under ${HVSC_PATH}:"

  if [[ "${FETCH_ATTEMPTED}" != "true" ]] && grep -Fq "${missing_sid_message}" "${stderr_log}"; then
    FETCH_ATTEMPTED="true"
    rm -f "${stderr_log}"
    fetch_hvsc "SID CLI Station reported missing SID content under ${HVSC_PATH}; retrying after HVSC sync"
    run_station_demo
    return $?
  fi

  rm -f "${stderr_log}"
  return "${exit_code}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_PATH="$2"
      shift 2
      ;;
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
Usage: scripts/sid-station.sh [options] [-- additional station args]

Defaults:
  similarity DB      latest cached sidflow-data release bundle
  --config           SIDFLOW_CONFIG or .sidflow.json
  --hvsc             workspace/hvsc
  --playback         local

Wrapper-specific options:
  --config <path>    Alternate SIDFlow config to use for fetch + playback
  --local-db <path>  Specific local similarity SQLite bundle
  --db <path>        Deprecated alias for --local-db
  --force-local-db   Use the latest local export under data/exports
  --hvsc <path>
  --features-jsonl <path>  Optional local provenance path to display in the TUI
  --playback <local|c64u|none>
  --c64u-host <host>

Any remaining arguments are passed through to:
  scripts/sidflow-play station
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

ensure_hvsc_present
run_station_demo
