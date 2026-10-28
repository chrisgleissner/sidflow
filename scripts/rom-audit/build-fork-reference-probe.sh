#!/usr/bin/env bash
# Link the bounded fork experiment against the existing qualified native build.
# Does not rebuild, patch, replace or install the production renderer.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
mapfile -t candidates < <(find "$root/workspace/rom-audit-screen-residfp" -path '*/libsidplayfp/src/.libs/libsidplayfp.a')
((${#candidates[@]} == 1)) || { echo "Expected exactly one pinned native reSIDfp build" >&2; exit 1; }
source_dir=${candidates[0]%/src/.libs/libsidplayfp.a}
cache="$root/workspace/rom-audit-fork-probe"
mkdir -p "$cache"
g++ -std=c++17 -O3 -DNDEBUG -march=native -ffp-contract=off -flto \
  -DSIDFLOW_NATIVE_RESIDFP=1 -DSIDFLOW_NATIVE_CAPACITY_GUARDED=1 \
  -I"$source_dir/src" -I"$source_dir/../libresidfp/src" \
  "$root/scripts/rom-audit/fork-reference-probe.cpp" \
  "$source_dir/src/.libs/libsidplayfp.a" "$(dirname "$(dirname "$source_dir")")/prefix/lib/libresidfp.a" \
  -o "$cache/render"
echo "$cache/render"
