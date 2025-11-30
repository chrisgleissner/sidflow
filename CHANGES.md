# Changelog


## 0.3.42 (2025-11-30)

- Merge pull request #71 from chrisgleissner/copilot/configure-classification-pipeline
- fix: improve pause-resume-position test stability by removing waitForTimeout
- fix: improve E2E test stability with better wait conditions
- fix: add error handling to E2E test helper function
- perf: update browserslist and optimize unit/E2E test efficiency
- fix: remove fly.io mentions and normalize time format with leading zeros
- feat: pass skipAlreadyClassified and deleteWavAfterClassification through CLI
- Update packages/sidflow-web/lib/scheduler.ts
- Update packages/sidflow-web/app/api/scheduler/route.ts
- test: add integration tests for scheduler and export/import API endpoints
- perf: parallelize export collection, import writes, WAV cleanup, and cache auto-tags checks
- feat: add scheduler and export/import UI components with E2E tests
- Update packages/sidflow-web/tests/unit/lib/scheduler.test.ts
- Update packages/sidflow-classify/src/index.ts
- Update packages/sidflow-web/lib/scheduler.ts
- fix: address code review comments for scheduler implementation
- feat: add scheduler initialization and classify options for skip/delete
- feat: add scheduler API and classification export/import endpoints
- feat: add scheduler and classification skip logic for nightly pipeline
- Initial plan
- Merge pull request #70 from chrisgleissner/copilot/fix-deployment-failure
- Add resource allocation comments to fly.prd.toml
- Add fly.prd.toml and improve production deployment workflow
- Initial plan
- chore: update CHANGES.md for 0.3.41


## 0.3.41 (2025-11-30)

- Merge pull request #69 from chrisgleissner/copilot/optimize-test-execution-time
- Address code review: use spinner check instead of domcontentloaded for action waits
- Stabilize flaky accessibility tests: replace networkidle with condition-based waits
- Optimize E2E tests: increase workers to 4, reduce timeouts, replace fixed waits with conditions
- Address code review: use precise string matching for test file validation
- Optimize phase-transitions test: reduce from ~174s to ~2.4s
- Initial plan
- Merge pull request #68 from chrisgleissner/copilot/ensure-valid-thread-transitions
- Fix heartbeat blocking: use WasmRendererPool for inline rendering in generateAutoTags
- Add progress callbacks to WAV rendering for heartbeat support
- Optimize Essentia.js feature extraction with downsampling and instance caching
- Add WASM backend support for TensorFlow.js and document Essentia.js bottleneck
- Fix flaky E2E tests: pause-resume position and accessibility
- Fix test timeouts: skip slow TensorFlow tests in CI and update bunfig timeout
- Revert playwright config changes, use mock-based test to avoid CI slowdowns and screenshot issues
- Revert accidentally committed screenshot changes
- Reduce sidflow-classify stub delays from 500ms to 10ms to speed up E2E tests
- Update packages/sidflow-web/tests/stubs/sidflow-classify
- Update packages/sidflow-web/tests/stubs/sidflow-classify
- Complete: Classification phase transitions E2E test with stable thread state verification
- Remove temp config file from git tracking and add to gitignore
- Fix E2E tests for classification phase transitions with proper stub and test design
- Initial plan
- chore: update CHANGES.md for 0.3.40


## 0.3.40 (2025-11-28)

- feat: Enhance HVSC archive extraction with p7zip-full support and improved error logging
- feat: Enhance Fly.io deployment process with dynamic app name, updated health check, and new deployment scripts
- feat: Update Fly.io deployment workflow to use dynamic staging app name and fix health check URL
- feat: Fix pause/resume synchronization issue by preserving playback position
- feat: Implement heartbeat mechanism for inline rendering and enhance classification phase visibility
- chore: update CHANGES.md for 0.3.39


## 0.3.39 (2025-11-28)

- feat: Enhance classification pipeline and user experience
- feat: add task for inline rendering and classification per song to improve workflow efficiency


## 0.3.37 (2025-11-27)

- docs: note docker health fix coverage
- fix: add 'roms' directory creation in Dockerfile.production for improved structure
- fix: precreate workspace/data subdirectories in Dockerfile.production for improved permissions and testing
- chore: update CHANGES.md for 0.3.36


## 0.3.36 (2025-11-27)

- refactor: simplify target duration handling in renderWavWithEngine function
- fix: update directory creation in Dockerfile and adjust logging in PLANS.md for improved clarity
- fix: use /opt/sidflow/tmp instead of /tmp to avoid space issues
- feat: update active tasks in PLANS.md for Docker health check and WAV rendering improvements
- feat: add WAV length verification script to ensure correct durations against HVSC database
- chore: update CHANGES.md for 0.3.35


## 0.3.35 (2025-11-27)

- feat: add symlink for config resolution and update Docker environment for CLI scripts
- chore: update CHANGES.md for 0.3.34


## 0.3.34 (2025-11-27)

- security: revert insecure health check bypass mechanism
- feat: health check bypasses auth using internal header
- fix: make health check more lenient for CI smoke tests
- perf: remove redundant chown in Dockerfile.production
- fix: install.sh now correctly uses sudo for privileged operations
- chore: update CHANGES.md for 0.3.33


## 0.3.33 (2025-11-27)

- fix: remove obsolete middleware.ts file
- feat(deployment): Update Fly.io configuration and deployment scripts
- feat: mark WAV rendering simplification task as complete
- Simplify WAV rendering: Let sidplayfp-cli use Songlengths.md5 directly
- Fix WAV duration truncation (15s → correct durations)
- feat: add task for investigating WAV duration truncation issue during classification
- feat: integrate RenderOrchestrator for sidplayfp-cli rendering and improve argument formatting
- chore: update CHANGES.md for 0.3.32


## 0.3.32 (2025-11-26)

- feat: add default sidplayfp.ini creation and configuration in docker startup script
- feat: add force rebuild option to classification process with confirmation prompt
- fix: increase CPU limit for deployment resources in install script
- refactor: update Dockerfile and install script for consistent non-root execution
- feat: enhance classification process with effective engine order and UI updates
- feat: enhance classification process with render engine tracking and UI display
- refactor: remove unused engine preference handling in classify CLI arguments
- fix: optimize tmpfs configuration in installation script for better resource management
- chore: update CHANGES.md for 0.3.31


## 0.3.31 (2025-11-26)

- refactor: improve workspace and data directory handling in health checks and installation scripts
- chore: update CHANGES.md for 0.3.30


## 0.3.30 (2025-11-26)

- Add scripts for SIDFlow management: logs, restore, start, status, stop, update, and webhook server
- feat: add task to reproduce Docker build and verification locally
- fix: update model configuration and replace outdated screenshots
- chore: update CHANGES.md for 0.3.29


## 0.3.29 (2025-11-26)

- fix: update E2E test configuration to use environment variables for base URL and server host
- Merge pull request #67 from chrisgleissner/copilot/fix-health-check-endpoints
- fix: add missing parseHostAndPort helper function for health check
- chore: disable deployment jobs until Cloudflare tunnel is configured
- fix: add missing permissions block to deploy-prd job
- Changes before error encountered
- fix: address code review feedback on deployment scripts and workflow
- feat: add deployment scripts and automated CI/CD workflow for Raspberry Pi
- Update packages/sidflow-web/app/api/health/route.ts
- Update packages/sidflow-web/tests/unit/health-api.test.ts
- Update docker-compose.production.yml
- Update doc/deployment.md
- fix: address code review feedback - improve IPv6 handling and test readability
- fix: health check treats Ultimate64 and streaming assets as optional, use correct U64 defaults
- Initial plan
- chore: update CHANGES.md for 0.3.28


## 0.3.28 (2025-11-25)

- Merge pull request #66 from chrisgleissner/copilot/fix-docker-image-health-check
- Fix Docker image health check by setting /app ownership before chmod
- Initial plan
- chore: update CHANGES.md for 0.3.27
- chore: update CHANGES.md for 0.3.27


## 0.3.27 (2025-11-24)

- perf(docker): consolidate RUN layers to restore build speed
  - Reduced Docker RUN statements from 13 to 10
  - Consolidated security hardening steps into single layer
  - Restores build time from ~10min (0.3.26) to ~5min (0.3.24 level)
  - Maintains all security verification and hardening features
- chore: update CHANGES.md for 0.3.26


## 0.3.26 (2025-11-24)

- fix(docker): improve diagnostics and smoke test reliability
- chore: update CHANGES.md for 0.3.25
- NOTE: This release had Docker build performance regression (2x slower) fixed in 0.3.27


## 0.3.25 (2025-11-24)

- Merge pull request #64 from chrisgleissner/fix/performance-and-security-hardening
- docs: update PLANS.md with Session 5 test fixes
- fix: achieve 100% unit test pass rate and stable E2E coverage
- Refactor Babel configuration and enhance E2E coverage setup
- docs: update PLANS.md with Session 4 E2E coverage aggregation fix
- fix: aggregate E2E coverage files into lcov.info for merge
- ci: add BABEL_ENV=coverage to E2E test command
- fix: enable E2E coverage instrumentation with BABEL_ENV=coverage
- fix: remove broken indexeddb-mock.ts that broke E2E coverage builds
- fix: correct test requirements in AGENTS.md and remove invalid test
- fix: correct typo in normalizeForDeterministicSerialization function call and remove redundant date handling test
- docs: update PLANS.md - Phase 2 restructured for E2E coverage approach
- feat: integrate E2E coverage with unit tests for Codecov
- docs: update PLANS.md with coverage progress (74.26% → 74.38%)
- test: add createPlaybackLock tests (78.41% → 86.36%)
- test: add ultimate64-capture edge case tests (68.29% → 94.30%)
- fix: resolve failing tests and enforce 100% pass rate requirements in plans
- fix: correct broken tests to achieve 100% pass rate
- test: enhance coverage with additional test cases for various modules
- Merge pull request #65 from chrisgleissner/copilot/sub-pr-64
- test(engine-factory): add comprehensive tests for engine creation and overrides
- fix: Update docker-startup.sh to redact correct env variable names
- fix(plans): Update active tasks and improve coverage goals in PLANS.md
- Update Dockerfile.production
- Update performance/journeys/play-start-stream.json
- Update scripts/docker-startup.sh
- Update scripts/docker-startup.sh
- Update Dockerfile.production
- Update Dockerfile.production
- Initial plan
- Update .github/workflows/performance.yml
- docs(plans): Archive tasks for local Docker build and release packaging reliability
- docs(plans): Archive completed tasks and clean up PLANS.md
- fix(perf): Update plans and enhance performance test journey for reliability
- docs(plans): Mark all validation tasks complete
- docs(plans): Document complete fix for performance test failures
- fix(perf): Add track-firstResult testid to AdvancedSearchBar and fix journey
- fix(perf): Add static asset copy step for standalone server
- docs(plans): Update performance test fix progress
- fix(perf): Fix nightly performance test failures
- fix(perf): set NODE_ENV=development for performance tests
- chore: update CHANGES.md for 0.3.24
- fix(perf): enable SIDFLOW_RELAXED_CSP for Next.js hydration


## 0.3.24 (2025-11-24)

- Merge pull request #63 from chrisgleissner/cursor/harden-production-docker-image-security-gpt-5.1-codex-25ec
- Add task for Production Docker Security Hardening
- chore: update CHANGES.md for 0.3.23


## 0.3.23 (2025-11-23)

- feat(release): auto-generate CHANGES.md from commits on tag push


## 0.3.10 (2025-11-22)

- feat: Generate package.json for standalone build without workspace dependencies

## 0.3.9 (2025-11-22)

- Update PLANS.md
- Update Dockerfile.production
- feat: Enhance Docker setup with smoke testing and deployment documentation
- feat: Add Docker release image and GHCR publishing

## 0.3.8 (2025-11-21)

- fix(release): package only required .bun modules (~20MB vs 249MB)

## 0.3.7 (2025-11-21)

- fix(release): correct next module dereferencing logic
- fix(release): dereference Next.js symlinks before packaging to avoid .bun bloat
- fix(release): include standalone .bun directory in release package for module resolution
- fix(release): use NODE_PATH for module resolution and reduce health check timeout to 10s
- fix(release): use NODE_PATH for Next.js module resolution instead of symlinks
- fix(release): create next symlink in standalone build for smoke test compatibility
- fix(release): correct YAML syntax errors in workflow
- fix(ci): prevent Copilot Setup workflow from triggering on tag pushes

## 0.3.6 (2025-11-21)

- fix(release): dereference Next.js symlinks before packaging to avoid .bun bloat
- fix(release): include standalone .bun directory in release package for module resolution
- fix(release): use NODE_PATH for module resolution and reduce health check timeout to 10s
- fix(release): use NODE_PATH for Next.js module resolution instead of symlinks
- fix(release): create next symlink in standalone build for smoke test compatibility
- fix(release): correct YAML syntax errors in workflow
- fix(ci): prevent Copilot Setup workflow from triggering on tag pushes

## 0.3.5 (2025-11-21)

- fix(release): use NODE_PATH for module resolution and reduce health check timeout to 10s
- fix(release): use NODE_PATH for Next.js module resolution instead of symlinks
- fix(release): create next symlink in standalone build for smoke test compatibility
- fix(release): correct YAML syntax errors in workflow
- fix(ci): prevent Copilot Setup workflow from triggering on tag pushes

## 0.3.4 (2025-11-21)

- fix(release): create next symlink in standalone build for smoke test compatibility
- fix(release): correct YAML syntax errors in workflow
- fix(ci): prevent Copilot Setup workflow from triggering on tag pushes

## 0.3.3 (2025-11-21)

- fix(release): correct YAML syntax errors in workflow
- fix(ci): prevent Copilot Setup workflow from triggering on tag pushes

## 0.2.2 (2025-11-21)

- fix(release): update tag handling in release workflow for better versioning
- fix(release): update smoke test error handling and log upload condition
- fix(release): add ".bun" to ignored directories in package release script
- fix(release): adjust packaging to retain runtime dependencies after artifact inspection
- fix(release): improve release packaging reliability with enhanced logging and aggressive pruning
- fix(release): enhance release preparation to include previous tag in changelog entry
- chore: remove outdated coverage analysis document
- fix(release): update artifact handling in release workflow for consistency and clarity
- fix(release): update artifact handling in release workflow for improved clarity and efficiency
- fix(release): update release workflow to use dynamic ref and export additional variables
- feat(release): enhance packaging by preserving symlinks and ignoring dangling references
- fix(release): enhance changelog extraction and output handling in release workflow
- docs: update PLANS.md with release automation work
- feat(release): automate release preparation on tag push
- docs: add release build investigation task to PLANS.md
- fix(release): improve release build and smoke test resilience
- docs: update PLANS.md with final task completion status
- fix(ci): configure Git safe directory for release workflow
- Improve performance test resilience: add error handling and relaxed thresholds for UI element visibility
- Refactor formatting in startPlayback step to improve readability
- Enhance test suite: enable skipped tests, fix failing tests, and update documentation
- Remove duplicate pacingSeconds parameter in performance runner (#55)
- Fix TypeScript error in runCommandWithRetries call
- Replace (step as any) with proper type narrowing in playwright-executor.ts
- refactor: improve type validation to avoid any type assertions
- Simplify type narrowing by relying on TypeScript discriminated unions
- Add comprehensive unit tests for @sidflow/performance package
- chore: remove accidentally committed test results and add to gitignore
- Add proper type guards for JourneyStep union types and fix function call
- fix: remove 'as any' type assertion and add proper ExecutorKind validation
- Initial plan
- Update packages/sidflow-performance/src/runner.ts
- Initial plan
- Initial plan
- Initial plan
- Update packages/sidflow-performance/src/runner.ts
- feat(performance): add new performance journey and results for play-start-stream
- Update PLANS.md and archive performance testing documents for unified rollout plan
- Clarify docstring to accurately describe script responsibilities
- Add NotADirectoryError handler and improve CLI help text
- Fix docstring to accurately reflect raised exceptions
- Address code review feedback: fix unused parameter and add specific exception handling
- Extract inline Python script to separate file for better maintainability
- Update README.md
- Update .github/workflows/release.yaml
- Initial plan
- Update .github/workflows/release.yaml
- Add additional game-soundtrack tests to improve coverage toward 75% target
- Fix failing remix-radar test and improve E2E coverage collection reliability
- Add unit tests for search path parsing utility
- Move import to top and add edge case tests for numeric parameters in job-runner
- Add LRU semantics test for key overwrite behavior in cache
- Update packages/sidflow-web/tests/unit/cache.test.ts
- Update packages/sidflow-common/test/job-runner.test.ts
- Update packages/sidflow-web/tests/unit/songlengths.test.ts
- Update packages/sidflow-web/tests/unit/rate-playback-utils.test.ts
- Add unit tests and E2E coverage infrastructure with full browser-side coverage collection
- Enable E2E coverage collection for all test files via Babel instrumentation
- Add unit tests and E2E coverage infrastructure to reach 80% total coverage
- Enable E2E test coverage collection via Istanbul/NYC instrumentation
- feat: Replace npm publish with release zip artifact
- Add tests for rate-playback utils and personal ratings validation
- Add comprehensive unit tests for cache, songlengths, and job-runner modules
- Initial plan
- Update doc/testing/coverage-baseline.md
- Update doc/testing/coverage-baseline.md
- Update doc/testing/coverage-baseline.md
- Add comprehensive coverage analysis document
- Fix: Configure proper coverage baseline and exclusions
- Initial plan
- feat(ci): Consolidate build and test jobs, streamline coverage uploads, and enhance Playwright report handling
- feat(tests): Increase timeouts and add retry logic for CI stability in E2E tests
- feat(tests): Remove Playwright browser caching steps and streamline installation in CI workflow
- feat(tests): Update E2E test sharding to 5 shards and adjust coverage report handling
- feat(ci): Update coverage upload condition to depend on test results
- feat(build): Enhance build and test workflow with improved caching and project build steps
- feat(tests): Refactor E2E and unit test workflows for improved structure and caching
- feat(tests): Enhance WASM loading tests with timeout and cleanup logic
- feat(build): Update build process and caching for improved performance
- feat(tests): Implement sharding for E2E tests and update coverage reporting
- feat(tests): Update advanced search E2E test to increase timeout for pause button visibility
- feat(tests): Update E2E tests for FavoritesTab, Playlists, and Song Browser; improve performance metrics and error handling
- feat(accessibility): Improve ARIA labels and enhance accessibility in various components
- feat(tests): Enhance E2E and unit test coverage, improve accessibility, and fix flaky tests
- Add end-to-end tests for social features, song browser, and telemetry validation
- feat(audit): Complete first and second rounds of codebase audit and documentation accuracy review
- fix: resolve Next.js build errors and Playwright test conflicts
- Fix TypeScript compilation error for 7zip-min module
- fix: format code in coverage.ts for improved readability
- test: add comprehensive tests for loadLibsidplayfp and environment detection
- fix: update test exclusions and skip flaky synthetic C4 tone verification
- Add comprehensive tests for audit trail, chip model normalization, JSONL schema, and playback lock functionality
- feat: implement buffer pool in SidAudioEngine to optimize memory usage during playback
- feat: Add TypeScript declarations for 7zip-min module and update web screenshots
- feat: Implement in-memory metadata cache with LRU eviction and automatic invalidation
- feat: clarify render engine terminology and enhance documentation across user guide, technical reference, and UI components
- feat: enhance documentation and clarify classification methods in README and technical reference
- Add performance test suite for SIDFlow web UI with full HVSC collection
- feat: enhance image comparison utility and add e2e tests for social features
- feat: add user registration and authentication components
- docs: update PLANS with Step 9 completion and test status
- fix: relax timing tolerances for performance tests under load
- fix: exclude E2E specs from bun test runs
- chore: gitignore playlist test artifacts and update PLANS
- feat(playlist): implement Step 9 playlist management
- fix(tests): relax timing thresholds in audio continuity test for CI stability
- docs(plans): mark Step 8 complete, document known flaky test
- feat(play-tab): complete Step 8 - Advanced Search & Discovery
- Increase FAST_AUDIO_TESTS timeouts to reduce flakiness
- Fix TypeScript compilation error in worker file
- fix: update pull request branch filter to allow all branches
- feat: document E2E runtime improvements and performance optimizations
- feat: enhance E2E tests with fast audio mode and skip song browser actions
- feat: implement fast audio testing mode for improved E2E test performance and stability
- feat: enhance E2E testing and logging by suppressing benign error logs and profiling additional specs
- feat: update E2E tests and documentation for improved performance and stability
- feat(plans): add comprehensive multi-hour execution plan for SIDFlow tasks
- feat: enhance favorites API logging and add skip option for song browser actions
- feat: enhance security headers with relaxed CSP options for development
- Addressing PR comments
- Standardize all Promise.race to Promise.any and complete timeout constant migration
- Update packages/sidflow-web/tests/e2e/favorites.spec.ts
- Final e2e test stabilization - improve waits and reduce parallelism
- Improve test reliability - replace waitForTimeout with proper waits
- Fix worklet loading - build worklet before starting test server
- Initial e2e test run - establishing baseline
- Initial plan
- fix: remove unnecessary whitespace in CLASSIFY tab verification
- feat: add loading wait times in E2E tests for Favorites and Play tab features
- feat: implement caching for API responses and database connections
- refactor: Improve end-to-end tests for Favorites and Song Browser features by optimizing timeouts and removing unnecessary waits
- fix: Clean up whitespace in E2E test files for consistency
- Enhance user experience with Phase 1 features: - Added smart search with real-time results and keyboard shortcuts. - Introduced favorites collection with dedicated tab and sync across sessions. - Implemented top charts for community insights and track metadata. - Enhanced keyboard shortcuts for improved navigation. - Developed a theme system with multiple options and persistence. - Created ML-powered station feature for personalized radio from songs. - Improved rating display with personal and community ratings. - Added HVSC browser for easy navigation of song collections. - Implemented volume control with visual feedback. - Introduced recently played history tracking and management.
- refactor: Simplify WASM request handling in playback end-to-end tests
- feat: Implement SIDFlow Web Server Rollout Plan and Tasks
- feat: update package.json with new testing libraries and fix formatting issues
- fix: skip audio encoding tests when ffmpeg unavailable and exclude E2E tests from unit test run
- test: Verify test stability across multiple runs
- fix: Resolve E2E test failures and keyboard shortcuts integration
- test: Fix IndexedDB test isolation issues
- docs: Update PLANS.md - Phase 1 nearly complete
- feat(charts): Implement Top Charts feature (Step 5)
- refactor: Optimize FavoriteButton with shared context
- refactor: Use stringifyDeterministic for localStorage serialization
- feat(keyboard): Implement global keyboard shortcuts (Step 4 complete)
- refactor: Address code review feedback
- docs: Remove AI terminology and boastful language from user-facing docs
- feat(search): Implement basic search functionality
- feat(history): Implement Recently Played history tracking
- test(favorites): Add comprehensive E2E tests for favorites feature
- feat(favorites): Add favorites UI components and integration
- feat(favorites): Implement favorites API with full test coverage
- feat: Add favorites schema to WebPreferences
- docs: Add strategic feature analysis and Phase 1 enhancement plan
- Initial plan: Create USP and competitive analysis document
- feat: Implement adaptive station API with session-based recommendations
- Initial plan
- feat: Implement remix radar functionality with API endpoint and helper methods
- feat: Implement SID chip model normalization and update related configurations
- feat: Enhance audio continuity and playback tests with relaxed tolerances
- refactor: rename HVSC to SID in paths and error messages
- refactor: improve formatting in loadConfig function for better readability
- feat: update PLANS.md with maintenance and structure rules; add Table of Contents section
- feat: implement crossfade functionality in SidflowPlayer
- refactor: format model.json for improved readability and structure
- feat: enhance configuration resolution and add unit tests for server environment
- perf: add in-memory caching to rating aggregator with 5-minute TTL
- Update packages/sidflow-web/lib/server/rating-aggregator.ts
- Update packages/sidflow-web/tests/unit/similarity-search.test.ts
- Update packages/sidflow-web/lib/personal-ratings.ts
- Update packages/sidflow-web/components/PlayTab.tsx
- Update packages/sidflow-web/app/api/play/station-from-song/route.ts
- chore: untrack data files that grow on each build per review feedback
- feat: complete phases 4 & 5 - add station sliders, personal ratings, and E/M/C tooltip
- docs: update PLANS.md with completed phases 4 and 5
- feat: add aggregate rating display with trending badges and star visualization
- feat: add Start Station button and unit tests for similarity search
- Refine assumptions and questions in PLANS.md
- feat: add station-from-song API endpoint and similarity search library
- Initial plan for Play tab phases 4 and 5
- Initial plan
- docs: final summary - all tests passing, >90% coverage achieved
- fix: update e2e test selectors for Radix UI components - all 16 tests passing
- fix: respect existing SIDFLOW_CONFIG in start-test-server and fix absolute path handling
- docs: add E2E testing guide for remote agent sessions and fix test selector
- fix: add SIDFLOW_CONFIG env var support and use absolute path in playwright config
- refactor: rename HVSC-specific components to generic names for broader SID collection support
- fix: remove broken references to expandedFolders state
- Update packages/sidflow-web/components/PlayTab.tsx
- Update packages/sidflow-web/tests/unit/hvsc-playlist-builder.test.ts
- Update packages/sidflow-web/components/HvscBrowser.tsx
- Implement Play tab phases 1-3: volume control, HVSC browser, and folder playback modes
- docs: update PLANS.md marking phases 1-3 complete
- test: add E2E tests for HVSC browser and volume control
- feat: implement HVSC browser UI and folder playback modes (phases 2-3)
- Initial plan for Play tab feature phases 1-3
- Initial plan
- docs: Update PLANS.md with completion status
- test: Refactor volume control tests to use real player instances
- fix: Address PR review feedback
- feat: Add HVSC folder browse API
- docs: Add comprehensive Play tab enhancement plan
- feat: Add volume control to Play tab
- Complete Steps 8-9: Add render engine integration tests
- Initial plan for steps 8-9 and play tab enhancements
- Initial plan
- Add documentation audit summary and fix production checklist env vars
- Add Web UI access points and release readiness documentation
- Initial analysis complete - preparing documentation improvements
- Initial plan
- Fix documentation: Add missing API docs, revert test artifacts, update .gitignore
- Apply suggestions from code review
- Apply suggestion from @Copilot
- Documentation cleanup: Archive historical plans, add comprehensive package READMEs
- Complete Phase 3-6: Final documentation and code cleanup, update CHANGES.md
- Phase 2.4-2.6: Update README cross-references, verify tests pass
- Phase 2.2-2.3: Add comprehensive package READMEs and fix cross-references
- Phase 2.1: Organize historical plans into archive directory
- Initial analysis: documentation and code cleanup plan
- Initial plan
- Addressing PR comments
- Address code review feedback: extract font check, remove unused utils, fix timeouts
- Add e2e test resilience guide reference to AGENTS.md
- Add reusable resilience utilities and refactor screenshot tests
- Add comprehensive E2E test resilience documentation
- Stage 1: Implement immediate stability fixes for flaky e2e screenshot tests
- Initial analysis of flaky e2e test issue
- Initial plan
- revert: remove testOrSkip logic - tests will fail if ffmpeg not available
- fix: restore classify screenshot and add wait for page content rendering
- docs: update PR description with final test results and security summary
- fix: add ffmpeg to CI and make audio encoding tests skip gracefully when unavailable
- Initial investigation: identified ffmpeg missing from CI causing test failures
- Initial plan
- feat(web): update CSP to allow data URLs for Playwright E2E tests and add corresponding unit tests
- feat(web): complete render engine stabilization
- feat: add render engine preference to admin settings and improve error handling in job updates
- feat: update WASM engine preference, enhance admin authentication, and improve web UI documentation
- Update model metadata, training logs, and coverage script
- feat: update model metadata and training logs with new training results and timestamps
- Add production rollout checklist, security audit documentation, and coverage script
- feat(phase-6): complete launch documentation, security, and accessibility
- Complete Phase 5: Observability, Scalability & Resilience
- Complete Phase 4: Admin Background Jobs & Data Governance
- feat: enhance audio encoding capabilities with new encoder options and CLI support
- feat: add availability configuration and audio encoding enhancements
- feat: add availability configuration and manifest handling
- feat: Enhance rendering capabilities with new configuration options and CLI support
- feat: Implement canonical writer for deterministic JSON file handling
- Fix type safety in admin jobs API by removing as any casts and using proper JobType/JobStatus types
- Address code review feedback: deduplicate audio encoding, add Ultimate 64 integration test, document sample rate
- Update packages/sidflow-web/app/api/admin/jobs/route.ts
- Update packages/sidflow-common/test/audio-encoding.test.ts
- Update packages/sidflow-common/test/job-orchestrator.test.ts
- Update packages/sidflow-common/src/ultimate64-client.ts
- Update packages/sidflow-common/src/audio-encoding.ts
- Update packages/sidflow-common/src/audio-encoding.ts
- Update packages/sidflow-common/src/ultimate64-capture.ts
- Update packages/sidflow-common/src/ultimate64-capture.ts
- Update packages/sidflow-web/app/api/admin/jobs/route.ts
- Apply suggestion from @Copilot
- Phase 4 implementation complete - job orchestration and admin infrastructure
- Add render matrix validation and audit trail
- Add admin job management UI and API endpoints
- Add job orchestration and audio encoding infrastructure
- Initial exploration of Phase 4 requirements
- Initial plan
- Implement Phase 3: Local Feedback & Training Infrastructure
- Document Phase 3 completion and update tasks.md
- Add training status display and manual controls to PrefsTab
- Add /api/model/latest endpoint for global model manifest
- Initial investigation of Phase 3 implementation status
- Initial plan
- feat: Update logging implementation and enhance debug output across various modules
- feat: Enhance worker initialization with progress tracking and timeout handling
- feat: Implement feedback runtime and sync functionality
- feat: Implement feedback storage and processing system
- feat: Add setup wizard and preferences sections to README, enhance HVSC fetch instructions
- feat: Update WASM build timestamp and refresh web screenshots for consistency
- feat: Update screenshot handling in tests to ensure consistent background styling across themes
- feat: Enhance end-to-end tests with stubbed playback and screenshot routes, improve theme preference handling
- feat: Update end-to-end tests for improved timeout handling and WASM asset loading verification
- feat: Implement HLS asset streaming and management
- Refactor code structure for improved readability and maintainability
- feat: Add support for M4A streaming and local ROM file validation
- feat: Implement Service Worker Bridge and Preferences Context
- feat: update Phase 2 plan with detailed implementation steps for local-first experience and audio format support
- feat: update lastChecked timestamp in wasm-build.json and modify play screenshot
- feat: update model metadata timestamps, enhance pause readiness logic in PlayTab and RateTab components
- feat: update WASM build timestamp and improve PlayTab functionality
- feat: enhance RateTab component with pause readiness state and improved playback handling
- Refactor: Introduce persona separation and admin auth
- Refactor code structure for improved readability and maintainability
- feat: add wav-cache-service for prefetching and rendering WAV files
- Refactor code structure for improved readability and maintainability
- feat(tests): enhance error handling in playback tests with retry logic
- feat(telemetry): implement comprehensive audio telemetry system
- feat(web): Update header logo to use logo-small.png
- feat: Update lastChecked timestamp in wasm-build.json and refresh web screenshots
- fix(e2e): Eliminate all flaky tests by properly waiting for audio loading
- feat: Update lastChecked timestamp in wasm-build.json and refresh web screenshots
- fix(e2e): Wait for playlist to populate before clicking play button
- docs: Consolidate README with detailed tutorial while preserving WASM architecture changes
- feat: Update lastChecked timestamp in wasm-build.json and refresh web screenshots
- Refactor WASM path handling for server-like environments
- feat: Enhance WASM path resolution and server environment detection
- feat: Update model metadata timestamps, enhance WAV caching, and improve classification plan handling
- feat: Add C64 Ultimate Data Stream Specification and Client-Side Playback Scale Migration Plan
- feat: add debug script for testing sidflow-play package fix: enhance layout with suppressHydrationWarning and improve RateTab component's table layout
- Improve CI performance and fix frequency test tolerances
- fix: update timestamps in model metadata, training log, and wasm build configuration
- Revert auto-resolution system for wasm-build.json conflicts
- Add automatic resolution for wasm-build.json timestamp conflicts
- fix: update timestamps in model metadata, training log, and WASM build; adjust file paths in tests
- feat: allow custom configuration file via SIDFLOW_CONFIG environment variable
- fix: standardize indentation and update timestamps in configuration and log files
- feat(tests): set up test workspace and configuration
- chore: update model metadata, training log, and WASM build timestamps; refactor logging in audio processing
- feat: update multithread rendering tests and configurations
- Update packages/sidflow-classify/src/render/wasm-render-pool.ts
- Update packages/sidflow-classify/src/render/wasm-render-pool.ts
- Refactor: Use npm and local bun install
- feat: Introduce playback facade and multiple playback adapters
- Refactor: Extract WAV rendering logic into separate modules
- Add client-side playback scale migration plan and tasks
- Changes before error encountered
- Initial plan
- feat: add support for chargen ROM paths in playback and preferences. Correctly plays /home/chris/dev/c64/sidflow/workspace/hvsc/C64Music/DEMOS/0-9/35_Years.sid
- fix: Audio playback now works for many SIDs.
- feat: integrate WASM support for SID playback
- Add test-output.wav to gitignore and update test artifacts
- Fix test discovery to only run tests once and enable Playwright execution
- Initial analysis of CI test issues
- Initial plan
- Fix E2E test execution by renaming integration test file
- Fix test auto-discovery by moving integration tests out of test/ directory
- Fix duplicate test execution caused by including root test/ directory
- Refactor telemetry E2E tests and optimize zero-byte frame detection
- Document semantic difference between missedQuanta and zeroByteFrames counters
- Update packages/sidflow-web/TELEMETRY.md
- Update packages/sidflow-web/components/TelemetryDashboard.tsx
- Addressing PR comments
- Add telemetry implementation summary and finalize
- Add comprehensive telemetry documentation
- Add comprehensive E2E telemetry validation tests
- Add enhanced telemetry with zero-byte frame, drift, and context event tracking
- Initial exploration - understanding telemetry and test infrastructure
- Initial plan
- Add comprehensive audio capture documentation
- Fix lint errors in test page
- Implement audio capture and full C4 fidelity E2E tests
- Add implementation summary and final verification
- Add comprehensive audio pipeline documentation
- Add audio fidelity E2E test framework
- Integrate AudioWorklet pipeline into SidflowPlayer
- Add AudioWorklet renderer and Web Worker producer
- Add cross-origin isolation and SAB ring buffer
- Initial plan for AudioWorklet + SAB audio pipeline
- Initial plan
- Final fix for PCM sample gaps - all critical tests passing
- Fix PCM sample gaps by correcting channel multiplication in WASM bindings
- docs: enhance WASM analysis document with references to native and WASM source code
- Initial exploration - understanding WASM audio gaps issue
- Initial plan
- fix: update feature statistics and training logs; adjust WASM build last checked timestamp
- refactor: streamline voice control initialization and playback logic in SID generation
- fix: update C4 frequency and waveform in test SID generation
- style: Improve code formatting and indentation in SID generation and test files
- test: Add comprehensive tests for SID playback and telemetry tracking. Known issue: Silent periods during playback.
- chore: update model metadata, feature stats, and training logs; refactor WASM asset paths and improve code formatting
- Refactor code structure for improved readability and maintainability
- Refactor playback handling to eliminate CLI dependencies and introduce session management
- docs: add details on modern client playback flow in WASM invocation catalog
- chore: update model metadata and training logs for consistency
- refactor: update formatting for deprecated sidplay option in CLI help messages
- docs: mark phase 7 complete
- feat: update model metadata, training logs, and WASM build timestamps; add migration plan and tasks for client-side playback
- feat: migrate interactive CLIs to wasm playback
- test: Add unit tests for JSONL output generation and integration pipeline
- Refactor: Remove sidplayPath from configuration and related tests
- docs: update required reading in WASM migration and rollout tasks
- feat: Enhance SidAudioEngine with caching and seek capabilities
- Extend WASM rollout tasks for remaining phases
- feat: remove sidflowSelectSong from LibsidplayfpWasmModule interface
- Refactor code structure for improved readability and maintainability
- Change song rating method from sliders to buttons
- Update README.md
- docs: capture wasm phase 5 guidance
- feat: Phase 4 complete
- feat: relocate wasm package into workspace
- feat: bundle seven zip helper
- feat: automate wasm upstream checks
- docs: complete wasm rollout phase 0
- docs: add wasm rollout tasks
- chore: sync branch with main outside wasm plan
- Update README.md
- Revise README for clarity and development status
- Revise classification note in README
- Update README.md
- feat: update training timestamps and enhance queue display logic in Home component
- feat: enhance file handling in PrefsTab and RateTab components
- feat: enhance PlayTab and RateTab components with improved layout and functionality
- feat: enhance rate playback with track information and add ROM path management
- feat: update model metadata timestamps, improve path handling in random selection, and enhance UI components in PlayTab and RateTab
- feat: add .sidflow-preferences.json to .gitignore and refactor rate API to improve path validation
- feat: enhance training tab with additional information on epochs and batch size
- refactor: update cwd reference in classify route and remove unused stop playback function in RateTab
- feat: update playback and classification features
- feat: update training timestamps and add favourite songs documentation
- fix: correct playbackLock initialization in POST function
- feat: add "use client" directive to ToastViewport component
- feat: replace uuid with crypto.randomUUID for toast ID generation
- feat: remove StatusDisplay component and related functionality
- feat: enhance error handling and logging in RatingPanel and TrainTab components
- Modernize UI with compact header and sidebar navigation
- Initial plan
- Refactor code structure for improved readability and maintainability
- fix: Update model training timestamps and add new training metrics; optimize image loading in web app
- fix: Remove Playwright report publication
- fix: Add Playwright report summary step to CI workflow and update reporter configuration for JSON output
- fix: Update CI and build-and-test workflows to include permissions for GitHub Pages and ID token access; ensure Playwright report availability check in build-and-test.
- fix: Update GitHub Actions workflow to upload Playwright HTML report, test artifacts, and tab screenshots; adjust retention policy. Update model metadata and training log with new training timestamps. Modify ensure-playwright-browser script for improved Chromium installation handling.
- fix: Refactor code structure for improved readability and maintainability
- fix: Enhance Dockerfile to install Google Chrome for Playwright and update Playwright configuration for system Chrome detection; add script to ensure Playwright-managed Chromium installation if needed. Update model metadata and training log with new training timestamps. Add new web screenshots and update package.json for E2E testing.
- Enhance copilot instructions with detailed architecture, conventions, CLI patterns, and coding practices
- Fix E2E test timeout by binding server to 0.0.0.0 and using Bun runtime
- Update CI configuration and model metadata
- Enhance comments in docker-build workflow
- Enhance Dockerfile with build-time hash argument
- Fix formatting in Docker build workflow
- Update docker-build.yaml
- Refactor apt package installation in Dockerfile
- Replace 7zip with p7zip-full in package list
- Fix Dockerfile to remove --no-install-recommends
- Fix shell not found error by explicitly setting bash as default shell in CI workflow
- Fix code review issues: useEffect dependencies, unused variables in stubs
- Fix CI duplicate runs, add bash shell to Docker, create unified test:all target, and add E2E screenshot generation
- Fix Docker CI image build and move all apt packages to external file
- Optimize CI build with enhanced Docker image and fix code review issues
- Fix CI paths-filter permission error by adding pull-requests read permission
- Add individual quick rating buttons for all dimensions in Rate tab and enhance Play/Rate with SID metadata
- Add permissions for contents in CI workflow
- Fix CI E2E test failure by running Playwright tests outside container
- Implement authentic C64 colors, logo header, prefs tab, and comprehensive UI documentation
- Implement C64 retro redesign with dark mode, tabs, enhanced player, and keyboard controls
- Add files via upload
- Fix error message inconsistency in stub rate script
- Add comprehensive documentation for web server to README and technical reference
- Add comprehensive E2E tests and CLI stub tools for web server testing
- Initial assessment of Web rollout completion status
- Initial plan
- Complete Phase 2 - Frontend MVP with React components
- Add OpenAPI 3.0 specification and update documentation
- Fix play route flag and add fetch/train API endpoints
- Apply suggestion from @Copilot
- Implement Phase 0 and 1 of Web rollout: Next.js server with CLI integration
- Fix test command to exclude Playwright spec files from bun test
- Complete Phase 0 and 1 of Web rollout - workspace setup and API integration
- Initial plan for Phase 0 and 1 of Web rollout
- Initial plan
- Add web server rollout planning documentation
- Initial plan
- Add git and gpg to apt-packages.txt for codecov action
- Initial plan
- Fix CI badge to reference correct workflow file (ci.yaml)
- Initial plan
- fix: Fix CI build
- fix: Fix CI build
- fix: Fix CI build
- fix: Fix CI build
- fix: Fix CI build
- fix: Fix CI build
- fix: Fix CI build
- fix: Fix CI build
- Fix Docker image: add p7zip-full and ensure bun is in PATH
- Add Docker-based CI with sidplayfp and enhanced test logging
- Fix integration test mock to match RenderWavOptions interface
- Improve README.md formatting for SID Flow description
- Deduplicate SID metadata parsing logic with shared utility function
- Improve SID parser error messages for version-specific size requirements
- Update packages/sidflow-classify/src/index.ts
- Address code review feedback: improve type safety and validation
- Add min-duration feature and comprehensive improvements plan
- Add verbose logging to integration test and optimize SID metadata caching
- Restructure README for non-technical users and add technical reference
- Enhanced e2e tests with real sidplayfp support and updated CI
- Initial plan
- Add error handling tests for train module - final coverage 85.95%
- Add more tests for version and retry modules
- Increase test coverage to 85.73%
- Fix string concatenation of songIndex for type safety
- Add 3 real SID files from HVSC Update #83 for e2e testing
- Update data structures and tests to support song indices
- Add SID metadata parser and multi-song WAV extraction support
- Initial plan
- Fix regex pattern in e2e test metrics verification
- Add comprehensive implementation summary document
- Fix rating dimension references in integration docs (e,m,c not s,m,c)
- Initial plan
- Add end-to-end test with HVSC test data and update documentation
- Initial plan
- Verify changes with successful build and tests
- Complete Phase 11 rollout and update README
- Initial plan
- Remove dynamic import and use static import for readdir in session.ts
- Update packages/sidflow-play/src/cli.ts
- Update packages/sidflow-play/src/session.ts
- Update packages/sidflow-play/test/playlist.test.ts
- Update packages/sidflow-play/test/session.test.ts
- Update bun.lock to include sidflow-play package dependencies
- Address code review feedback: fix test consistency and type assertions
- Complete Phase 10 documentation and mark rollout phase complete
- Implement Phase 10: sidflow-play package with playlist generation and playback
- Initial plan
- Fix path consistency in artifact governance docs
- Phase 9 complete - Artifact Governance documentation
- Phase 8 complete - Music Stream Recommendation Engine implemented
- Initial exploration - preparing Phase 8 implementation
- Initial plan
- Update README: add technical components section and train command to workflow diagram
- Address code review feedback: improve path handling and add constants
- Add documentation and CLI scripts for training system
- Add comprehensive tests for training system
- Add Phase 11 to rollout.md and implement core training infrastructure
- Initial plan
- Address code review feedback: improve constants and error handling
- Update documentation for Phase 7 LanceDB implementation
- Implement Phase 7: Rebuildable LanceDB with vector database
- Initial plan
- Use stringifyDeterministic for JSONL output to ensure consistent key ordering
- Fix circular imports and simplify test code per review
- Implement Phase 6: JSONL user feedback logging with validation
- Implement Phase 5: JSONL classification output with schema and converter
- Initial plan
- Fix CLI help text and rating display to include preference dimension
- Rename sidflow-tag to sidflow-rate and complete Phase 4.6
- Add preference (p) rating dimension to support Phase 4.6
- Mark Phase 4.5 (Speed to Energy rename) as complete
- Mark Phase 4 Essentia.js/TF.js integration as complete
- Initial plan
- Fix typo and add exploration parameter for recommendation diversity
- Rename tags→ratings, add preference dimension, update tools and workflow
- Nest e/m/c ratings in 'tags' object for extensible JSONL schema
- Make JSONL schema extensible to preserve all classifier features
- Rename 's' (speed) to 'e' (energy) and consolidate phase steps
- Add Music Stream phases to rollout documentation
- Initial plan
- Add comprehensive Mermaid workflow diagram to README
- Address code review feedback - improve error handling and documentation
- Add integration test and documentation for Essentia.js + TF.js
- Add Essentia.js and TF.js integration for feature extraction and prediction
- Initial plan
- docs(classify): Clarify threads parameter is reserved for future use
- fix(classify): Address code review feedback on progress reporting
- Update packages/sidflow-classify/src/index.ts
- Update doc/performance-metrics.md
- feat(classify): Add real-time progress reporting and hash-based caching
- fix(test): Remove unused variable in metrics test
- feat(classify): Add comprehensive performance metrics tracking
- Initial plan for Phase 4 rollout completion
- Initial plan
- feat(init): Phase 4 mostly done
- feat(init): Added SID metadata spec
- feat(init): Reduced build time
- feat(init): Reduced build time
- feat(init): Reduced build time
- feat(init): Reduced build time
- feat(init): Fix test
- feat(init): Fix coverage upload
- feat(init): Fix coverage upload
- feat(init): Improved coverage upload
- feat(init): Improved docs
- feat(init): Improved docs
- feat(init): Improved docs
- feat(init): Improved docs
- feat(init): Improved docs
- feat(init): Extend rollout plan
- feat(init): Codecov
- feat(init): Codecov
- feat(init): Progress report during fetch
- feat(init): Code coverage
- feat(init): Phase 1 done
- feat(init): Prepared rollout docs
- first commit

## 0.1.0

- Initial release candidate of the SIDFlow workspace packages.
- Documented the libsidplayfp WASM build pipeline, added rebuild runbook guidance, and expanded consumer docs for the committed artifacts.
- Added a header-patching fallback in `SidAudioEngine` (with automated tests using `Great_Giana_Sisters.sid`) so multi-song playback works while the native `selectSong` binding is investigated.
