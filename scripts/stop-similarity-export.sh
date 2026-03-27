#!/usr/bin/env bash

set -euo pipefail

# Stop a local run started by scripts/run-similarity-export.sh by reading the
# runtime lock and sending SIGTERM to the wrapper so its cleanup trap can stop
# the dev server, classify request, and worker processes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/tmp/runtime/similarity-export"
RUN_LOCK_FILE="${RUNTIME_DIR}/.run.lock"

log() {
  printf '[sidcorr-stop] %s\n' "$*"
}

if [[ ! -f "${RUN_LOCK_FILE}" ]]; then
  log "No active similarity-export lock found at ${RUN_LOCK_FILE}"
  exit 0
fi

lock_contents="$(cat "${RUN_LOCK_FILE}" 2>/dev/null || true)"
lock_pid="${lock_contents%% *}"

if [[ -z "${lock_pid}" ]]; then
  log "Lock file exists but does not contain a PID; removing stale lock"
  rm -f "${RUN_LOCK_FILE}"
  exit 0
fi

if ! kill -0 "${lock_pid}" >/dev/null 2>&1; then
  log "PID ${lock_pid} is no longer running; removing stale lock"
  rm -f "${RUN_LOCK_FILE}"
  exit 0
fi

log "Stopping similarity-export wrapper pid ${lock_pid}"
kill -TERM "${lock_pid}" >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if ! kill -0 "${lock_pid}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if kill -0 "${lock_pid}" >/dev/null 2>&1; then
  log "Wrapper pid ${lock_pid} did not exit after SIGTERM; sending SIGKILL"
  kill -KILL "${lock_pid}" >/dev/null 2>&1 || true
fi

rm -f "${RUN_LOCK_FILE}"
log "Similarity-export runtime stopped"
