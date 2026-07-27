#!/usr/bin/env bash
#
# Classify one fixed corpus with each SID engine, in isolation, and record how
# long each took.
#
# Both runs see byte-identical inputs and differ only in SIDFLOW_SID_ENGINE, so
# any difference downstream is attributable to the emulation. Each engine gets
# its own classified/, audio-cache/ and renders/ directory: sharing them would
# let the second run reuse the first run's WAVs and silently compare an engine
# against itself.
#
# The runs are sequential, never concurrent — the wall-clock times feed a
# throughput ratio, and overlapping them would measure contention instead.
#
#   bash scripts/engine-comparison/run-comparison.sh [corpus.json]

set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CORPUS_MANIFEST="${1:-${REPO}/scripts/engine-comparison/corpus-500.json}"
WORK="${REPO}/workspace/engine-comparison"
HVSC_ROOT="${SIDFLOW_HVSC_ROOT:-${REPO}/workspace/hvsc/C64Music}"

[[ -f "${CORPUS_MANIFEST}" ]] || { echo "missing corpus manifest: ${CORPUS_MANIFEST}" >&2; exit 1; }
[[ -d "${HVSC_ROOT}" ]] || { echo "missing HVSC: ${HVSC_ROOT}" >&2; exit 1; }

echo "==> Materialising corpus"
CORPUS_DIR="${WORK}/corpus"
rm -rf "${CORPUS_DIR}"
mkdir -p "${CORPUS_DIR}/C64Music"
# A missing file is tolerated but reported, never silently dropped. HVSC updates
# rename and retire tunes, so a selection committed against one release will
# always drift against a later one; crashing on the first absence makes the whole
# comparison unrunnable over a single moved file. Erosion past 2% aborts instead,
# because by then the corpus is no longer the one the published numbers describe.
python3 - "${CORPUS_MANIFEST}" "${HVSC_ROOT}" "${CORPUS_DIR}/C64Music" <<'PY'
import json, os, shutil, sys
manifest, hvsc, dest = sys.argv[1:4]
files = json.load(open(manifest))["files"]
copied, missing = 0, []
for rel in files:
    src = os.path.join(hvsc, rel)
    if not os.path.exists(src):
        missing.append(rel)
        continue
    dst = os.path.join(dest, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    copied += 1
print(f"copied {copied} SID files")
if missing:
    print(f"WARNING: {len(missing)} of {len(files)} selected files are absent from this HVSC:")
    for rel in missing:
        print(f"  missing: {rel}")
    if len(missing) > 0.02 * len(files):
        sys.exit(f"aborting: {len(missing)/len(files):.1%} of the corpus is missing; re-select with select-corpus.ts")
PY

run_engine() {
    local engine="$1"
    local root="${WORK}/${engine}"

    echo
    echo "==> Classifying with ${engine}"
    rm -rf "${root}"
    mkdir -p "${root}/data/classified" "${root}/workspace/audio-cache" "${root}/data/renders"

    local config="${root}/.sidflow.json"
    python3 - "${REPO}/.sidflow.json" "${config}" "${CORPUS_DIR}" "${root}" <<'PY'
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

    local started
    started=$(date +%s.%N)
    SIDFLOW_SID_ENGINE="${engine}" \
        bash "${REPO}/scripts/sidflow-classify" \
        --config "${config}" \
        --sid-engine "${engine}" \
        --force-rebuild \
        >"${root}/classify.log" 2>&1
    local ended
    ended=$(date +%s.%N)

    local elapsed
    elapsed=$(python3 -c "print(f'{${ended} - ${started}:.1f}')")
    echo "${engine}: ${elapsed}s" | tee "${root}/elapsed.txt"

    # Export so the analysis has neighbours to compare, not just features.
    bash -c "cd '${REPO}' && bun run export:similarity -- \
        --config '${config}' \
        --profile full \
        --neighbors 10 \
        --corpus-version 'engine-${engine}' \
        --output '${root}/export.sqlite'" >>"${root}/classify.log" 2>&1

    echo "${engine}: export written to ${root}/export.sqlite"
}

# Sequential, and reSIDfp first so the slower engine is not the one competing
# with any lingering page cache effects from the other.
run_engine residfp
run_engine sidlite

echo
echo "==> Done"
for engine in residfp sidlite; do
    printf '%-9s %s\n' "${engine}" "$(cat "${WORK}/${engine}/elapsed.txt" 2>/dev/null || echo '?')"
done
echo "Analyse with: bun run scripts/engine-comparison/analyze.ts"
