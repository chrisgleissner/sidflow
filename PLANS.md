# PLANS.md - SID Classification Pipeline Recovery

## Objective

Recover the SID classification pipeline by diagnosing and fixing the pathological behavior where `GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` causes all workers to become stuck, pegging all cores at 100% with zero forward progress.

## Branch Topology

- `main`: restored to `c392f08` (stable baseline)
- `fix/direct-sid-classification`: contains commits `e6ea3b4..e06e301` + new fix work

## Phase 0 - Branch Recovery and Plan
- [x] Create `fix/direct-sid-classification` at `e06e301`
- [x] Reset `main` to `c392f08`
- [x] Verify branch topology
- [x] Create PLANS.md
- [x] Create WORKLOG.md

## Phase 1 - Establish Baseline
- [ ] Confirm pipeline builds and tests pass on fix branch
- [ ] Run small bounded classification (5-10 SIDs) to confirm non-pathological behavior
- [ ] Define reproduction tiers (single SID, small batch, prefix replay)
- [ ] Define forward-progress metrics

## Phase 2 - Telemetry Instrumentation
- [ ] Add per-song wall-clock timeout to `runConcurrent` worker invocations
- [ ] Add per-worker SID attribution logging (JSON)
- [ ] Add stall watchdog: no song completes for 60s -> dump state
- [ ] Add duplicate-dispatch detection (same SID on multiple workers)
- [ ] Add periodic status snapshot (every 10s) with queue/worker state
- [ ] Add per-song timing and outcome tracking
- [ ] Machine-readable run summary JSON

## Phase 3 - Controlled Reproduction
- [ ] Tier A: Single-SID isolation of `Super_Mario_Bros_64_2SID.sid`
- [ ] Tier B: Small batch (5-10 SIDs) including the problematic SID
- [ ] Tier C: Prefix replay approaching historical failure
- [ ] Determine minimal reproduction scope

## Phase 4 - Root Cause Analysis
- [ ] Identify exact stage where problematic SID stalls
- [ ] Determine if single worker hangs vs multiple workers stuck on same SID
- [ ] Determine if duplicate dispatch occurs
- [ ] Compare normal vs pathological SID telemetry
- [ ] State root cause precisely

## Phase 5 - Implement Fixes
- [ ] Per-song watchdog timeout with error attribution
- [ ] Worker ownership discipline (one SID cannot monopolize all workers)
- [ ] Deduplication/lease protection against duplicate concurrent dispatch
- [ ] Forward-progress detection
- [ ] Safe failure: pathological SID skipped/quarantined, pipeline continues
- [ ] Structured failure artifacts

## Phase 6 - CPU Utilization Stabilization
- [ ] Measure utilization during healthy runs
- [ ] Identify idle gaps or bottlenecks
- [ ] Verify >= 50% avg CPU per core during substantial runs
- [ ] No false 100% CPU with zero progress

## Phase 7 - Long-Run Validation
- [ ] Bounded run crossing historical ~10 min failure threshold
- [ ] Large corpus run with continuous progress
- [ ] All expected output artifacts produced
- [ ] Telemetry confirms worker health throughout

## Phase 8 - Regression Protection
- [ ] Regression test for pathological-song timeout behavior
- [ ] Scheduler test: duplicate SID ownership cannot consume all workers
- [ ] Timeout/watchdog test
- [ ] Documented reproduction procedure

## Phase 9 - Final Documentation
- [ ] Root-cause write-up in doc/research/
- [ ] Updated classification usage docs
- [ ] Telemetry inspection guide
- [ ] Final verification evidence in WORKLOG.md

## Phase 10 - PR #87 Convergence

### Objective

Bring PR #87 to a merge-ready state by addressing inline review feedback, fixing the failing CI job, and re-running validation until the branch is stable.

### Checklist
- [ ] Review all inline PR comments and classify each as fix / no-op with rationale
- [ ] Implement minimal code/test fixes for valid review findings
- [ ] Re-run targeted classify tests and build locally
- [ ] Re-run full `bun run test` until green
- [ ] Re-run required validation 3x per repo policy and capture outputs
- [ ] Respond to each inline review comment with technical resolution
- [ ] Resolve all review threads/comments that are addressed
- [ ] Push branch updates and verify all CI checks pass

### Progress
- 2026-03-24: Loaded repo guidance and PR state. `gh api graphql` reports no active review threads, but `gh api repos/.../pulls/87/comments` returned 11 inline Copilot comments that still need individual responses.
- 2026-03-24: `gh pr status` shows PR #87 has 1/4 failing checks. The failing check is `Build and test / Build and Test` from Actions run `23484605584`.
- 2026-03-24: Initial review triage identified likely-valid issues in `render-timeout.test.ts`, `wasm-render-pool.ts`, `index.ts`, and a wording issue in `cli.ts`. Work in progress.

### Decision Log
- 2026-03-24: Treat inline Copilot comments as authoritative review work even though GraphQL `reviewThreads` returned no active thread nodes for this PR.

### Outcomes
- Pending.

## Phase 11 - Similarity Export Slowdown Telemetry

### Objective

Add deterministic, per-song classification lifecycle telemetry for the `bash scripts/run-similarity-export.sh --mode local --full-rerun true` workflow, then use that evidence to explain the reported slowdown around 70-75% completion.

### Checklist
- [x] Read repo guidance, docs, and classify/export entrypoints
- [x] Establish baseline build/test state before code changes
- [x] Add wrapper-run metadata capture for the exact similarity-export command
- [x] Emit structured per-song classification telemetry without changing the main classification JSONL schema
- [x] Surface the hidden post-extraction phases in CLI/web/script progress reporting
- [x] Add focused tests for telemetry + phase reporting
- [x] Run a bounded classify/export verification and inspect emitted telemetry
- [x] Document the slowdown root cause and evidence in `doc/research/`
- [ ] Re-run final validation (`bun run build`, targeted tests, `bun run test` x3)

### Progress
- 2026-03-25: Baseline `npm run build` succeeded. `npm run test` also exited successfully from a clean code baseline.
- 2026-03-25: Code inspection shows `generateAutoTags()` does a concurrent feature-extraction pass, then a second serialized pass that builds the dataset-normalized rating model and writes final classification records. Existing progress/log parsing largely exposes the first phase, so late-run work can look like a slowdown.
- 2026-03-25: Added `classification_*.events.jsonl` telemetry, wrapper-level `run-events.jsonl`, and explicit `Building Rating Model` / `Writing Results` progress phases.
- 2026-03-25: Focused validation passed: `npm run build:quick` and `bun test packages/sidflow-classify/test/cli.test.ts packages/sidflow-classify/test/auto-tags.test.ts packages/sidflow-classify/test/index.test.ts`.
- 2026-03-25: Bounded wrapper verification hit an environment blocker (`ffmpeg` missing), but still produced the wrapper `run_start` artifact. The classification lifecycle itself was verified end-to-end with the same run context against `test-data`.

### Decision Log
- 2026-03-25: Keep telemetry in a separate `classification_*.events.jsonl` stream to avoid breaking downstream consumers of the canonical `classification_*.jsonl` schema.

### Outcomes
- Root cause identified: a real late serialized finalization pass existed, but the severe slowdown symptom was primarily caused by missing visibility into that pass.
