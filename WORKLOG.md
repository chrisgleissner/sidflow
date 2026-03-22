# WORKLOG — Release Tag CI Fix (0.5.0-RC3)

Append-only execution trace. Each entry records commands, CI results, observations, and outcomes.

---

## 2026-03-22 — Station similarity audit implementation (Phases A and B)

### Phase 0: Repo guidance and code-path discovery

Read and confirmed:
- `PLANS.md`
- `README.md`
- `doc/developer.md`
- `doc/technical-reference.md`
- `doc/research/sid-station-similarity-audit.md`

Key findings from live code inspection before edits:
- `packages/sidflow-play/src/station/queue.ts`
  - `buildWeightsByTrackId()` still uses the old aggressive mapping `5→9, 4→4, 3→1.5, else 0.1`
  - local queue-flow cosine helper is unweighted and dimension-agnostic, but there is no minimum similarity filter or deviation rejection around candidate retrieval
- `packages/sidflow-common/src/similarity-export.ts`
  - export vectors are still assembled only from `e/m/c` or `e/m/c/p` (`dims?: 3 | 4`)
  - `recommendFromSeedTrack()` and `recommendFromFavorites()` still use plain cosine on stored vectors
  - feedback aggregation there still understands only `play|like|dislike|skip`
- `packages/sidflow-classify/src/deterministic-ratings.ts`
  - deterministic tag/rating mapping exists, but there is no perceptual-vector builder yet
- `packages/sidflow-classify/src/index.ts`
  - classification JSONL currently writes ratings plus features; no 24D vector field is included
- `packages/sidflow-common/src/jsonl-schema.ts`
  - feedback actions are still limited to `play|like|dislike|skip`
  - classification schema has no explicit vector field yet
- `packages/sidflow-web/app/api/feedback/sync/route.ts`
  - route is still a stub returning `{ success: true }` without persistence
- `packages/sidflow-web/lib/server/rating-aggregator.ts`
  - aggregation is count-based only; no temporal decay is applied

Implementation order chosen:
1. Update plan/log files first
2. Land Phase A in shared similarity + station queue code with tests
3. Extend schema + classifier feature/vector pipeline
4. Upgrade similarity/export to variable dimensions and weighted cosine
5. Finish feedback sync + temporal decay
6. Produce validation artifacts and run build/tests

### Phase 1: Station core quick fixes (A1-A4)

Files changed:
- `packages/sidflow-play/src/station/constants.ts`
- `packages/sidflow-play/src/station/args.ts`
- `packages/sidflow-play/src/station/queue.ts`
- `packages/sidflow-play/src/station/index.ts`
- `packages/sidflow-play/src/sid-station.ts`
- `packages/sidflow-play/test/cli.test.ts`

Implemented:
- Reduced the minimum rated-track gate from `10` to `5`
- Updated CLI defaults/help to reflect the 5-track activation threshold
- Replaced the old aggressive weight curve with `5→3, 4→2, 3→1, 2→0.3, 1→0.1`
- Added minimum similarity thresholds: `0.82` during cold start (`<10` ratings) and `0.75` otherwise
- Added weighted centroid construction across favorite rows and rejected candidates whose `e/m/c` deviations exceed `1.5`

Focused validation:
- `packages/sidflow-play/test/cli.test.ts` — PASS after updating expectations for the stricter queue policy
- `tsc -b` quick build — PASS

### Phase 2: Schema, features, and 24D perceptual vectors (B1-B3)

Files changed:
- `packages/sidflow-common/src/jsonl-schema.ts`
- `packages/sidflow-classify/src/deterministic-ratings.ts`
- `packages/sidflow-classify/src/essentia-features.ts`
- `packages/sidflow-classify/src/essentia-frame-features.ts`
- `packages/sidflow-classify/src/index.ts`
- `packages/sidflow-common/src/similarity-export.ts`
- `packages/sidflow-classify/test/deterministic-ratings.test.ts`
- `packages/sidflow-classify/test/essentia-features.test.ts`
- `packages/sidflow-classify/test/jsonl.test.ts`
- `packages/sidflow-common/test/jsonl-schema.test.ts`
- `packages/sidflow-common/test/similarity-export.test.ts`

Implemented:
- Extended the shared classification schema with `vector?: number[]` and the new feature fields: `onsetDensity`, `rhythmicRegularity`, `spectralFluxMean`, `dynamicRange`, `pitchSalience`, `inharmonicity`, `lowFrequencyEnergyRatio`, and `spectralCentroidStd`
- Added deterministic/heuristic extraction for those features in both Essentia and fallback paths
- Added `buildPerceptualVector()` to construct a 24D vector from normalized spectral, temporal, MFCC, and derived features
- Threaded the 24D vector through both classification-record emission paths
- Upgraded shared similarity export and recommendation helpers to auto-detect vector dimensionality, preserve legacy 4D behavior, and use weighted cosine automatically for 24D vectors

Focused validation:
- Classifier/common focused tests — PASS (`32 passed, 0 failed`)
- `tsc -b` quick build — PASS after importing `buildDeterministicRatingModel` in `packages/sidflow-classify/src/index.ts`

### Phase 3: Feedback persistence and temporal decay (B4-B5)

Files changed:
- `packages/sidflow-common/src/feedback.ts`
- `packages/sidflow-web/app/api/feedback/sync/route.ts`
- `packages/sidflow-web/lib/server/rating-aggregator.ts`
- `packages/sidflow-web/tests/unit/feedback-sync-route.test.ts`
- `packages/sidflow-web/tests/unit/rating-aggregator-decay.test.ts`
- `packages/sidflow-web/tests/unit/feedback-recorder.test.ts`

Implemented:
- Extended feedback logging/types to support `play_complete`, `skip_early`, `skip_late`, `replay`, and persisted `song_index`
- Replaced the sync endpoint stub with real persistence of raw sync batches under `data/feedback-sync/YYYY/MM/DD/events.jsonl`
- Emitted aggregate-friendly implicit feedback events under `data/feedback/YYYY/MM/DD/events.jsonl`
- Applied a 90-day half-life decay model in the server rating aggregator and differentiated skip/play/replay event weights

Focused validation:
- Feedback/web focused tests — PASS (`43 passed, 0 failed`)
- `tsc -b` quick build — PASS

### Phase 4: Validation artifacts

Files added:
- `scripts/validate-phase-ab.ts`
- `doc/research/phase-ab-sample-24d-classification.json`
- `doc/research/phase-ab-validation-report.md`

Command run:

```bash
bun run scripts/validate-phase-ab.ts
```

Results written to `tmp/phase-ab-validation/` and promoted to tracked deliverables.

Measured outputs:
- Vector dimensions: `24`
- Sample classification artifact: `MUSICIANS/A/Artist/ambient-1.sid` with ratings `{ c: 2, e: 2, m: 4 }`
- Feature means:
  - `onsetDensity = 2.56`
  - `rhythmicRegularity = 0.556`
  - `spectralFluxMean = 0.274`
  - `dynamicRange = 0.558`
  - `pitchSalience = 0.646`
  - `inharmonicity = 0.414`
  - `lowFrequencyEnergyRatio = 0.210`
- Similarity ranking from ambient seed:
  - `ambient-2.sid = 0.9890891539407359`
  - `demo-hybrid.sid = 0.8984677871565525`
  - `game-drive.sid = 0.6770255496725501`
  - `game-drive-2.sid = 0.6420971850981998`
- Station coherence:
  - `meanPairwiseWeightedCosine = 0.9389623462074951`
  - `minPairwiseWeightedCosine = 0.8984677871565525`
  - `maxPairwiseWeightedCosine = 0.9890891539407359`

Next step queued:
- Run full repository `build` and `test` gates and record the final results here

---

## 2026-03-22 — Phase 5: Repository build and test validation (final gates)

### Build gate

Command: `bun run build` (installs deps, checks upstream WASM, runs `tsc -b`)
Result: **PASS** — `tsc -b` exits 0, zero TypeScript errors across all packages.
WASM upstream check emits an informational warning (upstream changed but no code
changes required for current task).

### Test gate — package-by-package results (3 consecutive runs each)

Test runner: `bun test` via `node scripts/run-bun.mjs test <package-dir>`

| Package | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| sidflow-play | 385/385 pass | 385/385 pass | 385/385 pass |
| sidflow-common | 445/445 pass | 445/445 pass | 445/445 pass |
| sidflow-classify | 287/287 pass | 287/287 pass | 287/287 pass |
| sidflow-web (unit) | 1062/1062 pass | 1062/1062 pass | 1062/1062 pass |
| sidflow-train | 23/23 pass | — | — |
| libsidplayfp-wasm + fetch + performance + rate | 173/173 pass | — | — |

All Phase A/B modified packages: **100% pass across 3 consecutive runs.**

### Timing-sensitive flaky tests (pre-existing, not related to Phase A/B)

When all packages are combined in a single bun test invocation under concurrent
scheduler pressure, 7 time-dependent tests in `cache.test.ts` and
`rate-limiter.test.ts` fail intermittently (LRUCache TTL and RateLimiter window
timeout assertions). These tests pass in isolation and were not modified in any
Phase A/B commit (confirmed via git log). They represent a pre-existing
infrastructure flakiness documented in prior WORKLOG entries.

### Convergence confirmation

All Phase A/B PLANS.md tasks are DONE. All acceptance criteria met:
- A1: min similarity threshold 0.75 (cold-start 0.82) enforced in station queue
- A2: weight mapping 5→3, 4→2, 3→1, 2→0.3, 1→0.1 applied
- A3: minimum rated tracks reduced from 10 to 5
- A4: per-dimension deviation ≤1.5 rejection applied against weighted centroid
- B1: onset_density, rhythmic_regularity, spectral_flux_mean, dynamic_range,
      pitch_salience, inharmonicity, low_frequency_energy_ratio extracted
- B2: 24D perceptual vector built deterministically from normalized features
- B3: similarity export handles 4D and 24D with auto-detected weighted cosine
- B4: sync route persists play_complete/skip_early/skip_late/replay events
- B5: 90-day half-life temporal decay applied in server rating aggregator

---

## 2026-03-21 — Phase 1: Discovery

### Observation: All release tags failing in CI

```
gh run list --workflow=release.yaml --limit=10
```

Result: Every tag from `0.3.43` through `0.5.0-rc2` has `conclusion: failure`.

### Finding the failure step

```
gh run view 23367403686 --log-failed
```

Grep for actual error:
```
mktemp: failed to create directory via template
'/home/runner/work/sidflow/sidflow/tmp/docker-smoke.XXXXXX':
No such file or directory
##[error]Process completed with exit code 1.
```

The Docker image build **succeeded** — the failure happens in the `Smoke test Docker image` step,
specifically on the very first line of `scripts/docker-smoke.sh` that calls `mktemp`.

### Root Cause

`scripts/docker-smoke.sh` line:
```bash
TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```

The `tmp/` directory is in `.gitignore` and therefore absent in fresh CI checkouts.
`mktemp` cannot create a subdirectory when the parent does not exist.

---

## 2026-03-21 — Phase 2–3: Fix

**File changed:** `scripts/docker-smoke.sh`

**Change:** Added `mkdir -p "${ROOT_DIR}/tmp"` immediately before the `mktemp` call.

```diff
 CLASSIFY_LIMIT="${CLASSIFY_LIMIT:-10}"
 HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
 READINESS_URL="${HEALTH_URL}?scope=readiness"
+# Ensure the tmp directory exists (it is gitignored and therefore absent in CI checkouts)
+mkdir -p "${ROOT_DIR}/tmp"
 TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```

---

## 2026-03-21 — Phase 4: Local Docker Build

Command:
```
docker build -f Dockerfile.production -t sidflow:rc3-local .
```

Result: **SUCCESS** — cached layers used, build completed in ~90s.

---

## 2026-03-21 — Phase 5: Local Smoke Test

Command:
```
IMAGE_TAG=sidflow:rc3-local DOCKER_SMOKE_MODE=build \
  CONTAINER_NAME=sidflow-smoke-rc3-local \
  bash scripts/docker-smoke.sh
```

Result: **SUCCESS**

Smoke test evidence:
- `mktemp` directory created successfully (fix validated)
- Container started and became healthy
- Health endpoint: `liveness=healthy`, `readiness=ready`
- Admin metrics API: responded with correct job queue data
- Playback API: returned `10_Orbyte.sid` track data
- Favorites add/list/delete: all succeeded
- Classification (limit=10): 10/10 files processed, 10 JSONL records written
- Final: `[docker-smoke] Success! Image 'sidflow:rc3-local' passed smoke test.`

---

## 2026-03-21 — Phase 6: Commit and Tag

```
git add scripts/docker-smoke.sh PLANS.md WORKLOG.md
git commit -m "fix(ci): create tmp/ before mktemp in docker-smoke.sh"
git push origin main
git tag 0.5.0-rc3
git push origin 0.5.0-rc3
```

---

## 2026-03-21 — Phase 7: CI Validation

CI run 23376286432 for tag `0.5.0-rc3`:
- Polled every 30s for ~7 minutes
- Result: **`completed/success`** ✅
- Image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`

---

## 2026-03-21 — Phase 8: GHCR Pull

```
docker pull ghcr.io/chrisgleissner/sidflow:0.5.0-rc3
```

Result: **SUCCESS** — image pulled, digest `sha256:397c0dff6a0dc00269348ebdc45d67f34d370e71a6897275ef11f21cdee39a52`

---

## 2026-03-21 — Phase 9: Functional Smoke Test (GHCR image)

Command:
```
IMAGE_TAG=ghcr.io/chrisgleissner/sidflow:0.5.0-rc3 \
  DOCKER_SMOKE_MODE=pull \
  CONTAINER_NAME=sidflow-smoke-rc3-ghcr \
  bash scripts/docker-smoke.sh
```

Result: **SUCCESS** ✅

- Container became healthy
- Health endpoint: `liveness=healthy`, `readiness=ready`
- Admin metrics API: responded correctly
- Playback API: returned track data for `C64Music/DEMOS/0-9/10_Orbyte.sid`
- Favorites add/list/delete: all passed
- Classification (limit=10): 10/10 files processed, 20 JSONL records across 2 files
- Final: `[docker-smoke] Success! Image 'ghcr.io/chrisgleissner/sidflow:0.5.0-rc3' passed smoke test.`

---

## OUTCOME: ALL TERMINATION CRITERIA MET ✅

1. ✅ Tag `0.5.0-rc3` exists and CI (release.yaml) is GREEN
2. ✅ Docker image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`
3. ✅ Image pulled from GHCR successfully
4. ✅ Container runs and health endpoint responds
5. ✅ Functional smoke: UI accessible, classify (10 songs) works, playback works
6. ✅ PLANS.md updated with final state
7. ✅ WORKLOG.md contains full trace

---

## 2026-03-21 — SID CLI Station rating-column integration

### Source of rating data

- The playlist window now sources per-track ratings from the existing station selection ratings map that is already persisted and reused by the station CLI.
- Rendering reads `state.ratings.get(track.track_id)` for each playlist row.
- Missing ratings are normalized to `0` and render as `[☆☆☆☆☆]`.

### Invalid rating handling

- Before the change, malformed persisted ratings outside `0..5` were discarded during selection-state hydration.
- That meant bad historical values such as `11` implicitly fell back to “missing”, which rendered as zero stars instead of a clamped maximum.
- The normalization layer now clamps every numeric persisted rating through a pure `normalizeRating(...)` helper:
  - `null`/missing/NaN -> `0`
  - negative -> `0`
  - greater than `5` -> `5`
  - fractional -> truncated integer, then clamped
- Regression coverage now verifies that malformed persisted values such as `11` render as `[★★★★★]` instead of disappearing.

### Layout comparison

Before:
```text
▶ 001/100 Title — Author — 1:00
```

After:
```text
001/100  ► [★★★★★] Title...  Author...  1:00 1989
```

- The playlist row layout is now a fixed column contract:
  - `index(7, right-aligned)`
  - `marker(2)`
  - `rating(7)`
  - `title(fixed width)`
  - `artist(fixed width)`
  - `duration(6, right-aligned)`
  - `extra/meta(6)`
- Column widths are resolved once per render width and reused for every row, so mixed ratings and long titles no longer shift downstream columns.

### Performance considerations

- Star rendering uses a precomputed string table for ratings `0..5` rather than rebuilding star strings for every row.
- Rating normalization is a small pure clamp/truncation helper with no I/O and no per-row dynamic width discovery.
- Playlist row widths are computed once per render call, not per row, which keeps redraw cost stable even with a long visible playlist window.

### Validation status

- Fast build: `bun run build:quick` — PASS
- Focused station tests: `packages/sidflow-play/test/cli.test.ts` — PASS after adding unit, regression, and exact-layout assertions for the new rating column
- Full build + full-suite validation: in progress

---

## 2026-03-21 — SID CLI Station deterministic TUI overhaul

### Before behavior

- Star filtering was bound to `?`, not `*`, and prompt-mode help still advertised the legacy mapping.
- `r` replayed the current song while `u` rebuilt the station, so the refresh behavior was not aligned with the visible help text or the requested spec.
- The visible filter state was mixed into a verbose shortcuts/status area instead of a dedicated unmistakable filter bar.
- The viewport logic was selection-driven, so playback and explicit play actions could reset or jump the visible window.
- ANSI redraws wrote a whole-screen string with trailing `\u001b[J`, which clears below the cursor but does not guarantee strict per-line overwrite semantics for every dynamic row.

### Phase structure for this overhaul

1. Phase 1: Input system + filters
2. Phase 2: Rendering correctness
3. Phase 3: Viewport logic
4. Phase 4: UX compression
5. Phase 5: Visual polish

### Phase 1 log

- 2026-03-21 — Audited `packages/sidflow-play/src/station/input.ts`, `packages/sidflow-play/src/station/run.ts`, and `packages/sidflow-play/src/station/screen.ts` against the target key model and filter spec.
- 2026-03-21 — Identified concrete mismatches to remove: duplicate `?` usage, legacy `f`/`u` bindings, star filter parsing that accepted optional `*` text instead of the required `*` then digit sequence, and status/help copy that still described replay/refresh semantics incorrectly.
- 2026-03-21 — Implementation started immediately after planning update. The next code changes will land in the station input, runtime, screen, and test files as one focused patch so the new key model and filter visibility stay consistent.
- 2026-03-21 — User expanded the scope mid-flight: playlists must contain unique songs only, `shuffle` must reshuffle membership-preservingly, and the Station must support saving/loading named playlists through an explicit dialog that can list prior saves.
- 2026-03-21 — Implementation decision recorded in the plan: use non-conflicting `w` = save playlist and `o` = open/load playlist. This keeps the fixed transport/filter/rating bindings intact while still exposing playlist management directly in the Station UI.
- 2026-03-21 — Implemented the deterministic Station input model, dedicated filter bar, compact controls block, playback-driven viewport handling, line-by-line ANSI redraw path, unique-song queue enforcement, and named playlist save/load persistence.
- 2026-03-21 — Validation update: `bun run build:quick` passed, and focused Station tests passed via `runTests` on `packages/sidflow-play/test/station-input.test.ts`, `packages/sidflow-play/test/station-screen.test.ts`, and `packages/sidflow-play/test/cli.test.ts` (`188 pass, 0 fail`).
- 2026-03-21 — Broader `bun run test` validation is not yet green in this session; the existing repo-level task currently exits `137` after substantial progress through the suite, so full-suite stabilization remains separate from the Station-focused fixes completed here.

### Manual validation scenarios queued for this task

- `*` then `3` filters to `>=3` stars immediately.
- `/moller` live-filters title + composer, case-insensitive.
- `*` + `/` combine as an intersection with a single visible filter bar.
- `Esc` clears active input first, then clears filters when idle.
- `Enter` plays the selected track without recentring the viewport.
- `r` performs a full refresh with no stale status or now-playing residue.

---

## 2026-03-22 — Station & Similarity System Audit

### Task

Full end-to-end audit and redesign of the SIDFlow similarity/station pipeline.

### Discovery

Mapped the complete data flow:
```
SID → WAV (11025Hz, 15s) → 35+ features (Essentia.js) → 7 sigmoid tags → 3 integer ratings [1-5]
→ vector [e,m,c,p] → SQLite/LanceDB → cosine similarity → bucket diversification → station
```

### Root Causes Proven (5)

1. **Dimensionality collapse**: 35+ features crushed to 3 integers (125 states for 50K+ tracks). Cosine similarity between `[3,4,3,3]` and `[4,4,3,3]` = 0.9978 — effectively identical despite different character.
2. **Missing perceptual dimensions**: No rhythm structure (onset patterns), timbral dynamics (spectral flux, filter sweeps), atmosphere modeling, danceability, or SID-specific features (arpeggio, voice count, waveform type).
3. **Cold-start centroid instability**: Rating 5 → weight 9x vs rating 4 → weight 4x. Ratio 90:1 (5→9 vs 1→0.1) means a single outlier highly-rated track dominates the centroid with 10 ratings.
4. **Feedback system not connected**: `POST /api/feedback/sync` accepts payloads but does not persist them server-side. No automated retraining cycle exists.
5. **No outlier rejection**: Station CLI (`buildStationQueue`) has no minimum similarity threshold. All recommendations from `recommendFromFavorites` are candidates regardless of score.

### Design Output

24D perceptual vector replacing 4D integer vector:
- 8 dims: spectral shape (continuous, not quantized)
- 6 dims: temporal dynamics (onset rate, regularity, spectral flux, dynamic range, etc.)
- 5 dims: MFCC texture
- 5 dims: derived perceptual axes (energy, mood, complexity, danceability, atmosphere)

Full redesign covers: weighted cosine similarity, confidence-aware cold start, multi-centroid intent model, metric learning self-improvement, champion/challenger safety, 4-phase roadmap.

### Output

`doc/research/sid-station-similarity-audit.md` — comprehensive research document (14 sections, all phases)
