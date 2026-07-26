#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ORIGINAL_ARGS=("$@")

MODE="local"
WORKFLOW="full"
PORT="3000"
PROFILE="full"
CORPUS_VERSION="hvsc"
RUNTIME="bun"
THREADS=""
DEFAULT_THREADS="12"
MAX_SONGS=""
SKIP_ALREADY_CLASSIFIED="true"
DELETE_WAV_AFTER_CLASSIFICATION="true"
FORCE_REBUILD="false"
FULL_RERUN="false"
RESUME_ATTEMPTS="40"
CHUNK_SONGS="5000"
KEEP_RUNTIME="false"
SCHEMA_VERSION="sidcorr-1"
SQLITE_NEIGHBORS_FOR_TINY="25"
PUBLISH_RELEASE="false"
PUBLISH_REPO="chrisgleissner/sidflow-data"
PUBLISH_TIMESTAMP=""

CONFIG_PATH="${REPO_ROOT}/.sidflow.json"
IMAGE="ghcr.io/chrisgleissner/sidflow:latest"
HVSC_PATH=""
STATE_DIR=""

ADMIN_USER="admin"
ADMIN_PASSWORD="sidflow-local-admin-password-2026"
ADMIN_SECRET="sidflow-local-admin-secret-2026-32-chars-min"
JWT_SECRET="sidflow-local-jwt-secret-2026-32-chars-min"

RUNTIME_DIR="${REPO_ROOT}/tmp/runtime/similarity-export"
RUN_LOCK_FILE="${RUNTIME_DIR}/.run.lock"
SERVER_LOG="${RUNTIME_DIR}/server.log"
WORKER_LOG="${RUNTIME_DIR}/worker.log"
PROGRESS_LOG="${RUNTIME_DIR}/progress.log"
REQUEST_LOG="${RUNTIME_DIR}/request.log"
REQUEST_STATUS_FILE="${RUNTIME_DIR}/request.status"
REPORT_STATE_FILE="${RUNTIME_DIR}/report-state.json"
RUN_EVENTS_LOG="${RUNTIME_DIR}/run-events.jsonl"
MEMORY_LOG="${RUNTIME_DIR}/memory-samples.jsonl"
CRASH_REPORT_DIR="${REPO_ROOT}/logs/crash-reports"
MEMORY_SAMPLER_PID=""
CURRENT_CHUNK="0"
SPAWNED_SERVER_PID=""
DEPS_INSTALLED="false"

REPORT_EVERY_SONGS=50

LOCAL_SERVER_PID=""
LOCAL_WORKER_PID=""
DOCKER_CONTAINER_NAME=""
CLASSIFY_REQUEST_PID=""
CLASSIFY_STARTED_AT_MS=""
CLASSIFIED_PATH=""
EXPORT_OUTPUT_PATH=""
LITE_OUTPUT_PATH=""
TINY_OUTPUT_PATH=""
RUN_LOCK_HELD="false"
ARTIFACT_BUNDLE_DIR=""
ARTIFACT_TARBALL_PATH=""

build_run_command() {
  local command="bash scripts/run-similarity-export.sh"
  local arg
  for arg in "${ORIGINAL_ARGS[@]}"; do
    command+=" ${arg}"
  done
  printf '%s\n' "${command}"
}

RUN_COMMAND="$(build_run_command)"

usage() {
  cat <<'EOF'
Run the full SIDFlow classify-then-export workflow unattended.

Usage:
  bash scripts/run-similarity-export.sh --mode local
  bash scripts/run-similarity-export.sh --mode docker --hvsc /absolute/path/to/hvsc --state-dir /absolute/path/to/sidflow-state
  bash scripts/run-similarity-export.sh --workflow publish-only --publish-release true

Options:
  --workflow full|publish-only        Full classify+export flow or publish an existing export only. Default: full
  --mode local|docker                 Runtime mode. Default: local
  --config PATH                       Local mode only. Default: .sidflow.json in repo root
  --hvsc PATH                         Docker mode: absolute host path to HVSC root
  --state-dir PATH                    Docker mode: absolute host path for persistent state
  --image IMAGE                       Docker mode image. Default: ghcr.io/chrisgleissner/sidflow:latest
  --port PORT                         Web port. Default: 3000
  --profile full|mobile               Export profile. Default: full
  --corpus-version LABEL              Manifest corpus label. Default: hvsc
  --runtime bun|node                  Local classify runtime. Default: bun (node cannot load the
                                      Bun-only SQLite bindings @sidflow/common re-exports)
  --threads N                         Optional classify thread count override
  --max-songs N                       Stop each classification run after at most N songs
  --full-rerun true|false             Force a complete reclassification and replace prior export. Default: false
  --resume-attempts N                 Times to resume classification after a crash. Default: 40
  --chunk-songs N                     Classify in chunks of N songs, restarting the whole runtime
                                      between chunks. 0 disables chunking. Default: 5000
  --skip-already-classified true|false
                                      Default: true
  --delete-wav-after-classification true|false
                                      Default: true
  --force-rebuild true|false          Default: false
  --publish-release true|false        Create and publish a tar.gz release bundle. Default: false
  --publish-repo OWNER/REPO           Release target. Default: chrisgleissner/sidflow-data
  --publish-timestamp UTCSTAMP        Override UTC timestamp in YYYYMMDDTHHMMSSZ format
  --sqlite-neighbors-for-tiny N       Precomputed neighbors stored per track in the full export. Default: 25
  --keep-runtime true|false           Keep started server/container running after success. Default: false
  --help                              Show this help

Examples:
  bash scripts/run-similarity-export.sh --mode local
  bash scripts/run-similarity-export.sh --mode local --full-rerun true
  bash scripts/run-similarity-export.sh --mode local --runtime node --full-rerun true
  bash scripts/run-similarity-export.sh --mode local --max-songs 200
  bash scripts/run-similarity-export.sh --mode local --threads 8 --skip-already-classified false
  bash scripts/run-similarity-export.sh --mode local --publish-release true
  bash scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true
  bash scripts/run-similarity-export.sh --mode docker --hvsc /srv/hvsc --state-dir /srv/sidflow-state
EOF
}

log() {
  printf '[sidcorr] %s\n' "$*"
}

fail() {
  printf '[sidcorr] ERROR: %s\n' "$*" >&2
  exit 1
}

acquire_run_lock() {
  mkdir -p "${RUNTIME_DIR}"

  if [[ -f "${RUN_LOCK_FILE}" ]]; then
    local existing
    existing="$(cat "${RUN_LOCK_FILE}" 2>/dev/null || true)"
    local existing_pid="${existing%% *}"
    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" >/dev/null 2>&1; then
      fail "Another run-similarity-export.sh instance is already running (pid ${existing_pid}). Stop it before starting a new run."
    fi
    rm -f "${RUN_LOCK_FILE}"
  fi

  printf '%s %s\n' "$$" "$(date -Is)" > "${RUN_LOCK_FILE}"
  RUN_LOCK_HELD="true"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

validate_publish_timestamp() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail "--publish-timestamp must match YYYYMMDDTHHMMSSZ"
}

release_timestamp() {
  if [[ -n "${PUBLISH_TIMESTAMP}" ]]; then
    validate_publish_timestamp "${PUBLISH_TIMESTAMP}"
    printf '%s\n' "${PUBLISH_TIMESTAMP}"
    return
  fi

  date -u +%Y%m%dT%H%M%SZ
}

release_tag() {
  local timestamp="$1"
  printf 'sidcorr-%s-%s-%s\n' "${CORPUS_VERSION}" "${PROFILE}" "${timestamp}"
}

release_title() {
  local timestamp="$1"
  printf 'SID correlation export %s %s %s\n' "${CORPUS_VERSION}" "${PROFILE}" "${timestamp}"
}

# Read straight out of the manifest rather than hardcoded, so the notes cannot drift
# from the artifact they describe. Consumers parse the vector width to decide how to read
# vector_json, so a stale number here would be worse than none.
manifest_field() {
  local manifest_path="$1"
  local field="$2"
  [[ -f "${manifest_path}" ]] || { printf 'unknown\n'; return; }
  python3 -c "
import json,sys
try:
    print(json.load(open(sys.argv[1])).get(sys.argv[2], 'unknown'))
except Exception:
    print('unknown')
" "${manifest_path}" "${field}" 2>/dev/null || printf 'unknown\n'
}

release_notes() {
  local tag="$1"
  local manifest_path="${EXPORT_OUTPUT_PATH%.sqlite}.manifest.json"
  local dims
  local tracks
  local engine
  local normalisation
  local neighbours
  dims="$(manifest_field "${manifest_path}" vector_dimensions)"
  tracks="$(manifest_field "${manifest_path}" track_count)"
  engine="$(manifest_field "${manifest_path}" sid_engine)"
  normalisation="$(manifest_field "${manifest_path}" vector_normalisation)"
  neighbours="$(manifest_field "${manifest_path}" neighbor_count_per_track)"

  cat <<EOF
Portable SID correlation export bundle generated by SIDFlow.

| | |
|---|---|
| corpus | ${CORPUS_VERSION} |
| tracks | ${tracks} |
| profile | ${PROFILE} |
| schemas | ${SCHEMA_VERSION}, sidcorr-lite-1, sidcorr-tiny-1 |
| similarity vector | **${dims} dimensions**, ${normalisation} normalised |
| precomputed neighbours per track | ${neighbours} |
| SID emulation | ${engine} |

## If you consume \`vector_json\`, read this

The stored similarity vector is **${dims} numbers wide**. Earlier bundles stored 4.
Never assume a width: read \`vector_dimensions\` from the manifest, which has always
declared it. Similarity is a plain weighted cosine over the stored vector, and values
are in [0, 1] so cosine stays non-negative.

The vector is three groups: 24 perceptual dimensions from the rendered audio, 11
pitch/texture dimensions, and 23 describing how the tune's playroutine drives the SID
chip. The last 34 are read from the register write trace rather than from audio.

## Provenance

\`sid_engine\` records which SID emulation rendered the corpus. This is not the same as
the \`render_engine\` column in the tracks table, which reports the renderer backend and
reads \`wasm\` for both emulations. A corpus that mixes emulations is refused at export
time, because features from different emulations are not on a comparable scale.

The tarball contains the SQLite export, the lite and tiny bundles, their manifests, and SHA256SUMS.

Source tag: ${tag}
EOF
}

portable_manifest_path() {
  local bundle_path="$1"
  printf '%s\n' "${bundle_path%.sidcorr}.manifest.json"
}

require_export_artifacts() {
  local sqlite_path="$1"
  local sqlite_manifest="${sqlite_path%.sqlite}.manifest.json"
  local lite_manifest
  local tiny_manifest

  lite_manifest="$(portable_manifest_path "${LITE_OUTPUT_PATH}")"
  tiny_manifest="$(portable_manifest_path "${TINY_OUTPUT_PATH}")"

  [[ -f "${sqlite_path}" ]] || fail "Expected export not found: ${sqlite_path}"
  [[ -f "${sqlite_manifest}" ]] || fail "Expected manifest not found: ${sqlite_manifest}"
  [[ -f "${LITE_OUTPUT_PATH}" ]] || fail "Expected lite bundle not found: ${LITE_OUTPUT_PATH}"
  [[ -f "${lite_manifest}" ]] || fail "Expected lite manifest not found: ${lite_manifest}"
  [[ -f "${TINY_OUTPUT_PATH}" ]] || fail "Expected tiny bundle not found: ${TINY_OUTPUT_PATH}"
  [[ -f "${tiny_manifest}" ]] || fail "Expected tiny manifest not found: ${tiny_manifest}"
}

cleanup() {
  local exit_code=$?

  if [[ -n "${MEMORY_SAMPLER_PID}" ]] && kill -0 "${MEMORY_SAMPLER_PID}" >/dev/null 2>&1; then
    kill "${MEMORY_SAMPLER_PID}" >/dev/null 2>&1 || true
  fi

  if [[ "${MODE}" == "local" && "${KEEP_RUNTIME}" != "true" ]]; then
    if [[ -n "${CLASSIFY_REQUEST_PID}" ]] && kill -0 "${CLASSIFY_REQUEST_PID}" >/dev/null 2>&1; then
      kill "${CLASSIFY_REQUEST_PID}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${LOCAL_WORKER_PID}" ]] && kill -0 "${LOCAL_WORKER_PID}" >/dev/null 2>&1; then
      kill "${LOCAL_WORKER_PID}" >/dev/null 2>&1 || true
    fi
    if [[ -n "${LOCAL_SERVER_PID}" ]] && kill -0 "${LOCAL_SERVER_PID}" >/dev/null 2>&1; then
      kill "${LOCAL_SERVER_PID}" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "${MODE}" == "docker" && "${KEEP_RUNTIME}" != "true" && -n "${DOCKER_CONTAINER_NAME}" ]]; then
    docker rm -f "${DOCKER_CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi

  if [[ "${RUN_LOCK_HELD}" == "true" && -f "${RUN_LOCK_FILE}" ]]; then
    local existing_pid
    existing_pid="$(cut -d' ' -f1 "${RUN_LOCK_FILE}" 2>/dev/null || true)"
    if [[ "${existing_pid}" == "$$" ]]; then
      rm -f "${RUN_LOCK_FILE}" >/dev/null 2>&1 || true
    fi
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

parse_bool() {
  case "$1" in
    true|false) printf '%s' "$1" ;;
    *) fail "Expected true or false, got: $1" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --workflow)
      WORKFLOW="$2"
      shift 2
      ;;
    --config)
      CONFIG_PATH="$2"
      shift 2
      ;;
    --hvsc)
      HVSC_PATH="$2"
      shift 2
      ;;
    --state-dir)
      STATE_DIR="$2"
      shift 2
      ;;
    --image)
      IMAGE="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --corpus-version)
      CORPUS_VERSION="$2"
      shift 2
      ;;
    --runtime)
      RUNTIME="$2"
      shift 2
      ;;
    --threads)
      THREADS="$2"
      shift 2
      ;;
    --max-songs)
      MAX_SONGS="$2"
      shift 2
      ;;
    --full-rerun)
      FULL_RERUN="$(parse_bool "$2")"
      shift 2
      ;;
    --skip-already-classified)
      SKIP_ALREADY_CLASSIFIED="$(parse_bool "$2")"
      shift 2
      ;;
    --delete-wav-after-classification)
      DELETE_WAV_AFTER_CLASSIFICATION="$(parse_bool "$2")"
      shift 2
      ;;
    --force-rebuild)
      FORCE_REBUILD="$(parse_bool "$2")"
      shift 2
      ;;
    --publish-release)
      PUBLISH_RELEASE="$(parse_bool "$2")"
      shift 2
      ;;
    --publish-repo)
      PUBLISH_REPO="$2"
      shift 2
      ;;
    --publish-timestamp)
      PUBLISH_TIMESTAMP="$2"
      shift 2
      ;;
    --resume-attempts)
      RESUME_ATTEMPTS="$2"
      shift 2
      ;;
    --chunk-songs)
      CHUNK_SONGS="$2"
      shift 2
      ;;
    --sqlite-neighbors-for-tiny)
      SQLITE_NEIGHBORS_FOR_TINY="$2"
      shift 2
      ;;
    --keep-runtime)
      KEEP_RUNTIME="$(parse_bool "$2")"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

case "${MODE}" in
  local|docker) ;;
  *) fail "--mode must be local or docker" ;;
esac

case "${WORKFLOW}" in
  full|publish-only) ;;
  *) fail "--workflow must be full or publish-only" ;;
esac

case "${PROFILE}" in
  full|mobile) ;;
  *) fail "--profile must be full or mobile" ;;
esac

case "${RUNTIME}" in
  bun|node) ;;
  *) fail "--runtime must be bun or node" ;;
esac

if [[ -n "${MAX_SONGS}" ]]; then
  [[ "${MAX_SONGS}" =~ ^[1-9][0-9]*$ ]] || fail "--max-songs must be a positive integer"
fi

[[ "${SQLITE_NEIGHBORS_FOR_TINY}" =~ ^[0-9]+$ ]] || fail "--sqlite-neighbors-for-tiny must be a non-negative integer"
[[ "${CHUNK_SONGS}" =~ ^[0-9]+$ ]] || fail "--chunk-songs must be a non-negative integer"
# 12 is the measured throughput peak on a 20-thread machine (6:10.01, 12:12.26, 16:10.97,
# 20:9.59 tracks/s). It used to be unsafe -- at 12 threads a long-lived run exhausted memory
# sooner, dying at 15,902 tracks against 31,626 at 6 -- but chunked mode restarts the stack
# long before that point, so the stability objection no longer applies and the fast setting
# can simply be the default.
if [[ -z "${THREADS}" && "${CHUNK_SONGS}" != "0" ]]; then
  THREADS="${DEFAULT_THREADS}"
fi

if [[ "${PUBLISH_RELEASE}" == "true" ]]; then
  require_command gh
  [[ "${PUBLISH_REPO}" =~ ^[^/]+/[^/]+$ ]] || fail "--publish-repo must be OWNER/REPO"
  if [[ -n "${PUBLISH_TIMESTAMP}" ]]; then
    validate_publish_timestamp "${PUBLISH_TIMESTAMP}"
  fi
  # Authentication is re-checked at publish time, but that is hours into a full
  # rerun. Fail here instead of after the whole corpus has been classified.
  gh auth status >/dev/null 2>&1 || fail "gh is not authenticated; run 'gh auth login' before using --publish-release true"
fi

if [[ "${WORKFLOW}" == "publish-only" && "${PUBLISH_RELEASE}" != "true" ]]; then
  fail "--workflow publish-only requires --publish-release true"
fi

mkdir -p "${RUNTIME_DIR}"
: > "${SERVER_LOG}"
: > "${WORKER_LOG}"
: > "${PROGRESS_LOG}"
: > "${REQUEST_LOG}"
: > "${RUN_EVENTS_LOG}"
rm -f "${REQUEST_STATUS_FILE}"
printf '{"lastReportedProcessed":0,"lastReportedPhase":"unknown","lastFeatureHealthLine":0}\n' > "${REPORT_STATE_FILE}"

require_command python3
require_command curl

if [[ "${FULL_RERUN}" == "true" ]]; then
  SKIP_ALREADY_CLASSIFIED="false"
  FORCE_REBUILD="true"
fi

python3 - <<'PY' "${RUN_EVENTS_LOG}" "${RUN_COMMAND}" "${MODE}" "${FULL_RERUN}" "${REPO_ROOT}" "${RUNTIME}"
import json, sys, time

log_path, command, mode, full_rerun, cwd, runtime = sys.argv[1:7]
record = {
    "event": "run_start",
    "command": command,
    "mode": mode,
  "runtime": runtime,
    "fullRerun": full_rerun == "true",
    "cwd": cwd,
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
with open(log_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(record, separators=(",", ":")) + "\n")
PY

if [[ "${MODE}" == "local" ]]; then
  require_command bun
  if [[ "${RUNTIME}" == "node" ]]; then
    require_command node
    require_command npm
  fi
  require_command sidplayfp
  require_command ffmpeg
else
  require_command docker
fi

ensure_node_runtime_build() {
  log "Building TypeScript artifacts for Node runtime"
  (
    cd "${REPO_ROOT}"
    npm run build:quick
  ) >> "${SERVER_LOG}" 2>&1
}

resolve_local_sid_path() {
  python3 - "$CONFIG_PATH" <<'PY'
import json, os, sys
config_path = os.path.abspath(sys.argv[1])
with open(config_path, 'r', encoding='utf-8') as fh:
    config = json.load(fh)
sid_path = config.get('sidPath')
if not sid_path:
    raise SystemExit('sidPath missing from config')
if not os.path.isabs(sid_path):
    sid_path = os.path.abspath(os.path.join(os.path.dirname(config_path), sid_path))
print(sid_path)
PY
}

resolve_local_tags_path() {
  python3 - "$CONFIG_PATH" <<'PY'
import json, os, sys
config_path = os.path.abspath(sys.argv[1])
with open(config_path, 'r', encoding='utf-8') as fh:
    config = json.load(fh)
tags_path = config.get('tagsPath') or './workspace/tags'
if not os.path.isabs(tags_path):
    tags_path = os.path.abspath(os.path.join(os.path.dirname(config_path), tags_path))
print(tags_path)
PY
}

resolve_local_classified_path() {
  python3 - "$CONFIG_PATH" <<'PY'
import json, os, sys
config_path = os.path.abspath(sys.argv[1])
with open(config_path, 'r', encoding='utf-8') as fh:
    config = json.load(fh)
classified_path = config.get('classifiedPath') or './data/classified'
if not os.path.isabs(classified_path):
    classified_path = os.path.abspath(os.path.join(os.path.dirname(config_path), classified_path))
print(classified_path)
PY
}

count_classified_rows() {
  local target_path="$1"
  python3 - "$target_path" <<'PY'
import os, sys

root = sys.argv[1]
count = 0
if os.path.isdir(root):
    for current_root, _, files in os.walk(root):
        for name in files:
            if not (name.startswith('classification_') and name.endswith('.jsonl')):
                continue
            full_path = os.path.join(current_root, name)
            with open(full_path, 'r', encoding='utf-8', errors='ignore') as fh:
                for line in fh:
                    if line.strip():
                        count += 1
print(count)
PY
}

count_feature_rows() {
  local target_path="$1"
  python3 - "$target_path" <<'PY'
import os, sys

root = sys.argv[1]
count = 0
if os.path.isdir(root):
  for current_root, _, files in os.walk(root):
    for name in files:
      if not name.startswith('features_') or not name.endswith('.jsonl'):
        continue
      full_path = os.path.join(current_root, name)
      with open(full_path, 'r', encoding='utf-8', errors='ignore') as fh:
        for line in fh:
          if line.strip():
            count += 1
print(count)
PY
}

print_resume_summary() {
  local classified_count="$1"
  local feature_count="$2"
  local export_path="$3"
  local manifest_path="${export_path%.sqlite}.manifest.json"

  if [[ "${FULL_RERUN}" == "true" ]]; then
    log "Mode is full rerun: existing classified data and export artifacts will be ignored and replaced"
    return
  fi

  if [[ "${classified_count}" -gt 0 ]]; then
    log "Resume mode: found ${classified_count} previously classified songs under ${CLASSIFIED_PATH}"
  else
    log "Resume mode: no prior classified songs found under ${CLASSIFIED_PATH}; starting fresh"
  fi

  if [[ "${feature_count}" -gt "${classified_count}" ]]; then
    log "Resume mode: detected $((feature_count - classified_count)) additional feature-phase rows without matching classification rows; export recovery will include them if classification was interrupted mid-run"
  fi

  if [[ -f "${export_path}" && -f "${manifest_path}" ]]; then
    log "Resume mode: existing export detected at ${export_path}; it will be replaced after classification completes"
  fi
}

prepare_run_state() {
  local classified_count
  local feature_count

  if [[ "${MODE}" == "local" ]]; then
    CLASSIFIED_PATH="$(resolve_local_classified_path)"
    EXPORT_OUTPUT_PATH="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
    LITE_OUTPUT_PATH="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-lite-1.sidcorr"
    TINY_OUTPUT_PATH="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-tiny-1.sidcorr"
  else
    CLASSIFIED_PATH="${STATE_DIR}/data/classified"
    EXPORT_OUTPUT_PATH="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
    LITE_OUTPUT_PATH="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-lite-1.sidcorr"
    TINY_OUTPUT_PATH="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-tiny-1.sidcorr"
  fi

  classified_count="$(count_classified_rows "${CLASSIFIED_PATH}")"
  feature_count="$(count_feature_rows "${CLASSIFIED_PATH}")"
  print_resume_summary "${classified_count}" "${feature_count}" "${EXPORT_OUTPUT_PATH}"

  if [[ "${FULL_RERUN}" == "true" ]]; then
    if [[ -d "${CLASSIFIED_PATH}" ]]; then
      log "Full rerun: removing prior classified JSONL artifacts from ${CLASSIFIED_PATH}"
      find "${CLASSIFIED_PATH}" -type f \( -name 'classification_*.jsonl' -o -name 'classification_*.events.jsonl' -o -name 'features_*.jsonl' \) -delete
    fi

    # The auto-tags are the SAME derived data as the classified JSONL, indexed by song
    # instead of by run, and they are what skipAlreadyClassified consults. Deleting one
    # without the other leaves the pipeline believing the corpus is already classified.
    #
    # This is not hypothetical. A full rerun removed the JSONL and left 176,284 tag
    # entries from earlier runs -- a different HVSC version and an older feature schema --
    # and the next run reported "Skipped 86867 already classified", classified 1,001
    # songs, and would have exported a 17k-track corpus in place of an 87,868-track one.
    # Nothing failed. The export would simply have been quietly wrong.
    local tags_path=""
    if [[ "${MODE}" == "local" ]]; then
      tags_path="$(resolve_local_tags_path)"
    else
      tags_path="${STATE_DIR}/workspace/tags"
    fi
    if [[ -n "${tags_path}" && -d "${tags_path}" ]]; then
      local tag_files
      tag_files="$(find "${tags_path}" -type f -name 'auto-tags.json' | wc -l | tr -d ' ')"
      log "Full rerun: removing ${tag_files} auto-tags files from ${tags_path} so skipAlreadyClassified cannot see a previous corpus"
      find "${tags_path}" -type f -name 'auto-tags.json' -delete
    fi
    rm -f \
      "${EXPORT_OUTPUT_PATH}" \
      "${EXPORT_OUTPUT_PATH%.sqlite}.manifest.json" \
      "${LITE_OUTPUT_PATH}" \
      "$(portable_manifest_path "${LITE_OUTPUT_PATH}")" \
      "${TINY_OUTPUT_PATH}" \
      "$(portable_manifest_path "${TINY_OUTPUT_PATH}")"
  fi
}

wait_for_health() {
  local port="${1:-${PORT}}"
  local url="http://127.0.0.1:${port}/api/health?scope=readiness"
  local attempts=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts > 120 )); then
      fail "Timed out waiting for ${url}"
    fi
    sleep 2
  done
}

# Starts a runtime and returns immediately, so a chunk can prewarm its successor while it
# is still working. SPAWNED_SERVER_PID carries the pid out.
spawn_local_runtime() {
  local port="${1:-${PORT}}"
  local sid_path
  sid_path="$(resolve_local_sid_path)"
  [[ -d "${sid_path}" ]] || fail "Configured sidPath does not exist: ${sid_path}"

  if [[ "${RUNTIME}" == "bun" ]]; then
    # Once per run, not once per chunk: with a warm lockfile this is pure latency in the
    # critical path of every handover.
    if [[ "${DEPS_INSTALLED}" != "true" ]]; then
      log "Installing dependencies for Bun local mode"
      (cd "${REPO_ROOT}" && bun install --frozen-lockfile) >> "${SERVER_LOG}" 2>&1
      DEPS_INSTALLED="true"
    fi

    log "Starting local web server under Bun on port ${port}"
    (
      cd "${REPO_ROOT}/packages/sidflow-web"
      SIDFLOW_CONFIG="${CONFIG_PATH}" \
      SIDFLOW_ADMIN_USER="${ADMIN_USER}" \
      SIDFLOW_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
      SIDFLOW_ADMIN_SECRET="${ADMIN_SECRET}" \
      JWT_SECRET="${JWT_SECRET}" \
      SIDFLOW_CLI_RUNTIME="bun" \
      SIDFLOW_CLASSIFY_RUN_COMMAND="${RUN_COMMAND}" \
      SIDFLOW_CLASSIFY_RUN_MODE="${MODE}" \
      SIDFLOW_CLASSIFY_RUN_FULL_RERUN="${FULL_RERUN}" \
      SIDFLOW_CLASSIFY_RUN_CWD="${REPO_ROOT}" \
      PORT="${port}" \
      bun run dev
    ) >> "${SERVER_LOG}" 2>&1 &
  else
    ensure_node_runtime_build

    log "Starting local web server under Node on port ${port}"
    (
      cd "${REPO_ROOT}/packages/sidflow-web"
      SIDFLOW_CONFIG="${CONFIG_PATH}" \
      SIDFLOW_ADMIN_USER="${ADMIN_USER}" \
      SIDFLOW_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
      SIDFLOW_ADMIN_SECRET="${ADMIN_SECRET}" \
      JWT_SECRET="${JWT_SECRET}" \
      SIDFLOW_CLI_RUNTIME="node" \
      SIDFLOW_CLASSIFY_RUN_COMMAND="${RUN_COMMAND}" \
      SIDFLOW_CLASSIFY_RUN_MODE="${MODE}" \
      SIDFLOW_CLASSIFY_RUN_FULL_RERUN="${FULL_RERUN}" \
      SIDFLOW_CLASSIFY_RUN_CWD="${REPO_ROOT}" \
      PORT="${port}" \
      node ./scripts/start-test-server.mjs --mode=development
    ) >> "${SERVER_LOG}" 2>&1 &
  fi
  SPAWNED_SERVER_PID=$!
}

# Spawn and wait. Used by the non-chunked path and for the very first chunk, where there is
# nothing to overlap with.
start_local_runtime() {
  local port="${1:-${PORT}}"
  spawn_local_runtime "${port}"
  LOCAL_SERVER_PID="${SPAWNED_SERVER_PID}"
  wait_for_health "${port}"
}

# Retire one runtime without touching the other. stop_local_runtime kills by pattern, which
# would take down the standby as well, so a double-buffered handover needs this instead.
retire_runtime() {
  local pid="$1"
  local port="$2"
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  # Children first: a crashed chunk can leave a classify process attached to this server.
  local child
  for child in $(pgrep -P "${pid}" 2>/dev/null || true); do
    kill "${child}" >/dev/null 2>&1 || true
  done
  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
  fi
  local waited=0
  while ss -ltn 2>/dev/null | grep -q ":${port} " && (( waited < 30 )); do
    sleep 1
    waited=$(( waited + 1 ))
  done
}

start_docker_runtime() {
  [[ -n "${HVSC_PATH}" ]] || fail "--hvsc is required in docker mode"
  [[ -n "${STATE_DIR}" ]] || fail "--state-dir is required in docker mode"

  HVSC_PATH="$(python3 - <<'PY' "$HVSC_PATH"
import os, sys
print(os.path.abspath(sys.argv[1]))
PY
)"
  STATE_DIR="$(python3 - <<'PY' "$STATE_DIR"
import os, sys
print(os.path.abspath(sys.argv[1]))
PY
)"

  [[ -d "${HVSC_PATH}" ]] || fail "HVSC path does not exist: ${HVSC_PATH}"
  mkdir -p "${STATE_DIR}/audio-cache" "${STATE_DIR}/tags" "${STATE_DIR}/data"

  DOCKER_CONTAINER_NAME="sidflow-sidcorr-${PORT}-$$"

  log "Pulling ${IMAGE}"
  docker pull "${IMAGE}" >> "${SERVER_LOG}" 2>&1

  log "Starting docker container ${DOCKER_CONTAINER_NAME} on port ${PORT}"
  docker run -d \
    --name "${DOCKER_CONTAINER_NAME}" \
    -p "${PORT}:3000" \
    -e SIDFLOW_ADMIN_USER="${ADMIN_USER}" \
    -e SIDFLOW_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    -e SIDFLOW_ADMIN_SECRET="${ADMIN_SECRET}" \
    -e JWT_SECRET="${JWT_SECRET}" \
    -e SIDFLOW_CLASSIFY_RUN_COMMAND="${RUN_COMMAND}" \
    -e SIDFLOW_CLASSIFY_RUN_MODE="${MODE}" \
    -e SIDFLOW_CLASSIFY_RUN_FULL_RERUN="${FULL_RERUN}" \
    -e SIDFLOW_CLASSIFY_RUN_CWD="${REPO_ROOT}" \
    -v "${HVSC_PATH}:/sidflow/workspace/hvsc" \
    -v "${STATE_DIR}/audio-cache:/sidflow/workspace/audio-cache" \
    -v "${STATE_DIR}/tags:/sidflow/workspace/tags" \
    -v "${STATE_DIR}/data:/sidflow/data" \
    "${IMAGE}" >> "${SERVER_LOG}" 2>&1

  wait_for_health
}

build_classify_payload() {
  python3 - <<'PY' \
    "${SKIP_ALREADY_CLASSIFIED}" \
    "${DELETE_WAV_AFTER_CLASSIFICATION}" \
    "${FORCE_REBUILD}" \
    "${THREADS}" \
    "${MAX_SONGS}"
import json, sys

payload = {
    # Intentional: keep the classify request synchronous while this helper tails
    # progress directly from the server log and the request exit status.
    'async': False,
    'skipAlreadyClassified': sys.argv[1] == 'true',
    'deleteWavAfterClassification': sys.argv[2] == 'true',
    'forceRebuild': sys.argv[3] == 'true',
}
threads = sys.argv[4]
if threads:
    payload['threads'] = int(threads)
limit = sys.argv[5]
if limit:
    payload['limit'] = int(limit)
print(json.dumps(payload, separators=(',', ':')))
PY
}

trigger_classification() {
  local payload
  payload="$(build_classify_payload)"
  CLASSIFY_STARTED_AT_MS="$(date +%s%3N)"

  log "Triggering classification with payload ${payload}"
  (
    curl -sS \
      -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
      -H 'content-type: application/json' \
      -o "${REQUEST_LOG}" \
      -w '%{http_code}' \
      -X POST "http://127.0.0.1:${PORT}/api/classify" \
      -d "${payload}" > "${REQUEST_STATUS_FILE}"
  ) &
  CLASSIFY_REQUEST_PID=$!
  log "Classification request started"
}

wait_for_classification() {
  log "Waiting for classification to finish"
  local last_progress_record
  local http_code
  local status

  while true; do
  if [[ -s "${REQUEST_STATUS_FILE}" ]]; then
    http_code="$(cat "${REQUEST_STATUS_FILE}")"
    case "${http_code}" in
    200)
          if python3 - <<'PY' "${REQUEST_LOG}" >> "${PROGRESS_LOG}"
import json, sys

request_path = sys.argv[1]

with open(request_path, 'r', encoding='utf-8', errors='ignore') as fh:
  payload = json.load(fh)

progress = payload.get('data', {}).get('progress') or payload.get('progress')
if not isinstance(progress, dict):
  raise SystemExit(11)

print(json.dumps(progress), flush=True)

combined_output = '\n'.join(
  str(value)
  for value in (
    payload.get('data', {}).get('output'),
    payload.get('data', {}).get('logs'),
    payload.get('details'),
    payload.get('error'),
  )
  if value
)

total = int(progress.get('totalFiles') or 0)
# Songs skipped because they were already classified count as done. Without them a
# re-run over a finished corpus reports 0/87868 and the workflow cannot proceed.
completed = (int(progress.get('taggedFiles') or 0)
  + int(progress.get('skippedFiles') or 0)
  + int(progress.get('skippedAlreadyClassifiedFiles') or 0))
is_complete = total <= 0 or completed >= total
has_failure = 'Classification failed:' in combined_output or 'Out of memory' in combined_output

if payload.get('success') is True and is_complete and not has_failure:
  raise SystemExit(7)

raise SystemExit(9)
PY
          then
            status=$?
          else
            status=$?
          fi
      ;;
    *)
      fail "Classification request failed with HTTP ${http_code}. Response: $(cat "${REQUEST_LOG}")"
      ;;
    esac
  else
      python3 - <<'PY' "${SERVER_LOG}" "${REPORT_STATE_FILE}"
import json, re, sys

log_path = sys.argv[1]
state_path = sys.argv[2]

try:
  with open(state_path, 'r', encoding='utf-8') as fh:
    state = json.load(fh)
except FileNotFoundError:
  state = {'lastReportedProcessed': 0, 'lastReportedPhase': 'unknown', 'lastFeatureHealthLine': 0}

last_feature_health_line = int(state.get('lastFeatureHealthLine') or 0)
feature_health_pattern = re.compile(r'\[classify-feature-health\]\s+(?:\[classify\]\s+)?(\[feature-health-issue\].*)')

try:
  with open(log_path, 'r', encoding='utf-8', errors='ignore') as fh:
    lines = fh.readlines()
except FileNotFoundError:
  lines = []

for line_number, line in enumerate(lines, start=1):
  if line_number <= last_feature_health_line:
    continue
  match = feature_health_pattern.search(line)
  if match:
    print(f'[sidcorr] {match.group(1).strip()}')

state['lastFeatureHealthLine'] = len(lines)
with open(state_path, 'w', encoding='utf-8') as fh:
  json.dump(state, fh)
PY

      if python3 - <<'PY' "${SERVER_LOG}" "${CLASSIFY_STARTED_AT_MS}" >> "${PROGRESS_LOG}"
import json, re, sys, time

log_path = sys.argv[1]
started_at_ms = int(sys.argv[2]) if sys.argv[2] else int(time.time() * 1000)
phase_progress = re.compile(r'\[(Extracting Features|Building Rating Model|Writing Results)\]\s+(\d+)/(\d+)\s+files,\s+(\d+)\s+remaining\s+\(([\d.]+)%\)\s+\[rendered=(\d+)\s+cached=(\d+)\s+extracted=(\d+)\](?:\s+\[featureHealth\s+completeRealistic=(\d+)/(\d+)\s+\((unknown|[\d.]+%)\)\])?')
analyzing = re.compile(r'\[Analyzing\]\s+(\d+)/(\d+)\s+files.*\(([\d.]+)%\)')

with open(log_path, 'r', encoding='utf-8', errors='ignore') as fh:
  lines = fh.readlines()

for line in reversed(lines):
  match = phase_progress.search(line)
  if match:
    label, processed, total, _remaining, percent, rendered, _cached, extracted, complete, checked, complete_percent = match.groups()
    phase = 'tagging' if label == 'Extracting Features' else 'finalizing'
    print(json.dumps({
      'phase': phase,
      'processedFiles': int(processed),
      'totalFiles': int(total),
      'renderedFiles': int(rendered),
      'extractedFiles': int(extracted),
      'taggedFiles': int(processed),
      'completeFeatureFiles': int(complete) if complete is not None else 0,
      'featureHealthCheckedFiles': int(checked) if checked is not None else 0,
      'completeFeaturePercent': None if complete_percent in (None, 'unknown') else float(complete_percent.rstrip('%')),
      'percentComplete': float(percent),
      'isActive': True,
      'updatedAt': int(time.time() * 1000),
      'startedAt': started_at_ms,
    }), flush=True)
    raise SystemExit(0)
  match = analyzing.search(line)
  if match:
    processed, total, percent = match.groups()
    print(json.dumps({
      'phase': 'analyzing',
      'processedFiles': int(processed),
      'totalFiles': int(total),
      'renderedFiles': 0,
      'extractedFiles': 0,
      'taggedFiles': 0,
      'percentComplete': float(percent),
      'isActive': True,
      'updatedAt': int(time.time() * 1000),
      'startedAt': started_at_ms,
    }), flush=True)
    raise SystemExit(0)

raise SystemExit(11)
PY
      then
        status=0
      else
        status=$?
      fi
  fi
  if [[ ${status} -eq 11 ]]; then
    sleep 5
    continue
  fi
  if [[ ${status} -eq 0 ]]; then
    last_progress_record="$(tail -n 1 "${PROGRESS_LOG}" 2>/dev/null || true)"
    PROGRESS_RECORD="${last_progress_record}" python3 - <<'PY' "${REPORT_STATE_FILE}" "${REPORT_EVERY_SONGS}"
import json, math, os, sys, time

state_path = sys.argv[1]
report_every = int(sys.argv[2])
raw = os.environ.get('PROGRESS_RECORD', '').strip()
if not raw:
  sys.exit(0)
record = json.loads(raw)

try:
  with open(state_path, 'r', encoding='utf-8') as fh:
    state = json.load(fh)
except FileNotFoundError:
  state = {'lastReportedProcessed': 0, 'lastReportedPhase': 'unknown'}

processed = int(record.get('processedFiles') or 0)
total = int(record.get('totalFiles') or 0)
phase = record.get('phase') or 'unknown'
last_reported = int(state.get('lastReportedProcessed') or 0)
last_phase = str(state.get('lastReportedPhase') or 'unknown')

if processed < report_every and phase != 'completed' and phase == last_phase:
  sys.exit(0)

if processed < last_reported + report_every and phase != 'completed' and phase == last_phase:
  sys.exit(0)

remaining = max(total - processed, 0)
started_at_ms = record.get('startedAt')
now = time.time()
if isinstance(started_at_ms, (int, float)) and started_at_ms > 0:
  elapsed_seconds = max(now - (started_at_ms / 1000.0), 1.0)
else:
  elapsed_seconds = 1.0

rate = processed / elapsed_seconds if processed > 0 else 0.0
eta_seconds = remaining / rate if rate > 0 else None

def fmt_duration(seconds: float | None) -> str:
  if seconds is None:
    return 'unknown'
  seconds = max(int(round(seconds)), 0)
  hours, remainder = divmod(seconds, 3600)
  minutes, secs = divmod(remainder, 60)
  if hours > 0:
    return f'{hours}h {minutes}m {secs}s'
  if minutes > 0:
    return f'{minutes}m {secs}s'
  return f'{secs}s'

phase_order = ['analyzing', 'metadata', 'building', 'tagging', 'finalizing', 'completed']
phase_rank = {name: index for index, name in enumerate(phase_order)}
current_rank = phase_rank.get(phase, -1)
feature_checked = int(record.get('featureHealthCheckedFiles') or 0)
feature_complete = int(record.get('completeFeatureFiles') or 0)
feature_percent = record.get('completeFeaturePercent')
feature_health = (
  f'featureHealth[completeRealistic={feature_complete}/{feature_checked} (unknown)]'
  if feature_percent is None
  else f'featureHealth[completeRealistic={feature_complete}/{feature_checked} ({float(feature_percent):.1f}%)]'
)
parts = []
for index, name in enumerate(phase_order):
  if phase == 'completed':
    marker = 'done'
  elif index < current_rank:
    marker = 'done'
  elif index == current_rank:
    marker = 'now'
  else:
    marker = 'todo'
  parts.append(f'{name}={marker}')

print(
  '[sidcorr] progress update: '
  f'completed={processed} remaining={remaining} total={total} '
  f'elapsed={fmt_duration(elapsed_seconds)} eta={fmt_duration(eta_seconds)} '
  f'rate={rate:.2f} songs/s percent={record.get("percentComplete")} '
  f'phase={phase} phases[' + ', '.join(parts) + '] '
  f'stageCounts[rendered={record.get("renderedFiles")}, extracted={record.get("extractedFiles")}, tagged={record.get("taggedFiles")}] {feature_health}'
)

state['lastReportedProcessed'] = processed
state['lastReportedPhase'] = phase
with open(state_path, 'w', encoding='utf-8') as fh:
  json.dump(state, fh)
PY
      sleep 30
      continue
    fi

    if [[ ${status} -eq 7 ]]; then
  last_progress_record="$(tail -n 1 "${PROGRESS_LOG}" 2>/dev/null || true)"
    PROGRESS_RECORD="${last_progress_record}" python3 - <<'PY' "${REPORT_STATE_FILE}"
import json, os, sys, time

state_path = sys.argv[1]
raw = os.environ.get('PROGRESS_RECORD', '').strip()
if not raw:
  sys.exit(0)
record = json.loads(raw)
processed = int(record.get('processedFiles') or 0)
total = int(record.get('totalFiles') or 0)
remaining = max(total - processed, 0)
started_at_ms = record.get('startedAt')
elapsed_seconds = max(time.time() - (started_at_ms / 1000.0), 1.0) if isinstance(started_at_ms, (int, float)) and started_at_ms else None
phase = record.get('phase') or 'completed'
feature_checked = int(record.get('featureHealthCheckedFiles') or 0)
feature_complete = int(record.get('completeFeatureFiles') or 0)
feature_percent = record.get('completeFeaturePercent')
feature_health = (
  f'featureHealth[completeRealistic={feature_complete}/{feature_checked} (unknown)]'
  if feature_percent is None
  else f'featureHealth[completeRealistic={feature_complete}/{feature_checked} ({float(feature_percent):.1f}%)]'
)

def fmt_duration(seconds):
  if seconds is None:
    return 'unknown'
  seconds = max(int(round(seconds)), 0)
  hours, remainder = divmod(seconds, 3600)
  minutes, secs = divmod(remainder, 60)
  if hours > 0:
    return f'{hours}h {minutes}m {secs}s'
  if minutes > 0:
    return f'{minutes}m {secs}s'
  return f'{secs}s'

print(
  '[sidcorr] progress update: '
  f'completed={processed} remaining={remaining} total={total} '
  f'elapsed={fmt_duration(elapsed_seconds)} eta=0s rate={(processed / elapsed_seconds) if elapsed_seconds else 0.0:.2f} songs/s '
  f'phase={phase} phases[analyzing=done, metadata=done, building=done, tagging=done, finalizing=done, completed=done] '
  f'stageCounts[rendered={record.get("renderedFiles")}, extracted={record.get("extractedFiles")}, tagged={record.get("taggedFiles")}] {feature_health}'
)

with open(state_path, 'w', encoding='utf-8') as fh:
  json.dump({'lastReportedProcessed': processed, 'lastReportedPhase': phase}, fh)
PY
      break
    fi
    if [[ ${status} -eq 9 ]]; then
      fail "Classification reported failed or incomplete status. Response: $(cat "${REQUEST_LOG}")"
    fi
    fail "Progress polling failed. See ${PROGRESS_LOG}"
  done

  log "Classification completed"

  if [[ -n "${CLASSIFY_REQUEST_PID}" ]]; then
    wait "${CLASSIFY_REQUEST_PID}"
  fi

  if [[ ! -f "${REQUEST_STATUS_FILE}" ]]; then
    fail "Classification request did not record an HTTP status. See ${REQUEST_LOG}"
  fi

  http_code="$(cat "${REQUEST_STATUS_FILE}")"
  case "${http_code}" in
    200)
      if ! python3 - <<'PY' "${REQUEST_LOG}"
import json, sys

with open(sys.argv[1], 'r', encoding='utf-8', errors='ignore') as fh:
  payload = json.load(fh)

progress = payload.get('data', {}).get('progress') or payload.get('progress') or {}
combined_output = '\n'.join(
  str(value)
  for value in (
    payload.get('data', {}).get('output'),
    payload.get('data', {}).get('logs'),
    payload.get('details'),
    payload.get('error'),
  )
  if value
)
total = int(progress.get('totalFiles') or 0)
# Songs skipped because they were already classified count as done. Without them a
# re-run over a finished corpus reports 0/87868 and the workflow cannot proceed.
completed = (int(progress.get('taggedFiles') or 0)
  + int(progress.get('skippedFiles') or 0)
  + int(progress.get('skippedAlreadyClassifiedFiles') or 0))
if payload.get('success') is not True:
  raise SystemExit(1)
if total > 0 and completed < total:
  raise SystemExit(1)
if 'Classification failed:' in combined_output or 'Out of memory' in combined_output:
  raise SystemExit(1)
PY
      then
        fail "Classification returned HTTP 200 but the body reports failure or incomplete progress. Response: $(cat "${REQUEST_LOG}")"
      fi
      ;;
    *)
      fail "Classification request failed with HTTP ${http_code}. Response: $(cat "${REQUEST_LOG}")"
      ;;
  esac
}

# Classification over a full corpus does not reliably survive to the end.
#
# The renderer's safety net terminates and replaces a worker whenever a single tune
# fails to return within the job timeout, and HVSC contains enough of those that a full
# pass replaces workers hundreds of times. Each replacement instantiates a fresh WASM
# module, the terminated worker's linear memory is not always reclaimed, and eventually
# instantiation fails with "Out of memory" -- observed at 15,902 of 87,868 tracks, with
# 3.5 GB peak RSS on a 62 GB machine, so this is address-space exhaustion inside the
# runtime rather than the host running out.
#
# Rendering that many tracks a second time to recover from one crash is hours of wasted
# work, and a workflow that cannot finish a full corpus is not a workflow. Retrying with
# skipAlreadyClassified keeps everything already done.
#
# Retrying only makes sense while it is making progress: a crash that classified nothing
# new will crash the same way again, so that case stops immediately rather than burning
# through the attempt budget.
classify_with_resume() {
  local attempt=1
  local before after

  while :; do
    before="$(count_feature_rows "${CLASSIFIED_PATH}")"

    # A subshell so that `fail` inside the classification helpers ends the ATTEMPT
    # rather than the run.
    if ( trigger_classification; wait_for_classification ); then
      return 0
    fi

    after="$(count_feature_rows "${CLASSIFIED_PATH}")"

    if (( after <= before )); then
      fail "Classification failed on attempt ${attempt} without classifying anything new (${after} records). Not retrying: a resume would fail identically."
    fi

    # The classifier crashing takes the server down with it -- observed as
    # "curl: (52) Empty reply from server" and a closed port on the very next attempt,
    # which then looked like a resume that made no progress. Restart the runtime before
    # retrying, or every retry after a hard crash fails instantly for the wrong reason.
    if [[ "${MODE}" == "local" ]]; then
      if [[ -n "${LOCAL_SERVER_PID}" ]] && kill -0 "${LOCAL_SERVER_PID}" >/dev/null 2>&1; then
        kill "${LOCAL_SERVER_PID}" >/dev/null 2>&1 || true
      fi
      if [[ -n "${LOCAL_WORKER_PID}" ]] && kill -0 "${LOCAL_WORKER_PID}" >/dev/null 2>&1; then
        kill "${LOCAL_WORKER_PID}" >/dev/null 2>&1 || true
      fi
      LOCAL_SERVER_PID=""
      LOCAL_WORKER_PID=""
      rm -f "${REQUEST_STATUS_FILE}" "${REQUEST_LOG}"
      log "Restarting the local runtime before resuming"
      start_local_runtime
    fi
    if (( attempt >= RESUME_ATTEMPTS )); then
      fail "Classification crashed ${attempt} times, the limit set by --resume-attempts. ${after} records were classified; re-run with --full-rerun false to continue from them."
    fi

    log "Classification crashed after reaching ${after} records (attempt ${attempt} of ${RESUME_ATTEMPTS}); resuming from what is already classified"
    SKIP_ALREADY_CLASSIFIED="true"
    FORCE_REBUILD="false"
    attempt=$(( attempt + 1 ))
  done
}

# A resumed corpus has its feature records spread across one file per attempt, and phase 2
# fits the deterministic rating model PER FEATURES FILE. The 1-5 energy/mood/complexity
# levels are quantile-calibrated against the corpus distribution, so several files means
# several different scales stitched into one export -- which is the exact failure the
# calibration exists to prevent, and it would be invisible in the output.
#
# So once phase 1 has covered the corpus, the per-attempt files are merged and phase 2 is
# run ONCE over the union. Its records carry the newest classified_at, and the export
# resolves duplicates by newest, so the single consistent model is what ships.
# Bring the whole local stack down. Not just the classify child: the web server accrues
# state across a long run too, and the point of chunking is that nothing survives a chunk.
stop_local_runtime() {
  if [[ "${MODE}" != "local" ]]; then
    return 0
  fi
  local pid
  for pid in "${CLASSIFY_REQUEST_PID}" "${LOCAL_WORKER_PID}" "${LOCAL_SERVER_PID}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done
  CLASSIFY_REQUEST_PID=""
  LOCAL_WORKER_PID=""
  LOCAL_SERVER_PID=""

  # Anything still holding the port would make the next chunk talk to a stale server.
  local lingering
  lingering="$(pgrep -f "sidflow-web" 2>/dev/null || true)"
  if [[ -n "${lingering}" ]]; then
    kill ${lingering} >/dev/null 2>&1 || true
  fi
  lingering="$(pgrep -f "packages/sidflow-classify/src/cli.ts" 2>/dev/null || true)"
  if [[ -n "${lingering}" ]]; then
    kill ${lingering} >/dev/null 2>&1 || true
  fi

  # Wait for the port to actually close rather than assuming it has.
  local waited=0
  while ss -ltn 2>/dev/null | grep -q ":${PORT} " && (( waited < 30 )); do
    sleep 1
    waited=$(( waited + 1 ))
  done
  rm -f "${REQUEST_STATUS_FILE}" "${REQUEST_LOG}"
}

# A continuous memory trace, so degradation is visible while it develops rather than
# reconstructed from a post-mortem crash report.
#
# Samples every process in the stack, because the interesting number moved between them as
# the investigation went on: first the main process RSS, then per-isolate external memory in
# the render workers. VmHWM is included because it is the high-water mark -- a run can be
# well under its peak at the moment you look at it, which made earlier spot checks
# misleading.
start_memory_sampler() {
  mkdir -p "$(dirname "${MEMORY_LOG}")"
  local owner=$$
  (
    while :; do
      # Exit if the run that started this sampler is gone. Without the check a sampler
      # outlives a killed run and keeps appending to the shared log, which silently
      # contaminates the next run's peak-RSS figure with the previous run's numbers --
      # observed once, reporting a 2,078 MiB peak on a chunk that never exceeded 1,726.
      if ! kill -0 "${owner}" >/dev/null 2>&1; then
        exit 0
      fi
      python3 - "${MEMORY_LOG}" "${CURRENT_CHUNK}" <<'SAMPLER'
import glob, json, os, re, sys, time

log_path, chunk = sys.argv[1], sys.argv[2]

def field(status: str, key: str) -> int:
    match = re.search(rf'^{key}:\s+(\d+) kB', status, re.M)
    return int(match.group(1)) * 1024 if match else 0

procs = []
for status_path in glob.glob('/proc/[0-9]*/status'):
    try:
        with open(status_path, 'r') as handle:
            status = handle.read()
        pid = status_path.split('/')[2]
        with open(f'/proc/{pid}/cmdline', 'rb') as handle:
            cmdline = handle.read().replace(b'\x00', b' ').decode('utf-8', 'replace')
    except (OSError, IndexError):
        continue
    # Only the processes that do the work. Matching on 'sidflow' alone pulled in every
    # shell and python helper whose command line happened to mention the repo, which buried
    # the two numbers that matter under thirty lines of 2 MiB noise.
    if 'packages/sidflow-classify/src/cli.ts' in cmdline or 'sidflow-classify' in cmdline:
        kind = 'classify'
    elif 'sidflow-web' in cmdline or ('next' in cmdline and 'node' in cmdline):
        kind = 'web'
    else:
        continue
    procs.append({
        'pid': int(pid),
        'kind': kind,
        'threads': int(re.search(r'^Threads:\s+(\d+)', status, re.M).group(1)) if re.search(r'^Threads:\s+(\d+)', status, re.M) else 0,
        'rss': field(status, 'VmRSS'),
        # High-water mark: a process can sit well below its peak, which made spot checks
        # of RSS misleading earlier in this investigation.
        'rssPeak': field(status, 'VmHWM'),
        'vsize': field(status, 'VmSize'),
        'vsizePeak': field(status, 'VmPeak'),
        'swap': field(status, 'VmSwap'),
    })

meminfo = {}
try:
    with open('/proc/meminfo') as handle:
        for line in handle:
            key, _, rest = line.partition(':')
            digits = rest.strip().split(' ')[0]
            if digits.isdigit():
                meminfo[key] = int(digits) * 1024
except OSError:
    pass

sample = {
    'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'chunk': int(chunk),
    'processes': procs,
    'totalRss': sum(p['rss'] for p in procs),
    'maxRssPeak': max((p['rssPeak'] for p in procs), default=0),
    'totalVsize': sum(p['vsize'] for p in procs),
    'systemAvailable': meminfo.get('MemAvailable', 0),
}
with open(log_path, 'a') as handle:
    handle.write(json.dumps(sample) + '\n')
SAMPLER
      sleep 10
    done
  ) >/dev/null 2>&1 &
  MEMORY_SAMPLER_PID=$!
}

stop_memory_sampler() {
  if [[ -n "${MEMORY_SAMPLER_PID}" ]] && kill -0 "${MEMORY_SAMPLER_PID}" >/dev/null 2>&1; then
    kill "${MEMORY_SAMPLER_PID}" >/dev/null 2>&1 || true
  fi
  MEMORY_SAMPLER_PID=""
}

# The whole crash, kept. A truncated log line was all that survived the earlier failures,
# which is why the mechanism took so long to characterise.
capture_crash_report() {
  local chunk="$1"
  mkdir -p "${CRASH_REPORT_DIR}"
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local report="${CRASH_REPORT_DIR}/chunk-${chunk}-${stamp}.log"
  {
    printf '=== chunk %s crashed at %s ===\n' "${chunk}" "${stamp}"
    printf '\n--- feature records on disk ---\n%s\n' "$(count_feature_rows "${CLASSIFIED_PATH}")"
    printf '\n--- last memory sample ---\n'
    tail -n 1 "${MEMORY_LOG}" 2>/dev/null || printf '(none)\n'
    printf '\n--- request response ---\n'
    cat "${REQUEST_LOG}" 2>/dev/null || printf '(none)\n'
    printf '\n--- server log tail (2000 lines) ---\n'
    tail -n 2000 "${SERVER_LOG}" 2>/dev/null || printf '(none)\n'
  } > "${report}" 2>&1
  log "Crash report written to ${report}"
}

# Classify in bounded chunks, tearing the whole stack down between them.
#
# The alternative -- one long-lived run -- exhausts memory at a predictable point and dies:
# measured repeatedly at 3.5 GiB RSS after roughly 88,000 WASM instantiations. Waiting for
# that and then resuming works, but it means every corpus pass includes several crashes, each
# costing a restart and leaving a segfault in the log.
#
# Restarting deliberately every N songs keeps the process far from the limit instead. The
# limit counts QUEUED songs, and songs already classified are skipped before they are queued,
# so each chunk does N *new* songs and progress accumulates. A chunk that makes no progress
# and succeeded means the corpus is complete; one that makes no progress and failed is a
# genuine fault rather than exhaustion, so it stops rather than looping.
classify_in_chunks() {
  local chunk=1
  local failures=0
  local before after
  local previous_total=-1

  # Double-buffered runtimes. The restart that keeps memory bounded costs about 35 seconds,
  # and measured on a 1,000-song chunk that was 15.6% of wall clock spent with no classify
  # process running at all. Overlapping it with the work removes that: while a chunk
  # renders, its successor's server is already starting on the other port.
  local active_port="${PORT}"
  local standby_port=$(( PORT + 1 ))
  local active_pid=""
  local standby_pid=""

  log "Double-buffered runtimes on ports ${active_port} and ${standby_port}"
  start_local_runtime "${active_port}"
  active_pid="${LOCAL_SERVER_PID}"

  while :; do
    CURRENT_CHUNK="${chunk}"
    before="$(count_feature_rows "${CLASSIFIED_PATH}")"
    local chunk_started_at
    chunk_started_at="$(date +%s)"

    # Prewarm the successor now, so its startup runs concurrently with this chunk's work
    # rather than after it.
    spawn_local_runtime "${standby_port}"
    standby_pid="${SPAWNED_SERVER_PID}"

    PORT="${active_port}"
    LOCAL_SERVER_PID="${active_pid}"
    start_memory_sampler

    # After the first chunk everything already done must be skipped rather than rebuilt.
    if (( chunk > 1 )); then
      SKIP_ALREADY_CLASSIFIED="true"
      FORCE_REBUILD="false"
    fi
    MAX_SONGS="${CHUNK_SONGS}"

    local ok=1
    if ( trigger_classification; wait_for_classification ); then
      ok=1
    else
      ok=0
    fi

    stop_memory_sampler
    after="$(count_feature_rows "${CLASSIFIED_PATH}")"
    local chunk_elapsed=$(( $(date +%s) - chunk_started_at ))

    if (( ok == 0 )); then
      failures=$(( failures + 1 ))
      capture_crash_report "${chunk}"
    fi

    local peak
    peak="$(python3 - "${MEMORY_LOG}" <<'PEAK'
import json, sys
peak = 0
try:
    with open(sys.argv[1]) as handle:
        for line in handle:
            try:
                peak = max(peak, json.loads(line).get('maxRssPeak', 0))
            except Exception:
                pass
except OSError:
    pass
print(round(peak / (1024 * 1024)))
PEAK
)"
    local added=$(( after - before ))
    local rate="n/a"
    if (( chunk_elapsed > 0 )); then
      rate="$(python3 -c "print(f'{${added}/${chunk_elapsed}:.2f}')")"
    fi
    log "Chunk ${chunk}: ${before} -> ${after} records (+${added}) in ${chunk_elapsed}s = ${rate} songs/s, threads ${THREADS:-auto}, peak RSS ${peak}Mi, failures ${failures}"

    # Hand over to the prewarmed runtime, then retire the one that just worked. Waiting for
    # health here costs nothing when the prewarm had a whole chunk to finish in.
    wait_for_health "${standby_port}"
    retire_runtime "${active_pid}" "${active_port}"
    local swap_port="${active_port}"
    active_port="${standby_port}"
    standby_port="${swap_port}"
    active_pid="${standby_pid}"
    standby_pid=""
    PORT="${active_port}"
    LOCAL_SERVER_PID="${active_pid}"

    if (( after <= before )); then
      if (( ok == 1 )); then
        log "Chunk ${chunk} classified nothing new and succeeded: the corpus is complete at ${after} records"
        retire_runtime "${standby_pid}" "${standby_port}"
        return 0
      fi
      fail "Chunk ${chunk} failed without classifying anything new (${after} records). Not retrying: this is a fault rather than resource exhaustion. See ${CRASH_REPORT_DIR}."
    fi

    if (( after == previous_total )); then
      fail "Chunk ${chunk} made no net progress twice in a row at ${after} records; stopping rather than looping."
    fi
    previous_total="${after}"

    if (( chunk >= RESUME_ATTEMPTS * 100 )); then
      fail "Reached the chunk ceiling at ${after} records."
    fi
    chunk=$(( chunk + 1 ))
  done
}

consolidate_features_if_resumed() {
  local file_count
  file_count="$(find "${CLASSIFIED_PATH}" -maxdepth 1 -type f -name 'features_*.jsonl' | wc -l | tr -d ' ')"
  if (( file_count <= 1 )); then
    return 0
  fi
  if [[ "${MODE}" != "local" ]]; then
    log "WARNING: ${file_count} features files present but mode is ${MODE}; skipping consolidation. Ratings may be calibrated per file."
    return 0
  fi

  log "Resumed corpus: merging ${file_count} features files so the rating model is fitted once over the whole corpus"

  local combined="${CLASSIFIED_PATH}/features_combined.jsonl"
  local archive="${CLASSIFIED_PATH}/features-attempts"
  local merged
  merged="$(python3 - "${CLASSIFIED_PATH}" "${combined}" <<'PYCONSOLIDATE'
import glob, os, re, sys

classified, combined = sys.argv[1], sys.argv[2]
path_pattern = re.compile(r'"sid_path":"((?:[^"\\]|\\.)*)"')
song_pattern = re.compile(r'"song_index":(\d+)')

# Newest file last, so a later attempt's record for a song wins over an earlier one.
files = sorted(
    (f for f in glob.glob(os.path.join(classified, "features_*.jsonl"))
     if os.path.basename(f) != os.path.basename(combined)),
    key=os.path.getmtime,
)
records = {}
order = []
for path in files:
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            m = path_pattern.search(line)
            if not m:
                continue
            s = song_pattern.search(line)
            key = f"{m.group(1)}#{s.group(1) if s else '1'}"
            if key not in records:
                order.append(key)
            records[key] = line

with open(combined, "w", encoding="utf-8") as out:
    for key in order:
        out.write(records[key])
        out.write("\n")

print(len(order))
PYCONSOLIDATE
)" || fail "Merging the features files failed"
  log "Merged ${file_count} files into ${combined}: ${merged} unique songs"

  mkdir -p "${archive}"
  find "${CLASSIFIED_PATH}" -maxdepth 1 -type f -name 'features_*.jsonl' ! -name 'features_combined.jsonl' -exec mv {} "${archive}/" \;

  log "Running phase 2 once over the merged corpus"
  ( cd "${REPO_ROOT}" && bun packages/sidflow-classify/src/cli.ts --config "${CONFIG_PATH}" --resume-from-features "${combined}" ) \
    || fail "Phase 2 over the merged features file failed"
  log "Phase 2 complete"
}

run_export() {
  local output_path
  if [[ "${MODE}" == "local" ]]; then
    log "Running local export with bun runtime"
    (
      cd "${REPO_ROOT}"
      bun run export:similarity -- --config "${CONFIG_PATH}" --profile "${PROFILE}" --neighbors "${SQLITE_NEIGHBORS_FOR_TINY}" --corpus-version "${CORPUS_VERSION}" --output "${EXPORT_OUTPUT_PATH}"
      bun run export:similarity -- --config "${CONFIG_PATH}" --format lite --source-sqlite "${EXPORT_OUTPUT_PATH}" --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}" --output "${LITE_OUTPUT_PATH}"
      bun run export:similarity -- --config "${CONFIG_PATH}" --format tiny --source-lite "${LITE_OUTPUT_PATH}" --neighbor-source-sqlite "${EXPORT_OUTPUT_PATH}" --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}" --output "${TINY_OUTPUT_PATH}"
    )
    output_path="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
  else
    log "Running export inside docker container"
    docker exec -w /sidflow/app "${DOCKER_CONTAINER_NAME}" \
      bun run export:similarity -- --profile "${PROFILE}" --neighbors "${SQLITE_NEIGHBORS_FOR_TINY}" --corpus-version "${CORPUS_VERSION}" --output "${EXPORT_OUTPUT_PATH}"
    docker exec -w /sidflow/app "${DOCKER_CONTAINER_NAME}" \
      bun run export:similarity -- --format lite --source-sqlite "${EXPORT_OUTPUT_PATH}" --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}" --output "${LITE_OUTPUT_PATH}"
    docker exec -w /sidflow/app "${DOCKER_CONTAINER_NAME}" \
      bun run export:similarity -- --format tiny --source-lite "${LITE_OUTPUT_PATH}" --neighbor-source-sqlite "${EXPORT_OUTPUT_PATH}" --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}" --output "${TINY_OUTPUT_PATH}"
    output_path="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
  fi

  require_export_artifacts "${output_path}"

  log "Export complete"
  log "Export runtime: bun"
  log "SQLite: ${output_path}"
  log "Manifest: ${output_path%.sqlite}.manifest.json"
  log "Lite: ${LITE_OUTPUT_PATH}"
  log "Lite manifest: $(portable_manifest_path "${LITE_OUTPUT_PATH}")"
  log "Tiny: ${TINY_OUTPUT_PATH}"
  log "Tiny manifest: $(portable_manifest_path "${TINY_OUTPUT_PATH}")"
}

stage_release_bundle() {
  local output_path="$1"
  local manifest_path="${output_path%.sqlite}.manifest.json"
  local lite_manifest
  local tiny_manifest
  local output_name
  local manifest_name
  local lite_name
  local lite_manifest_name
  local tiny_name
  local tiny_manifest_name
  local checksum_name="SHA256SUMS"
  local checksum_path
  local timestamp="$2"
  local bundle_name="${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}-${timestamp}"
  local artifact_root="${REPO_ROOT}/workspace/artifacts/similarity-export"

  lite_manifest="$(portable_manifest_path "${LITE_OUTPUT_PATH}")"
  tiny_manifest="$(portable_manifest_path "${TINY_OUTPUT_PATH}")"
  output_name="$(basename "${output_path}")"
  manifest_name="$(basename "${manifest_path}")"
  lite_name="$(basename "${LITE_OUTPUT_PATH}")"
  lite_manifest_name="$(basename "${lite_manifest}")"
  tiny_name="$(basename "${TINY_OUTPUT_PATH}")"
  tiny_manifest_name="$(basename "${tiny_manifest}")"
  ARTIFACT_BUNDLE_DIR="${artifact_root}/${bundle_name}"
  ARTIFACT_TARBALL_PATH="${artifact_root}/${bundle_name}.tar.gz"
  checksum_path="${ARTIFACT_BUNDLE_DIR}/${checksum_name}"

  mkdir -p "${ARTIFACT_BUNDLE_DIR}"
  rm -f "${ARTIFACT_BUNDLE_DIR}"/* "${ARTIFACT_TARBALL_PATH}"

  cp "${output_path}" "${ARTIFACT_BUNDLE_DIR}/"
  cp "${manifest_path}" "${ARTIFACT_BUNDLE_DIR}/"
  cp "${LITE_OUTPUT_PATH}" "${ARTIFACT_BUNDLE_DIR}/"
  cp "${lite_manifest}" "${ARTIFACT_BUNDLE_DIR}/"
  cp "${TINY_OUTPUT_PATH}" "${ARTIFACT_BUNDLE_DIR}/"
  cp "${tiny_manifest}" "${ARTIFACT_BUNDLE_DIR}/"

  (
    cd "${ARTIFACT_BUNDLE_DIR}"
    sha256sum "${output_name}" "${manifest_name}" "${lite_name}" "${lite_manifest_name}" "${tiny_name}" "${tiny_manifest_name}" > "${checksum_name}"
    sha256sum -c "${checksum_name}" >/dev/null
  )

  tar -czf "${ARTIFACT_TARBALL_PATH}" \
    -C "${ARTIFACT_BUNDLE_DIR}" \
    "${output_name}" \
    "${manifest_name}" \
    "${lite_name}" \
    "${lite_manifest_name}" \
    "${tiny_name}" \
    "${tiny_manifest_name}" \
    "${checksum_name}"

  local tar_listing
  tar_listing="$(tar -tzf "${ARTIFACT_TARBALL_PATH}")"
  grep -qx "${output_name}" <<<"${tar_listing}" || fail "Release tarball is missing the SQLite export"
  grep -qx "${manifest_name}" <<<"${tar_listing}" || fail "Release tarball is missing the manifest"
  grep -qx "${lite_name}" <<<"${tar_listing}" || fail "Release tarball is missing the lite bundle"
  grep -qx "${lite_manifest_name}" <<<"${tar_listing}" || fail "Release tarball is missing the lite manifest"
  grep -qx "${tiny_name}" <<<"${tar_listing}" || fail "Release tarball is missing the tiny bundle"
  grep -qx "${tiny_manifest_name}" <<<"${tar_listing}" || fail "Release tarball is missing the tiny manifest"
  grep -qx "${checksum_name}" <<<"${tar_listing}" || fail "Release tarball is missing SHA256SUMS"
  [[ -f "${checksum_path}" ]] || fail "Release bundle is missing SHA256SUMS"

  log "Prepared release bundle: ${ARTIFACT_TARBALL_PATH}"
}

publish_release_if_requested() {
  local output_path="$1"
  local manifest_path="${output_path%.sqlite}.manifest.json"
  local lite_manifest
  local tiny_manifest
  [[ "${PUBLISH_RELEASE}" == "true" ]] || return 0

  lite_manifest="$(portable_manifest_path "${LITE_OUTPUT_PATH}")"
  tiny_manifest="$(portable_manifest_path "${TINY_OUTPUT_PATH}")"

  gh auth status >/dev/null 2>&1 || fail "gh is not authenticated; run 'gh auth login' before using --publish-release true"

  local timestamp
  local tag
  timestamp="$(release_timestamp)"
  tag="$(release_tag "${timestamp}")"

  stage_release_bundle "${output_path}" "${timestamp}"

  if gh release view "${tag}" --repo "${PUBLISH_REPO}" >/dev/null 2>&1; then
    fail "Release ${tag} already exists in ${PUBLISH_REPO}; choose a different --publish-timestamp"
  fi

  local notes_file
  notes_file="${RUNTIME_DIR}/release-notes-${timestamp}.md"
  release_notes "${tag}" > "${notes_file}"

  gh release create "${tag}" \
    "${output_path}" \
    "${manifest_path}" \
    "${LITE_OUTPUT_PATH}" \
    "${lite_manifest}" \
    "${TINY_OUTPUT_PATH}" \
    "${tiny_manifest}" \
    "${ARTIFACT_BUNDLE_DIR}/SHA256SUMS" \
    "${ARTIFACT_TARBALL_PATH}" \
    --repo "${PUBLISH_REPO}" \
    --title "$(release_title "${timestamp}")" \
    --notes-file "${notes_file}"

  log "Published release ${tag} to ${PUBLISH_REPO}"
}

main() {
  acquire_run_lock
  prepare_run_state

  if [[ "${WORKFLOW}" == "publish-only" ]]; then
    require_export_artifacts "${EXPORT_OUTPUT_PATH}"
    log "Workflow: publish-only"
    publish_release_if_requested "${EXPORT_OUTPUT_PATH}"
    return
  fi

  log "Mode: ${MODE}"
  log "Runtime: ${RUNTIME}"

  # Chunked mode owns the runtime lifecycle, because tearing it down between chunks is the
  # whole point: a long-lived stack exhausts memory at a predictable ~3.5 GiB and dies.
  if [[ "${MODE}" == "local" && "${CHUNK_SONGS}" != "0" ]]; then
    log "Classifying in chunks of ${CHUNK_SONGS} songs, restarting the runtime between each"
    : > "${MEMORY_LOG}"
    classify_in_chunks
  else
    if [[ "${MODE}" == "local" ]]; then
      start_local_runtime
    else
      start_docker_runtime
    fi
    classify_with_resume
  fi

  consolidate_features_if_resumed
  run_export
  publish_release_if_requested "${EXPORT_OUTPUT_PATH}"
}

main
