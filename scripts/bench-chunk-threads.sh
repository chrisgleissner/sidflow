#!/usr/bin/env bash
# Measures classification throughput per thread count, one chunk each.
#
# The 710-track microbenchmark that produced the earlier "12 threads is optimal" figure was
# not representative: on the real corpus 12 threads measured 9.49-10.08 songs/s while 8
# measured about 12.5. A short, warm, cached corpus does not reproduce the memory pressure of
# a full pass, so throughput has to be measured on real chunks.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
CHUNK="${CHUNK:-1000}"
RESULTS="logs/thread-bench-chunked.tsv"
: > "${RESULTS}"

stop_all() {
  local pid
  for pid in $(pgrep -f "run-similarity-expor""t.sh" 2>/dev/null || true); do kill "${pid}" 2>/dev/null || true; done
  sleep 3
  for pid in $(pgrep -f "sidflow-classify/src/cli""\.ts" 2>/dev/null || true); do kill "${pid}" 2>/dev/null || true; done
  sleep 2
  for pid in $(pgrep -f "next de""v" 2>/dev/null || true); do kill "${pid}" 2>/dev/null || true; done
  sleep 2
  rm -f tmp/runtime/similarity-export/.run.lock
}

for T in "$@"; do
  stop_all
  LOG="logs/bench-t${T}.log"
  nohup bash scripts/run-similarity-export.sh --mode local --threads "${T}" --chunk-songs "${CHUNK}" > "${LOG}" 2>&1 &
  # Wait for one chunk line, or give up.
  for _ in $(seq 1 90); do
    if grep -qE "^\[sidcorr\] Chunk 1:" "${LOG}" 2>/dev/null; then break; fi
    sleep 10
  done
  line="$(grep -oE "Chunk 1: .*songs/s" "${LOG}" 2>/dev/null | head -1)"
  rate="$(printf '%s' "${line}" | grep -oE '= [0-9.]+ songs/s' | grep -oE '[0-9.]+' || echo 0)"
  printf '%s\t%s\n' "${T}" "${rate}" >> "${RESULTS}"
  printf 'threads=%-3s %s\n' "${T}" "${line:-no chunk completed}"
done
stop_all
printf '\n=== fastest ===\n'
sort -k2 -gr "${RESULTS}" | head -1
