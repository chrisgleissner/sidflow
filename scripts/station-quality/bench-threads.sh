#!/usr/bin/env bash
#
# Find the classification thread count that actually maximises throughput.
#
# getRecommendedWorkerCount() caps workers at min(6, physical/2), which on a
# 14-physical-core part leaves most of the machine idle. SIDFLOW_MAX_THREADS
# overrides that ceiling, but the right value is not obviously "all of them":
# this is a hybrid CPU, the E-cores are materially slower than the P-cores, and
# the pipeline interleaves WASM rendering with feature extraction. Guessing costs
# hours on a full pass, so measure instead.
#
# Each setting re-renders the same corpus from scratch (--force-rebuild) into its
# own tree, so no run can benefit from another's WAV cache. Runs are sequential;
# overlapping them would measure contention.
#
#   bash scripts/station-quality/bench-threads.sh [threads...]

set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CORPUS="${SIDFLOW_BENCH_CORPUS:-${REPO}/workspace/engine-comparison/corpus}"
WORK="${REPO}/workspace/thread-bench"
ENGINE="${SIDFLOW_BENCH_ENGINE:-sidlite}"
THREAD_COUNTS=("$@")
if [[ ${#THREAD_COUNTS[@]} -eq 0 ]]; then
    THREAD_COUNTS=(6 12 16 20 24)
fi

[[ -d "${CORPUS}" ]] || { echo "missing corpus: ${CORPUS} (run the engine comparison first)" >&2; exit 1; }

mkdir -p "${WORK}"
RESULTS="${WORK}/results.tsv"
: >"${RESULTS}"
printf 'threads\tseconds\ttracks\ttracks_per_sec\n' >>"${RESULTS}"

echo "corpus:  ${CORPUS}"
echo "engine:  ${ENGINE}"
echo "logical: $(nproc)"
echo

for threads in "${THREAD_COUNTS[@]}"; do
    root="${WORK}/t${threads}"
    rm -rf "${root}"
    mkdir -p "${root}/data/classified" "${root}/workspace/audio-cache" "${root}/data/renders" "${root}/data/availability"

    config="${root}/.sidflow.json"
    python3 - "${REPO}/.sidflow.json" "${config}" "${CORPUS}" "${root}" <<'PY'
import json, sys
base, out, corpus, root = sys.argv[1:5]
cfg = json.load(open(base))
cfg["sidPath"] = corpus
cfg["classifiedPath"] = f"{root}/data/classified"
cfg["audioCachePath"] = f"{root}/workspace/audio-cache"
cfg.setdefault("render", {})["outputPath"] = f"{root}/data/renders"
cfg.setdefault("availability", {})["assetRoot"] = f"{root}/data/renders"
cfg["availability"]["manifestPath"] = f"{root}/data/availability/streams.json"
json.dump(cfg, open(out, "w"), indent=2)
PY

    started=$(date +%s.%N)
    SIDFLOW_MAX_THREADS="${threads}" SIDFLOW_SID_ENGINE="${ENGINE}" \
        bash "${REPO}/scripts/sidflow-classify" \
        --config "${config}" --sid-engine "${ENGINE}" --force-rebuild \
        >"${root}/classify.log" 2>&1
    ended=$(date +%s.%N)

    elapsed=$(python3 -c "print(f'{${ended} - ${started}:.1f}')")
    tracks=$(cat "${root}"/data/classified/features_*.jsonl 2>/dev/null | wc -l | tr -d ' ')
    rate=$(python3 -c "print(f'{${tracks} / ${elapsed}:.2f}')")
    printf '%s\t%s\t%s\t%s\n' "${threads}" "${elapsed}" "${tracks}" "${rate}" >>"${RESULTS}"
    printf '%-3s threads: %8ss  %5s tracks  %6s tracks/s\n' "${threads}" "${elapsed}" "${tracks}" "${rate}"

    # The WAV cache for a full corpus is large; keep only the numbers.
    rm -rf "${root}/workspace/audio-cache" "${root}/data/renders"
done

echo
echo "results: ${RESULTS}"
sort -t$'\t' -k4 -g -r "${RESULTS}" | head -3
