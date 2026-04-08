#!/usr/bin/env bash

set -euo pipefail

# Update an existing GitHub release with derived portable similarity assets.
# The script stages a coherent bundle containing the authoritative full sqlite,
# its manifest, the lite bundle + manifest, the tiny bundle + manifest, and a
# regenerated SHA256SUMS before uploading the changed assets with --clobber.

usage() {
  cat <<'EOF'
Usage:
  bash scripts/upload-existing-release-assets.sh \
    --repo OWNER/REPO \
    --tag RELEASE_TAG \
    --full-sqlite /path/to/sidcorr-hvsc-full-sidcorr-1.sqlite \
    --lite /path/to/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr \
    --lite-manifest /path/to/sidcorr-hvsc-full-sidcorr-lite-1.manifest.json \
    --tiny /path/to/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr \
    --tiny-manifest /path/to/sidcorr-hvsc-full-sidcorr-tiny-1.manifest.json \
    [--full-manifest /path/to/sidcorr-hvsc-full-sidcorr-1.manifest.json] \
    [--notes-file /path/to/release-notes.md] \
    [--tarball-name hvsc-full-sidcorr-1-YYYYMMDDTHHMMSSZ.tar.gz]

Notes:
  - If --full-manifest is omitted, the script downloads the existing full manifest
    asset from the target release into the staging directory.
  - The script replaces the release tarball and SHA256SUMS using --clobber and
    uploads the lite/tiny assets and their manifests.
EOF
}

fail() {
  printf '[release-upload] ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "Expected file does not exist: $1"
}

REPO=""
TAG=""
FULL_SQLITE=""
FULL_MANIFEST=""
LITE=""
LITE_MANIFEST=""
TINY=""
TINY_MANIFEST=""
NOTES_FILE=""
TARBALL_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --full-sqlite)
      FULL_SQLITE="$2"
      shift 2
      ;;
    --full-manifest)
      FULL_MANIFEST="$2"
      shift 2
      ;;
    --lite)
      LITE="$2"
      shift 2
      ;;
    --lite-manifest)
      LITE_MANIFEST="$2"
      shift 2
      ;;
    --tiny)
      TINY="$2"
      shift 2
      ;;
    --tiny-manifest)
      TINY_MANIFEST="$2"
      shift 2
      ;;
    --notes-file)
      NOTES_FILE="$2"
      shift 2
      ;;
    --tarball-name)
      TARBALL_NAME="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$REPO" ]] || fail "--repo is required"
[[ -n "$TAG" ]] || fail "--tag is required"
[[ -n "$FULL_SQLITE" ]] || fail "--full-sqlite is required"
[[ -n "$LITE" ]] || fail "--lite is required"
[[ -n "$LITE_MANIFEST" ]] || fail "--lite-manifest is required"
[[ -n "$TINY" ]] || fail "--tiny is required"
[[ -n "$TINY_MANIFEST" ]] || fail "--tiny-manifest is required"

command -v gh >/dev/null 2>&1 || fail "gh CLI is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated"
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 || fail "Release $TAG does not exist in $REPO"

require_file "$FULL_SQLITE"
require_file "$LITE"
require_file "$LITE_MANIFEST"
require_file "$TINY"
require_file "$TINY_MANIFEST"
if [[ -n "$NOTES_FILE" ]]; then
  require_file "$NOTES_FILE"
fi

timestamp="${TAG##*-}"
if [[ -z "$TARBALL_NAME" ]]; then
  TARBALL_NAME="hvsc-full-sidcorr-1-${timestamp}.tar.gz"
fi

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/sidflow-release-upload.XXXXXX")"
trap 'rm -rf "$stage_dir"' EXIT

if [[ -z "$FULL_MANIFEST" ]]; then
  gh release download "$TAG" --repo "$REPO" --pattern "sidcorr-hvsc-full-sidcorr-1.manifest.json" --dir "$stage_dir"
  FULL_MANIFEST="$stage_dir/sidcorr-hvsc-full-sidcorr-1.manifest.json"
fi

require_file "$FULL_MANIFEST"

cp "$FULL_SQLITE" "$stage_dir/"
if [[ "$(cd "$(dirname "$FULL_MANIFEST")" && pwd)" != "$stage_dir" ]]; then
  cp "$FULL_MANIFEST" "$stage_dir/"
fi
cp "$LITE" "$stage_dir/"
cp "$LITE_MANIFEST" "$stage_dir/"
cp "$TINY" "$stage_dir/"
cp "$TINY_MANIFEST" "$stage_dir/"

(
  cd "$stage_dir"
  sha256sum \
    "$(basename "$FULL_SQLITE")" \
    "$(basename "$FULL_MANIFEST")" \
    "$(basename "$LITE")" \
    "$(basename "$LITE_MANIFEST")" \
    "$(basename "$TINY")" \
    "$(basename "$TINY_MANIFEST")" \
    > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
  tar -czf "$TARBALL_NAME" \
    "$(basename "$FULL_SQLITE")" \
    "$(basename "$FULL_MANIFEST")" \
    "$(basename "$LITE")" \
    "$(basename "$LITE_MANIFEST")" \
    "$(basename "$TINY")" \
    "$(basename "$TINY_MANIFEST")" \
    SHA256SUMS
)

gh release upload "$TAG" --repo "$REPO" --clobber \
  "$stage_dir/$(basename "$LITE")" \
  "$stage_dir/$(basename "$LITE_MANIFEST")" \
  "$stage_dir/$(basename "$TINY")" \
  "$stage_dir/$(basename "$TINY_MANIFEST")" \
  "$stage_dir/SHA256SUMS" \
  "$stage_dir/$TARBALL_NAME"

if [[ -n "$NOTES_FILE" ]]; then
  gh release edit "$TAG" --repo "$REPO" --notes-file "$NOTES_FILE"
fi

printf '[release-upload] Uploaded assets to %s/%s\n' "$REPO" "$TAG"
printf '[release-upload] Assets: %s, %s, %s, %s, SHA256SUMS, %s\n' \
  "$(basename "$LITE")" \
  "$(basename "$LITE_MANIFEST")" \
  "$(basename "$TINY")" \
  "$(basename "$TINY_MANIFEST")" \
  "$TARBALL_NAME"