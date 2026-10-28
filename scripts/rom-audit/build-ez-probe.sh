#!/usr/bin/env bash
# Build the Commander-pinned upstream libSidplayEZ as a native Linux probe.
# Experimental only: no eligibility publication or existing renderer replacement.
# Usage: bash scripts/rom-audit/build-ez-probe.sh
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
revision=4c8664c80df8d363049e1a3eadf59cd9e52afd1f
sha=b74103101f95e1635a064147d9b83c54a6f128a28e2ded043e70779513075590
cache="$root/workspace/rom-audit-ez-probe"
mkdir -p "$cache"
archive="$cache/source.tar.gz"
if [[ ! -f "$archive" ]]; then
  curl -L --fail --retry 3 "https://codeload.github.com/Toddler-Boy/libSidplayEZ/tar.gz/$revision" -o "$archive.part"
  mv "$archive.part" "$archive"
fi
printf '%s  %s\n' "$sha" "$archive" | sha256sum --check
if [[ ! -d "$cache/source" ]]; then
  mkdir "$cache/source"
  tar -xzf "$archive" -C "$cache/source" --strip-components=1
fi
# Keep source and build artifacts outside the system; never install a library.
printf '%s\n' "$cache/source"
compiler=${CXX:-clang++}
command -v "$compiler" >/dev/null || { echo "Clang required; set CXX or run setup-local-clang.sh" >&2; exit 1; }
flags=(-std=c++23 -O3 -DNDEBUG -march=native -ffp-contract=off -fno-math-errno -pthread)
stamp=$( { sha256sum "$archive" "$root/scripts/rom-audit/ez-probe.cpp" "${BASH_SOURCE[0]}"; find "$cache/source" -type f -print0 | sort -z | xargs -0 sha256sum; "$compiler" --version; "$compiler" -march=native -### -x c++ /dev/null 2>&1; } | sha256sum | cut -d' ' -f1)
if [[ -x "$cache/render" && -f "$cache/stamp" && $(cat "$cache/stamp") == "$stamp" && -f "$cache/render.sha256" && $(sha256sum "$cache/render" | cut -d' ' -f1) == $(cat "$cache/render.sha256") ]]; then
  echo "$cache/render"
  exit 0
fi
mkdir -p "$cache/objects"
export ROM_EZ_SOURCE="$cache/source/src" ROM_EZ_OBJECTS="$cache/objects" ROM_EZ_CXX="$compiler"
# Compile source files independently, without modifying upstream or system files.
find "$cache/source/src" -name '*.cpp' -not -path '*/EZ/*' -print0 |
  xargs -0 -P "${ROM_AUDIT_JOBS:-8}" -I{} bash -c '
    file="$1"; relative="${file#"$ROM_EZ_SOURCE/"}"; object="${relative//\//_}";
    "$ROM_EZ_CXX" -std=c++23 -O3 -DNDEBUG -march=native -ffp-contract=off -fno-math-errno -pthread -I"$ROM_EZ_SOURCE" -c "$file" -o "$ROM_EZ_OBJECTS/$object.o"
  ' _ '{}'
"$compiler" "${flags[@]}" -I"$cache/source/src" "$root/scripts/rom-audit/ez-probe.cpp" "$cache/objects/"*.o -o "$cache/render.tmp"
mv "$cache/render.tmp" "$cache/render"
sha256sum "$cache/render" | cut -d' ' -f1 > "$cache/render.sha256"
printf '%s' "$stamp" > "$cache/stamp"
echo "$cache/render"
