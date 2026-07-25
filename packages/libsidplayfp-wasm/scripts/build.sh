#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to run this build" >&2
    exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
DIST_DIR="${PACKAGE_ROOT}/dist"
CACHE_DIR="${PACKAGE_ROOT}/.cache/upstream"
IMAGE_NAME="sidflow-libsidplayfp-wasm:latest"

mkdir -p "${DIST_DIR}" "${CACHE_DIR}"

docker build -f "${PACKAGE_ROOT}/docker/Dockerfile" -t "${IMAGE_NAME}" "${PACKAGE_ROOT}"
# Forward the build knobs the entrypoint understands, so upstream refs and the
# libresidfp math flags can be varied without editing the image.
DOCKER_ENV=()
for var in LIBSIDPLAYFP_REF LIBRESIDFP_REF SIDFLOW_RESIDFP_MATH_FLAGS SIDFLOW_EXTRA_FLAGS; do
    if [[ -n "${!var:-}" ]]; then
        DOCKER_ENV+=(-e "${var}=${!var}")
    fi
done

docker run \
    --rm \
    "${DOCKER_ENV[@]}" \
    -v "${DIST_DIR}:/dist" \
    -v "${CACHE_DIR}:/opt/libsidplayfp-cache" \
    "${IMAGE_NAME}"

echo "Artifacts are available in ${DIST_DIR}"
