#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_TAG="${IMAGE_TAG:-sidflow:local}"
CONTAINER_NAME="${CONTAINER_NAME:-sidflow-smoke}"
HOST_PORT="${PORT:-3000}"
ADMIN_USER="${SIDFLOW_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${SIDFLOW_ADMIN_PASSWORD:-docker-smoke-password-2026}"
ADMIN_SECRET="${SIDFLOW_ADMIN_SECRET:-docker-smoke-admin-secret-2026-1234567890}"
JWT_SECRET="${JWT_SECRET:-docker-smoke-jwt-secret-2026-1234567890ab}"
SMOKE_MODE="${DOCKER_SMOKE_MODE:-build}"
FIXTURE_SID_ROOT="${FIXTURE_SID_ROOT:-${ROOT_DIR}/test-data}"
CLASSIFY_LIMIT="${CLASSIFY_LIMIT:-10}"
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
READINESS_URL="${HEALTH_URL}?scope=readiness"
TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"

mkdir -p "${TMP_ROOT}"

if [[ ! -d "${FIXTURE_SID_ROOT}" ]]; then
  echo "[docker-smoke] Fixture SID root not found: ${FIXTURE_SID_ROOT}" >&2
  exit 1
fi

SAMPLE_SID_HOST_PATH="$(find "${FIXTURE_SID_ROOT}" -type f -name '*.sid' | sort | head -n 1)"
if [[ -z "${SAMPLE_SID_HOST_PATH}" ]]; then
  echo "[docker-smoke] No SID fixtures found under ${FIXTURE_SID_ROOT}" >&2
  exit 1
fi
SAMPLE_SID_RELATIVE="${SAMPLE_SID_HOST_PATH#${FIXTURE_SID_ROOT}/}"
AUTH_HEADER="Basic $(printf '%s:%s' "${ADMIN_USER}" "${ADMIN_PASSWORD}" | base64 | tr -d '\n')"

curl_json() {
  local method="$1"
  local url="$2"
  local output_file="$3"
  local body="${4:-}"
  shift 4 || true

  local -a args
  args=(--silent --show-error --fail-with-body -X "$method" "$url" -H 'Content-Type: application/json' -o "$output_file")
  while (($#)); do
    args+=("$1")
    shift
  done
  if [[ -n "$body" ]]; then
    args+=(--data "$body")
  fi
  curl "${args[@]}"
}

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  if [[ "${KEEP_DOCKER_SMOKE_ARTIFACTS:-0}" != "1" ]]; then
    rm -rf "${TMP_ROOT}"
  else
    echo "[docker-smoke] Preserving artifacts in ${TMP_ROOT}"
  fi
}
trap cleanup EXIT

case "${SMOKE_MODE}" in
  build)
    echo "[docker-smoke] Building image '${IMAGE_TAG}'"
    "${ROOT_DIR}/scripts/run-with-timeout.sh" 1800 -- docker build -f "${ROOT_DIR}/Dockerfile.production" -t "${IMAGE_TAG}" "${ROOT_DIR}"
    ;;
  pull)
    echo "[docker-smoke] Pulling image '${IMAGE_TAG}'"
    "${ROOT_DIR}/scripts/run-with-timeout.sh" 600 -- docker pull "${IMAGE_TAG}"
    ;;
  *)
    echo "[docker-smoke] Unsupported DOCKER_SMOKE_MODE='${SMOKE_MODE}' (expected build or pull)" >&2
    exit 1
    ;;
esac

echo "[docker-smoke] Cleaning any previous container '${CONTAINER_NAME}'"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "[docker-smoke] Starting container '${CONTAINER_NAME}' on host port ${HOST_PORT}"
CONTAINER_ID="$("${ROOT_DIR}/scripts/run-with-timeout.sh" 120 -- docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${HOST_PORT}:3000" \
  -e SIDFLOW_ADMIN_USER="${ADMIN_USER}" \
  -e SIDFLOW_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  -e SIDFLOW_ADMIN_SECRET="${ADMIN_SECRET}" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -v "${FIXTURE_SID_ROOT}:/sidflow/workspace/hvsc:ro" \
  "${IMAGE_TAG}")"

echo "[docker-smoke] Container started: ${CONTAINER_ID}"

echo "[docker-smoke] Waiting for container health..."
attempt=0
max_attempts=60
sleep_seconds=2
while (( attempt < max_attempts )); do
  health_status="$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_ID}" 2>/dev/null || echo "unknown")"
  if [[ "${health_status}" == "healthy" ]]; then
    echo "[docker-smoke] Container is healthy"
    break
  fi
  if [[ "${health_status}" == "unhealthy" ]]; then
    echo "[docker-smoke] Container reported unhealthy"
    docker logs "${CONTAINER_ID}" || true
    exit 1
  fi
  attempt=$(( attempt + 1 ))
  sleep "${sleep_seconds}"
done

if (( attempt == max_attempts )); then
  echo "[docker-smoke] Container did not become healthy in time"
  docker logs "${CONTAINER_ID}" || true
  exit 1
fi

echo "[docker-smoke] Verifying health endpoints"
curl_json GET "${HEALTH_URL}" "${TMP_ROOT}/health.json" ""
jq '.' "${TMP_ROOT}/health.json"
curl_json GET "${READINESS_URL}" "${TMP_ROOT}/readiness.json" ""
jq '.' "${TMP_ROOT}/readiness.json"

echo "[docker-smoke] Verifying admin API via Basic auth"
curl_json GET "http://127.0.0.1:${HOST_PORT}/api/admin/metrics" "${TMP_ROOT}/admin-metrics-before.json" "" -H "Authorization: ${AUTH_HEADER}"
jq '.jobs' "${TMP_ROOT}/admin-metrics-before.json"

echo "[docker-smoke] Exercising public playback APIs"
curl_json POST "http://127.0.0.1:${HOST_PORT}/api/play" "${TMP_ROOT}/play.json" "$(jq -cn --arg sid_path "${SAMPLE_SID_RELATIVE}" '{sid_path: $sid_path}')"
jq '.data.track | {sidPath, relativePath, displayName}' "${TMP_ROOT}/play.json"

echo "[docker-smoke] Exercising favorites flow"
curl_json POST "http://127.0.0.1:${HOST_PORT}/api/favorites" "${TMP_ROOT}/favorites-add.json" "$(jq -cn --arg sid_path "${SAMPLE_SID_RELATIVE}" '{sid_path: $sid_path}')"
curl_json GET "http://127.0.0.1:${HOST_PORT}/api/favorites" "${TMP_ROOT}/favorites-list.json" ""
jq --arg sid_path "${SAMPLE_SID_RELATIVE}" '(.data.favorites | index($sid_path)) != null' "${TMP_ROOT}/favorites-list.json" | grep -qx 'true'
curl_json DELETE "http://127.0.0.1:${HOST_PORT}/api/favorites" "${TMP_ROOT}/favorites-delete.json" "$(jq -cn --arg sid_path "${SAMPLE_SID_RELATIVE}" '{sid_path: $sid_path}')"

echo "[docker-smoke] Exercising bounded classify flow (limit=${CLASSIFY_LIMIT})"
curl_json POST "http://127.0.0.1:${HOST_PORT}/api/classify" "${TMP_ROOT}/classify.json" "$(jq -cn --argjson limit "${CLASSIFY_LIMIT}" '{limit: $limit, forceRebuild: false, skipAlreadyClassified: false, deleteWavAfterClassification: false}')" -H "Authorization: ${AUTH_HEADER}"
jq '.' "${TMP_ROOT}/classify.json"

JSONL_COUNT="$(docker exec "${CONTAINER_NAME}" sh -lc "find /sidflow/data/classified -maxdepth 1 -type f -name '*.jsonl' | wc -l" | tr -d ' ')"
JSONL_RECORD_COUNT="$(docker exec "${CONTAINER_NAME}" sh -lc "cat /sidflow/data/classified/*.jsonl 2>/dev/null | wc -l" | tr -d ' ')"
if [[ "${JSONL_COUNT}" -lt 1 ]]; then
  echo "[docker-smoke] Expected classification output under /sidflow/data/classified" >&2
  docker logs "${CONTAINER_ID}" || true
  exit 1
fi
if [[ "${JSONL_RECORD_COUNT}" -lt 1 ]]; then
  echo "[docker-smoke] Expected at least one classified JSONL record" >&2
  docker logs "${CONTAINER_ID}" || true
  exit 1
fi

curl_json GET "http://127.0.0.1:${HOST_PORT}/api/admin/metrics" "${TMP_ROOT}/admin-metrics-after.json" "" -H "Authorization: ${AUTH_HEADER}"
jq '.cache' "${TMP_ROOT}/admin-metrics-after.json"

echo "[docker-smoke] Success! Image '${IMAGE_TAG}' passed smoke test."
echo "[docker-smoke] Sample SID: ${SAMPLE_SID_RELATIVE}"
echo "[docker-smoke] Classification outputs: ${JSONL_COUNT} JSONL file(s), ${JSONL_RECORD_COUNT} record(s)"
echo "Container logs (last 40 lines):"
docker logs --tail=40 "${CONTAINER_ID}" || true
