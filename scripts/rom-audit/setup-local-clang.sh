#!/usr/bin/env bash
# Ubuntu development helper: unpack Clang into workspace, without sudo or a
# system package installation. Requires the host's matching libclang-cpp/LLVM.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cache="$root/workspace/rom-audit-clang"
mkdir -p "$cache"
cd "$cache"
apt-get download clang-21 libclang-common-21-dev
for archive in ./*.deb; do dpkg-deb -x "$archive" "$cache"; done
"$cache/usr/bin/clang++-21" --version
