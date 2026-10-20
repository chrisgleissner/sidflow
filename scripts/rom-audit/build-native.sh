#!/usr/bin/env bash
# Build the fast audit renderer from the exact source shipped with SIDFlow's
# locked libsidplayfp-wasm package. No distro engine or network checkout is used.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cache="${ROM_AUDIT_BUILD_DIR:-$root/workspace/rom-audit-native}"
compiler_flags=(-O3 -DNDEBUG)
if [[ "${ROM_AUDIT_SANITIZE:-0}" == 1 ]]; then
  cache="$cache-asan"
  compiler_flags=(-O1 -g -fsanitize=address -fno-omit-frame-pointer)
fi
source_archive="${ROM_AUDIT_PACKAGE:-$root/packages/sidflow-classify/node_modules/libsidplayfp-wasm}/dist/complete-source.tar.gz"
mkdir -p "$cache"
stamp=$(sha256sum "$source_archive" "$root/scripts/rom-audit/render.cpp" "$root/scripts/rom-audit/apply-sid-write-hook.py" "$root/scripts/rom-audit/apply-basic-read-hook.py" "${BASH_SOURCE[0]}")
if [[ -x "$cache/render" && -f "$cache/stamp" && "$(cat "$cache/stamp")" == "$stamp" ]]; then
  echo "$cache/render"
  exit 0
fi
for tool in g++ make autoreconf libtoolize xa; do
  command -v "$tool" >/dev/null || { echo "Missing build prerequisite: $tool" >&2; exit 1; }
done
tar -xf "$source_archive" -C "$cache"
archive_root=$(tar -tf "$source_archive" | awk 'NR == 1 { print $0 }')
source_dir="$cache/${archive_root%/}/libsidplayfp"
[[ -n "$source_dir" ]] || { echo "Cannot locate packaged libsidplayfp source" >&2; exit 1; }
(
  cd "$source_dir"
  python3 "$root/scripts/rom-audit/apply-sid-write-hook.py" "$source_dir"
  python3 "$root/scripts/rom-audit/apply-basic-read-hook.py" "$source_dir"
  autoreconf -fi
  # SIDLite is built into libsidplayfp; do not accidentally link distro reSIDfp.
  PKG_CONFIG_LIBDIR=/nonexistent ./configure --disable-shared --enable-static \
    --without-exsid --without-usbsid CXXFLAGS="${compiler_flags[*]}"
  make -j"${ROM_AUDIT_JOBS:-7}" src/builders/sidlite-builder/sidlite/libsidlite.la
  make -j"${ROM_AUDIT_JOBS:-7}" src/builders/sidlite-builder/libsidplayfp-sidlite.la
  make src/psiddrv.bin src/sidtune/sidplayer1.bin src/sidtune/sidplayer2.bin
  make -j"${ROM_AUDIT_JOBS:-7}" src/libsidplayfp.la
) >"$cache/build.log" 2>&1
g++ "${compiler_flags[@]}" -std=c++17 "$root/scripts/rom-audit/render.cpp" \
  -I"$source_dir/src" "$source_dir/src/.libs/libsidplayfp.a" -o "$cache/render"
printf '%s' "$stamp" >"$cache/stamp"
echo "$cache/render"
