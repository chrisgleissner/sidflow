#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${EMSDK:-}" && -f "${EMSDK}/emsdk_env.sh" ]]; then
    source "${EMSDK}/emsdk_env.sh" >/dev/null
elif [[ -f /emsdk/emsdk_env.sh ]]; then
  source /emsdk/emsdk_env.sh >/dev/null
elif [[ -f /opt/emsdk/emsdk_env.sh ]]; then
  source /opt/emsdk/emsdk_env.sh >/dev/null
else
    echo "emsdk environment script not found" >&2
    exit 1
fi

BUILD_ROOT=/tmp/libsidplayfp
RESIDFP_BUILD_ROOT=/tmp/libresidfp
OUTPUT_ROOT=/dist
CACHE_ROOT=/opt/libsidplayfp-cache
CACHE_REPO="${CACHE_ROOT}/repo"
RESIDFP_CACHE_REPO="${CACHE_ROOT}/residfp"

# Where the cross-compiled libresidfp is installed so that libsidplayfp's
# `PKG_CHECK_MODULES([RESIDFP], ...)` can find it during emconfigure.
SYSROOT_PREFIX=/opt/wasm-sysroot

rm -rf "${BUILD_ROOT}" "${RESIDFP_BUILD_ROOT}"
mkdir -p "${BUILD_ROOT}" "${RESIDFP_BUILD_ROOT}" "${OUTPUT_ROOT}" "${CACHE_ROOT}" "${SYSROOT_PREFIX}"

GIT_URL="https://github.com/libsidplayfp/libsidplayfp"
RESIDFP_GIT_URL="https://github.com/libsidplayfp/libresidfp"

# Pin upstream. This used to track master and `reset --hard origin/master` on
# every run, so the artifact silently changed with upstream and was not
# reproducible. v3.0.2 is the current stable release (2026-06-21); the build was
# previously stuck on the v3.0.0a2 *pre-release alpha*. Override with
# LIBSIDPLAYFP_REF to try another — and update bindings.cpp if the API moved.
LIBSIDPLAYFP_REF="${LIBSIDPLAYFP_REF:-v3.0.2}"

# Since libsidplayfp v3.x the reSIDfp engine lives in this separate library.
# libsidplayfp v3.0.2 requires >= 1.0.0.
LIBRESIDFP_REF="${LIBRESIDFP_REF:-v1.1.2}"

# Which SID emulation the artifact is built with.
#
#   residfp  (default) cycle-accurate, what a C64 actually sounds like
#   sidlite            a fast approximation, ~2 orders of magnitude cheaper
#
# libresidfp is cross-compiled either way: SIDLite lives inside libsidplayfp
# itself, and building both keeps the two artifacts identical apart from the
# emulation, which is the whole point of being able to compare them.
SIDFLOW_SID_ENGINE="${SIDFLOW_SID_ENGINE:-residfp}"
case "${SIDFLOW_SID_ENGINE}" in
    residfp | sidlite) ;;
    *)
        echo "SIDFLOW_SID_ENGINE must be residfp or sidlite, got: ${SIDFLOW_SID_ENGINE}" >&2
        exit 1
        ;;
esac
echo "SID engine: ${SIDFLOW_SID_ENGINE}"

sync_repo() {
    local url="$1" dest="$2" ref="$3"
    if [[ ! -d "${dest}/.git" ]]; then
        git clone --recurse-submodules "${url}" "${dest}"
    else
        git -C "${dest}" fetch --tags origin
    fi
    git -C "${dest}" checkout --force "${ref}"
    git -C "${dest}" submodule update --init --recursive
}

# ---------------------------------------------------------------------------
# 1. Cross-compile libresidfp, the actual SID emulation.
#
# Without this, libsidplayfp's configure leaves HAVE_RESIDFP undefined and the
# bindings silently fall back to SIDLite — a fast approximation that measurably
# does not sound like a C64. bindings.cpp now #errors in that case, so this step
# is load-bearing rather than an optimisation.
# ---------------------------------------------------------------------------
sync_repo "${RESIDFP_GIT_URL}" "${RESIDFP_CACHE_REPO}" "${LIBRESIDFP_REF}"
echo "libresidfp pinned at ${LIBRESIDFP_REF} ($(git -C "${RESIDFP_CACHE_REPO}" rev-parse --short HEAD))"

rsync -a --delete "${RESIDFP_CACHE_REPO}/" "${RESIDFP_BUILD_ROOT}/"
cd "${RESIDFP_BUILD_ROOT}"

# reSIDfp builds its filter tables on helper threads. These sources used to live
# in libsidplayfp; since v3.x they are here, which is why the guard has to be
# applied to this tree too.
python3 /opt/libsidplayfp-wasm/scripts/apply-thread-guards.py "${RESIDFP_BUILD_ROOT}"

# Diagnostic knob: e.g. SIDFLOW_EXTRA_FLAGS="-fsanitize=address" instruments the
# whole stack so an out-of-bounds access inside the emulation is reported with a
# stack trace instead of showing up as mysteriously wrong audio.
EXTRA_FLAGS="${SIDFLOW_EXTRA_FLAGS:-}"
if [[ -n "${EXTRA_FLAGS}" ]]; then
    echo "extra build flags: ${EXTRA_FLAGS}"
fi

autoreconf -vfi
emconfigure ./configure \
    --prefix="${SYSROOT_PREFIX}" \
    --disable-shared \
    --enable-static \
    --disable-dependency-tracking \
    CFLAGS="-O3 ${EXTRA_FLAGS}" \
    CXXFLAGS="-O3 ${EXTRA_FLAGS}"
# libresidfp's configure hard-codes `-ffast-math -fno-unsafe-math-optimizations`
# into RESIDFP_CXXFLAGS (configure.ac), and appends them after any value passed
# in, so they cannot be overridden on the configure line. Rewriting the
# generated Makefile is the only way to vary them — which matters because the
# wasm artifact measures ~10 dB brighter above 3 kHz than a native build of the
# identical source, and the fast-math family is the leading suspect.
if [[ -n "${SIDFLOW_RESIDFP_MATH_FLAGS:-}" ]]; then
    echo "overriding libresidfp math flags: ${SIDFLOW_RESIDFP_MATH_FLAGS}"
    find . -name Makefile -exec sed -i "s|^RESIDFP_CXXFLAGS = .*|RESIDFP_CXXFLAGS = ${SIDFLOW_RESIDFP_MATH_FLAGS}|" {} +
fi

emmake make -j"$(nproc)"
emmake make install

export PKG_CONFIG_PATH="${SYSROOT_PREFIX}/lib/pkgconfig${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"

if ! pkg-config --exists libresidfp; then
    echo "libresidfp was built but pkg-config cannot see it in ${PKG_CONFIG_PATH}" >&2
    exit 1
fi
echo "pkg-config sees libresidfp $(pkg-config --modversion libresidfp)"

# ---------------------------------------------------------------------------
# 2. Cross-compile libsidplayfp against it.
# ---------------------------------------------------------------------------
sync_repo "${GIT_URL}" "${CACHE_REPO}" "${LIBSIDPLAYFP_REF}"
echo "libsidplayfp upstream pinned at ${LIBSIDPLAYFP_REF} ($(git -C "${CACHE_REPO}" rev-parse --short HEAD))"

rsync -a --delete "${CACHE_REPO}/" "${BUILD_ROOT}/"

cd "${BUILD_ROOT}"

git submodule update --init --recursive

python3 /opt/libsidplayfp-wasm/scripts/apply-thread-guards.py "${BUILD_ROOT}"
python3 /opt/libsidplayfp-wasm/scripts/apply-sid-write-hook.py "${BUILD_ROOT}"

if grep -q 'AC_MSG_ERROR("pthreads not found")' configure.ac; then
    sed -i 's/AX_PTHREAD(\[\], \[AC_MSG_ERROR("pthreads not found")\])/AX_PTHREAD([], [])/' configure.ac
fi

autoreconf -vfi

emconfigure ./configure \
    --disable-shared \
    --enable-static \
    --without-gcrypt \
    --without-exsid \
    --without-usbsid \
    --disable-dependency-tracking \
    CFLAGS="-O3 ${EXTRA_FLAGS}" \
    CXXFLAGS="-O3 ${EXTRA_FLAGS}" \
    RESIDFP_CFLAGS="$(pkg-config --cflags libresidfp)" \
    RESIDFP_LIBS="$(pkg-config --libs libresidfp)"

# configure only warns when libresidfp is missing, so assert the result rather
# than discovering it later in `strings` output.
if ! grep -q '^#define HAVE_RESIDFP 1' src/config.h 2>/dev/null && \
   ! grep -q '^#define HAVE_RESIDFP 1' config.h 2>/dev/null; then
    echo "configure did not define HAVE_RESIDFP — libsidplayfp would build without reSIDfp" >&2
    exit 1
fi
echo "HAVE_RESIDFP is defined; libsidplayfp will build the reSIDfp builder"

emmake make -j"$(nproc)"

cp /opt/libsidplayfp-wasm/src/bindings/bindings.cpp "${BUILD_ROOT}/"

ENGINE_FLAGS=""
if [[ "${SIDFLOW_SID_ENGINE}" == "sidlite" ]]; then
    ENGINE_FLAGS="-DSIDFLOW_SID_ENGINE_SIDLITE=1"
fi

em++ bindings.cpp src/.libs/libsidplayfp.a \
    ${ENGINE_FLAGS} \
    -I./src \
    -I./src/sidplayfp \
    -I./src/sidtune \
    -I./src/builders/sidlite-builder \
    -I./src/builders/residfp-builder \
    $(pkg-config --cflags libresidfp) \
    $(pkg-config --libs libresidfp) \
    ${EXTRA_FLAGS} \
    --bind -O3 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="createLibsidplayfp" \
    -sEXPORT_ES6=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sDISABLE_EXCEPTION_CATCHING=0 \
    -sFORCE_FILESYSTEM=1 \
    -sASSERTIONS=1 \
  -sENVIRONMENT=web,worker,node \
    -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='[$ccall,$cwrap]' \
    -sEXPORTED_RUNTIME_METHODS='[FS,PATH,cwrap,ccall]' \
    -o "${OUTPUT_ROOT}/libsidplayfp.js"

# ---------------------------------------------------------------------------
# 3. Assert the artifact really is what we think it is.
#
# For a long time every published artifact was silently SIDLite because
# HAVE_RESIDFP was never defined. Check the built binary, not the build inputs,
# so this cannot regress unnoticed again.
# ---------------------------------------------------------------------------
# Materialise the symbol dump first: piping `strings` into `grep -q` makes grep
# exit on the first match, which SIGPIPEs strings, which under `set -o pipefail`
# reports the pipeline as failed even though the match succeeded.
ARTIFACT_SYMBOLS=$(strings "${OUTPUT_ROOT}/libsidplayfp.wasm")

if [[ "${SIDFLOW_SID_ENGINE}" == "residfp" ]]; then
    WANT_BUILDER="WasmReSIDfp"
    UNWANTED_BUILDER="WasmSIDLite"
else
    WANT_BUILDER="WasmSIDLite"
    UNWANTED_BUILDER="WasmReSIDfp"
fi

if ! grep -q "${WANT_BUILDER}" <<<"${ARTIFACT_SYMBOLS}"; then
    echo "ARTIFACT CHECK FAILED: libsidplayfp.wasm does not contain ${WANT_BUILDER}" >&2
    exit 1
fi
if grep -q "${UNWANTED_BUILDER}" <<<"${ARTIFACT_SYMBOLS}"; then
    echo "ARTIFACT CHECK FAILED: libsidplayfp.wasm also contains ${UNWANTED_BUILDER}; the artifact is not a pure ${SIDFLOW_SID_ENGINE} build" >&2
    exit 1
fi
echo "artifact check: ${SIDFLOW_SID_ENGINE} confirmed (${WANT_BUILDER}), ${UNWANTED_BUILDER} absent"

# ...and that it actually renders. A strings check proves what was linked, not
# that it works: reSIDfp's filter-table threads threw at load time in exactly
# this configuration, producing an artifact that passed every static check and
# emitted no samples at all.
node /opt/libsidplayfp-wasm/scripts/smoke-render.mjs "${OUTPUT_ROOT}" /opt/libsidplayfp-wasm/test-tone-c4.sid

cp COPYING "${OUTPUT_ROOT}/LICENSE"

cat <<'JSON' >"${OUTPUT_ROOT}/package.json"
{
  "name": "libsidplayfp-wasm",
  "version": "0.1.0",
  "description": "WebAssembly build of libsidplayfp with embind bindings for TypeScript projects.",
  "type": "module",
  "main": "./libsidplayfp.js",
  "module": "./libsidplayfp.js",
  "types": "./libsidplayfp.d.ts",
  "sideEffects": false
}
JSON

cat <<'DTS' >"${OUTPUT_ROOT}/libsidplayfp.d.ts"
export interface SidPlayerContextOptions {
  locateFile?(path: string, prefix?: string): string | URL;
  [key: string]: unknown;
}

export type SidTuneInfo = Record<string, unknown> | null;
export type EngineInfo = Record<string, unknown> | null;

export class SidPlayerContext {
  constructor();
  configure(sampleRate: number, stereo: boolean): boolean;
  loadSidBuffer(buffer: Uint8Array | ArrayBufferView): boolean;
  loadSidFile(path: string): boolean;
  selectSong(song: number): number;
  render(cycles: number): Int16Array | null;
  reset(): boolean;
  hasTune(): boolean;
  isStereo(): boolean;
  getChannels(): number;
  getSampleRate(): number;
  getTuneInfo(): SidTuneInfo;
  getEngineInfo(): EngineInfo;
  getLastError(): string;
  setSystemROMs(
    kernal?: Uint8Array | ArrayBufferView | null,
    basic?: Uint8Array | ArrayBufferView | null,
    chargen?: Uint8Array | ArrayBufferView | null
  ): boolean;
}

export interface LibsidplayfpWasmModule {
  FS: any;
  PATH: any;
  SidPlayerContext: typeof SidPlayerContext;
}

export default function createLibsidplayfp(moduleConfig?: SidPlayerContextOptions): Promise<LibsidplayfpWasmModule>;
DTS

cat <<'MD' >"${OUTPUT_ROOT}/README.md"
# libsidplayfp WebAssembly Build

This bundle is produced by the Docker build located in `packages/libsidplayfp-wasm/`. It exposes
`SidPlayerContext` through an embind wrapper so you can drive the C64 SID player
from JavaScript or TypeScript.

## Quick Start

```ts
import createLibsidplayfp from "./libsidplayfp.js";

const module = await createLibsidplayfp();
const player = new module.SidPlayerContext();

const response = await fetch("Team_Patrol.sid");
const buffer = new Uint8Array(await response.arrayBuffer());

if (!player.loadSidBuffer(buffer)) {
  throw new Error(player.getLastError());
}

const samples = player.render(20000); // Int16Array with PCM samples
```

The generated module supports both browsers and Node.js. When using filesystem
paths, mount files into Emscripten's virtual FS (`FS`).
MD

rm -rf "${BUILD_ROOT}"
