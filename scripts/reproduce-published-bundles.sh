#!/usr/bin/env bash
#
# Rebuild the lite and tiny bundles from a full sidcorr-1 SQLite export and compare
# them, byte for byte, against the bundles a release actually published.
#
# WHY THIS EXISTS
#
# The full export is the one artefact that cannot be regenerated without a complete
# reclassification pass over HVSC. Lite and tiny are derived from it, and their
# derivation is deterministic: the lite PQ codebook is quantile-based (sort each
# dimension, take equal-count buckets, use the bucket mean as the centroid) with no
# k-means and no RNG, and the tiny builder is a pure function of the lite bundle, the
# neighbour hint and the SID file bytes under the HVSC root.
#
# So a byte-exact reproduction does three jobs at once:
#
#   1. it proves the derivation really is deterministic, and that the published
#      bundles came from this pipeline rather than from a one-off patch;
#   2. it identifies the HVSC release EMPIRICALLY, because tiny stores a 48-bit MD5
#      prefix of every .sid file and only reproduces if the local collection is the
#      one the export was built from;
#   3. it establishes a baseline, so that after a change every byte that differs is
#      attributable to a change someone intended.
#
# Run it BEFORE changing the export code, and again after, so the diff is legible.
#
# USAGE
#
#   scripts/reproduce-published-bundles.sh \
#     --source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite \
#     --published-dir /path/to/downloaded/release
#
#   # or fetch the published bundles straight from the release:
#   scripts/reproduce-published-bundles.sh \
#     --source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite \
#     --release sidcorr-hvsc-full-20260726T203707Z
#
# Exit code 0 means both bundles reproduced byte for byte.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

SOURCE_SQLITE=""
PUBLISHED_DIR=""
RELEASE_TAG=""
DATA_REPO="chrisgleissner/sidflow-data"
WORK_DIR=""
KEEP_WORK_DIR="false"

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-sqlite)
      SOURCE_SQLITE="${2:-}"
      shift 2
      ;;
    --published-dir)
      PUBLISHED_DIR="${2:-}"
      shift 2
      ;;
    --release)
      RELEASE_TAG="${2:-}"
      shift 2
      ;;
    --data-repo)
      DATA_REPO="${2:-}"
      shift 2
      ;;
    --work-dir)
      WORK_DIR="${2:-}"
      KEEP_WORK_DIR="true"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "${SOURCE_SQLITE}" ]] || fail "--source-sqlite is required"
[[ -f "${SOURCE_SQLITE}" ]] || fail "No such file: ${SOURCE_SQLITE}"

if [[ -z "${PUBLISHED_DIR}" && -z "${RELEASE_TAG}" ]]; then
  fail "Give either --published-dir or --release"
fi

if [[ -z "${WORK_DIR}" ]]; then
  WORK_DIR="$(mktemp -d -t sidcorr-reproduce-XXXXXX)"
fi
mkdir -p "${WORK_DIR}/rebuilt"

cleanup() {
  if [[ "${KEEP_WORK_DIR}" != "true" ]]; then
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

# Fetching the published bundles is what makes this a comparison rather than a
# self-consistency check: the reference has to come from the release, not from
# whatever happens to be sitting in data/exports.
if [[ -n "${RELEASE_TAG}" ]]; then
  command -v gh >/dev/null 2>&1 || fail "gh is required to use --release"
  PUBLISHED_DIR="${WORK_DIR}/published"
  mkdir -p "${PUBLISHED_DIR}"
  printf 'Downloading published bundles from %s %s\n' "${DATA_REPO}" "${RELEASE_TAG}"
  gh release download "${RELEASE_TAG}" --repo "${DATA_REPO}" -D "${PUBLISHED_DIR}" \
    --pattern '*-sidcorr-lite-1.sidcorr' \
    --pattern '*-sidcorr-tiny-1.sidcorr' \
    --clobber
fi

[[ -d "${PUBLISHED_DIR}" ]] || fail "No such directory: ${PUBLISHED_DIR}"

published_lite="$(find "${PUBLISHED_DIR}" -maxdepth 1 -name '*-sidcorr-lite-1.sidcorr' -print -quit)"
published_tiny="$(find "${PUBLISHED_DIR}" -maxdepth 1 -name '*-sidcorr-tiny-1.sidcorr' -print -quit)"
[[ -n "${published_lite}" ]] || fail "No *-sidcorr-lite-1.sidcorr in ${PUBLISHED_DIR}"
[[ -n "${published_tiny}" ]] || fail "No *-sidcorr-tiny-1.sidcorr in ${PUBLISHED_DIR}"

rebuilt_lite="${WORK_DIR}/rebuilt/$(basename "${published_lite}")"
rebuilt_tiny="${WORK_DIR}/rebuilt/$(basename "${published_tiny}")"

printf '\n== Rebuilding lite from %s ==\n' "${SOURCE_SQLITE}"
node scripts/run-bun.mjs run packages/sidflow-play/src/cli.ts export-similarity \
  --format lite \
  --source-sqlite "${SOURCE_SQLITE}" \
  --output "${rebuilt_lite}"

# Tiny resolves every sid_path against config.sidPath and throws on the first miss,
# so a mismatched HVSC fails loudly here rather than producing wrong md5_48 identities.
printf '\n== Rebuilding tiny from the rebuilt lite ==\n'
node scripts/run-bun.mjs run packages/sidflow-play/src/cli.ts export-similarity \
  --format tiny \
  --source-lite "${rebuilt_lite}" \
  --neighbor-source-sqlite "${SOURCE_SQLITE}" \
  --output "${rebuilt_tiny}"

status=0
compare() {
  local label="$1"
  local rebuilt="$2"
  local published="$3"
  local rebuilt_sha published_sha
  rebuilt_sha="$(sha256sum "${rebuilt}" | cut -d' ' -f1)"
  published_sha="$(sha256sum "${published}" | cut -d' ' -f1)"
  printf '\n%s\n  rebuilt   %s\n  published %s\n' "${label}" "${rebuilt_sha}" "${published_sha}"
  if [[ "${rebuilt_sha}" == "${published_sha}" ]]; then
    printf '  MATCH\n'
  else
    printf '  MISMATCH\n'
    status=1
  fi
}

compare "lite" "${rebuilt_lite}" "${published_lite}"
compare "tiny" "${rebuilt_tiny}" "${published_tiny}"

printf '\n'
if [[ "${status}" -eq 0 ]]; then
  printf 'Both bundles reproduced byte for byte.\n'
  printf 'The derivation is deterministic and the local HVSC matches the one the export was built from.\n'
else
  printf 'Reproduction FAILED. Do not treat any downstream diff as attributable until this is understood.\n'
  printf 'A non-reproducible pipeline is a finding in its own right.\n'
fi

exit "${status}"
