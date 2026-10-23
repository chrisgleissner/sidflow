# Run the HVSC 85 listener-relevant ROM audit

The goal is a full census within 16 hours on a 14600K. Run the benchmark on that
machine first; a different CPU's speed or the deliberately adversarial pilot is
not sufficient evidence for this budget.

```sh
git clone git@github.com:chrisgleissner/sidflow.git && cd sidflow
git checkout feat/hvsc-rom-audit-methodology-3
set -o pipefail
bash scripts/rom-audit/run-full.sh 2>&1 | tee -a rom-audit-run.log
```

Linux prerequisites: Bun 1.3.x, Node, npm, git, around 5 GB disk and enough RAM
for the requested workers. The scripts install locked packages and fetch inputs.
HVSC 85 is required: 61,157 SID files, 87,868 subtunes, corpus identity
`4b66fe03e72e18155ee4e14a0a7fd3f2c4de2ed1a467296156d5642e716f132e`.
When a newer release exists, supply HVSC 85 at `workspace/hvsc/C64Music` first.

Stages are `setup`, `bench`, `pilot`, `harden`, `full`, `publish`. Setup verifies
source approval before qualification. The benchmark renders 80 stratified
subtunes from the complete verified corpus using the same listener classifier,
workers and repeat sampling as the full census. It writes
`workspace/rom-audit-benchmark.json`: actual CPU, workers, corpus/source/engine
identities, per-job timings, population weights and projected hours with a 15%
margin. Benchmark samples are reserved in the same 5% rollout ledger as pilots.

The budget gate defaults to **15 hours for the census**, leaving one hour within
the requested 16-hour target. Setup and hardening are additional prerequisites;
they include three full test suites and should be done before timing the census.
The gate stops on a larger projection. `ROM_AUDIT_IGNORE_BENCHMARK=1` explicitly
bypasses only that budget rejection; it never bypasses a broken benchmark.
Neither the projection nor its margin guarantees the eventual runtime.

Use `ROM_AUDIT_WORKERS=N` to choose workers (default logical CPUs minus one),
`ROM_AUDIT_MAX_HOURS=H` for the budget, `ROM_AUDIT_STAGE_ONLY=bench` for one stage,
and `ROM_AUDIT_RETRY_FAILURES=1` to retry failed jobs. The same command resumes
checkpoints after interruption. Source/profile changes require a new run directory
and qualification; old exact-comparison v3 data cannot be resumed as listener data.

The pilot lives in `workspace/rom-audit-v4`, with 567 selected subtunes and a
sampled reference repeat. Hardening refuses failed jobs and unresolved measured
results for either supported ROM set. Full execution remains gated on a completed
source-bound certificate. Check current approval and validation in
[the review](hvsc-rom-adversarial-review.md).

```sh
tail -n 3 rom-audit-run.log
cat workspace/rom-audit-full/coverage.json
```

Publication is `workspace/rom-audit-full/published/`. Its manifest reports measured,
failed and pending subtunes; a complete successful census has zero failed and
zero pending. Copy it to `doc/research/hvsc-rom-catalogue/v4/` to update the
maintained snapshot and run the exhaustive lookup test. Horizons above one hour
are left pending rather than silently shortened (HVSC 85's verified maximum is
2,031.332 seconds).

Results answer whether missing ROMs cause listener-relevant differences on the
pinned SIDLite engine. Tiny timing changes are accepted. **Consumers must zero
absent banks before creating a player**, use the tested profile/model and stop at
the measured horizon. See [the methodology and thresholds](hvsc-rom-production.md).
No coverage of another renderer, actual hardware fidelity or indefinite looping
is implied.
