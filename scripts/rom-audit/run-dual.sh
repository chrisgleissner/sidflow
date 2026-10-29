#!/usr/bin/env bash
# Prepare, qualify, benchmark and run both HVSC85 ROM classifiers, resuming safely.
# From an installed checkout: bash scripts/rom-audit/run-dual.sh
# ROM_AUDIT_WORKERS=N, ROM_AUDIT_MAX_HOURS=12 (hard command budget; maximum 24),
# ROM_AUDIT_OUT=workspace/rom-audit-dual, ROM_AUDIT_STAGE_ONLY=setup|qualify|bench|full.
# ROM_AUDIT_SAMPLE_CLOCK=1 selects the separately qualified accelerated backend.
# Budget projection is measured on the executing CPU; it is not a completion guarantee.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
started=$(date +%s)
workers=${ROM_AUDIT_WORKERS:-$(( $(nproc) - 1 ))}
((workers>0)) || workers=1
maximum=${ROM_AUDIT_MAX_HOURS:-12}
out=${ROM_AUDIT_OUT:-workspace/rom-audit-dual}
only=${ROM_AUDIT_STAGE_ONLY:-}
case "$only" in ''|setup|qualify|bench|full) ;; *) echo "Unknown ROM_AUDIT_STAGE_ONLY: $only" >&2; exit 1;; esac
# Bound setup and qualification too, including every descendant process. The
# census reserves a minute for publication; this outer watchdog is the fallback
# when an earlier phase stalls. Its five-second kill grace fits inside the budget.
budget_seconds=$(node -e 'const h=Number(process.argv[1]);if(!Number.isFinite(h)||h*3600<=5||h>24)throw Error("ROM_AUDIT_MAX_HOURS must be >5 seconds and <=24 hours");process.stdout.write(String(Math.floor(h*3600)-5))' "$maximum")
if [[ ${ROM_AUDIT_BUDGET_WRAPPED:-0} != 1 ]]; then
  command -v timeout >/dev/null || { echo "Missing prerequisite: timeout (GNU coreutils)" >&2; exit 1; }
  exec timeout --signal=TERM --kill-after=5s "${budget_seconds}s" env ROM_AUDIT_BUDGET_WRAPPED=1 bash "$root/scripts/rom-audit/run-dual.sh"
fi
want(){ [[ -z "$only" || "$only" == "$1" ]]; }
if want setup; then
  for tool in bun node npm git python3 g++ make autoreconf libtoolize pkg-config xa; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }; done
  # All Bun processes, including the census workers spawned through
  # process.execPath, must use the packageManager-pinned runtime. Newer Bun
  # releases have exhibited worker lifecycle crashes in this long-running flow.
  node scripts/run-bun.mjs install --frozen-lockfile
  node scripts/run-bun.mjs run build
  node scripts/run-bun.mjs scripts/rom-audit/fetch-hvsc85.ts --destination workspace/hvsc/C64Music
  node scripts/run-bun.mjs run roms:fetch
  for engine in sidlite residfp; do
    ROM_AUDIT_ENGINE="$engine" ROM_AUDIT_PACKAGE="$root/node_modules/libsidplayfp-wasm-audit" \
      ROM_AUDIT_BUILD_DIR="$root/workspace/rom-audit-screen-$engine" ROM_AUDIT_JOBS="$workers" bash scripts/rom-audit/build-native.sh
  done
  if [[ ${ROM_AUDIT_SAMPLE_CLOCK:-0} == 1 ]]; then bash scripts/rom-audit/build-sample-clock.sh; fi
fi
if want qualify; then node scripts/run-bun.mjs scripts/rom-audit/qualify-screen.ts; fi
# Account for setup, qualification and benchmark instead of silently adding them
# to the promised command budget. Reserve one minute for final publication.
remaining(){ node -e 'const [hours,start]=process.argv.slice(1).map(Number);const left=hours-(Date.now()/1000-start+60)/3600;if(!Number.isFinite(left)||left<=0||hours>24)throw Error("Command budget exhausted/invalid");process.stdout.write(String(left))' "$maximum" "$started"; }
if want bench; then
  node scripts/run-bun.mjs scripts/rom-audit/screen-census.ts bench workspace/hvsc/C64Music workspace/roms "$out" "$workers" "$(remaining)"
fi
if want full; then
  node scripts/run-bun.mjs scripts/rom-audit/screen-census.ts full workspace/hvsc/C64Music workspace/roms "$out" "$workers" "$(remaining)"
  if [[ -n ${ROM_AUDIT_MAX_JOBS:-} ]]; then
    echo "Bounded checkpoint saved; publication remains incomplete and is not a consumer bundle. Resume without ROM_AUDIT_MAX_JOBS to classify the remaining HVSC inventory."
  else
    node scripts/run-bun.mjs scripts/rom-audit/verify-publication.ts "$out/published"
  fi
fi
