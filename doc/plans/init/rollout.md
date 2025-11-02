# SIDFlow Rollout

**Required reading:** `sidflow-project-spec.md`

## Execution Rules

- Work through phases strictly in order; do not begin a new phase until the prior phase's checklist is complete.
- Before checking any box, ensure automated tests cover the change, all tests pass, and coverage remains above 90% in CI.

## Phase 1 — Monorepo & Shared Foundation

### Phase 1 Checklist

- [x] Scaffold Bun workspace with packages: `sidflow-fetch`, `sidflow-tag`, `sidflow-classify`, `sidflow-common`.
- [x] Implement `.sidflow.json` ingestion and shared logging/config utilities in `sidflow-common`.
- [x] Add GitHub Actions CI with Bun setup, build, test with coverage, and Codecov upload.
- [x] Publish `.github/copilot-instructions.md` to guide contributions and enforce strict TypeScript practices.
- [x] Bun workspace builds cleanly; `bun test --coverage` reports ≥90% coverage for foundation modules.
- [x] CI pipeline green on default branch with Codecov gate configured.
- [x] README updated with repository structure and first-run guidance referencing the spec.

## Phase 2 — HVSC Synchronization (`sidflow-fetch`)

### Phase 2 Checklist

- [x] Implement smart HVSC base/delta downloader with retry logic and checksum validation.
- [x] Persist `hvsc-version.json` with last applied versions, timestamps, and checksums.
- [x] Ensure idempotent behavior: re-running across empty or current trees leaves data consistent.
- [x] Abstract archive handling and `sidplayfp` discovery via `sidflow-common` utilities.
- [x] CLI command `sidflow fetch` syncs a sample HVSC subtree end-to-end in CI.
- [x] Unit/integration tests cover success, delta updates, and failure scenarios (network, checksum mismatch).
- [x] Documentation includes troubleshooting for network outages and checksum mismatches.

## Phase 3 — Manual Tagging (`sidflow-tag`)

### Phase 3 Checklist

- [x] Build interactive CLI that cycles through untagged `.sid` files with sequential/random modes.
- [x] Wire keyboard controls for speed (`s1-5`), mood (`m1-5`), complexity (`c1-5`), save (`Enter`), quit (`Q`).
- [x] Serialize deterministic `*.sid.tags.json` files adjacent to source SIDs with timestamps and source markers.
- [x] Integrate `sidplayfp` playback management with graceful error handling and overrides.
- [x] CLI demo covers default flow, override flags, and tag persistence with deterministic ordering.
- [x] Automated tests validate key bindings, file output, and configuration fallbacks (mocked players/filesystem).
- [x] README and in-tool help explain tagging semantics (`s/m/c`) and workflow expectations.

## Phase 4 — Automated Classification (`sidflow-classify`)

### Phase 4 Checklist

- [x] Implement WAV caching pipeline using `sidplayfp -w`, respecting `threads` and cache freshness.
- [ ] Integrate Essentia.js for feature extraction and a lightweight TF.js regressor producing `(s,m,c)`.
- [x] Merge manual and auto tags without overwriting manual values; fill gaps only.
- [x] Generate `auto-tags.json` per folder level defined by `classificationDepth`, with deterministic ordering.
- [x] Capture metadata via `sidplayfp -t1 --none` for use in tagging and future features.
- [x] CLI processes a curated HVSC sample, producing WAV cache, metadata, and aggregated auto-tag files.
- [x] Regression tests ensure manual tags take precedence and feature extraction/model steps are repeatable.
- [ ] Performance metrics recorded (runtime, cache reuse) and documented for future scaling.

Current status: the classify CLI, metadata capture, WAV cache, and auto-tag generation are live and covered by tests. Essentia.js + TF.js integration remains outstanding, so the pipeline defaults to heuristic feature and prediction helpers. We still need to capture performance metrics once the model work lands.

## Phase 5 — Personal Radio (`sidflow-play`)

### Phase 5 Checklist

- [ ] Expose playlist builder that consumes manual and auto tags to score tracks against user mood profiles.
- [ ] Support filter syntax (tempo, mood, complexity ranges) and weighted blends for on-the-fly sessions.
- [ ] Stream selected tracks through `sidplayfp` with queue controls (skip, pause, resume) and graceful fallbacks.
- [ ] Persist session history and allow exporting deterministic playlist manifests (JSON + M3U).
- [ ] Provide CLI help, examples, and integration tests covering playlist generation and playback orchestration.
- [ ] Document radio workflows in README, emphasising how classification feeds personalised queues.
