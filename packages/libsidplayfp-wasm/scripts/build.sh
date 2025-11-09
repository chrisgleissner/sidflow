#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to run this build" >&2
    exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
DIST_DIR="${PACKAGE_ROOT}/dist"
IMAGE_NAME="sidflow-libsidplayfp-wasm:latest"

mkdir -p "${DIST_DIR}"

docker build -f "${PACKAGE_ROOT}/docker/Dockerfile" -t "${IMAGE_NAME}" "${PACKAGE_ROOT}"
docker run --rm -v "${DIST_DIR}:/dist" "${IMAGE_NAME}"

echo "Artifacts are available in ${DIST_DIR}"
