#!/usr/bin/env bash
# Build the fast audit renderer from the exact source shipped with SIDFlow's
# locked libsidplayfp-wasm package. No distro engine or network checkout is used.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
engine=${ROM_AUDIT_ENGINE:-sidlite}
native_suffix=""
case "$engine" in
  sidlite) native_residfp=0 ;;
  residfp) native_residfp=1; native_suffix="-residfp" ;;
  *) echo "Unsupported ROM_AUDIT_ENGINE: $engine" >&2; exit 1 ;;
esac
cache="${ROM_AUDIT_BUILD_DIR:-$root/workspace/rom-audit-native$native_suffix}"
compiler_flags=(-O3 -DNDEBUG -ffp-contract=off -march=native -flto)
if [[ "${ROM_AUDIT_SANITIZE:-0}" == 1 ]]; then
  cache="$cache-asan"
  compiler_flags=(-O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer)
fi
source_archive="${ROM_AUDIT_PACKAGE:-$root/packages/sidflow-classify/node_modules/libsidplayfp-wasm}/dist/complete-source.tar.gz"
archive_listing=$(tar -tf "$source_archive")
capacity_guarded=0
if [[ "$archive_listing" == *"/libsidplayfp-wasm/scripts/apply-sidlite-buffer-guards.py"* ]]; then
  capacity_guarded=1
fi
compiler_flags+=("-DSIDFLOW_NATIVE_CAPACITY_GUARDED=$capacity_guarded")
compiler_flags+=("-DSIDFLOW_NATIVE_RESIDFP=$native_residfp")
compiler_flags+=("-DSIDFLOW_AUDIT_INLINE_FILTERS=1")
mkdir -p "$cache"
# The stamp binds every input, the toolchain and the flags. The output is bound
# separately by render.sha256, so a binary swapped in later is detected and rebuilt.
stamp=$( { sha256sum "$source_archive" "$root/scripts/rom-audit/render.cpp" "$root/scripts/rom-audit/apply-sid-write-hook.py" "$root/scripts/rom-audit/apply-basic-read-hook.py" "$root/scripts/rom-audit/apply-digital-screen.py" "$root/scripts/rom-audit/apply-inline-filters.py" "${BASH_SOURCE[0]}"
  g++ --version | head -1
  # Bind resolved CPU features too: copying a workspace to the 14600K must
  # rebuild -march=native objects rather than reuse the 6700K's cached binary.
  g++ -march=native -Q --help=target
  printf '%s\n' "${compiler_flags[@]}" "${ROM_AUDIT_JOBS:-7}"; } | sha256sum | cut -d' ' -f1)
if [[ -x "$cache/render" && -f "$cache/stamp" && "$(cat "$cache/stamp")" == "$stamp" && -f "$cache/render.sha256" \
      && "$(sha256sum "$cache/render" | cut -d' ' -f1)" == "$(cat "$cache/render.sha256")" ]]; then
  echo "$cache/render"
  exit 0
fi
for tool in g++ make autoreconf libtoolize xa; do
  command -v "$tool" >/dev/null || { echo "Missing build prerequisite: $tool" >&2; exit 1; }
done
rm -f "$cache/stamp" "$cache/render.sha256"
build="$cache/build-${stamp:0:16}"
rm -rf "$build"; mkdir -p "$build"
tar -xf "$source_archive" -C "$build"
archive_root=$(tar -tf "$source_archive" | awk 'NR == 1 { print $0 }')
source_dir="$build/${archive_root%/}/libsidplayfp"
prefix="$build/prefix"
[[ -n "$source_dir" ]] || { echo "Cannot locate packaged libsidplayfp source" >&2; exit 1; }
(
  cd "$source_dir"
  if [[ "$capacity_guarded" == 1 ]]; then
    python3 "$(dirname "$source_dir")/libsidplayfp-wasm/scripts/apply-sidlite-buffer-guards.py" "$source_dir"
  fi
  python3 "$root/scripts/rom-audit/apply-sid-write-hook.py" "$source_dir"
  python3 "$root/scripts/rom-audit/apply-basic-read-hook.py" "$source_dir"
  python3 "$root/scripts/rom-audit/apply-digital-screen.py" "$source_dir"
  if [[ "$engine" == residfp ]]; then
    cd "$(dirname "$source_dir")/libresidfp"
    python3 "$(dirname "$source_dir")/libsidplayfp-wasm/scripts/apply-thread-guards.py" "$PWD"
    python3 "$root/scripts/rom-audit/apply-inline-filters.py" "$PWD"
    autoreconf -fi
    ./configure --disable-shared --enable-static --prefix="$prefix" --libdir="$prefix/lib" CXXFLAGS="${compiler_flags[*]}"
    make -j"${ROM_AUDIT_JOBS:-7}"
    make install
  fi
  cd "$source_dir"
  autoreconf -fi
  # Only the matching archive's optional reSIDfp is visible; never use a distro engine.
  PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig" ./configure --disable-shared --enable-static \
    --without-exsid --without-usbsid CXXFLAGS="${compiler_flags[*]}"
  make -j"${ROM_AUDIT_JOBS:-7}" src/builders/sidlite-builder/sidlite/libsidlite.la
  make -j"${ROM_AUDIT_JOBS:-7}" src/builders/sidlite-builder/libsidplayfp-sidlite.la
  if [[ "$engine" == residfp ]]; then
    make -j"${ROM_AUDIT_JOBS:-7}" src/builders/residfp-builder/libsidplayfp-residfp.la
  fi
  make src/psiddrv.bin src/sidtune/sidplayer1.bin src/sidtune/sidplayer2.bin
  make -j"${ROM_AUDIT_JOBS:-7}" src/libsidplayfp.la
) >"$build/build.log" 2>&1
link_libraries=("$source_dir/src/.libs/libsidplayfp.a")
if [[ "$engine" == residfp ]]; then
  link_libraries+=("$prefix/lib/libresidfp.a")
fi
g++ "${compiler_flags[@]}" -std=c++17 "$root/scripts/rom-audit/render.cpp" \
  -I"$source_dir/src" "${link_libraries[@]}" -o "$build/render"
cp "$build/render" "$cache/render.tmp" && mv -f "$cache/render.tmp" "$cache/render"
sha256sum "$cache/render" | cut -d" " -f1 >"$cache/render.sha256"
printf '%s' "$stamp" >"$cache/stamp"
# Drop superseded build trees (and the legacy in-place extraction).
find "$cache" -maxdepth 1 \( -name 'build-*' -a ! -name "build-${stamp:0:16}" -o -name '*-complete-source' \) -exec rm -rf {} +
echo "$cache/render"
