# Changelog


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

This changelog highlights only the meaningful releases and milestones. Routine “update CHANGES.md” noise is removed.

## 0.3.43 (2025-12-02)
- Refined classify progress counters and data-testid coverage for thread metrics.
- Clarified feature extraction output visibility and terminology in docs/UI.
- Updated Fly.io production configuration and admin credential handling.
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
- Fly.io deployment hardening: health checks, dynamic app selection, admin password workflow.

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
