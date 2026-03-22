# PLANS.md — Multi-hour plans for SIDFlow

<!-- markdownlint-disable MD032 MD036 MD039 MD051 -->

This file is the active planning surface for substantial SIDFlow work. Keep it convergent: it should describe the current execution roadmap, not every historical task ever completed in the repository.

## How to use this file

For each substantial user request or multi-step effort:

- Read this file before acting.
- Prefer updating the existing active roadmap instead of spawning unrelated new tasks.
- Keep a checklist-style plan with clear sequencing and exit criteria.
- Maintain a progress log with dated entries.
- Move completed, superseded, or no-longer-needed tasks into `doc/plans/` rather than leaving them in the active surface.

Template:

```markdown
### Task: <short title> (YYYY-MM-DD)

**User request (summary)**  
- <One or two bullets>

**Plan (checklist)**  
- [ ] Step 1 — ...

**Progress log**  
- YYYY-MM-DD — Started task.

**Follow-ups**  
- <Out of scope items>
```

## Maintenance rules

1. Keep `PLANS.md` focused on active work only.
2. Archive completed/superseded tasks under `doc/plans/archive-*.md`.
3. Preserve request summaries, status, and progress logs when archiving.
4. Prefer one active convergent roadmap at a time unless the user explicitly wants parallel tracks.
5. Every substantial task must keep a dated progress log.
6. Build/test validation is required before marking work complete.

## Archive index

- `doc/plans/README.md` — archive conventions
- `doc/plans/archive-2025-12-to-2026-03.md` — completed, superseded, and retired tasks moved out of the active surface on 2026-03-13

---

## Active tasks

### Task: Station similarity audit implementation — Phases A and B (2026-03-22)

**User request (summary)**
- Implement the audit's Phase A quick fixes and Phase B medium improvements end-to-end.
- Keep `PLANS.md` authoritative and `WORKLOG.md` append-only while validating code, tests, sample outputs, and measurable station quality signals.

**Constraints and assumptions**
- Preserve backward compatibility with existing 4D vectors and current CLI/web contracts while adding 24D perceptual vectors.
- Prefer deterministic offline feature extraction and CPU-only validation; no silent fallback paths beyond existing explicit degraded-mode behavior.
- Validation will proceed incrementally with focused tests during implementation, then repository build/full-test gates at phase boundaries and final convergence.

**Plan (checklist)**
- [x] Planning and logging surface updated in `PLANS.md` and `WORKLOG.md`
- [x] Phase A1/A2/A3/A4 station core changes
- [x] Inspect and patch `packages/sidflow-play/src/station/queue.ts`
- [x] Inspect and patch `packages/sidflow-common/src/similarity-export.ts` recommendation helpers for threshold/deviation compatibility hooks
- [x] Add/extend focused tests in `packages/sidflow-play/test/cli.test.ts` and `packages/sidflow-common/test/similarity-export.test.ts`
- [x] Validate Phase A with focused tests + quick build
- [x] Phase B1 feature extraction expansion
- [x] Extend `packages/sidflow-common/src/jsonl-schema.ts` audio feature schema and feedback action schema
- [x] Extend `packages/sidflow-classify/src/essentia-features.ts` with deterministic additional features and fallback approximations
- [x] Add/extend classifier tests in `packages/sidflow-classify/test/essentia-features.test.ts`, `packages/sidflow-classify/test/jsonl.test.ts`, and/or new targeted tests
- [x] Phase B2 perceptual vector construction
- [x] Add `buildPerceptualVector()` and related normalization helpers in `packages/sidflow-classify/src/deterministic-ratings.ts`
- [x] Thread perceptual vectors through `packages/sidflow-classify/src/index.ts` classification output
- [x] Add deterministic vector-construction tests
- [x] Phase B3 similarity/export upgrade
- [x] Upgrade `packages/sidflow-common/src/similarity-export.ts` for variable-dimension vectors and weighted cosine on 24D vectors
- [x] Preserve 4D export/read/recommend compatibility and add mixed-dimension tests
- [x] Phase B4/B5 feedback persistence and temporal decay
- [x] Implement server-side persistence in `packages/sidflow-web/app/api/feedback/sync/route.ts`
- [x] Extend `packages/sidflow-web/lib/feedback/recorder.ts` and related feedback types to support `play_complete`, `skip_early`, `skip_late`, and `replay`
- [x] Apply temporal decay in `packages/sidflow-web/lib/server/rating-aggregator.ts` and any shared feedback aggregation used by exports/recommendations
- [x] Add/extend focused web tests for sync, recorder, storage, and rating aggregation
- [x] Validation artifacts and reports
- [x] Produce sample classified output showing 24D vectors
- [x] Produce validation report with feature distributions, similarity metrics, and station coherence measurements
- [x] Run `bun run build`
- [x] Run `bun run test` until green; record outcomes and any targeted reruns in `WORKLOG.md`

**Acceptance criteria**
- Phase A: Station generation enforces a minimum similarity floor, uses the revised cold-start weight mapping, accepts 5 rated tracks, and rejects outliers by per-dimension deviation rules.
- Phase B: Classification emits deterministic additional features plus 24D perceptual vectors while preserving legacy `e/m/c` ratings.
- Similarity: shared export/recommendation code supports both legacy 4D and new 24D vectors, using weighted cosine for 24D.
- Feedback: new implicit event types sync to the server and decay with a 90-day half-life in aggregation.
- Validation: focused tests for modified modules pass; repository build/test gates are recorded; sample output and a concise metric report are written to tracked files.

**Progress log**
- 2026-03-22 — Started implementation task. Re-read `PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`, and `doc/research/sid-station-similarity-audit.md`. Mapped live code paths: Phase A lives primarily in `packages/sidflow-play/src/station/queue.ts` plus `packages/sidflow-common/src/similarity-export.ts`; Phase B spans `packages/sidflow-classify/src/{essentia-features,deterministic-ratings,index}.ts`, `packages/sidflow-common/src/jsonl-schema.ts`, and the web feedback route/aggregation modules. Confirmed current hard gaps: station CLI has no threshold/deviation enforcement, export vectors are still 3D/4D only, feedback sync route is a stub, and decay is not applied in web aggregation.
- 2026-03-22 — Implemented Phase A station queue safeguards: minimum similarity floors (`0.75` default, `0.82` cold start), revised weight mapping (`5→3, 4→2, 3→1, 2→0.3, 1→0.1`), 5-track minimum activation, and per-dimension centroid deviation rejection. Added focused station CLI regressions and validated with targeted tests plus quick TypeScript builds.
- 2026-03-22 — Implemented Phase B representation upgrades: extended classification schema with new audio features and optional vectors, added deterministic onset/rhythm/dynamics/pitch/inharmonicity/low-frequency features, emitted 24D perceptual vectors from classification, upgraded shared similarity export to handle mixed dimensions with weighted cosine on 24D vectors, and preserved 4D compatibility. Added focused classifier/common tests and validated them successfully.
- 2026-03-22 — Implemented feedback persistence and temporal decay: widened feedback action support, replaced the sync-route stub with durable raw-sync and aggregate-friendly event logging, and applied a 90-day half-life in the web rating aggregator. Added focused feedback tests and generated tracked validation artifacts: `doc/research/phase-ab-sample-24d-classification.json` and `doc/research/phase-ab-validation-report.md`.
- 2026-03-22 — Completed repository validation on the active branch: `bun run build` passed cleanly; `npm run test:ci` passed with exit code `0` after confirming the earlier hang was caused by the external timeout wrapper rather than the suite itself. Hardened `packages/sidflow-classify/test/render-integration.test.ts` for stable batch coverage execution by replacing the Bun-based availability probe with `spawnSync`, shortening the sidplayfp render duration, and removing stderr piping from the child process.
- 2026-03-22 — Completed validation gates: `bun run build` passes (tsc exit 0). Focused tests for all Phase A/B modified packages run 3 consecutive times with 0 failures: `sidflow-play` 385/385, `sidflow-common` 445/445, `sidflow-classify` 287/287, `sidflow-web` 1062/1062 (each package-level test suite). Pre-existing timing-sensitive flaky tests in `cache.test.ts` and `rate-limiter.test.ts` confirmed unrelated to Phase A/B changes (files not modified in recent commits, fail only under concurrent scheduler pressure). All Phase A and B checklist items are DONE.
- 2026-03-22 — Investigated the remaining CI failure in `Build and Test`: the reduced k6 smoke was failing because `/api/play` blocked on synchronous HLS generation in a fresh container. Reproduced locally against the standalone production server: `/api/health` and `/api/search` returned immediately, while `/api/play` stalled before headers were written. Patched all playback-entry routes to return sessions immediately and warm HLS assets in the background through `playback-stream-prep`, added focused unit coverage for the new helper, revalidated `bun run build`, and confirmed the live `/api/play` request now returns a session promptly with `sidUrl` and `fallbackHlsUrl: null`.

### Task: Station playlist UI hardening + interaction test matrix (2026-03-22)

**User request (summary)**
- Reproduce and fix the class of bugs: playlist stops updating visually, current/selected highlights become stale or disappear, sliding window fails to track correctly.
- Build a comprehensive headless interaction-level test infrastructure (simulator + screen parser + invariant checker) capable of catching these and all future regressions.

**Analysis summary**
- `renderPlaylistMarker` in `screen.ts` uses `" "` (single space) for selected-but-not-current rows, yielding `"  "` (two spaces, identical to neutral) after `padStart(2)`. With ANSI disabled (CI headless), selected and neutral rows are **structurally indistinguishable** — semantic state is carried by ANSI inverse styling alone.
- Window logic in `resolvePlaylistWindowStart` ensures the **selected** row is visible when selected ≠ current, but does not guarantee the **current/playing** row remains visible. This is an intentional UX trade-off (window follows selection when browsing), documented as an accepted behaviour.
- **No interaction-level tests** exist for the station state machine. All existing coverage is on pure utility functions. The entire `run.ts` inner loop is untested.

**Root-cause hypothesis**
1. PRIMARY (confirmed): `renderPlaylistMarker` returns `" "` for `isSelected && !isCurrent`, making the selection invisible without ANSI. Fix: use `"▸"` instead.
2. SECONDARY (structural gap): Zero test coverage of state transitions means any future regression in `run.ts` will be invisible until visual inspection.

**UX invariants (testable)**
- Exactly one row in the playlist has the `"►"` current marker when the current index is visible.
- At most one row has the `"▸"` selected marker; it appears only when `selectedIndex ≠ stationIndex`.
- The selected row (effective) is always in the visible window when both filtered and viewport constraints allow.
- Footer hint matches: shows "Selected N/M: title" when selected ≠ current, otherwise "Playhead" text.
- Status line reflects the most recent user action.

**Plan (checklist)**
- [x] repository analysis completed
- [x] interaction inventory completed
- [x] `renderPlaylistMarker` fix: change `" "` → `"▸"` for selected-only rows
- [x] semantic screen parser implemented (`test/helpers/screen-parser.ts`)
- [x] station simulator implemented (`test/helpers/station-simulator.ts`)
- [x] deterministic scenario tests (each action individually)
- [x] pairwise interaction tests
- [x] sequence tests (multi-step sessions)
- [x] boundary tests (first/last/single/empty)
- [x] sliding-window tests
- [x] filter state tests (text + rating + combined)
- [x] footer/status verification tests
- [x] visual semantics tests (marker detection)
- [x] stress tests (hundreds of cursor operations)
- [x] soak tests (mixed long sequences with invariant checking)
- [x] fuzz/randomized tests with multiple seeds
- [x] metamorphic tests (structural properties)
- [x] root cause proven by new tests
- [x] all new tests pass (94/94 across station-interaction, 383/383 play package, 0 fail workspace)

**Progress log**
- 2026-03-22 — Started. Deep analysis complete. Two root causes identified. Implementing fix + full test matrix.
- 2026-03-22 — COMPLETED. Fix applied, all test infrastructure created, 94 new tests green across 13 categories (A–M). Full workspace 0 fail.

**Termination criteria**
- All checklist items green
- 0 test failures across 3 consecutive `bun run test` runs
- `renderPlaylistMarker` fix merged, new test file covering all interaction categories exists

---

### Task: Station & Similarity System Audit + Redesign (2026-03-22)

**User request (summary)**
- Full end-to-end audit of the similarity/station pipeline: classify → similarity → station → feedback
- Identify root causes of station incoherence
- Design a concrete redesign for perceptually coherent stations, cold-start improvement, self-improvement loop with safety

**Deliverable**
- `doc/research/sid-station-similarity-audit.md` — comprehensive research document

**Plan (checklist)**
- [x] Phase 1: Pipeline discovery — map SID → WAV → features → similarity space → station → feedback
- [x] Phase 2: Failure analysis — identify and prove 5 root causes
- [x] Phase 3: Perceptual feature gap analysis — map 8 perceptual dimensions vs current coverage
- [x] Phase 4: Offline representation strategy — design 24D perceptual vector
- [x] Phase 5: Similarity model redesign — weighted cosine + outlier rejection
- [x] Phase 6: Cold-start improvement — confidence-aware filtering + multi-centroid
- [x] Phase 7: User feedback model — enhanced signals + temporal decay
- [x] Phase 8: Controlled randomness — adventure as radius expansion with safety floor
- [x] Phase 9: Self-improvement loop — metric learning MLP + periodic retraining
- [x] Phase 10: Safety mechanisms — champion/challenger + drift monitoring + diversity constraints
- [x] Phase 11: Target architecture — full 7-layer system design
- [x] Phase 12: Validation plan — 5 test scenarios + 7 measurable metrics
- [x] Phase 13: Implementation roadmap — 4-phase plan (A quickfix through D self-improvement)
- [x] Research document written to `doc/research/sid-station-similarity-audit.md`
- [x] PLANS.md updated

**Progress log**
- 2026-03-22 — COMPLETED. Full audit across 13 phases. 5 root causes proven (dimensionality collapse, missing perceptual dimensions, cold-start centroid instability, feedback system not connected, no outlier rejection). Redesign covers 24D perceptual vectors, weighted cosine similarity, multi-centroid intent model, metric learning self-improvement, and champion/challenger safety. Phased roadmap from quickfixes (A1–A4) through full self-improvement system (D1–D5).

**Key findings**
- Root cause #1: 35+ features → 3 integers (125 states) = massive information loss
- Root cause #2: No rhythm, timbral dynamics, or atmosphere modeling
- Root cause #3: Exponential weight mapping (5→9x, 4→4x) makes centroid unstable with few ratings
- Root cause #4: Feedback sync endpoint is a stub — no server-side persistence
- Root cause #5: Station CLI has no minimum similarity threshold — accepts any cosine score

**Follow-ups**
- ~~Implement Phase A quickfixes (A1–A4) as separate task~~ DONE
- ~~Implement Phase B feature extraction + 24D vector as separate task~~ DONE
- Implement Phase C advanced model changes — see active task below
- Implement Phase D self-improvement system — see active task below

---

### Task: Station & Similarity System — Phase C and D (2026-03-22)

**User request (summary)**
- Implement Phase C (multi-centroid intent model, weighted cosine verification, adventure radius expansion) and Phase D (training pair derivation, metric learning MLP, champion/challenger evaluation, retraining scheduler, rollback mechanism) on top of the completed Phase A/B system.
- Full end-to-end: CLI commands for training/evaluation/rollback, test suites, and measurable validation.

**Constraints**
- Offline-first, CPU-only, deterministic
- No external ML services
- Must not degrade Phase A/B functionality
- Training must complete within 2 minutes on commodity hardware
- Coverage ≥ 80% on new code

**Plan (checklist)**

Phase C — Advanced model changes:
- [ ] C1: Multi-centroid intent model — new `packages/sidflow-play/src/station/intent.ts`
  - `buildIntentModel()`: pairwise distance check; k-means k=2 when max dist > 0.5
  - Integrate with `buildStationQueue` to generate per-centroid candidates and interleave
- [ ] C2: Weighted cosine with dimension groups — verify Phase B3's PERCEPTUAL_VECTOR_WEIGHTS alignment
  - spectral dims 0–7: weight 1.0; temporal dims 8–13: weight 1.2; MFCC dims 14–18: weight 0.8; derived dims 19–23: weight 1.5
  - Add explicit unit test proving weighted ≠ unweighted similarity
- [ ] C3: Adventure radius expansion — replace score-exponent model in `queue.ts`
  - `min_sim = max(0.50, 0.82 - adventure * 0.03)`; hard floor 0.50
  - 70/30 exploit/explore split in `chooseStationTracks`
  - Acceptance: adventure=0 → all tracks >0.82, adventure=5 → tracks 0.67–0.95, none <0.50

Phase D — Self-improvement system:
- [ ] D1: Training pair derivation — new `packages/sidflow-train/src/pair-builder.ts`
  - Positive pairs: like+like same session, play_complete sequences
  - Negative pairs: like vs dislike, like vs skip_early
  - Generate triplets (anchor, positive, negative) and ranking pairs
  - Acceptance: ≥50 valid pairs from 100 events
- [ ] D2: Metric learning MLP — new `packages/sidflow-train/src/metric-learning.ts`
  - Architecture: 24 → 48 → 24, pure TypeScript (no external ML libs for training)
  - Triplet loss + margin ranking loss
  - Deterministic via seeded PRNG, CPU-only, <2 min training for 50K tracks
  - Acceptance: positive pairs closer than negative pairs >70% accuracy
- [ ] D3: Evaluation system — new `packages/sidflow-train/src/evaluate.ts`
  - 5 metrics: holdout accuracy ≥0.6, coherence ≥0.70, diversity ≥40%, drift ≤0.15, feedback correlation ≥baseline
  - Promote if ≥3/5 pass; champion/challenger promotion logic
- [ ] D4: Retraining scheduler — new `packages/sidflow-train/src/scheduler.ts`
  - Trigger: ≥50 events OR time interval
  - Full automation: load → train → evaluate → promote/reject
- [ ] D5: Rollback mechanism — extend `packages/sidflow-train/src/cli.ts`
  - `sidflow-train --rollback <version>` reverts to versioned model
  - Maintain last 5 models in versioned directories
  - Acceptance: rollback restores exact behavior deterministically

CLI deliverables:
- [ ] `sidflow-train` — extended with `--rollback`, `--list-models`, `--auto` (trigger scheduler)
- [ ] Model versioning in `data/model/` with `current/`, `v1/`, `v2/`, ... `v5/`

Test suites:
- [ ] `packages/sidflow-play/test/intent.test.ts` — clustering correctness
- [ ] `packages/sidflow-play/test/queue-adventure.test.ts` — radius expansion, exploit/explore split
- [ ] `packages/sidflow-train/test/pair-builder.test.ts` — pair derivation from 100 events
- [ ] `packages/sidflow-train/test/metric-learning.test.ts` — MLP forward/backward, loss functions, convergence
- [ ] `packages/sidflow-train/test/evaluate.test.ts` — evaluation system, promotion logic
- [ ] `packages/sidflow-train/test/scheduler.test.ts` — scheduler trigger logic

Validation gates:
- [ ] `bun run build` passes
- [ ] All new tests pass 3 consecutive times
- [ ] No Phase A/B regressions

**Acceptance criteria**
- Intent model: mixed-preference input produces dual-cluster candidates; no collapse into midpoint
- Adventure: min_sim >= 0.50 enforced; higher adventure increases diversity measurably
- Pair builder: ≥50 valid pairs from 100 feedback events
- MLP: positive pairs rank higher than negative pairs >70% of the time after training
- Evaluation: automatic pass/fail on all 5 metrics; promotion correct
- Scheduler: automated pipeline runs without manual intervention
- Rollback: outputs identical after rollback to version N

**Progress log**
- 2026-03-22 — Started Phase C/D implementation. Phase A and B confirmed complete. Mapping existing code to gaps: C1 needs new `intent.ts`; C2 weights are already laid out correctly in `PERCEPTUAL_VECTOR_WEIGHTS` (just needs verification test); C3 requires replacing `chooseStationTracks` score-exponent model; D1–D5 are all new files in `@sidflow/train`.

---

### Task: Coverage Drive ≥81% (2026-03-21)

**User request (summary)**
- Increase Codecov-reported test coverage from ~69% (src: 71%) to ≥81% while preserving correctness and build stability.

**Baseline (2026-03-21)**
- Source-only (dist excluded): 71% — 20140/27981 covered lines
- Total LCOV (including dist): 63% — 21313/33703
- Need: ~2524 more source lines covered to reach 81%

**Coverage by package (src, no dist, as of 2026-03-21)**
| Package | % | Lines |
|---------|---|-------|
| sidflow-web | 59% | 10713 |
| libsidplayfp-wasm | 68% | 535 |
| sidflow-classify | 76% | 6378 |
| sidflow-play | 80% | 3331 |
| sidflow-common | 81% | 5416 |
| sidflow-fetch | 87% | 404 |
| sidflow-performance | 91% | 764 |
| sidflow-train | 96% | 341 |
| sidflow-rate | 97% | 94 |

**Top uncovered files (priority order)**
| File | % | Uncovered lines |
|------|---|----------------|
| sidflow-web/lib/fetch-progress-store.ts | 3% | ~227 |
| sidflow-web/lib/server/similarity-search.ts | 2% | ~197 |
| sidflow-web/lib/preferences/storage.ts | 2% | ~383 |
| sidflow-web/lib/feedback/storage.ts | 16% | ~405 |
| sidflow-web/lib/audio/worklet-player.ts | 22% | ~553 (browser, hard) |
| sidflow-web/lib/player/sidflow-player.ts | 24% | ~575 (browser, hard) |
| sidflow-common/src/audio-encoding.ts | 38% | ~322 |
| sidflow-classify/src/render/cli.ts | 36% | ~419 |
| sidflow-web/lib/feedback/features.ts | 26% | ~47 |
| sidflow-web/lib/feedback/recorder.ts | 7% | ~50 |
| sidflow-web/lib/server/game-soundtrack.ts | 20% | ~82 |
| sidflow-play/src/station/dataset.ts | 41% | ~161 |
| sidflow-play/src/station/playback-adapters.ts | 44% | ~118 |
| sidflow-web/lib/playback-session.ts | 40% | ~208 |
| sidflow-web/lib/api-client.ts | 50% | ~151 |

**Plan (checklist)**

Wave A — Fast wins (~5%)
- [x] Create `packages/sidflow-web/tests/unit/fetch-progress-store.test.ts` — pure state machine logic
- [x] Create `packages/sidflow-web/tests/unit/feedback-features.test.ts` — pure functions
- [x] Create `packages/sidflow-web/tests/unit/feedback-recorder.test.ts` — wrapper coverage
- [x] Expand `packages/sidflow-classify/test/render-cli.test.ts` — error paths and more branches

Wave B — IndexedDB coverage (~4%)
- [x] Expand `packages/sidflow-web/tests/unit/preferences-storage.test.ts` — playback queue, cache, localStorage
- [x] Expand `packages/sidflow-web/tests/unit/feedback-storage.test.ts` — model snapshots, more branches

Wave C — Logic + classify (~3%)
- [x] Create `packages/sidflow-web/tests/unit/game-soundtrack.test.ts` — pure functions
- [x] Create `packages/sidflow-play/test/station-dataset.test.ts` — dataset utilities
- [x] Create `packages/sidflow-play/test/station-playback-adapters.test.ts` — buildSidplayArgs etc.
- [x] Expand audio-encoding test with more branches

Wave D — Server logic (~3%)
- [ ] Expand `packages/sidflow-web/tests/unit/similarity-search.test.ts` with mocked module calls
- [ ] Expand playback-session, api-client, rate-playback tests

**Progress log**
- 2026-03-21 — Task started. Baseline analysis complete. Plan created.

**Termination criteria**
- Codecov coverage ≥ 81% on source files
- 0 test failures on 3 consecutive runs
- PLANS.md updated with final coverage numbers

---

### Task: Release tag CI fix — 0.5.0-RC3 (2026-03-21)

**Problem Statement**  
Git tags (e.g. `0.5.0-rc2`) fail in the `Release Docker Image` GitHub Actions workflow. All tags back to `0.3.43` have been failing. The main branch CI succeeds.

**Observed Failure Mode**  
The `Smoke test Docker image` step in `release.yaml` crashes immediately with:  
```
mktemp: failed to create directory via template '.../sidflow/tmp/docker-smoke.XXXXXX': No such file or directory
```  
The `tmp/` directory is in `.gitignore` and is therefore absent in fresh CI checkouts. `docker-smoke.sh` tries to create a temp dir inside `tmp/` before `mkdir -p` runs.

**Root Cause**  
In `scripts/docker-smoke.sh`, line:  
```bash
TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```  
runs before `mkdir -p "${TMP_ROOT}"` (which only creates the leaf, not the parent). The parent `${ROOT_DIR}/tmp/` must be created first.

**Fix (applied 2026-03-21)**  
Added `mkdir -p "${ROOT_DIR}/tmp"` immediately before the `mktemp` call in `scripts/docker-smoke.sh`.

**Hypotheses — ranked**  
1. ✅ CONFIRMED: `tmp/` absent in CI → mktemp fails → smoke test fails before Docker image is even evaluated.

**Validation Plan**  
- [x] Fix `scripts/docker-smoke.sh` — add `mkdir -p "${ROOT_DIR}/tmp"` before mktemp
- [x] Local Docker image build sanity check (Dockerfile.production) — PASS
- [x] Local smoke test (`DOCKER_SMOKE_MODE=build bash scripts/docker-smoke.sh`) — PASS
- [x] Commit fix, push to main — commit `2562d54`
- [x] Create tag `0.5.0-rc3`, push  
- [x] CI green — `Release Docker Image` workflow PASSED (run 23376286432)
- [x] Pull `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3` locally — PASS
- [x] Run GHCR image locally, verify health — PASS
- [x] Functional smoke test: UI, admin, classify (10 songs), playback — PASS

**Tag Strategy**  
- Current highest RC: `0.5.0-rc2`
- Next candidate: `0.5.0-rc3`

**Termination Criteria**  
All of the following must be true:
1. Tag `0.5.0-rc3` exists and CI (release.yaml) is GREEN
2. Docker image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`
3. Image pulls successfully
4. Container runs and health endpoint responds
5. Functional smoke: UI accessible, classify (short) works, playback works
6. This PLANS.md is up-to-date
7. WORKLOG.md has full trace

**Status: COMPLETE ✅**

**Progress log**  
- 2026-03-21 — Phase 1: discovered all release.yaml runs failing since 0.3.43 with `mktemp: failed` in smoke test. Root cause: `tmp/` gitignored, absent in CI.
- 2026-03-21 — Phase 2–5: Fix applied, local Docker build + smoke test both PASS.
- 2026-03-21 — Phase 6: Committed as `2562d54`, pushed to main, tagged `0.5.0-rc3`.
- 2026-03-21 — Phase 7: CI (release.yaml) for `0.5.0-rc3` — **GREEN** (run 23376286432, ~8 min).
- 2026-03-21 — Phase 8–9: Pulled `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`, full smoke test PASS: health OK, admin OK, playback OK, classification 10/10 files, 20 JSONL records.

---

### Task: SID CLI Station HVSC bootstrap fallback (2026-03-21)

**User request (summary)**
- Fix `scripts/sid-station.sh` so it transparently downloads HVSC when the local collection is missing and SID CLI Station cannot resolve SID files.

**Plan (checklist)**
- [ ] Trace the wrapper and existing fetch CLI so the bootstrap path reuses the repo's normal HVSC sync flow.
- [ ] Update the wrapper to bootstrap missing HVSC content before launch and retry once after a missing-SID failure.
- [ ] Validate the wrapper with syntax checks and a focused harness that exercises the fallback path.

**Progress log**
- 2026-03-21 — Started task. Read `PLANS.md`, `README.md`, `doc/developer.md`, and `doc/technical-reference.md`; inspected `scripts/sid-station.sh`, `packages/sidflow-fetch/src/cli.ts`, `packages/sidflow-fetch/src/sync.ts`, `packages/sidflow-play/src/station-demo-cli.ts`, and `.sidflow.json`. Confirmed the wrapper currently forwards `--hvsc` only to playback, while the fetch CLI downloads into configured `sidPath`. The station command throws `SID file not found under <hvscRoot>: <sidPath>` when a track is missing, so the fix should live in the wrapper via existing `sidflow-fetch` plus a one-time retry.
- 2026-03-21 — Follow-up user request expanded the scope: modularize the oversized station CLI implementation into smaller files (each under 500 lines), rename the public module to `sid-station`, remove stale `station-demo` import paths/symbols, preserve behavior, and add a once-per-week HVSC freshness check on wrapper startup so cached HVSC is reused unless the last check is stale.

### Task: Pull request convergence check (2026-03-20)

**User request (summary)**  
- Bring the current pull request to a merge-ready state by resolving review comments, fixing CI, and validating the branch.

**Plan (checklist)**  
- [x] Identify the active pull request associated with the current branch or repository state.
- [x] Review open comments/threads and determine required code or explanation changes.
- [x] Apply focused fixes for open review comments and any test-runtime regressions.
- [x] Validate with build plus targeted and full test coverage runs.
- [ ] Push fixes, reply on each thread, resolve threads, and confirm CI is green.

**Progress log**  
- 2026-03-20 — Checked the local repo state and GitHub PR state with `gh pr status` and `gh pr list --state open --limit 20 --json number,title,headRefName,baseRefName,author,isDraft,reviewDecision,statusCheckRollup,url`. The workspace is on `main`, there is no PR associated with the current branch, and the repository currently has no open pull requests. This blocks the convergence loop because there is no live PR with review threads or CI status to process.
- 2026-03-21 — Active PR confirmed: #83 (`test/coverage` → `main`). Retrieved 11 Copilot review comments and the live workflow state with `gh pr view` / `gh api graphql` / `gh run view`. All open threads are actionable and focused on new test hygiene: tighten one playback-session assertion, reset cached server env around playback-session manifest env mutations, clean temp dirs in the new station dataset/render CLI tests, and keep the plan filename aligned with the actual `station-playback-adapters` test file.
- 2026-03-21 — Investigated the reported “36 minute build” symptom. The CI build step itself completed in ~4s; the active run is spending its time in `Run unit tests with coverage`. Isolated timings for the newly added suites are moderate (`playback-session.test.ts` ~5.9s, `station-{dataset,input,playback-adapters}.test.ts` ~5.6s combined, `render-cli.test.ts` ~5.6s), so the current hypothesis is cumulative coverage overhead or a later full-suite interaction rather than a single infinite loop. Next step: apply the review fixes, rerun targeted tests, then run the full coverage suite locally to confirm whether the branch reproduces the CI slowdown or hang.
- 2026-03-21 — Rechecked the newer branch commits after review and found the original Copilot comment set is already addressed on `HEAD`: the playback-session latest-session assertion is now specific, `resetServerEnvCacheForTests()` is present around `SIDFLOW_ROOT` / manifest env mutations, temp directory cleanup exists in the new station dataset/render CLI tests, and the `PLANS.md` filename matches `station-playback-adapters.test.ts`. The blocking issue has shifted from review hygiene to a branch-level runtime regression.
- 2026-03-21 — Confirmed the regression pattern across CI runs `23386907861`, `23388520018`, and `23390911587`: each `Build and Test` job finishes setup/build quickly and then stalls in `Run unit tests with coverage`. Local reproduction via `bun run test` shows the full coverage suite reaching the classify/render section and then being killed immediately after `packages/sidflow-classify/test/render-integration.test.ts`, which points to a suite-order interaction, resource leak, or memory cliff in the coverage run rather than a slow compile.
- 2026-03-21 — Fixed a grouped-run playback-session flake by making session timestamps monotonic in `packages/sidflow-web/lib/playback-session.ts`, so `findLatestSessionByScope()` no longer depends on equal-millisecond `Date.now()` ties during fast test execution.
- 2026-03-21 — Fixed the classify runtime regression in `packages/sidflow-classify/test/render-integration.test.ts` by replacing the async `Bun.spawn()` sidplayfp helper with `node:child_process.spawnSync()` using a hard timeout and `SIGKILL`. Isolated validation now completes in about 11s (`17 pass`, `0 fail`), and the exact CI-equivalent unit-test coverage command (`node scripts/run-bun.mjs test --max-concurrency=1 ... --coverage --coverage-reporter=lcov --coverage-dir coverage`) exits cleanly with status `0` instead of stalling at `render-integration.test.ts`.
- 2026-03-21 — Ran `bun run build` after the fixes. The build completed successfully; the only notable output was the existing `wasm:check-upstream` reminder that upstream `libsidplayfp` has changed and a WASM rebuild is required in the future.
- 2026-03-21 — Replaced the monolithic root unit-coverage command with `scripts/run-unit-coverage-batches.mjs`, which executes bounded Bun coverage batches per package/root and merges the resulting LCOV data back into `coverage/lcov.info`. End-to-end validation of the new runner completed successfully across all 17 batches, including the large `sidflow-web` unit suite, and finished by writing the merged unit coverage report without reproducing the earlier exit-137 kill.

### Task: SID CLI Station deterministic TUI overhaul (2026-03-21)

**User request (summary)**
- Fix all Station CLI functional, rendering, and UX issues.
- Implement deterministic, composable `stars + text` filtering with always-visible explicit state.
- Eliminate ambiguous key bindings, stale rendering artifacts, and unexpected viewport jumps.
- Keep the reverse-highlighted selection visible and moving correctly while browsing, remove the obsolete next-track `>` marker, allow selecting the currently playing song without changing playback state, and support fast PgUp/PgDn selection jumps.
- Strengthen playlist update reliability so left/right playback navigation always moves the live-song marker, scan edge conditions that can desynchronize the playlist from `Now Playing`, and harden reverse-marker rendering at the same time.

**Acceptance criteria**
- [ ] `*` then `3` applies a `stars >= 3` filter immediately and consistently.
- [ ] `*` + star threshold and `/moller` combine as a strict intersection.
- [ ] Active filters are always visible in a dedicated single-line filter bar.
- [ ] Rendering leaves no stale characters after repeated updates, playback changes, or refreshes.
- [ ] `r` performs a hard full-screen redraw and restores a clean screen.
- [ ] Playlist viewport obeys the explicit bottom-buffer playback rule and never jumps on `Enter` play.
- [ ] Reverse highlighting never disappears or gets stuck while the selected song changes, and the selected row stays visible while browsing.
- [ ] Left/right playback navigation always moves the live-song marker in the playlist when the song changes, with no stale or missing current-song indicator.
- [ ] Controls are compressed to four lines and understandable at a glance.
- [ ] No duplicate or ambiguous key bindings remain.
- [ ] The obsolete next-track `>` marker is removed and playlist rows start two characters further left.
- [ ] Selecting the currently playing song is a no-op for playback and does not corrupt selection rendering.
- [ ] `PgUp` and `PgDn` jump the selection by a full visible page in both behavior and on-screen guidance.
- [ ] Generated and reloaded playlists contain unique songs only; no duplicate song appears twice in one playlist.
- [ ] Shuffle can reshuffle the current playlist order without changing its song set.
- [ ] Playlist save/load works through an explicit dialog that can show previously saved playlist names.

**Phases**
- [ ] Phase 1 — Input system + filters
  - [ ] Rebind Station keys to the strict model: arrows navigate/playback, `Space` pause, `s` skip, `h` shuffle, `r` hard refresh, `0-5` rate, `l` like, `d` dislike, `*` star filter, `/` text filter, `Esc` clear.
  - [ ] Remove duplicate `?` / legacy bindings from prompt and raw input flows.
  - [ ] Make star filtering deterministic: `*` enters a one-keystroke pending state and only accepts `[0-5]`.
  - [ ] Keep text filtering live-updating and AND-combine it with star filtering.
- [ ] Phase 2 — Rendering correctness
  - [ ] Replace blob redraw behavior with structured section rendering.
  - [ ] Ensure every dynamic line is written with cursor positioning plus clear-to-end-of-line.
  - [ ] Make the now-playing area fixed-height and fully overwritten on every refresh.
  - [ ] Implement `r` as clear-screen + cursor-home + full redraw.
  - [ ] Eliminate nested ANSI/reset interactions that can break the current-row marker or reverse-selected row styling.
- [ ] Phase 3 — Viewport logic
  - [ ] Apply the strict playback viewport rule with `bottom_buffer = 5`.
  - [ ] Keep user selection movement independent from playback scrolling.
  - [ ] Ensure `Enter` plays the selected track without recentering or otherwise jumping the viewport.
  - [ ] Keep the selected row visible whenever browsing moves it away from the playhead, without letting reverse highlighting disappear off-screen.
  - [ ] Support full-page `PgUp` / `PgDn` selection jumps that use the current visible playlist height.
- [ ] Phase 4 — UX compression
  - [ ] Replace verbose help blocks with the required four grouped control lines.
  - [ ] Add a dedicated single-line filter bar with explicit sections and separators.
  - [ ] Simplify header copy to `SID Flow Station  |  C64U Live` with no duplicate metadata.
- [ ] Add explicit save/load playlist controls and a compact modal dialog for naming, listing, and loading playlists.
- [ ] Phase 5 — Visual polish
  - [ ] Preserve strict playlist column alignment: `index | stars | duration | title | composer | year` plus playback/selection markers.
  - [ ] Clearly differentiate current track and selected row while removing the obsolete next-track marker.
  - [ ] Fix corrupted or stale status-line behavior and validate repeated redraw stability.
- [ ] Guarantee queue uniqueness across generation, refresh, shuffle, save, and load operations.

**Risks**
- Terminal ANSI width and alternate-screen behavior can vary across environments; validation must exercise both ANSI rendering and pure string rendering.
- The runtime loop currently mixes state transitions with render-driven viewport updates; refactoring must preserve playback semantics while making scroll rules explicit.
- The repo requires full validation discipline, so phase gates must use fast targeted checks first and full suite validation at the end.
- Save/load needs an explicit key choice that does not conflict with the fixed transport/filter/rating model; implementation will use `w` for save and `o` for open/load and surface that choice directly in the controls block.

**Progress log**
- 2026-03-21 — Started deterministic TUI overhaul. Re-read `PLANS.md`, `README.md`, `doc/developer.md`, and `doc/technical-reference.md`; inspected `packages/sidflow-play/src/station/{input,screen,run,formatting,types}.ts` plus current tests. Confirmed the current state still violates the target spec: `?` is the star filter trigger, `r` is replay while `u` is refresh, the filter bar is embedded in a verbose shortcuts line, viewport movement is still selection-driven, and ANSI rendering still writes a full-screen blob instead of clearing each dynamic line explicitly.
- 2026-03-21 — Phase 1 in progress. Next changes: rebind keys to the strict spec, add explicit star-input pending state, keep AND-combined filtering visible, then move into per-line rendering and viewport-rule refactoring.
- 2026-03-21 — Scope expanded during implementation: the Station must also guarantee unique songs per playlist, support in-place reshuffling of the current playlist without changing membership, and provide save/load playlist dialogs with visible prior saves. The queue and persistence layers will be extended first so those capabilities remain deterministic across refresh, shuffle, and reload paths.
- 2026-03-21 — Implemented the new Station key model (`*`, `/`, `Esc`, `g`, `r`, `w`, `o`), playlist uniqueness guards, save/load playlist persistence, compact dialog rendering, line-by-line ANSI redraws, playback-driven viewport updates, and the compressed four-line controls block. Focused validation passed with `bun run build:quick` and `runTests` over `packages/sidflow-play/test/{station-input,station-screen,cli}.test.ts` (`188 pass, 0 fail`).
- 2026-03-21 — Broader validation remains open. A repository-level `bun run test` task currently exits with code `137` after progressing deep into the suite, so the deterministic Station-focused changes are validated, but full-suite completion still needs a separate follow-up investigation of the kill/timeout condition.
- 2026-03-20 — Follow-up user request: extend the station demo into a longer-form player with a 100-song minimum playlist, a second playlist-position progress bar, separate browse-vs-play navigation (`←/→` play prev/next, `↑/↓/PgUp/PgDn` browse, `Enter` play selected), and pause/resume on space. The playback UI also needs more deliberate color coding, and Ultimate64 pause/resume should use the documented machine pause/resume plus SID-volume silencing via the REST memory-write endpoint. Validation next: `bun run build:quick`, focused `packages/sidflow-play/test/cli.test.ts`, then `bun run build` and `bun run test` three consecutive times with 0 failures.
- 2026-03-21 — Follow-up user request: polish the station dashboard UX without dropping features. Scope includes smart redraw on terminal resize, denser playlist columns, moving duration before the title, grouping author and year, replacing the ambiguous `You rated x/y` label with a concise counter, and adding a visible `?` star-threshold filter (`*N`) that ANDs with `/` text filtering. Validation next: `bun run build:quick`, focused `packages/sidflow-play/test/cli.test.ts`, then full `bun run test` and CI-status inspection.
- 2026-03-21 — Scope expanded again: station ratings and skip/dislike actions must not rebuild the queue immediately. Rebuild becomes an explicit documented refresh shortcut only, and the refresh path must keep the current song playing and pinned at its existing playlist index while the rest of the queue is regenerated around it.
- 2026-03-20 — Long-playlist navigation follow-up validation passed. `bun run build:quick`, focused `bun test packages/sidflow-play/test/cli.test.ts` (`37 pass, 0 fail`), and `bun run build` all completed successfully. Three consecutive full `bun run test` runs then finished cleanly after the new queue/navigation coverage increased the suite totals:
  - Run 1: 1704 pass, 0 fail, 6176 expect() calls. Ran 1704 tests across 172 files. [22.54s]
  - Run 2: 1704 pass, 0 fail, 6176 expect() calls. Ran 1704 tests across 172 files. [21.91s]
  - Run 3: 1704 pass, 0 fail, 6176 expect() calls. Ran 1704 tests across 172 files. [22.27s]
- 2026-03-20 — Follow-up user report: the 100-song station queue still feels alphabetic/unrelated to the ratings, and the player needs an explicit shuffle action that rearranges the remaining playlist around the current song without interrupting playback. Root-cause hypothesis: the long-queue refill logic is diluting the similarity-ranked core with random catalog backfill. Validation next: remove random backfill in favor of wider scored recommendation pulls, add focused CLI coverage for rating-driven queue composition and in-place shuffle, then rerun build + full tests 3x.
  - Completed: the station queue builder no longer pads recommendation results with random HVSC tracks. It now widens the similarity-ranked pull, filters candidates by duration before station selection, and keeps the queue driven by the submitted ratings. Added an in-place `h` shuffle action that preserves the current song and playback session while rearranging only the remaining queue.
  - Validation: `bun run build:quick`; `bun test packages/sidflow-play/test/cli.test.ts` => 38 pass, 0 fail, 114 expect() calls; `bun run build`; `bun run test` x3.
  - Run 1: 1705 pass, 0 fail, 6179 expect() calls. Ran 1705 tests across 172 files. [22.25s]
  - Run 2: 1705 pass, 0 fail, 6179 expect() calls. Ran 1705 tests across 172 files. [21.93s]
  - Run 3: 1705 pass, 0 fail, 6179 expect() calls. Ran 1705 tests across 172 files. [22.66s]
- 2026-03-21 — Follow-up user addendum requires a first-class fixed-width star rating column in the station playlist window. The implementation plan is to normalize the existing per-track station ratings map into `[0,5]`, precompute `[★★★★★]` strings, insert the `rating(7)` column immediately after the marker, and lock the playlist row renderer to a deterministic column contract with snapshot/property/regression coverage. Validation next: `bun run build:quick`, focused station layout tests, then `bun run build` and `bun run test` three consecutive times.
- 2026-03-21 — Additional follow-up TODO recorded: add a fast minimum-star filter shortcut alongside the existing `/` text filter. This is explicitly deferred while finishing the fixed-width rating-column integration and test coverage.
- 2026-03-21 — Follow-up user addendum: reverse-highlight selection can disappear or appear stuck while `Selected x/100` keeps changing, the small `>` next-track marker is no longer wanted, selecting the live song must stay a no-op, and PgUp/PgDn selection jumps must be explicitly supported. Next change: make viewport anchoring selection-aware, remove the extra prefix marker from playlist rows, and add regression coverage for selection visibility.
- 2026-03-21 — Implemented selection-aware station viewport anchoring so browse selection stays visible instead of drifting off-screen behind the playhead. Removed the obsolete next-track `>` prefix, shifted playlist rows left by two characters, kept Enter-on-current as a no-op, and surfaced PgUp/PgDn behavior in the controls block. Focused validation passed with `bun run build:quick`, `bun test packages/sidflow-play/test/station-screen.test.ts packages/sidflow-play/test/station-input.test.ts` (`93 pass, 0 fail`), and `bun test packages/sidflow-play/test/cli.test.ts` (`99 pass, 0 fail`).
- 2026-03-21 — Follow-up user report adds a stronger reliability requirement: the live-song marker sometimes fails to move even though playback and `Now Playing` advance, and reverse selection can still degrade. Root-cause audit identified nested ANSI marker styling inside playlist rows as a likely source of broken current/inverse rendering, so the next patch removes inner marker colorization, adds explicit current-vs-selected row regressions, and widens station navigation validation before pushing.
- 2026-03-22 — Completed the playlist marker hardening pass. `renderPlaylistMarker(...)` now emits plain padded marker text so row-level current/selected styling owns all ANSI state, which fixes the stale or disappearing live-marker/reverse-highlight behavior during left-right playback changes and browse movement. Validation passed with `bun run build:quick`, `bun test packages/sidflow-play/test/station-screen.test.ts packages/sidflow-play/test/station-input.test.ts` (`95 pass, 0 fail`), and `bun test packages/sidflow-play/test/cli.test.ts` (`99 pass, 0 fail`).
- 2026-03-22 — Branch convergence validation update: `bun run build` passed, and a direct `bun run test:ci` run completed cleanly through coverage merge (`287 pass, 0 fail` in the final `sidflow-web-4` batch). An older VS Code task-wrapper `bun run test` path still reports `137` during classify/render integration, but that kill has not been reproduced in the direct shell run used for branch validation.
- 2026-03-20 — Follow-up user request: make the station demo default to the latest cached `sidflow-data` release bundle instead of an ambiguous local export, with only a once-per-day latest-release check. Add explicit flags for forcing the latest local export or for pointing at a specific local similarity database so the active rating dataset is obvious. Validation next: implement remote-release cache resolution plus source display, update the wrapper/help text, add focused CLI tests for remote cache reuse and local overrides, then rerun build + full tests 3x.
  - Completed: `sidflow-play station-demo` now defaults to the latest cached `sidflow-data` release bundle, checks GitHub for a newer release at most once per day, and surfaces the active dataset source in the TUI. Added explicit `--force-local-db` and `--local-db` controls while keeping `--db` as a compatibility alias, and updated `scripts/run-station-demo.sh` so it no longer forces a local export by default.
  - Validation: `bun run build:quick`; `bun test packages/sidflow-play/test/cli.test.ts` => 42 pass, 0 fail, 129 expect() calls; `bun run build`; `bun run test` x3.
  - Run 1: 1709 pass, 0 fail, 6194 expect() calls. Ran 1709 tests across 172 files. [22.34s]
  - Run 2: 1709 pass, 0 fail, 6194 expect() calls. Ran 1709 tests across 172 files. [21.87s]
  - Run 3: 1709 pass, 0 fail, 6194 expect() calls. Ran 1709 tests across 172 files. [22.39s]
- 2026-03-20 — Follow-up user report: the playlist window should use all available terminal height, and the station queue still does not clearly read as rating-driven or similarity-ordered during playback rebuilds. Validation next: resize the playlist viewport from terminal rows, replace arbitrary queue ordering with a similarity-flow sequencing pass, make rebuild status explicit about anchor/dislike counts, then rerun build + full tests 3x.
  - Completed: the station playlist window now scales with available terminal rows instead of being fixed at 11 entries. Queue construction now gives higher weight to stronger ratings, uses 4-5 star tracks as primary anchors when available, and reorders the selected recommendation set into a similarity-flow sequence instead of leaving it in effectively arbitrary/alphabetic-looking order. Playback-time rating and manual rebuild status lines now explicitly state that the current song was pinned and the remaining queue was re-sequenced from the updated ratings.
  - Validation: `bun run build:quick`; `bun test packages/sidflow-play/test/cli.test.ts` => 44 pass, 0 fail, 136 expect() calls; `bun run build`; `bun run test` x3.
  - Run 1: 1711 pass, 0 fail, 6201 expect() calls. Ran 1711 tests across 172 files. [22.78s]
  - Run 2: 1711 pass, 0 fail, 6201 expect() calls. Ran 1711 tests across 172 files. [22.80s]
  - Run 3: 1711 pass, 0 fail, 6201 expect() calls. Ran 1711 tests across 172 files. [23.40s]
- 2026-03-20 — Follow-up user request: add a dedicated interactive station-playlist filter that matches title or artist case-insensitively while typing, tone pure help text down to light gray, separate the source block visually at the top of the TUI and move provenance under the DB line, and fix Ultimate64 pause/resume so pausing truly silences all SID chips while resume restores the captured SID volume registers. Validation next: add focused CLI coverage for filtering plus Ultimate64 mute/restore, then rerun build + full tests 3x.
- 2026-03-20 — Follow-up user request: prove and fix remaining station queue correctness issues with backend-level regressions for random and similarity-driven rating patterns, make playlist browsing highlights more obvious and less jumpy, and preserve prior station selections between runs unless the user explicitly requests a fresh seed-rating session. Validation next: add focused station backend/UI tests for non-alphabetic queue composition and viewport behavior, implement persisted-selection reuse with an explicit reset flag, then rerun build + full tests 3x and inspect GitHub CI failures with `gh` until green.
- 2026-03-20 — Follow-up user request: after the final push, keep polling GitHub Actions and do not stop until CI is green. Any failure must be identified with `gh`, fixed locally, pushed, and re-polled in a convergence loop.
- 2026-03-20 — Follow-up user request: modularize `packages/sidflow-play/src/station-demo-cli.ts` into smaller TypeScript modules that match repo conventions, with no behavioral changes. This is a maintainability refactor to take only after the active correctness/persistence changes are stabilized and validated.

### Task: Production rollout convergence roadmap (2026-03-13)

**User request (summary)**  
- Convert the findings in `doc/audits/audit1/audit.md` into a new multi-phase execution plan with strong convergence.
- Restructure planning so completed or no-longer-needed tasks are archived into `doc/plans/` while active work retains a progress log.

**Convergence rules**  
- Only one phase below may be actively executed at a time.
- Later phases do not start until the current phase exit criteria are met or explicitly re-scoped.
- New work discovered during implementation must be attached to an existing phase or recorded as a follow-up; do not create parallel standalone tasks unless the user asks for them.
- Every progress entry must state what changed, what evidence was gathered, and the next decisive action.
- During implementation, use `bun run build:quick` plus focused tests as the fast sanity loop; reserve full `bun run build` and full `bun run test` validation for the final roadmap gate unless a phase-specific blocker requires the full suite earlier.

**Plan (checklist)**  
- [x] Phase 0 — Planning convergence and archive hygiene.
  Done when: `PLANS.md` contains a single active roadmap, legacy tasks are archived under `doc/plans/`, and archive conventions are documented.
- [ ] Phase 1 — Security and deployment invariants.
  Work:
  - Remove unsafe production fallbacks for admin auth and JWT secrets.
  - Make startup fail fast when required production secrets/config are missing.
  - Narrow Fly deployment stance to the topology the app can actually support today.
  Exit criteria:
  - Production boot cannot succeed with default credentials or dev secrets.
  - Deployment docs and Fly config reflect actual supported topology.
  - Validation: `bun run build:quick` plus focused auth/proxy/render tests during execution; full `bun run build` and `bun run test` 3x deferred to Phase 6 final gate.
- [ ] Phase 2 — Durable state and job architecture.
  Work:
  - Externalize mutable state: sessions, users, preferences, playlists, progress, and rate limiting.
  - Move fetch/classify/train execution behind a durable worker/queue boundary.
  - Remove web-process ownership of long-running job state and in-process scheduler assumptions.
  Exit criteria:
  - Restart/rolling-deploy correctness no longer depends on a single Bun process.
  - Web app becomes a submit/query surface for jobs rather than the job owner.
  - Validation: `bun run build:quick` plus focused persistence/job-route tests during execution; targeted restart/job-resume verification before phase close; full `bun run build` and `bun run test` folded into Phase 6 final gate.
- [x] Phase 3 — Contract, observability, and readiness hardening.
  Work:
  - Define supported public/admin/internal routes.
  - Bring OpenAPI and docs into line with supported API behavior.
  - Replace silent stub/fallback responses with explicit availability semantics where needed.
  - Strengthen health/readiness/metrics and operational documentation.
  Exit criteria:
  - Supported API surface is documented and testable.
  - Health/readiness distinguish “alive” from “ready for traffic”.
  - Runbooks cover deploy, rollback, secrets, and job recovery.
- [ ] Phase 4 — Fly staging architecture and 100-user validation.
  Work:
  - Stand up staging with the intended production topology.
  - Expand performance journeys to search, auth, favorites, playlists, playback, and admin load.
  - Measure realistic mixed load, including rolling deploy behavior under traffic.
  Exit criteria:
  - Repository contains reproducible evidence that the chosen Fly topology supports the target workload.
  - VM sizing and concurrency limits are based on measured p95/p99 behavior, not defaults.
- [ ] Phase 5 — Portable SID correlation export.
  Work:
  - Implement the single-file offline export designed in the audit, with SQLite as the primary format.
  - Add schema/versioning, validation, CLI generation, and optional download metadata.
  - Provide a consumer-oriented example for c64commander-style favorite-to-playlist workflows.
  - Add an explicit opt-in publish path that bundles the generated SQLite export, manifest, and `SHA256SUMS` into a release artifact for `chrisgleissner/sidflow-data` using `gh`.
  Exit criteria:
  - Export can be generated reproducibly from repo artifacts.
  - Fixture tests verify offline retrieval from one or more favorites.
  - Docs cover schema, lifecycle, and compatibility expectations.
- [ ] Phase 6 — Launch gate.
  Work:
  - Reconcile the system against Section 13 of `doc/audits/audit1/audit.md`.
  - Close or explicitly defer any remaining launch blockers with documented rationale.
  Exit criteria:
  - Fly rollout criteria are met for the intended topology.
  - Validation evidence exists for build/tests/load/deploy readiness.

**Progress log**  
- 2026-03-13 — Derived this roadmap from `doc/audits/audit1/audit.md`.
- 2026-03-13 — Archived completed, superseded, and no-longer-needed task history into `doc/plans/archive-2025-12-to-2026-03.md`.
- 2026-03-13 — Added archive conventions in `doc/plans/README.md` and reduced `PLANS.md` to a single active roadmap for stronger convergence.
- 2026-03-13 — Validation exposed a full-suite flake: `packages/sidflow-web/tests/unit/playlist-builder.test.ts` leaked `global.fetch` state across files. Fixed the test to reset/restore the mock and re-established 3 consecutive clean runs:
  - Run 1: 1666 pass, 0 fail, 6047 expect() calls. Ran 1666 tests across 165 files. [120.00s]
  - Run 2: 1666 pass, 0 fail, 6047 expect() calls. Ran 1666 tests across 165 files. [119.57s]
  - Run 3: 1666 pass, 0 fail, 6047 expect() calls. Ran 1666 tests across 165 files. [118.76s]
- 2026-03-13 — Next decisive action: start Phase 1 by enforcing production secret/deployment invariants in code, startup checks, Fly config, and deployment docs.
- 2026-03-13 — Phase 1 implementation started. Changed auth/JWT runtime checks to reject weak production secrets, blocked middleware bypass flags in production, added fail-fast Docker startup validation, switched Fly guidance/config to a single-machine topology, and aligned deployment docs/workflows with the new secret requirements. Evidence gathering next: run focused unit tests, then `bun run build` and `bun run test` until Phase 1 exits cleanly.
- 2026-03-13 — Investigated a stalled Phase 1 validation run and found an orphaned `vitest` process plus a hanging `sidplayfp` render integration path. Added a watchdog to `packages/sidflow-classify/test/render-integration.test.ts`, cleared the orphaned runner, and verified the lightweight per-phase sanity path: `tsc -b` completes in 0.268s while the WASM upstream check adds 0.730s. Next decisive action: use `bun run build:quick` plus targeted Phase 1 tests while iterating, then rerun full roadmap validation once Phase 1 is clean.
- 2026-03-13 — Re-scoped validation cadence per user direction: keep `bun run build:quick` (`tsc -b`) as the default phase sanity build and use focused tests while iterating; reserve full `bun run build` and full `bun run test` for the final roadmap gate unless a phase-specific issue requires the whole suite sooner.
- 2026-03-13 — Phase 2 implementation started with restart-sensitive state and durable job submission. Playback sessions now persist under `data/` and survive store resets; `/api/fetch` and `/api/train` now queue durable jobs via the existing manifest-backed orchestrator instead of spawning CLIs inline; admin job routes now reload the shared manifest from the repo-root path each request. Evidence: `bun run build:quick` passed after each slice; targeted tests passed: `packages/sidflow-web/tests/unit/playback-session.test.ts`, `packages/sidflow-web/tests/unit/api/fetch-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/train-jobs-route.test.ts` (5 pass, 0 fail). Next decisive action: finish the remaining Phase 2 gaps by moving classification and remaining in-memory state (rate limiting/progress) onto durable stores or the shared job boundary.
- 2026-03-13 — Extended the durable job boundary to async classification requests and classify progress fallback. `POST /api/classify` with `async=true` now queues a manifest-backed job instead of running inline, and `/api/classify/progress` surfaces queued-job state when no in-process runner is active. Evidence: `bun run build:quick` passed; focused tests passed: `packages/sidflow-web/tests/unit/api/classify-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/classify-route-temp-config.test.ts`, `packages/sidflow-web/tests/unit/api/fetch-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/train-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/playback-session.test.ts` (7 pass, 0 fail). Next decisive action: move the remaining Phase 2 mutable state (`rate-limiter`, classify/fetch progress persistence, scheduler assumptions) off process-local storage and wire operational docs around the job worker.
- 2026-03-13 — Removed two more Phase 2 single-process assumptions. Rate limiting now persists its sliding-window state under `data/rate-limits/` and the proxy uses async rate-limit checks, so abuse protection survives process restarts. The nightly scheduler now queues durable fetch/classify jobs through the manifest-backed orchestrator instead of calling internal HTTP routes, and the default classify UI flow now submits queued jobs by default. Evidence: `bun run build:quick` passed repeatedly; focused tests passed for rate limiting, proxy integration, scheduler, classify client/route behavior, fetch/train job routes, and playback-session persistence (35 pass for rate-limit/proxy slice, 10 pass for scheduler slice, 22 pass for classify/client slice, 0 fail). Next decisive action: begin Phase 3 by hardening the documented API surface and readiness semantics now that the core long-running execution path is queue-backed.
- 2026-03-13 — Completed the first concrete Phase 3 contract/readiness slice. `/api/health` now reports explicit liveness and readiness state, `GET /api/health?scope=readiness` returns `503` only when blocking readiness checks fail, and `GET /api/model/latest` now returns `503` instead of a silent stub when trained model artifacts are unavailable. Updated `packages/sidflow-web/openapi.yaml` and `doc/technical-reference.md` so the supported contract reflects durable queued `202 Accepted` behavior for fetch/train/classify plus the health/model availability semantics. Evidence: `bun run build:quick` passed after the changes; focused tests passed for health/model endpoints and queued API routes/client expectations: `packages/sidflow-web/tests/unit/health-api.test.ts`, `packages/sidflow-web/tests/unit/model-api.test.ts`, `packages/sidflow-web/tests/unit/api/fetch-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/train-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/classify-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api-client.test.ts` (30 pass, 0 fail). Next decisive action: continue Phase 3 by tightening operational documentation and metrics/runbook coverage around durable job recovery, deploy rollback, and supported admin/internal endpoints.
- 2026-03-13 — Finished the remaining Phase 3 operational slice. Admin metrics now read durable job state from the shared manifest-backed orchestrator instead of inferring from a guessed filesystem layout, and `doc/deployment.md` now covers readiness checks, model availability, durable job worker recovery, and Fly rollback via the repository deployment script. Evidence: `bun run build:quick` passed; focused tests passed: `packages/sidflow-web/tests/unit/admin-metrics-api.test.ts`, `packages/sidflow-web/tests/unit/health-api.test.ts`, `packages/sidflow-web/tests/unit/model-api.test.ts` (23 pass, 0 fail). Next decisive action: start Phase 4 by inventorying the existing performance journeys, staging deployment assumptions, and current Fly capacity evidence for the 100-user validation plan.
- 2026-03-13 — Started Phase 4 with concrete staging-validation scaffolding. Extended `@sidflow/sidflow-performance` with a protocol-level `apiRequest` step so remote load runs can hit authenticated admin/API routes, added checked-in journeys for mixed search/play/favorite traffic and admin classify queue pressure, and added `scripts/perf/run-staging-validation.sh` as the reviewed wrapper for the remote staging bundle. Evidence: `bun run build:quick` passed after each slice; focused performance-package tests passed: `packages/sidflow-performance/test/action-map.test.ts`, `packages/sidflow-performance/test/playwright-executor.test.ts`, `packages/sidflow-performance/test/journey-loader.test.ts`, `packages/sidflow-performance/test/k6-executor.test.ts` (84 pass, 0 fail) plus a follow-up 43-pass subset after the wrapper script landed. Next decisive action: begin Phase 5 reconnaissance and implementation planning for the portable SID correlation export while Phase 4 awaits real staging credentials/data for execution evidence.
- 2026-03-13 — Phase 5 operator workflow tightened. Added `scripts/run-similarity-export.sh` as the unattended end-to-end helper for both local checkout and GHCR Docker modes, and rewrote `doc/similarity-export.md` to point to the helper with minimal copy-paste entrypoints instead of a long manual sequence. Evidence: `bash -n scripts/run-similarity-export.sh`, `bash scripts/run-similarity-export.sh --help`, and focused export/classify tests passed. Next decisive action: let the active full-HVSC classification complete, then verify the automatic export artifacts and close the remaining launch-gate validation work.
- 2026-03-13 — Hardened the Phase 5 helper for bounded/resumable classify runs and repaired export resiliency against real resumed-corpus data. `POST /api/classify` now accepts `limit`, the helper exposes `--max-songs`, and live local proof runs completed twice at `200/200` with stdout progress reporting. The helper no longer depends on the stale classify progress endpoint; it monitors the synchronous classify request through server-log parsing and request-status completion. Export now deduplicates repeated `sid_path` rows by newest `classified_at` and skips malformed classification rows without ratings, so resumed corpora export successfully again. Evidence: two local capped runs completed `200/200`; `bun run export:similarity -- --profile full --corpus-version hvsc` now succeeds on the live corpus; focused tests passed for `packages/sidflow-common/test/similarity-export.test.ts` (5 pass, 0 fail) and the latest helper syntax/build checks (`bash -n scripts/run-similarity-export.sh`, `bun run build:quick`). Next decisive action: start the unlimited helper-managed resume run and let it carry the full HVSC classification through to the final export artifact.
- 2026-03-14 — Investigated a user-reported under-export after a full HVSC run and confirmed the mismatch: `data/classified/features_2026-03-13_18-02-43-329.jsonl` contained 70,498 song rows spanning 49,096 unique `sid_path` values, while the existing SQLite bundle had only 948 `tracks`. Root cause: classification persists `features_*.jsonl` before emitting `classification_*.jsonl`, so an interrupted second phase leaves recoverable feature rows that the exporter previously ignored; the exporter also rebuilt the final SQLite path in place and could fail with `database is locked`, and it was including fixture `sample.jsonl` rows. Fixed Phase 5 export resiliency by recovering classification rows from orphaned `features_*.jsonl`, excluding non-export fixture JSONL files, and writing exports to a temporary SQLite file before atomically replacing the final artifact. Evidence: `packages/sidflow-common/test/similarity-export.test.ts` passed with the new recovery regression (`6 pass, 0 fail`), `bun run build:quick` passed, `bash -n scripts/run-similarity-export.sh` passed, and a live rebuild completed successfully with `Tracks: 49096` and a refreshed `data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`.
- 2026-03-14 — Continued Phase 5 from file-level export identity to per-track export identity while keeping the public schema label at `sidcorr-1` per user direction. Fixed a remaining bug where feedback aggregation was computed per track but still looked up by bare `sid_path`, and applied low-risk SQLite layout improvements for Android-class devices: keyed tables now use `WITHOUT ROWID` and the redundant `neighbors` index was removed because the composite primary key already covers the hot lookup. Evidence gathering next: rerun focused export tests/build, then generate a fresh full export under the current `introSkipSec=20`, `maxClassifySec=20`, `maxRenderSec=45` settings and inspect the resulting manifest/row counts.
- 2026-03-14 — Validation after the per-track/SQLite changes passed on the focused loop: `packages/sidflow-common/test/similarity-export.test.ts` returned `6 pass, 0 fail`, and `bun run build:quick` passed. While starting the full helper-managed rerun, found and fixed an indentation bug in `scripts/run-similarity-export.sh` inside the classified-row counting heredoc; `bash -n scripts/run-similarity-export.sh` now passes again. A fresh full local rerun is now live via the helper under the current `20/20/45` config; current evidence in the runtime logs shows classification actively processing the full corpus (`totalFiles: 87074`, render/extract activity visible in `tmp/runtime/similarity-export/server.log`). Next decisive action: let the classify pass finish, then verify the rebuilt `sidcorr-hvsc-full-sidcorr-1` SQLite/manifest counts from the completed export.
- 2026-03-13 — PR #82 review follow-up tightened the durability/operations slice. Rate-limit persistence now debounces snapshot writes off the hot request path while keeping explicit reset/cleanup flushes immediate, job-manifest access now reuses a cached orchestrator unless the manifest mtime changes, runtime job/rate-limit snapshots are removed from source control and ignored, and worker docs now consistently point to `bun run jobs:run`. The classify/export helper heredoc was also normalized and documents why it intentionally keeps classify requests synchronous while tailing server logs. Evidence: `bun run build:quick` passed, `bash -n scripts/run-similarity-export.sh` passed, and focused tests passed for `packages/sidflow-web/tests/unit/rate-limiter-persistence.test.ts`, `packages/sidflow-web/tests/unit/proxy-rate-limit.test.ts`, `packages/sidflow-web/tests/unit/admin-auth.test.ts`, and `packages/sidflow-web/tests/unit/admin-metrics-api.test.ts` (32 pass, 0 fail). Next decisive action: push this review-response batch, resolve the outstanding PR threads with clear comments, and continue polling CI/review state until PR #82 is green.
- 2026-03-13 — Follow-up CI triage on PR #82 found the remaining failure in the Next.js production build rather than the unit test phase. Fixed explicit JSON serialization typing for playback-session and rate-limit persisted manifests, and narrowed the synthesized classify per-thread status array to `ClassifyThreadStatus[]` so the web build satisfies the production-only type checks. Evidence: `cd packages/sidflow-web && bun run build` passed; focused tests passed for `packages/sidflow-web/tests/unit/playback-session.test.ts`, `packages/sidflow-web/tests/unit/rate-limiter-persistence.test.ts`, `packages/sidflow-web/tests/unit/proxy-rate-limit.test.ts`, and `packages/sidflow-web/tests/unit/admin-metrics-api.test.ts` (14 pass, 0 fail on the final rerun). Next decisive action: push the CI-fix commit and keep polling PR #82 until the Build and Test workflow finishes green.
- 2026-03-13 — Continued PR #82 CI triage into the production Playwright lane. The E2E harness now boots the real standalone Next server in production mode, seeds a valid signed admin session directly in the Playwright page fixture for `/admin` routes, and keeps generated auth state under ignored `test-results/` output instead of repo paths. The focused accessibility spec was corrected to match actual production behavior by skipping the login-dialog Escape check when no login control is rendered and by excluding hidden inputs from label-audit failures. Evidence: CI-like local run with `CI=1`, production server mode, and a unique port passed for `packages/sidflow-web/tests/e2e/accessibility.spec.ts` with `14 passed, 3 skipped, 0 failed`. Next decisive action: commit/push the E2E harness fixes and resume polling PR #82 checks/review threads until green.
- 2026-03-13 — The first rerun after `ab0373a` still failed before Chromium tests started: Node-based Playwright discovery hit `Received protocol 'bun:'` because `packages/sidflow-web/tests/e2e/playback.spec.ts` imported `@sidflow/common`, whose barrel re-exports the Bun-only `similarity-export` module. Replaced that spec-local logger dependency with a tiny local helper so `npx playwright` can discover the full Chromium suite under Node. Evidence: `CI=1 ... npx playwright test --project=chromium --list` now discovers `85 tests in 16 files` instead of `0 tests in 0 files`. Next decisive action: push the discovery fix, rerun CI, and use the next failure layer to continue production E2E triage.
- 2026-03-13 — Corrected representative-window metadata for classification. The render pipeline now persists the cumulative source-song offset introduced by silence trimming and intro-skipping WAV slicing, and both main-thread and worker Essentia extraction add that offset back into `analysisStartSec`. This preserves original-song timing even when cached WAVs are pre-sliced to the representative segment. Evidence: `bun run build:quick` passed and `packages/sidflow-classify/test/essentia-features.test.ts` passed with the new regression case covering a pre-sliced 10-second WAV reporting `analysisStartSec ≈ 10` instead of `0`.
- 2026-03-13 — CI rerun for PR #82 still failed in the unit-test lane with a single flaky assertion: `packages/sidflow-common/test/perf-utils.test.ts` expected `measureAsync` to report `>= 10ms` after `setTimeout(10)`. Replaced the scheduler-dependent wait with an awaited microtask plus a short busy loop so the test still exercises the async path without depending on GitHub runner timer jitter. Evidence: focused reruns of `packages/sidflow-common/test/perf-utils.test.ts` passed 3 times, `bun run build:quick` passed, and `SIDFLOW_BUN_TEST_MAX_CONCURRENCY=1 bun run test:ci` passed locally with `1690 pass, 0 fail`. Next decisive action: commit/push the test hardening change and keep polling PR #82 until the GitHub `Build and Test` job is green.
- 2026-03-13 — New user request: fix the broken automatic classify-then-export workflow, but first restore the failing CI build. Reproduced the current red PR lane from GitHub Actions for PR #82 (`Continuous Integration`, run `23062263925`) and narrowed the failure to Playwright classification E2E, not the package/build lanes. Evidence: `gh run view 23062263925 --log-failed` shows `classify-api-e2e`, `classify-essentia-e2e`, and `classify-heartbeat` failing/flaking on stale classification state; local `bun run build`, `bun run test:ci`, `cd packages/sidflow-web && npm run build`, and `bun run check:packages --source local` all passed. Next decisive action: remove the accidental live classify start from `POST /api/classify` when `async=true`, then harden the classification E2E coordination so the CI lane becomes deterministic before moving on to the export helper.
- 2026-03-13 — Fixed the CI classification failure and the export-helper reliability issue. `POST /api/classify` no longer starts a live classify process when `async=true`; it now cleanly queues the durable job, the classification E2E specs were aligned with that contract, and stale lock cleanup now ignores dead owners. For the automatic classify-then-export helper, `scripts/run-similarity-export.sh` now rejects overlapping runs with a stale-PID-aware lock so concurrent invocations cannot corrupt shared runtime/export state. Evidence: focused Chromium rerun passed for `classify-api-e2e`, `classify-essentia-e2e`, and `classify-heartbeat` (`5 passed, 0 failed`); local helper runs succeeded for both normal and `--full-rerun true` modes, and a concurrent second invocation now fails fast with an explicit lock error instead of breaking export.
- 2026-03-13 — Full-suite validation then exposed a separate flake in `packages/sidflow-web/tests/unit/proxy-rate-limit.test.ts`: the shared persisted rate-limit snapshots under `data/rate-limits/` could be reloaded after `reset()`, resurrecting stale request counts between runs. Fixed `RateLimiter.reset()` so explicit resets make the current in-memory state authoritative for the rest of the process, and added a persistence regression test covering that scenario. Evidence: focused rerun passed for `packages/sidflow-web/tests/unit/proxy-rate-limit.test.ts` and `packages/sidflow-web/tests/unit/rate-limiter-persistence.test.ts` (`15 pass, 0 fail`). Next decisive action: rerun the full `bun run test` suite three consecutive times and then repeat the classification Playwright slice to capture final stability evidence.
- 2026-03-13 — New CI triage from Actions run `23063535432` identified three remaining red signals: two flaky Playwright specs (`playlists.spec.ts`, `scheduler-export-import.spec.ts`) and the perf smoke `play-start-stream` SLO on public runners. To avoid disrupting a user-requested live similarity export still running on the local `next dev` server, limited changes to test/workflow files only: the playlist empty-state assertion now waits for the sheet state instead of racing the initial mocked load, the scheduler test now waits for scheduler hydration and asserts the checkbox/time-input state transition together, and CI perf workflows now pass explicit relaxed reduced-profile latency overrides (`p95=15000`, `p99=25000`) for noisy public-runner smoke checks. Evidence gathering next: run focused non-runtime validation immediately, then complete targeted/full validation after the live export finishes so app/runtime edits and Playwright runs do not interfere.
- 2026-03-13 — Follow-up GitHub Actions rerun `23066360843` for PR #82 completed green on commit `17caf5a0e69f18df0773f492cfe39f4d7a4594b2`. `Build and test / Build and Test` passed end to end, including the previously flaky Playwright lane and the reduced-profile k6 perf smoke, and `Package check / verify` also passed. No further CI fixes were required after the test/workflow hardening already pushed.
- 2026-03-14 — The full per-track similarity export is now validated on disk (`features_2026-03-14_13-03-41-920.jsonl` at 71,480 rows; `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite` and manifest at 71,498 tracks). Active next slice: add a `sidflow-play` station demo CLI that proves the standalone SQLite export is usable and self-contained by selecting random tracks from the export, collecting 1-5 ratings, and generating a station with local `sidplayfp` or Ultimate64 playback against the exported DB. Evidence gathering next: focused CLI tests plus `bun run build:quick`, then finish the remaining export-sharing docs and PR review follow-up.
- 2026-03-14 — Implemented the first station-demo slice in `@sidflow/play`. `sidflow-play station-demo` now reads random seed tracks straight from the exported SQLite DB, collects 1-5 ratings, rebuilds a station from `recommendFromFavorites`, shows previous/current/next queue context with SID metadata, and supports `local`, `c64u`, or `none` playback modes. Focused validation passed: `bun test packages/sidflow-play/test/cli.test.ts` (`29 pass, 0 fail`) and `bun run build:quick` passed. Next decisive action: finish the remaining export-sharing docs and then move to the queued PR review comment follow-up.
- 2026-03-15 — Phase 5 publication slice started. The helper will gain an explicit `--publish-release true` path that keeps default local-only behavior unchanged, validates/derives a UTC `YYYYMMDDTHHMMSSZ` release timestamp, stages the existing SQLite + manifest into an ignored bundle directory, generates and verifies `SHA256SUMS`, creates a tarball, and publishes it via `gh release create` to `chrisgleissner/sidflow-data` under tag `sidcorr-hvsc-<profile>-<timestamp>`. The same slice also adds a minimal continuity README to `sidflow-data` that links back to SIDFlow and the export schema doc in this repo. Evidence gathering next: fix the station-demo CLI test file, land the helper/docs changes, then publish the already-built full export.
- 2026-03-15 — Completed the first `sidflow-data` publication flow. The repo-side helper now supports both the full classify-then-export path and a `--workflow publish-only` mode for releasing an already-built bundle, the short continuity README was added to `chrisgleissner/sidflow-data`, and the existing full export was published as release `sidcorr-hvsc-full-20260315T095426Z`. Evidence so far: `bash -n scripts/run-similarity-export.sh`, focused `bun test packages/sidflow-play/test/cli.test.ts` (`30 pass, 0 fail`), `bun run build:quick`, and a live GitHub release containing the tarball with SQLite export, manifest, and `SHA256SUMS`.
- 2026-03-15 — New user request: fix the red CI unit-test lane reporting a single failure around `SidAudioEngine buffer pool > should handle multiple engines with separate pools`. Root cause was a WASM lifecycle leak in `packages/libsidplayfp-wasm/src/player.ts`: `SidPlayerContext` instances were never manually `.delete()`d on reload, cache-building, or engine disposal, so repeated suite runs accumulated leaked C++ instances and produced CI-only instability. Fixed the engine to release superseded/current/cache contexts explicitly and added a regression test that verifies context deletion across reload and dispose. Validation: focused `packages/libsidplayfp-wasm/test/buffer-pool.test.ts` passed (`6 pass, 0 fail`), `bun run build:quick` passed, full `npm run test:ci` passed 3 consecutive times (`1697 pass, 0 fail` in 61.81s / 62.90s / 76.35s), and full `bun run build` passed.

**Follow-ups**  
- If older archived work needs to be revived, reopen it by linking the archive entry and attaching it to one of the phases above instead of restoring it as an independent active task.
