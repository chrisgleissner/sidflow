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
RUNTIME="node"
THREADS=""
MAX_SONGS=""
SKIP_ALREADY_CLASSIFIED="true"
DELETE_WAV_AFTER_CLASSIFICATION="true"
FORCE_REBUILD="false"
FULL_RERUN="false"
KEEP_RUNTIME="false"
SCHEMA_VERSION="sidcorr-1"
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

REPORT_EVERY_SONGS=50

LOCAL_SERVER_PID=""
LOCAL_WORKER_PID=""
DOCKER_CONTAINER_NAME=""
CLASSIFY_REQUEST_PID=""
CLASSIFY_STARTED_AT_MS=""
CLASSIFIED_PATH=""
EXPORT_OUTPUT_PATH=""
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
  --runtime bun|node                  Local classify runtime. Default: node
  --threads N                         Optional classify thread count override
  --max-songs N                       Stop each classification run after at most N songs
  --full-rerun true|false             Force a complete reclassification and replace prior export. Default: false
  --skip-already-classified true|false
                                      Default: true
  --delete-wav-after-classification true|false
                                      Default: true
  --force-rebuild true|false          Default: false
  --publish-release true|false        Create and publish a tar.gz release bundle. Default: false
  --publish-repo OWNER/REPO           Release target. Default: chrisgleissner/sidflow-data
  --publish-timestamp UTCSTAMP        Override UTC timestamp in YYYYMMDDTHHMMSSZ format
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

release_notes() {
  local tag="$1"
  cat <<EOF
Portable SID correlation export bundle generated by SIDFlow.

- repo: ${REPO_ROOT}
- source tag: ${tag}
- corpus: ${CORPUS_VERSION}
- profile: ${PROFILE}
- schema: ${SCHEMA_VERSION}

The tarball contains the SQLite export, manifest, and SHA256SUMS.
EOF
}

cleanup() {
  local exit_code=$?

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

if [[ "${PUBLISH_RELEASE}" == "true" ]]; then
  require_command gh
  [[ "${PUBLISH_REPO}" =~ ^[^/]+/[^/]+$ ]] || fail "--publish-repo must be OWNER/REPO"
  if [[ -n "${PUBLISH_TIMESTAMP}" ]]; then
    validate_publish_timestamp "${PUBLISH_TIMESTAMP}"
  fi
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
  else
    CLASSIFIED_PATH="${STATE_DIR}/data/classified"
    EXPORT_OUTPUT_PATH="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
  fi

  classified_count="$(count_classified_rows "${CLASSIFIED_PATH}")"
  feature_count="$(count_feature_rows "${CLASSIFIED_PATH}")"
  print_resume_summary "${classified_count}" "${feature_count}" "${EXPORT_OUTPUT_PATH}"

  if [[ "${FULL_RERUN}" == "true" ]]; then
    if [[ -d "${CLASSIFIED_PATH}" ]]; then
      log "Full rerun: removing prior classified JSONL artifacts from ${CLASSIFIED_PATH}"
      find "${CLASSIFIED_PATH}" -type f \( -name 'classification_*.jsonl' -o -name 'classification_*.events.jsonl' -o -name 'features_*.jsonl' \) -delete
    fi
    rm -f "${EXPORT_OUTPUT_PATH}" "${EXPORT_OUTPUT_PATH%.sqlite}.manifest.json"
  fi
}

wait_for_health() {
  local url="http://127.0.0.1:${PORT}/api/health?scope=readiness"
  local attempts=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts > 120 )); then
      fail "Timed out waiting for ${url}"
    fi
    sleep 2
  done
}

start_local_runtime() {
  local sid_path
  sid_path="$(resolve_local_sid_path)"
  [[ -d "${sid_path}" ]] || fail "Configured sidPath does not exist: ${sid_path}"

  if [[ "${RUNTIME}" == "bun" ]]; then
    log "Installing dependencies for Bun local mode"
    (cd "${REPO_ROOT}" && bun install --frozen-lockfile) >> "${SERVER_LOG}" 2>&1

    log "Starting local web server under Bun on port ${PORT}"
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
      PORT="${PORT}" \
      bun run dev
    ) >> "${SERVER_LOG}" 2>&1 &
  else
    ensure_node_runtime_build

    log "Starting local web server under Node on port ${PORT}"
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
      PORT="${PORT}" \
      node ./scripts/start-test-server.mjs --mode=development
    ) >> "${SERVER_LOG}" 2>&1 &
  fi
  LOCAL_SERVER_PID=$!

  wait_for_health
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
completed = int(progress.get('taggedFiles') or 0) + int(progress.get('skippedFiles') or 0)
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
completed = int(progress.get('taggedFiles') or 0) + int(progress.get('skippedFiles') or 0)
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

run_export() {
  local output_path
  if [[ "${MODE}" == "local" ]]; then
    log "Running local export with bun runtime"
    (
      cd "${REPO_ROOT}"
      bun run export:similarity -- --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}"
    )
    output_path="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
  else
    log "Running export inside docker container"
    docker exec -w /sidflow/app "${DOCKER_CONTAINER_NAME}" \
      bun run export:similarity -- --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}"
    output_path="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}.sqlite"
  fi

  [[ -f "${output_path}" ]] || fail "Expected export not found: ${output_path}"
  [[ -f "${output_path%.sqlite}.manifest.json" ]] || fail "Expected manifest not found: ${output_path%.sqlite}.manifest.json"

  log "Export complete"
  log "Export runtime: bun"
  log "SQLite: ${output_path}"
  log "Manifest: ${output_path%.sqlite}.manifest.json"
}

stage_release_bundle() {
  local output_path="$1"
  local manifest_path="${output_path%.sqlite}.manifest.json"
  local timestamp="$2"
  local bundle_name="${CORPUS_VERSION}-${PROFILE}-${SCHEMA_VERSION}-${timestamp}"
  local artifact_root="${REPO_ROOT}/workspace/artifacts/similarity-export"

  ARTIFACT_BUNDLE_DIR="${artifact_root}/${bundle_name}"
  ARTIFACT_TARBALL_PATH="${artifact_root}/${bundle_name}.tar.gz"

  mkdir -p "${ARTIFACT_BUNDLE_DIR}"
  rm -f "${ARTIFACT_BUNDLE_DIR}"/* "${ARTIFACT_TARBALL_PATH}"

  cp "${output_path}" "${ARTIFACT_BUNDLE_DIR}/"
  cp "${manifest_path}" "${ARTIFACT_BUNDLE_DIR}/"

  (
    cd "${ARTIFACT_BUNDLE_DIR}"
    sha256sum "$(basename "${output_path}")" "$(basename "${manifest_path}")" > SHA256SUMS
    sha256sum -c SHA256SUMS >/dev/null
  )

  tar -czf "${ARTIFACT_TARBALL_PATH}" -C "${ARTIFACT_BUNDLE_DIR}" .

  local tar_listing
  tar_listing="$(tar -tzf "${ARTIFACT_TARBALL_PATH}")"
  grep -q "$(basename "${output_path}")" <<<"${tar_listing}" || fail "Release tarball is missing the SQLite export"
  grep -q "$(basename "${manifest_path}")" <<<"${tar_listing}" || fail "Release tarball is missing the manifest"
  grep -q '^SHA256SUMS$' <<<"${tar_listing}" || fail "Release tarball is missing SHA256SUMS"

  log "Prepared release bundle: ${ARTIFACT_TARBALL_PATH}"
}

publish_release_if_requested() {
  local output_path="$1"
  [[ "${PUBLISH_RELEASE}" == "true" ]] || return 0

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

  gh release create "${tag}" "${ARTIFACT_TARBALL_PATH}" \
    --repo "${PUBLISH_REPO}" \
    --title "$(release_title "${timestamp}")" \
    --notes-file "${notes_file}"

  log "Published release ${tag} to ${PUBLISH_REPO}"
}

main() {
  acquire_run_lock
  prepare_run_state

  if [[ "${WORKFLOW}" == "publish-only" ]]; then
    [[ -f "${EXPORT_OUTPUT_PATH}" ]] || fail "Expected export not found for publish-only workflow: ${EXPORT_OUTPUT_PATH}"
    [[ -f "${EXPORT_OUTPUT_PATH%.sqlite}.manifest.json" ]] || fail "Expected manifest not found for publish-only workflow: ${EXPORT_OUTPUT_PATH%.sqlite}.manifest.json"
    log "Workflow: publish-only"
    publish_release_if_requested "${EXPORT_OUTPUT_PATH}"
    return
  fi

  log "Mode: ${MODE}"
  log "Runtime: ${RUNTIME}"
  if [[ "${MODE}" == "local" ]]; then
    start_local_runtime
  else
    start_docker_runtime
  fi

  trigger_classification
  wait_for_classification
  run_export
  publish_release_if_requested "${EXPORT_OUTPUT_PATH}"
}

main
