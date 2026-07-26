# Changelog


## 0.7.0 (2026-07-26)

Rebuilds how SIDFlow decides two SID tunes are alike, and regenerates the published
`sidflow-data` corpus from it.

### Station quality

- Similarity retrieval improves **243x** over the vectors in the currently published export
  (nDCG@10 0.0016 -> 0.3915) and **+156.4%** over the best configuration previously in the
  repository (0.1527 -> 0.3915), both p=0.0002. Measured on the full 87,868-track corpus with
  all 11,284 development-corpus tracks excluded, so nothing measured was used for fitting.
  (Absolute nDCG falls as a corpus grows, because each seed competes against more candidates
  for the same ten slots; the relative figure is the one that transfers across corpus sizes.)
- **A defect was suppressing that result by roughly half.** A fixed 15-second intro skip landed
  past the end of short subsongs, so 16,398 of 87,868 tracks (18.66%) had all 22 playroutine
  dimensions at the "no trace" default and 34 of the 58 similarity dimensions were a shared
  constant across a fifth of HVSC. Nothing failed and every record was well-formed. The
  analysis window now scales with song length. Corrected, the gain over the previous best rose
  from +69.1% to +156.4%.
- The stored similarity vector grows from 4 dimensions in the published export to
  **58**: 24 perceptual, 11 pitch/texture, and 23 describing how a tune's playroutine
  drives the SID chip. The manifest's `vector_dimensions` declares the width; consumers
  must not assume it.
- Most of the gain comes from describing the **playroutine** rather than the sound.
  Composers reuse their player code, and its register-write pattern is that tooling's
  signature. One such dimension separates composers better than all 24 original
  dimensions together (0.7713 against 0.7229).
- Category stations fixed: the 1-5 energy/mood/complexity scales used 3 of 5 levels with
  up to 94% of the corpus on one value. Quantile calibration puts 20.00% in each level,
  raising mood entropy from 0.397 bits to the 2.3219-bit maximum.
- Complexity now measures note density, polyphony and rhythmic vocabulary rather than
  loudness. Mood now sees harmony.
- Stations no longer repeat themselves: 54.7% of generated stations replayed a tune,
  now 6.0%.

### The published export

- Regenerated end to end through the documented `run-similarity-export.sh` workflow.
- Renders with **SIDLite**, chosen by a pre-registered paired comparison on 23,817
  identical tracks (`doc/sid-engine-comparison.md`). reSIDfp is +1.49% on the 24
  WAV-derived dimensions but fails Holm correction, reverses on cold start, and shrinks
  to +0.40% on the shipped vector because 34 of 58 dimensions read the register trace and
  are engine-identical.
- New `sid_engine` field records which SID emulation rendered the corpus, in both the
  classified records and the export manifest. The export now **refuses** a corpus that
  mixes emulations.
- Precomputed neighbours per track raised from 3 to 25.

### Reliability of the classification pipeline

- Classification now runs in bounded chunks (default 2,500 songs) rather than one long-lived
  process. A single process exhausts memory at a predictable ~3.5 GiB after tens of thousands
  of WASM instantiations and dies; chunking holds peak RSS to ~2,000 MiB and the final corpus
  pass completed with **zero crashes**, against three to fourteen per pass before.
- A resume that works: the index of already-classified songs is built by streaming the feature
  records, so it costs 948 ms and 400 MB at 87,868 records. It also validates each record and
  treats an unsound one as not-done, so a rerun repairs rather than preserves it.
- A live integrity assertion aborts a run whose records contradict themselves — a trace holding
  events cannot yield an all-zero playroutine vector — above 1% over a 500-record sample.
- Continuous memory sampling to `memory-samples.jsonl` and full crash reports under
  `logs/crash-reports/`, which is how the failure above was finally characterised.
- Thread count measured on real chunks rather than a microbenchmark: throughput is flat from 6
  to 14 threads (9.43–9.90 songs/s), so the default is 6, which leaves the most memory headroom.

### Fixes

- `recommendFromSeedTrack` served the precomputed neighbour cache whenever it held even
  one row, so with the previous default of 3 stored neighbours, a request for 100
  candidates returned 3. It now falls back to a vector scan unless the cache can serve
  the whole request.
- The documented default classify runtime could not run at all: `--runtime node` failed
  with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `@sidflow/common` re-exports modules
  importing `bun:sqlite`. Default is now `bun`.
- The tiny profile's 48-bit file identity had no collision check, so two files sharing
  one silently reported the loser's tracks under the winner's path. Collisions are now
  detected at build time and at open time, and both files named.
- Weighted cosine switched itself off for any vector not exactly 24 wide.
- The tiny profile returned zero recommendations against a real nested HVSC layout.
- Neighbour insertion took over 40 minutes for 11,284 tracks; now 48 seconds.
- Release notes no longer publish the builder's local filesystem path, and now state the
  vector width and SID emulation, read from the manifest at publish time.

### Documentation

- `doc/station-quality.md` reports the full optimisation campaign including failures,
  the four measurement defects that fabricated signal, a configuration scoring +136.9%
  that was rejected for regressing cold start by 33%, and a representation that scored
  higher but is unshippable because zero candidates clear the station's similarity
  threshold.
- `doc/sid-engine-comparison.md` pre-registers and reports the engine comparison.
- README corrected: engine default now carries its measurement, thread optimum (12)
  documented with the measured curve, and the broken Node runtime path replaced.


## 0.6.0 (2026-07-24)

- docs: record PR 94 completion
- Verify correctness of tiny export via radio station creation and comparison with full/lite export (#94)
- Add DeepWiki link to developer documentation
- chore: update CHANGES.md for 0.5.8


## 0.5.8 (2026-04-08)

- Merge pull request #93 from chrisgleissner/fix/sidcorr-tiny-release
- feat: implement fixes and enhancements for sidcorr-tiny export, including CLI validation and manifest updates
- Automated full vs tiny export comparison
- feat: add support for sidcorr-tiny export and update release asset upload script
- Add similarity export audit documentation and convergence validation script
- chore: update CHANGES.md for 0.5.7


## 0.5.7 (2026-04-07)

- Merge pull request #92 from chrisgleissner/feat/sidcorr-tiny
- Implement code changes to enhance functionality and improve performance
- fix: update Bun to 1.3.11 in CI Docker image to fix SIGILL crash
- fix: update E2E tests to pass dataset handle instead of sqlite path
- fix: resolve TypeScript errors and test threshold blocking CI
- feat: enhance tiny similarity export with songlengths integration and CI improvements
- Refactor similarity export process and enhance dataset fidelity
- feat: add tiny similarity export functionality and portable dataset interfaces


## 0.5.6 (2026-03-29)

- Merge pull request #89 from chrisgleissner/fix/oome
- fix: treat SIDFLOW_MAX_THREADS as a direct ceiling override, not a heuristic cap
- fix: enforce error handling in WASM and WAV rendering to prevent silent failures
- fix: enhance WASM renderer and CPU detection logic for improved stability and performance
- fix: implement skip-hole fix in flushIntermediate to prevent data loss on WASM errors
- Refactor WASM error handling in SidAudioEngine and classification process
- fix: add job timeout configuration and handling in WASM render pool
- Enhance multithread rendering tests and WAV renderer duration caps
- Refactor SID classification and rendering logic for improved error handling and debugging
- fix: enhance error handling for rendering failures and add tests for high-risk SID classification
- fix: use dynamic import for LanceDB connection to optimize worker thread performance
- Refactor feature extraction and rendering logic
- fix: resolve worker timeout issues and enhance rendering stability in WASM pool
- Enhance WASM Renderer Pool with Job Timeout Management and Stress Testing
- feat: update feature schema version and manifest details
- feat: enhance rendering capabilities with new classification render profiles and metadata handling
- feat: enhance stability and performance of SID classification pipeline with new rendering strategies and telemetry improvements
- chore: update CHANGES.md for 0.5.5


## 0.5.5 (2026-03-26)

- Merge pull request #88 from chrisgleissner/copilot/implement-per-song-logging
- feat: update classification E2E tests with cache-complete fixtures and add five-profile station regression
- Refactor E2E tests to use seedClassificationCacheEntry utility
- fix: update admin session cookie path to cover both admin pages and APIs
- Add validation scripts for HVSC similarity export and quality
- feat: enhance classification logging and filtering in E2E tests
- feat: implement per-song lifecycle logging for classification pipeline
- feat: add classification slowdown telemetry
- chore: initialize slowdown investigation plan
- Initial plan
- Updated logs in README.md
- chore: update CHANGES.md for 0.5.4


## 0.5.4 (2026-03-24)

- Merge pull request #87 from chrisgleissner/fix/direct-sid-classification
- Add SID files for 2/3 SIDs to exercise edge conditions
- test: improve buffer pool tests for SidAudioEngine and enhance synthetic tone verification
- feat: enhance render timeout and circuit breaker handling in WasmRendererPool and related components
- feat: implement render timeout handling and circuit breaker in WasmRendererPool
- feat: enable SID register-write trace capture during WAV rendering
- feat: implement OOM fix and data-retention cleanup in similarity export script
- Refactor libsidplayfp loading mechanism to cache default module instances
- fix: update fallback render cap to 30 seconds in tests
- feat: implement WASM module compilation caching to improve rendering performance
- feat: enhance performance instrumentation and caching for WASM module in rendering pipeline
- feat: optimize SID trace sidecar writing for improved performance and reduced syscall overhead
- feat: update rendering parameters and resource management for improved performance
- feat: add system ROMs requirements and alternative locations to README
- Merge pull request #86 from chrisgleissner/feat/improve-raw-sid-feature-extraction-performance
- feat: enhance end-to-end tests and documentation for SID feature extraction and classification
- feat: enhance documentation and examples for SID file handling and performance metrics
- feat: enhance single-pass SID classification pipeline and documentation
- feat: enhance SID trace sidecar handling and WAV rendering settings
- feat: improve performance of raw SID feature extraction by integrating trace sidecar handling
- feat: enhance dual-source classification audit and HVSC export process
- chore: update CHANGES.md for 0.5.3


## 0.5.3 (2026-03-23)

- Merge pull request #85 from chrisgleissner/feat/improve-classification-2
- test(web): stabilize browser audio fidelity checks
- fix(web): always show playlist browser controls
- feat(tests): add visibility check for playlists button in E2E tests
- fix(ci): restore decay export and stabilize wasm test
- feat: enhance performance tests with error handling and resource management
- feat: add C64U LED CLI integration and offline evaluation metrics
- Refactor code structure for improved readability and maintainability
- feat: Enhance SID-native classification by preserving WAV-derived features and improving compatibility with cached bundles
- feat: Enhance SID feature extraction and testing
- feat: add SID write tracing and feedback aggregation functionality
- fix: extend station demo fixture for C3 min_sim stability; mark Phase C/D complete in PLANS/WORKLOG
- Add comprehensive tests for queue adventure and evaluation modules
- feat: Implement metric-learning MLP for triplet and ranking pair training
- chore: update CHANGES.md for 0.5.2


## 0.5.2 (2026-03-22)

- Merge pull request #84 from chrisgleissner/feat/improve-classification
- ci: warm up /api/play before k6 perf smoke to prevent WASM-init flakiness
- feat: implement playback session stream preparation and refactor related API routes
- test(ci): stabilize render integration coverage
- fix: address Copilot PR review comments
- fix: update chunk size for sidflow-classify in coverage batch processing; enhance validation gates in WORKLOG
- fix: remove existing coverage directory before running coverage batches
- fix: adjust chunk sizes for sidflow-classify and sidflow-web in coverage batch processing
- Add unit tests for deterministic ratings and feedback sync route; implement validation script for phase A/B
- Update README formatting and headings
- Clarify SIDFlow project description [skip ci]
- Revise development status note in README [skip ci]
- docs: streamline README.md for clarity and conciseness, update installation and usage instructions
- docs: update README.md to clarify SID Flow Station usage and add CLI player description
- chore: update CHANGES.md for 0.5.1


## 0.5.1 (2026-03-22)

- Merge pull request #83 from chrisgleissner/test/coverage
- feat: complete station playlist UI hardening and interaction test matrix
- Add exhaustive interaction-level tests for SIDFlow station rendering engine
- feat: update playback sessions and improve playlist handling
- Fix E2E storage reset typecheck
- Fix batched test storage reset
- feat: implement unit coverage batching and improve playback session handling
- feat: enhance station screen rendering and playlist management
- feat: enhance station CLI with rating filters and improved navigation
- feat: integrate fixed-width star rating column in station playlist window
- Add demo-basic.prg file with initial content
- Add comprehensive tests for various API endpoints and utility functions
- Add unit tests for station dataset and playback adapters


## 0.5.0-rc3 (2026-03-21)

- fix(ci): create tmp/ dir before mktemp in docker-smoke.sh
- fix(station): preserve filter when entering edit mode; clear filterBuffer on /
- chore: remove unused demo-basic.prg file
- feat: add station screen and types for SIDFlow CLI
- chore: update CHANGES.md for 0.5.0-rc2
- Added SID CLI Station screenshot
- feat(cli): improve station screen rendering and playlist management
- feat: enhance station demo CLI with reset selections functionality
- feat: update .gitignore to include cache directory and add pull request convergence task in PLANS.md
- feat: add PR convergence prompt for merging process guidance
- feat: update README with enhanced CLI tools description and new CLI SID radio station section
- feat(cli): add interactive filter for station playlist by title or artist
- feat(cli): enhance station demo CLI with local database options
- Enhance station demo CLI and add Ultimate 64 REST API documentation
- feat: enhance docker smoke script with JSONL record count validation and improved output logging
- chore: update CHANGES.md for 0.5.0-rc1
- refactor: simplify docker smoke script by removing unused variables and adjusting paths
- feat: enhance release workflow and smoke test scripts with improved version handling and health checks
- chore: update CHANGES.md for 0.5.0
- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0
- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.5.0-rc2 (2026-03-21)

- Added SID CLI Station screenshot
- feat(cli): improve station screen rendering and playlist management
- feat: enhance station demo CLI with reset selections functionality
- feat: update .gitignore to include cache directory and add pull request convergence task in PLANS.md
- feat: add PR convergence prompt for merging process guidance
- feat: update README with enhanced CLI tools description and new CLI SID radio station section
- feat(cli): add interactive filter for station playlist by title or artist
- feat(cli): enhance station demo CLI with local database options
- Enhance station demo CLI and add Ultimate 64 REST API documentation
- feat: enhance docker smoke script with JSONL record count validation and improved output logging
- chore: update CHANGES.md for 0.5.0-rc1
- refactor: simplify docker smoke script by removing unused variables and adjusting paths
- feat: enhance release workflow and smoke test scripts with improved version handling and health checks
- chore: update CHANGES.md for 0.5.0
- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0
- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.5.0-rc1 (2026-03-15)

- refactor: simplify docker smoke script by removing unused variables and adjusting paths
- feat: enhance release workflow and smoke test scripts with improved version handling and health checks
- chore: update CHANGES.md for 0.5.0
- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0
- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.5.0 (2026-03-15)

- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0


## 0.4.0 (2025-12-21)

- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.3.48 (2025-12-14)

- Merge pull request #77 from chrisgleissner/cursor/test-suite-stability-and-fixes-44be
- Refactor: Scope E2E tests to the play tab and improve FCP check
- feat: Implement WAV file truncation and duration management
- feat: enhance Dockerfile for legacy path support and update classification duration handling
- chore: update CHANGES.md for 0.3.47


## 0.3.47 (2025-12-12)

- ci: fix fly app creation
- chore: update CHANGES.md for 0.3.46


## 0.3.46 (2025-12-12)

- ci: auto-create fly apps
- chore: update CHANGES.md for 0.3.45


## 0.3.45 (2025-12-12)

- Merge pull request #76 from chrisgleissner/feat/classification-pipeline-hardening
- fix: adjust polling parameters for classification heartbeat test to improve performance
- feat: enhance classification CLI with limit and sidPathPrefix options; improve heartbeat test for thread freshness
- chore: remove committed training JSONL artifact
- feat: enhance heartbeat mechanism to prevent stale threads during long feature extraction
- fix: rename middleware.ts to proxy.ts for Next.js 16 compatibility
- chore: update CHANGES.md for 0.3.44


## 0.3.44 (2025-12-06)

- Merge pull request #75 from chrisgleissner/feat/classification-pipeline-hardening
- fix: address PR review comments
- refactor: remove unused import and add jsonl writer queue functions
- docs: clean up PLANS.md - archive completed tasks
- fix(e2e): speed up CI by skipping slow classification tests
- fix(e2e): use correct progress endpoint to check classification status
- fix(e2e): increase classification test timeouts
- fix(e2e): wait for classification idle before starting test
- feat(classify): pipeline hardening and productionization
- feat(tests): add end-to-end tests for synthetic SID classification and REST API integration
- Refactor code structure for improved readability and maintainability
- Merge pull request #72 from chrisgleissner/fix/classify
- fix: correct comment terminology in classify-progress-store
- fix: enhance accessibility tests with improved wait conditions and retry logic
- chore: reduce verbose getPositionSeconds logging
- fix: add istanbul ignore file comments to Edge runtime files
- chore: suppress baseline-browser-mapping warnings in CI workflows
- fix: exclude middleware from Istanbul coverage to avoid Edge runtime eval error
- feat: enhance image comparison utility and improve accessibility tests
- feat: consolidate CLI argument parsing across multiple packages
- fix: enhance classification pipeline error handling and logging
- fix: update classification pipeline to use default feature extractor and predictor
- feat: add Codebase Deduplication & Cleanup task to PLANS.md
- feat: add performance journey for 'play-start-stream' with navigation and playback steps
- Remove obsolete performance test results and summary files for the 'play-start-stream' journey across multiple timestamps, including both k6 and playwright metrics. This cleanup helps maintain a tidy project structure and ensures only relevant data is retained.
- Merge main into fix/classify: resolve conflicts, add cachedFiles tracking
- Remove deprecated SIDFlow scripts: logs.sh, restore.sh, start.sh, status.sh, stop.sh, update.sh, and webhook-server.sh
- Refactor SIDFlow web documentation and remove obsolete files
- feat: implement unified performance testing framework with Playwright and k6
- feat: add support for JSON journey files with line comments
- Add comprehensive tests for state machine, middleware, and classify progress metrics
- Merge pull request #74 from chrisgleissner/copilot/fix-unit-and-e2e-tests
- Fix test permissions after Docker e2e runs
- Restore original screenshots modified by e2e tests
- Verify unit and e2e tests passing
- Initial plan
- chore: update CHANGES.md for 0.3.43
- Add scripts for SIDFlow management: logs, restore, start, status, stop, update, and webhook server

This changelog is a lightweight summary of releases; it may include some mechanical “update CHANGES.md” entries from automation.

## 0.3.43 (2025-12-02)
- Refined classify progress counters and data-testid coverage for thread metrics.
- Clarified feature extraction output visibility and terminology in docs/UI.
- Updated managed-hosting production configuration and admin credential handling.
- Cleaned README terminology (HVSC → SID Browser) and deployment notes.

## 0.3.42 (2025-11-30)
- Added classification scheduler plus export/import APIs and UI with tests.
- Exposed skip/delete options for classification runs; improved parallelism for exports/imports.
- Optimized unit/E2E tests and Playwright waits for stability.
- Deployment fixes: dynamic staging app name and corrected health-check URL.

## 0.3.41–0.3.40 (2025-11-28–30)
- Large test-speed improvements (phase transitions, accessibility waits, higher worker counts).
- Pause/resume playback sync fixes; inline rendering heartbeat and phase visibility.
- HVSC extraction reliability: p7zip-full support and richer error logging.
- Managed-hosting deployment hardening: health checks, dynamic app selection, admin password workflow.

## 0.3.39–0.3.35 (2025-11-27–28)
- Classification pipeline tightening: inline render per song, Essentia-first defaults, thread state verification.
- Docker/health adjustments: precreate workspace/data paths, roms dir, sudo-safe install paths.
- Security/health: auth-safe health checks, sidplayfp CLI rendering simplification, WAV duration fixes.

## 0.3.34–0.3.32 (2025-11-26–27)
- Added default sidplayfp.ini creation and force-rebuild flag for classification.
- Improved render engine ordering, UI display of active engines, and non-root Docker execution.
- Config tidying: preferred engines, render defaults, and CPU limit tuning for deploy scripts.

## Earlier milestones (≤0.3.31)
- 0.3.31 (2025-11-25): Unified performance runner (Playwright + k6) with deterministic tmp/results layout.
- 0.3.28–0.3.24: End-to-end classification pipeline with Essentia defaults and JSONL export; WAV render cache + songlength safeguards; improved retry/backoff.
- 0.3.20–0.3.15: HVSC fetch pipeline hardened, sidplayfp/ffmpeg integration, workspace layout finalized.
- 0.3.10: Initial public release with fetch, classify (heuristic), rate, play, and Fly/Docker deployment scaffolding.
- 0.3.9–0.3.6: Release packaging hardening (standalone Next.js bundle, size cuts, symlink handling), GHCR images, and smoke-testable artifacts.
- 0.3.5–0.3.3: CI stabilization (path filters, retries, sharding) and E2E coverage ramp.
- 0.3.2–0.3.1: AudioWorklet/SAB pipeline, telemetry, similarity search, favorites, playlists, adaptive station, and first comprehensive web rollout phases.

## 0.2.x (2025-10)
- Introduced web UI flows for browse/search/play with early rating storage.
- Added basic progress reporting for classification, initial Playwright E2E harness, and unified performance journey scaffolding.
- Release automation and Docker/Fly scripts stabilized with health checks and config defaults.

## 0.1.x (2025-09)
- First internal prototypes: HVSC fetcher, WASM-based SID rendering, heuristic ratings.
- Seeded workspace layout (`hvsc`, `audio-cache`, `tags`) and minimal CLI wrappers.
- Laid groundwork for future feature extraction and training flows.
