#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_TAG="${IMAGE_TAG:-sidflow:local}"
CONTAINER_NAME="${CONTAINER_NAME:-sidflow-smoke}"
HOST_PORT="${PORT:-3000}"
ADMIN_USER="${SIDFLOW_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${SIDFLOW_ADMIN_PASSWORD:-docker-smoke-secret}"
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"

echo "[docker-smoke] Building image '${IMAGE_TAG}'"
"${ROOT_DIR}/scripts/run-with-timeout.sh" 1800 -- docker build -f "${ROOT_DIR}/Dockerfile.production" -t "${IMAGE_TAG}" "${ROOT_DIR}"

echo "[docker-smoke] Cleaning any previous container '${CONTAINER_NAME}'"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "[docker-smoke] Starting container '${CONTAINER_NAME}' on host port ${HOST_PORT}"
CONTAINER_ID="$("${ROOT_DIR}/scripts/run-with-timeout.sh" 120 -- docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${HOST_PORT}:3000" \
  -e SIDFLOW_ADMIN_USER="${ADMIN_USER}" \
  -e SIDFLOW_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  "${IMAGE_TAG}")"

cleanup() {
  docker rm -f "${CONTAINER_ID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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

echo "[docker-smoke] Waiting for server to be ready to accept connections..."
sleep 5

echo "[docker-smoke] Curling health endpoint ${HEALTH_URL}"
retry=0
max_retries=10
while (( retry < max_retries )); do
  if curl -fsS "${HEALTH_URL}" > /tmp/sidflow-docker-health.json 2>&1; then
    echo "[docker-smoke] Health endpoint responded successfully"
    cat /tmp/sidflow-docker-health.json
    break
  fi
  retry=$(( retry + 1 ))
  if (( retry < max_retries )); then
    echo "[docker-smoke] Health endpoint not ready (attempt $retry/$max_retries), retrying..."
    sleep 2
  fi
done

if (( retry == max_retries )); then
  echo "[docker-smoke] Health endpoint failed after $max_retries attempts"
  echo "[docker-smoke] Last curl output:"
  cat /tmp/sidflow-docker-health.json 2>/dev/null || echo "(no output)"
  echo "[docker-smoke] Container logs:"
  docker logs "${CONTAINER_ID}" || true
  exit 1
fi

echo "[docker-smoke] Success! Image '${IMAGE_TAG}' passed smoke test."
echo "Container logs (last 20 lines):"
docker logs --tail=20 "${CONTAINER_ID}" || true
