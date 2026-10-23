#!/usr/bin/env bash
# Run the complete HVSC 85 ROM census on this machine, from a fresh clone.
#
#   git clone git@github.com:chrisgleissner/sidflow.git && cd sidflow \
#     && git checkout <branch-or-tag> && bash scripts/rom-audit/run-full.sh 2>&1 | tee -a rom-audit-run.log
#
# Idempotent: re-run the identical command to resume after an interruption (every stage
# checkpoints; a finished stage is skipped quickly). Environment:
#   ROM_AUDIT_WORKERS      worker processes (default: logical CPUs - 1)
#   ROM_AUDIT_ENGINES      renderers to qualify, comma separated (default: sidlite; reSIDfp is about 6x as expensive)
#   ROM_AUDIT_STAGE_ONLY   run just one stage: setup|pilot|harden|full|publish
# See doc/research/hvsc-rom-full-run.md for what each stage proves and what to read afterwards.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
workers=${ROM_AUDIT_WORKERS:-$(( $(nproc) - 1 ))}
(( workers >= 1 )) || workers=1
engines=${ROM_AUDIT_ENGINES:-sidlite}
hvsc=workspace/hvsc/C64Music
roms=workspace/roms
pilot=workspace/rom-audit-v3
full=workspace/rom-audit-full
evidence=workspace/rom-audit-hardening
review=doc/research/hvsc-rom-adversarial-review.md
expected_corpus=4b66fe03e72e18155ee4e14a0a7fd3f2c4de2ed1a467296156d5642e716f132e
log() { printf '\n[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
only=${ROM_AUDIT_STAGE_ONLY:-}
want() { [[ -z "$only" || "$only" == "$1" ]]; }

if want setup; then
  log "setup: prerequisites, dependencies, HVSC 85, ROMs, approval"
  for tool in bun git; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool (see doc/research/hvsc-rom-full-run.md)" >&2; exit 1; }; done
  bun install --frozen-lockfile
  [[ -d "$hvsc" ]] || bash scripts/sidflow-fetch
  bun run roms:fetch
  corpus=$(bun -e 'import {corpusIdentity} from "./scripts/rom-audit/inputs.ts"; console.log(await corpusIdentity(process.argv[1]))' "$hvsc")
  [[ "$corpus" == "$expected_corpus" ]] || { echo "Corpus identity $corpus differs from the verified HVSC 85 release $expected_corpus" >&2; exit 1; }
  echo "corpus verified: $corpus"
  # Fail in seconds, not after hours, if the sources are not the ones the architect approved.
  identity=$(bun scripts/rom-audit/harden.ts --identity)
  grep -q "^Approved-source-identity: $identity$" "$review" || { echo "No architect approval for source identity $identity in $review" >&2; exit 1; }
  echo "architect approval present for source identity $identity"
fi

if want pilot; then
  log "pilot: reviewed stratified selection (at most 5%), engines: $engines"
  bun scripts/rom-audit/select-pilot.ts "$hvsc" workspace/rom-audit-v3-selection.json
  bun scripts/rom-audit/audit.ts --hvsc "$hvsc" --roms "$roms" --out "$pilot" --workers "$workers" --seconds 10 \
    --rollout pilot --selection workspace/rom-audit-v3-selection.json --engines "$engines"
fi

if want harden; then
  log "harden: decision regression, pilot checks, reproducibility, three focused runs and three complete test suites"
  bun scripts/rom-audit/harden.ts --hvsc "$hvsc" --roms "$roms" --pilot "$pilot" --review "$review" --out "$evidence"
fi

if want full; then
  log "full: every subtune at its documented horizon (resumable)"
  bun scripts/rom-audit/audit.ts --hvsc "$hvsc" --roms "$roms" --out "$full" --workers "$workers" --seconds 10 \
    --rollout full --hardening "$evidence/certificate.json" --engines "$engines"
fi

if want publish; then
  log "publish: dataset and report"
  bun scripts/rom-audit/publish.ts --production "$full" "$full/published"
  cat "$full/coverage.json"
  echo "Dataset: $full/published (manifest.json, deny-list.<engine>.json, research.jsonl.gz, census.jsonl.gz)"
  echo "Copy $full/published into doc/research/hvsc-rom-catalogue/v3/ to commit it; see doc/research/hvsc-rom-full-run.md"
fi
log "stage(s) finished"
