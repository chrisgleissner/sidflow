#!/usr/bin/env bash
#
# Classify the development corpus and export it, into an isolated tree.
#
# Run repeatedly: feature work means re-classifying the same corpus and comparing
# paired against the previous run, so each run gets its own root and nothing is
# shared. Sharing the audio cache between runs would let a later run silently
# reuse an earlier run's WAVs and compare a feature set against itself.
#
#   bash scripts/station-quality/classify-dev-corpus.sh <label> [engine] [threads]
#
# Writes workspace/station-opt/<label>/{classify.log,export.sqlite,elapsed.txt}.

set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LABEL="${1:?usage: classify-dev-corpus.sh <label> [engine] [threads]}"
ENGINE="${2:-residfp}"
THREADS="${3:-12}"
MANIFEST="${SIDFLOW_DEV_CORPUS:-${REPO}/scripts/station-quality/dev-corpus.json}"
HVSC_ROOT="${SIDFLOW_HVSC_ROOT:-${REPO}/workspace/hvsc/C64Music}"
ROOT="${REPO}/workspace/station-opt/${LABEL}"
CORPUS_DIR="${REPO}/workspace/station-opt/corpus"

[[ -f "${MANIFEST}" ]] || { echo "missing corpus manifest: ${MANIFEST}" >&2; exit 1; }
[[ -d "${HVSC_ROOT}" ]] || { echo "missing HVSC: ${HVSC_ROOT}" >&2; exit 1; }

# The materialised corpus is shared across runs and is pure input, so it is built
# once. Re-materialising costs nothing but would mask a manifest change.
if [[ ! -f "${CORPUS_DIR}/.materialised" ]]; then
    echo "==> Materialising corpus"
    rm -rf "${CORPUS_DIR}"
    mkdir -p "${CORPUS_DIR}/C64Music"
    python3 - "${MANIFEST}" "${HVSC_ROOT}" "${CORPUS_DIR}/C64Music" <<'PY'
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
    print(f"WARNING: {len(missing)} of {len(files)} selected files are absent from this HVSC")
    if len(missing) > 0.02 * len(files):
        sys.exit("aborting: too much of the corpus is missing; re-select it")
PY
    touch "${CORPUS_DIR}/.materialised"
else
    echo "==> Reusing materialised corpus at ${CORPUS_DIR}"
fi

echo "==> Classifying '${LABEL}' with ${ENGINE} on ${THREADS} threads"
rm -rf "${ROOT}"
mkdir -p "${ROOT}/data/classified" "${ROOT}/workspace/audio-cache" "${ROOT}/data/renders" "${ROOT}/data/availability"

CONFIG="${ROOT}/.sidflow.json"
python3 - "${REPO}/.sidflow.json" "${CONFIG}" "${CORPUS_DIR}" "${ROOT}" "${THREADS}" <<'PY'
import json, sys
base, out, corpus, root, threads = sys.argv[1:6]
cfg = json.load(open(base))
cfg["sidPath"] = corpus
cfg["classifiedPath"] = f"{root}/data/classified"
cfg["audioCachePath"] = f"{root}/workspace/audio-cache"
cfg.setdefault("render", {})["outputPath"] = f"{root}/data/renders"
cfg.setdefault("availability", {})["assetRoot"] = f"{root}/data/renders"
cfg["availability"]["manifestPath"] = f"{root}/data/availability/streams.json"
cfg["threads"] = int(threads)
json.dump(cfg, open(out, "w"), indent=2)
PY

started=$(date +%s.%N)
SIDFLOW_MAX_THREADS="${THREADS}" SIDFLOW_SID_ENGINE="${ENGINE}" \
    bash "${REPO}/scripts/sidflow-classify" \
    --config "${CONFIG}" --sid-engine "${ENGINE}" --force-rebuild \
    >"${ROOT}/classify.log" 2>&1
ended=$(date +%s.%N)
python3 -c "print(f'{${ended} - ${started}:.1f}')" >"${ROOT}/elapsed.txt"
echo "==> Classified in $(cat "${ROOT}/elapsed.txt")s"

echo "==> Exporting with neighbours"
(cd "${REPO}" && bun run export:similarity -- \
    --config "${CONFIG}" \
    --profile full \
    --neighbors 25 \
    --corpus-version "dev-${LABEL}" \
    --output "${ROOT}/export.sqlite") >>"${ROOT}/classify.log" 2>&1

TRACKS=$(cat "${ROOT}"/data/classified/features_*.jsonl 2>/dev/null | wc -l | tr -d ' ')
echo "==> Done: ${TRACKS} tracks -> ${ROOT}/export.sqlite"
