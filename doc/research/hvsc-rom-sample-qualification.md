# Sample-clock acceleration qualification

The original classifier remains the reference. The accelerated path is selectable
with `ROM_AUDIT_SAMPLE_CLOCK=1` after representative and source-bound qualification.
The candidate omits analogue synthesis only for register-screen decisions that
can be resolved from independently measured frame counts and timed SID writes.
Unresolved configurations retain the existing native PCM listener comparison.
SIDLite remains independently classified with its existing backend.

## Gates

- The isolated native build must pass its 3,200 upstream-resampler readiness checks.
- Packet/frame/timed-write controls cover PAL/NTSC, 6581/8580, delayed KERNAL,
  BASIC and CHARGEN reads, late subtunes, multiple SIDs, silent changes, dense
  writes, stateful reads and fractional final packets.
- Forced-audio synthetic controls check register grants, including CPU halts.
- The real cohort is the entire existing 320-job deterministic stratified HVSC85
  benchmark. Selection is checked against the verified full inventory. Every job
  must already be reserved in the durable ledger; no corpus expansion is allowed.
- Each sample-screen grant must agree with actual native audio. A separate A/B
  comparison must retain the production classifier's decisions and reference
  repeat policy. Any mismatch, unresolved baseline or incomplete shard fails.
- CPU comparisons include both native children and per-job coordinator CPU.
  Unchanged SIDLite work is measured once and included in both totals. These
  figures do not measure worker startup, publication or whole-corpus wall time.
- Enabling the candidate requires representative benefit and correctness, then
  source-bound qualification and a target-machine production benchmark.

## Reproduce

From a checkout with the existing verified HVSC85, ROMs and zero-failure
320-job benchmark:

```bash
bash scripts/rom-audit/build-sample-clock.sh
node scripts/run-bun.mjs scripts/rom-audit/verify-sample-clock.ts \
  workspace/roms workspace/rom-audit-sample-clock/native/render \
  workspace/sample-clock-expanded-controls.json
ROM_AUDIT_SAMPLE_CLOCK=0 node scripts/run-bun.mjs scripts/rom-audit/qualify-sample-screen.ts \
  workspace/rom-audit-dual-4/benchmark.json workspace/hvsc/C64Music \
  workspace/roms workspace/rom-audit-sample-clock/native/render \
  workspace/sample-clock-320-qualification 8
```

Run the representative A/B proof with `ROM_AUDIT_SAMPLE_CLOCK=0` so the
baseline identity is explicit. Choose a new output directory for each run; old
reports are preserved. Parallel
read-only experiments share a kernel scope lock and check existing ledger
reservations. Census writers retain exclusive locking and cannot run concurrently.
The report binds qualification sources, the sample binary and the input benchmark;
shards retain individual grant and A/B evidence. Raw reports stay in `workspace/`.

## Runtime limit

The dual launcher now accepts `ROM_AUDIT_MAX_HOURS=24`; values above 24 hours
are rejected. The default remains 12 hours. Setup, qualification and benchmarking
count toward the invocation budget, with one minute reserved for publication.
The time limit does not waive the representative benchmark or qualification gates.

## Representative result (2026-10-28)

The complete 320-job cohort passed: all A/B decisions matched, with zero unknowns,
zero errors and 467 compatibility grants independently verified against native
audio. Sources and sample binary stayed unchanged throughout the 2,308.51-second
run. Weighted dual-engine CPU work fell from 523.83 to 249.04 core-hours, a
52.46% reduction. These are population-weighted CPU estimates, not observed
whole-corpus elapsed times. The per-job comparison includes coordinator CPU;
worker startup and publication are excluded. Unchanged SIDLite work is included
in both totals. The [compact measured report](hvsc-rom-sample-qualification.json)
retains hashes, strata and costs; raw per-tune evidence remains local.

Earlier attempts exposed exclusive-lock contention and fractional process timeout
milliseconds. Both were fixed and the complete cohort was rerun from frozen
sources. Neither incomplete attempt supplies qualification evidence.

## Select the accelerated classifier

Keep the complete proof directory, including the twenty shard reports and logs.
Qualification rechecks its candidate-source hashes, original measurement identity,
native binaries, full cohort coverage and evidence of a CPU benefit. Changes to
those inputs require a fresh representative run. The thin worker adapter is also
checked against the original classifier on synthetic and real controls.

```bash
ROM_AUDIT_SAMPLE_CLOCK=1 \
  ROM_AUDIT_SAMPLE_PROOF=workspace/sample-clock-320-qualification \
  ROM_AUDIT_MAX_HOURS=24 ROM_AUDIT_WORKERS=19 \
  ROM_AUDIT_OUT=workspace/rom-audit-sample \
  bash scripts/rom-audit/run-dual.sh
```

This builds the isolated sample-clock executable, qualifies it, measures the new
backend on the target machine and applies the normal budget gate. For bounded
runs, retain `ROM_AUDIT_MAX_JOBS`. The original mode remains available with
`ROM_AUDIT_SAMPLE_CLOCK=0` or unset. Its measurement identity is unchanged;
accelerated results have their own identity and methodology
`rom-audit-sample-clock-1`. Use separate output directories; never combine their
raw checkpoints. Qualification for the accelerated mode lives in
`workspace/rom-audit-sample-qualification/` and binds the representative proof hash,
exact binaries, native controls, deployed-worker checks and three full suites.

The isolated worker's cancellation path also terminates an in-flight synchronous
native renderer. It preserves the launcher's watchdog process group, closes the
transport pipes, and leaves the interrupted census job pending. A regression
holds a renderer inside `spawnSync` and verifies that closing the worker stops it.
