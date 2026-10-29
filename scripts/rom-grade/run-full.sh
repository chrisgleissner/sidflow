#!/usr/bin/env bash
# Grade every HVSC #85 subtune (87,868) for ROM fidelity: both engines (SIDLite, reSIDfp) x ROM sets (none, KERNAL+BASIC),
# against the same engine with all three authentic ROMs. Methodology: doc/research/hvsc-rom-fidelity-grading.md.
#
# From an installed checkout, with the native renderers (workspace/rom-audit-screen-{residfp,sidlite}/render), the ROMs
# (workspace/roms) and HVSC #85 (workspace/hvsc/C64Music) in place:
#   bash scripts/rom-grade/run-full.sh
# Environment:
#   ROM_GRADE_WORKERS=18             worker processes (one subtune each)
#   ROM_GRADE_OUT=workspace/rom-grade-full   output directory; rerunning resumes it (idempotent)
#   ROM_GRADE_MAX_HOURS=24           hard budget for the whole command (maximum 24)
#   ROM_GRADE_MAX_JOBS=N             validation only: grade a deterministic subset of N subtunes, publish nothing
#   ROM_GRADE_PROGRESS_EVERY=1000    progress.jsonl cadence
# Output: checkpoint.jsonl (append-only), progress.jsonl, scope.json, methodology.json and, once complete,
#   grading-results.jsonl (schema sidflow-rom-grading-results-1) and research-export.jsonl.gz.
# Monitor at any time: node scripts/run-bun.mjs scripts/rom-grade/summarize.ts "$ROM_GRADE_OUT"
# A checkpoint written under a different methodology identity (grader sources, renderers, ROMs, frozen options) is refused.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
started=$(date +%s)
workers=${ROM_GRADE_WORKERS:-18}
maximum=${ROM_GRADE_MAX_HOURS:-24}
out=${ROM_GRADE_OUT:-workspace/rom-grade-full}
for tool in node timeout flock df; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }; done
[[ $workers =~ ^[0-9]+$ ]] && ((workers>0)) || { echo "ROM_GRADE_WORKERS must be a positive integer" >&2; exit 1; }
budget_seconds=$(node -e 'const h=Number(process.argv[1]);if(!Number.isFinite(h)||h*3600<=5||h>24)throw Error("ROM_GRADE_MAX_HOURS must be >5 seconds and <=24 hours");process.stdout.write(String(Math.floor(h*3600)-5))' "$maximum")
if [[ ${ROM_GRADE_BUDGET_WRAPPED:-0} != 1 ]]; then
  # The whole command, every descendant included, is bounded; a resumable checkpoint survives the kill.
  exec timeout --signal=TERM --kill-after=5s "${budget_seconds}s" env ROM_GRADE_BUDGET_WRAPPED=1 bash "$root/scripts/rom-grade/run-full.sh"
fi
# Preconditions (the grader re-verifies ROM hashes, renderer hashes and the HVSC corpus identity itself).
workspace=${SIDFLOW_WORKSPACE:-$root/workspace}
[[ -d $workspace/roms ]] || workspace=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)/workspace
for file in "$workspace/rom-audit-screen-residfp/render" "$workspace/rom-audit-screen-sidlite/render" "$workspace/hvsc/C64Music/DOCUMENTS/Songlengths.md5" \
            "$workspace/roms/kernal.901227-03.bin" "$workspace/roms/basic.901226-01.bin" "$workspace/roms/characters.901225-01.bin"; do
  [[ -e $file ]] || { echo "Missing prerequisite: $file (see scripts/rom-audit/run-dual.sh setup)" >&2; exit 1; }
done
mkdir -p "$out"
free_kb=$(df -Pk "$out" | awk 'NR==2{print $4}')
((free_kb > 6*1024*1024)) || { echo "Need at least 6 GiB free in $out" >&2; exit 1; }
exec 9>"$out/run.lock"
flock -n 9 || { echo "Another grading run holds $out/run.lock" >&2; exit 1; }
export ROM_GRADE_WORKERS=$workers
export SIDFLOW_WORKSPACE=$workspace
node scripts/run-bun.mjs scripts/rom-grade/full-run.ts "$out"
echo "Elapsed $(( $(date +%s) - started )) s"
