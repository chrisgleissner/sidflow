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

### Phase 5: Full repository validation and test-harness hardening

Commands run:

```bash
bun run build
npm run test:ci
```

Observed outcomes:
- `bun run build` completed successfully
- `npm run test:ci` completed successfully with exit code `0`
- A separate local repro established that `packages/sidflow-classify/test/render-integration.test.ts` passes under direct coverage execution but can hang when the entire test run is wrapped by `scripts/run-with-timeout.sh`

Follow-up hardening change:
- Updated `packages/sidflow-classify/test/render-integration.test.ts` to avoid the Bun-based `which sidplayfp` probe, switch to `spawnSync` availability detection, reduce the sidplayfp render duration from `10s` to `2s`, tighten the watchdog window, and stop piping child stderr in the integration helper

Validation evidence:
- Direct isolated repro: `node scripts/run-bun.mjs test packages/sidflow-classify/test/render-integration.test.ts --coverage --coverage-reporter=lcov --exclude=**/*.spec.ts --exclude=**/tests/e2e/** --exclude=**/dist/**` — PASS (`17 pass, 0 fail`)
- Direct suite run written to `tmp/phase-ab-direct-1774189212/test.log` with `tmp/phase-ab-direct-1774189212/test.status = 0`

Coverage snapshot for key Phase A/B files from merged LCOV:
- `packages/sidflow-play/src/station/queue.ts` — `467/503` (`92.8%`)
- `packages/sidflow-classify/src/deterministic-ratings.ts` — `301/328` (`91.8%`)
- `packages/sidflow-classify/src/essentia-frame-features.ts` — `222/269` (`82.5%`)
- `packages/sidflow-common/src/jsonl-schema.ts` — `11/11` (`100.0%`)
- `packages/sidflow-web/app/api/feedback/sync/route.ts` — `90/105` (`85.7%`)

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

### Phase 6: CI perf-smoke investigation and fix

Problem observed from GitHub Actions:
- `Build and Test` was failing after unit tests and Playwright succeeded
- failure point was perf smoke (`k6`) with `http_req_failed` threshold crossed on `play-start-stream`

Local reproduction against the production-like standalone server:
- `GET /api/health` — immediate `200`
- `GET /api/search?q=ambient` — immediate `200` with `Test_Artist/Ambient_Dream.sid`
- `POST /api/play` — stalled before response headers when the server had no prebuilt HLS assets

Root cause:
- `packages/sidflow-web/app/api/play/route.ts` and sibling playback-entry routes awaited `ensureHlsForTrack()` on the request path
- in fresh CI containers, that forced on-demand WAV render + ffmpeg HLS generation before returning a playback session
- the reduced k6 journey treats any stalled/non-2xx request as failure, so the smoke test tripped on cold-start asset generation rather than on search or path resolution

Files changed:
- `packages/sidflow-web/lib/server/playback-stream-prep.ts`
- `packages/sidflow-web/app/api/play/route.ts`
- `packages/sidflow-web/app/api/play/manual/route.ts`
- `packages/sidflow-web/app/api/play/random/route.ts`
- `packages/sidflow-web/app/api/rate/random/route.ts`
- `packages/sidflow-web/tests/unit/playback-stream-prep.test.ts`

Implemented:
- Added `preparePlaybackSessionStreams()` to keep playback session creation non-blocking
- If stream assets already exist, sessions include them immediately
- If no stream assets exist yet, routes now kick off HLS warming in the background instead of awaiting it
- Playback sessions still return `sidUrl` immediately, so the perf smoke and legacy playback path can start without waiting for HLS generation

Validation:
- `packages/sidflow-web/tests/unit/playback-stream-prep.test.ts` — PASS
- `bun run build` — PASS
- live standalone repro after restart:
  - `POST /api/play` returned `200` immediately
  - response included `sidUrl` and `fallbackHlsUrl: null`
- exact local `perf:run` k6 smoke could not be executed end-to-end in this environment because `k6` is not installed locally (`spawn k6 ENOENT`); GitHub Actions already installs it in the workflow

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

---

## 2026-03-22 — Phase C and D implementation (similarity system redesign)

### Phase C: Advanced model changes

**C1 — Multi-centroid intent model**
- New file: `packages/sidflow-play/src/station/intent.ts`
- Exports: `buildIntentModel()`, `kMeans2()`, `interleaveClusterResults()`, `weightedCosine()`
- `buildIntentModel`: computes pairwise cosine distances; if max distance > 0.5, runs k-means k=2 (up to 100 iterations) to detect dual-cluster preferences; builds per-cluster `{ trackIds, weights, centroid }`
- `kMeans2`: seeded deterministic k-means with cosine distance; handles degenerate cases (empty clusters reset to random seed track)
- `interleaveClusterResults`: merges two arrays by alternating elements; shorter exhausted first
- `weightedCosine`: applies per-dimension group weights (spectral 1.0 / temporal 1.2 / MFCC 0.8 / derived 1.5) to produce weighted cosine similarity
- Integration: `buildStationQueue` reads `intentModel.multiCluster`; if true, calls `recommendFromFavorites` for each cluster with half-limit, interleaves, and dedupes by `track_id`

**C2 — Weighted cosine with dimension groups**
- `weightedCosine()` in `intent.ts` uses `PERCEPTUAL_VECTOR_WEIGHTS` (dims 0–7: 1.0, 8–13: 1.2, 14–18: 0.8, 19–23: 1.5)
- Added unit test to `intent.test.ts` confirming weighted ≠ unweighted for dimension-skewed vectors
- Results verified: weighted similarity differs measurably for tracks heavy in different dimension ranges

**C3 — Adventure radius expansion**
- Replaced the old score-flattening exponent with `computeAdventureMinSimilarity(adventure)`:
  - `min_sim = max(0.50, 0.82 − adventure * 0.03)`
  - adventure=0→0.82, adventure=3→0.73, adventure=5→0.67; hard floor 0.50
- `chooseStationTracks` refactored to 70/30 exploit/explore split:
  - Exploitation: tracks with `score > min_sim + 0.10` (top similarity)
  - Exploration band: `[min_sim, min_sim + 0.10]`
  - Fallback: when exploration band is empty, backfills from exploitation pool
  - Below-`min_sim` candidates never enter the station
- Added `MIN_SIMILARITY_FLOOR = 0.50` hard guard to prevent any score below floor

### Phase D: Self-improvement system

**D1 — Training pair derivation (`pair-builder.ts`)**
- Positive pairs: same-track `like` events, `play_complete` → `like` sequences, `like` + `replay`
- Negative pairs: `like` vs `dislike`, `like` vs `skip_early`
- Triplets: for each positive pair → find a negative anchor → emit `(anchor, positive, negative)`
- Ranking pairs: `(higherRatedTrack, lowerRatedTrack, 1.0 weight)`
- Output: `TrainingPairSet { positivePairs, negativePairs, triplets, rankingPairs }`
- De-duplication via sorted key to prevent duplicate pairs

**D2 — Metric learning MLP (`metric-learning.ts`)**
- Architecture: 24 → 48 → 24 (two-layer perceptron)
- Pure TypeScript, CPU-only, no external ML dependencies
- Activations: tanh (hidden) + L2 normalization (output)
- Losses: triplet loss (margin=0.2) + margin ranking loss
- Optimizer: mini-batch gradient descent (Adam-inspired momentum)
- Determinism: seeded PRNG via `seedrandom` pattern (mulberry32)
- Accepts `MetricLearningConfig { epochs, learningRate, batchSize, tripletMargin, seed }`
- Returns `MetricLearningModel { weights1, biases1, weights2, biases2, config }` (JSON-serializable)

**D3 — Evaluation system (`evaluate.ts`)**
- Five metrics: holdout accuracy, station coherence, output diversity, embedding drift, feedback correlation
- Holdout accuracy: fraction of test triplets where `d(anchor,positive) < d(anchor,negative)`
- Station coherence: mean pairwise cosine similarity of 20-track simulated station
- Output diversity: unique bucket coverage over 50 sampled tracks
- Embedding drift: mean absolute change vs identity transform (0→no drift, 1→max drift)
- Feedback correlation: fraction of pairs where liked track scores higher than disliked
- Promotion rules: pass ≥3/5 metrics (configurable `minPassCount`)
- Outputs `EvaluationResult { metrics, passed, metricsDetail }` for logging

**D4 — Retraining scheduler (`scheduler.ts`)**
- `runScheduler(config, options)`: reads feedback JSONL files from `data/feedback/`
- Trigger conditions: `eventCount ≥ minEvents (50)` OR `hoursSinceLastTraining ≥ intervalHours`
- Loads embedding vectors from `data/classified/` JSONL files
- Calls `deriveTrainingPairs → trainMetricLearningModel → evaluateModel`
- Promotes challenger to `data/model/current/` and versions old model as `v1..v5`; Enforces max 5 historical versions (prunes oldest)
- Returns `SchedulerResult { triggered, trained, promoted, rejected, reason }`

**D5 — CLI extensions (`cli.ts` + `scheduler.ts`)**
- `--rollback <n>`: finds `data/model/vN/` directory, copies back to `data/model/current/`; exits 1 if version not found
- `--list-models`: reads `data/model/` subdirectories, prints version table (version, timestamp, metrics) and exits 0
- `--auto [--force]`: calls `runScheduler`; prints triggered/no-trigger/promoted/rejected status

### Test suites written

| File | Tests | Coverage |
|------|-------|----------|
| `packages/sidflow-play/test/intent.test.ts` | 29 | kMeans2, buildIntentModel, weightedCosine, interleaveClusterResults |
| `packages/sidflow-play/test/queue-adventure.test.ts` | 29 | computeAdventureMinSimilarity, chooseStationTracks exploit/explore |
| `packages/sidflow-train/test/pair-builder.test.ts` | 13 | deriveTrainingPairs correctness + acceptance criteria |
| `packages/sidflow-train/test/metric-learning.test.ts` | 14 | MLP architecture, loss functions, forward pass, training convergence |
| `packages/sidflow-train/test/evaluate.test.ts` | 12 | each metric, promotion logic, edge cases |
| `packages/sidflow-train/test/scheduler.test.ts` | 5 + 5 CLI | trigger logic, scheduler-CLI integration |

### Validation results

**Build**: `tsc -b` exits 0. No TypeScript errors.

**Test run 1** (2026-03-22):
- common: 445/0
- classify: 287/0
- play: 414/0
- train: 65/0
- fetch/rate/perf: 128/0

**Test run 2** (2026-03-22):
- common: 445/0
- play: 414/0
- train: 65/0
- fetch/rate/perf: 128/0
- classify: 287/0

**Test run 3** (2026-03-22):
- Combined (non-classify): 1052/0
- classify: 287/0

All three runs: **0 failures**. Phase A/B not regressed.

### Notable bug fixed during validation

During run 2, 3 `runPlayCli` tests failed with "only N long-enough station tracks were available; at least 100 required." Root cause: `createStationDemoFixture` generated tracks with `energy = 0.99 − index × 0.003` (bottoming at 0.57 for index 140). With adventure=3, `min_sim = 0.73`. When SQLite's `ORDER BY RANDOM()` selected seed tracks that included outlier tracks (songs 7/8 with vector `[0,1,0]`), the resulting centroid fell below the cluster, causing many generated tracks to fail the similarity floor.

Fix: extended the fixture from index 13..140 to 13..250, changing the energy formula to `max(0.848, 0.99 − (index−13) × 0.0006)` so all generated tracks have energy ≥ 0.848 and cosine similarity ≥ 0.985 to any cluster centroid, guaranteeing ≥200 candidates above `min_sim=0.73` regardless of seed selection.

### Phase C and D — COMPLETED 2026-03-22
