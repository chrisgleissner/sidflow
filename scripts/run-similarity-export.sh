#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MODE="local"
PORT="3000"
PROFILE="full"
CORPUS_VERSION="hvsc"
THREADS=""
MAX_SONGS=""
SKIP_ALREADY_CLASSIFIED="true"
DELETE_WAV_AFTER_CLASSIFICATION="true"
FORCE_REBUILD="false"
FULL_RERUN="false"
KEEP_RUNTIME="false"

CONFIG_PATH="${REPO_ROOT}/.sidflow.json"
IMAGE="ghcr.io/chrisgleissner/sidflow:latest"
HVSC_PATH=""
STATE_DIR=""

ADMIN_USER="admin"
ADMIN_PASSWORD="sidflow-local-admin-password-2026"
ADMIN_SECRET="sidflow-local-admin-secret-2026-32-chars-min"
JWT_SECRET="sidflow-local-jwt-secret-2026-32-chars-min"

RUNTIME_DIR="${REPO_ROOT}/tmp/runtime/similarity-export"
SERVER_LOG="${RUNTIME_DIR}/server.log"
WORKER_LOG="${RUNTIME_DIR}/worker.log"
PROGRESS_LOG="${RUNTIME_DIR}/progress.log"
REQUEST_LOG="${RUNTIME_DIR}/request.log"
REQUEST_STATUS_FILE="${RUNTIME_DIR}/request.status"
REPORT_STATE_FILE="${RUNTIME_DIR}/report-state.json"

REPORT_EVERY_SONGS=100

LOCAL_SERVER_PID=""
LOCAL_WORKER_PID=""
DOCKER_CONTAINER_NAME=""
CLASSIFY_REQUEST_PID=""
CLASSIFY_STARTED_AT_MS=""
CLASSIFIED_PATH=""
EXPORT_OUTPUT_PATH=""

usage() {
  cat <<'EOF'
Run the full SIDFlow classify-then-export workflow unattended.

Usage:
  bash scripts/run-similarity-export.sh --mode local
  bash scripts/run-similarity-export.sh --mode docker --hvsc /absolute/path/to/hvsc --state-dir /absolute/path/to/sidflow-state

Options:
  --mode local|docker                 Runtime mode. Default: local
  --config PATH                       Local mode only. Default: .sidflow.json in repo root
  --hvsc PATH                         Docker mode: absolute host path to HVSC root
  --state-dir PATH                    Docker mode: absolute host path for persistent state
  --image IMAGE                       Docker mode image. Default: ghcr.io/chrisgleissner/sidflow:latest
  --port PORT                         Web port. Default: 3000
  --profile full|mobile               Export profile. Default: full
  --corpus-version LABEL              Manifest corpus label. Default: hvsc
  --threads N                         Optional classify thread count override
  --max-songs N                       Stop each classification run after at most N songs
  --full-rerun true|false             Force a complete reclassification and replace prior export. Default: false
  --skip-already-classified true|false
                                      Default: true
  --delete-wav-after-classification true|false
                                      Default: true
  --force-rebuild true|false          Default: false
  --keep-runtime true|false           Keep started server/container running after success. Default: false
  --help                              Show this help

Examples:
  bash scripts/run-similarity-export.sh --mode local
  bash scripts/run-similarity-export.sh --mode local --full-rerun true
  bash scripts/run-similarity-export.sh --mode local --max-songs 200
  bash scripts/run-similarity-export.sh --mode local --threads 8 --skip-already-classified false
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

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
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

case "${PROFILE}" in
  full|mobile) ;;
  *) fail "--profile must be full or mobile" ;;
esac

if [[ -n "${MAX_SONGS}" ]]; then
  [[ "${MAX_SONGS}" =~ ^[1-9][0-9]*$ ]] || fail "--max-songs must be a positive integer"
fi

mkdir -p "${RUNTIME_DIR}"
: > "${SERVER_LOG}"
: > "${WORKER_LOG}"
: > "${PROGRESS_LOG}"
: > "${REQUEST_LOG}"
rm -f "${REQUEST_STATUS_FILE}"
printf '{"lastReportedProcessed":0}\n' > "${REPORT_STATE_FILE}"

require_command python3
require_command curl

if [[ "${FULL_RERUN}" == "true" ]]; then
  SKIP_ALREADY_CLASSIFIED="false"
  FORCE_REBUILD="true"
fi

if [[ "${MODE}" == "local" ]]; then
  require_command bun
  require_command sidplayfp
  require_command ffmpeg
else
  require_command docker
fi

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
            if not name.endswith('.jsonl'):
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
  local export_path="$2"
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

  if [[ -f "${export_path}" && -f "${manifest_path}" ]]; then
    log "Resume mode: existing export detected at ${export_path}; it will be replaced after classification completes"
  fi
}

prepare_run_state() {
  local classified_count

  if [[ "${MODE}" == "local" ]]; then
    CLASSIFIED_PATH="$(resolve_local_classified_path)"
    EXPORT_OUTPUT_PATH="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-1.sqlite"
  else
    CLASSIFIED_PATH="${STATE_DIR}/data/classified"
    EXPORT_OUTPUT_PATH="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-1.sqlite"
  fi

  classified_count="$(count_classified_rows "${CLASSIFIED_PATH}")"
  print_resume_summary "${classified_count}" "${EXPORT_OUTPUT_PATH}"

  if [[ "${FULL_RERUN}" == "true" ]]; then
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

  log "Installing dependencies for local mode"
  (cd "${REPO_ROOT}" && bun install --frozen-lockfile) >> "${SERVER_LOG}" 2>&1

  log "Starting local web server on port ${PORT}"
  (
    cd "${REPO_ROOT}/packages/sidflow-web"
    SIDFLOW_CONFIG="${CONFIG_PATH}" \
    SIDFLOW_ADMIN_USER="${ADMIN_USER}" \
    SIDFLOW_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    SIDFLOW_ADMIN_SECRET="${ADMIN_SECRET}" \
    JWT_SECRET="${JWT_SECRET}" \
    PORT="${PORT}" \
    bun run dev
  ) >> "${SERVER_LOG}" 2>&1 &
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
          if python3 - <<'PY' "${SERVER_LOG}" "${CLASSIFY_STARTED_AT_MS}" >> "${PROGRESS_LOG}"
import json, re, sys, time

log_path = sys.argv[1]
started_at_ms = int(sys.argv[2]) if sys.argv[2] else int(time.time() * 1000)
extracting = re.compile(r'\[Extracting Features\]\s+(\d+)/(\d+)\s+files,\s+(\d+)\s+remaining\s+\(([\d.]+)%\)\s+\[rendered=(\d+)\s+cached=(\d+)\s+extracted=(\d+)\]')
analyzing = re.compile(r'\[Analyzing\]\s+(\d+)/(\d+)\s+files.*\(([\d.]+)%\)')

with open(log_path, 'r', encoding='utf-8', errors='ignore') as fh:
  lines = fh.readlines()

record = None
for line in reversed(lines):
  match = extracting.search(line)
  if match:
    processed, total, _remaining, percent, rendered, _cached, extracted = match.groups()
    record = {
      'phase': 'completed' if int(processed) >= int(total) else 'tagging',
      'processedFiles': int(processed),
      'totalFiles': int(total),
      'renderedFiles': int(rendered),
      'extractedFiles': int(extracted),
      'taggedFiles': int(processed),
      'percentComplete': float(percent),
      'isActive': False,
      'updatedAt': int(time.time() * 1000),
      'startedAt': started_at_ms,
    }
    break
  match = analyzing.search(line)
  if match:
    processed, total, percent = match.groups()
    record = {
      'phase': 'analyzing',
      'processedFiles': int(processed),
      'totalFiles': int(total),
      'renderedFiles': 0,
      'extractedFiles': 0,
      'taggedFiles': 0,
      'percentComplete': float(percent),
      'isActive': False,
      'updatedAt': int(time.time() * 1000),
      'startedAt': started_at_ms,
    }
    break

if record is None:
  raise SystemExit(11)

print(json.dumps(record), flush=True)
PY
          then
            status=7
          else
            status=$?
          fi
      ;;
    *)
      fail "Classification request failed with HTTP ${http_code}. Response: $(cat "${REQUEST_LOG}")"
      ;;
    esac
  else
      if python3 - <<'PY' "${SERVER_LOG}" "${CLASSIFY_STARTED_AT_MS}" >> "${PROGRESS_LOG}"
import json, re, sys, time

log_path = sys.argv[1]
started_at_ms = int(sys.argv[2]) if sys.argv[2] else int(time.time() * 1000)
extracting = re.compile(r'\[Extracting Features\]\s+(\d+)/(\d+)\s+files,\s+(\d+)\s+remaining\s+\(([\d.]+)%\)\s+\[rendered=(\d+)\s+cached=(\d+)\s+extracted=(\d+)\]')
analyzing = re.compile(r'\[Analyzing\]\s+(\d+)/(\d+)\s+files.*\(([\d.]+)%\)')

with open(log_path, 'r', encoding='utf-8', errors='ignore') as fh:
  lines = fh.readlines()

for line in reversed(lines):
  match = extracting.search(line)
  if match:
    processed, total, _remaining, percent, rendered, _cached, extracted = match.groups()
    print(json.dumps({
      'phase': 'tagging',
      'processedFiles': int(processed),
      'totalFiles': int(total),
      'renderedFiles': int(rendered),
      'extractedFiles': int(extracted),
      'taggedFiles': int(processed),
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
  state = {'lastReportedProcessed': 0}

processed = int(record.get('processedFiles') or 0)
total = int(record.get('totalFiles') or 0)
phase = record.get('phase') or 'unknown'
last_reported = int(state.get('lastReportedProcessed') or 0)

if processed < report_every and phase != 'completed':
  sys.exit(0)

if processed < last_reported + report_every and phase != 'completed':
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

phase_order = ['analyzing', 'metadata', 'building', 'tagging', 'completed']
phase_rank = {name: index for index, name in enumerate(phase_order)}
current_rank = phase_rank.get(phase, -1)
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
  f'stageCounts[rendered={record.get("renderedFiles")}, extracted={record.get("extractedFiles")}, tagged={record.get("taggedFiles")}]'
)

state['lastReportedProcessed'] = processed
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
  'phase=completed phases[analyzing=done, metadata=done, building=done, tagging=done, completed=done] '
  f'stageCounts[rendered={record.get("renderedFiles")}, extracted={record.get("extractedFiles")}, tagged={record.get("taggedFiles")}]'
)

with open(state_path, 'w', encoding='utf-8') as fh:
  json.dump({'lastReportedProcessed': processed}, fh)
PY
      break
    fi
    if [[ ${status} -eq 9 ]]; then
      fail "Classification reported failed status. See ${PROGRESS_LOG}"
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
      ;;
    *)
      fail "Classification request failed with HTTP ${http_code}. Response: $(cat "${REQUEST_LOG}")"
      ;;
  esac
}

run_export() {
  local output_path
  if [[ "${MODE}" == "local" ]]; then
    log "Running local export"
    (
      cd "${REPO_ROOT}"
      bun run export:similarity -- --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}"
    )
    output_path="${REPO_ROOT}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-1.sqlite"
  else
    log "Running export inside docker container"
    docker exec -w /sidflow/app "${DOCKER_CONTAINER_NAME}" \
      bun run export:similarity -- --profile "${PROFILE}" --corpus-version "${CORPUS_VERSION}"
    output_path="${STATE_DIR}/data/exports/sidcorr-${CORPUS_VERSION}-${PROFILE}-sidcorr-1.sqlite"
  fi

  [[ -f "${output_path}" ]] || fail "Expected export not found: ${output_path}"
  [[ -f "${output_path%.sqlite}.manifest.json" ]] || fail "Expected manifest not found: ${output_path%.sqlite}.manifest.json"

  log "Export complete"
  log "SQLite: ${output_path}"
  log "Manifest: ${output_path%.sqlite}.manifest.json"
}

main() {
  log "Mode: ${MODE}"
  if [[ "${MODE}" == "local" ]]; then
    start_local_runtime
  else
    start_docker_runtime
  fi

  prepare_run_state
  trigger_classification
  wait_for_classification
  run_export
}

main