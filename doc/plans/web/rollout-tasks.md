# SIDFlow Web Server Rollout Tasks

**Required reading:** `rollout-plan.md`

## Execution Rules

- Work through phases strictly in order; do not begin a new phase until the prior phase's checklist is complete.
- Before checking any box, ensure automated tests cover the change, all tests pass, and coverage remains above 90% in CI.
- Web server changes must not break existing CLI functionality.

## Phase 0 — Preparation

### Phase 0 Checklist

- [ ] Create `packages/sidflow-web/` directory within Bun workspace.
- [ ] Initialize Next.js 15 project with App Router using `bunx create-next-app@latest`.
- [ ] Configure TypeScript with `tsconfig.json` extending `../../tsconfig.base.json`.
- [ ] Install and configure Tailwind CSS with default configuration.
- [ ] Add shadcn/ui with `bunx shadcn-ui@latest init` and configure `components.json`.
- [ ] Install Playwright with `bun add -D @playwright/test`.
- [ ] Create `playwright.config.ts` with headless browser configuration.
- [ ] Update root `package.json` to include `sidflow-web` in workspace packages.
- [ ] Create minimal `app/layout.tsx` with SIDFlow branding and Tailwind setup.
- [ ] Create minimal `app/page.tsx` with "SIDFlow Control Panel" header.
- [ ] Add `packages/sidflow-web/.gitignore` excluding `.next/`, `node_modules/`, `playwright-report/`.
- [ ] Verify `bun run dev` starts server on port 3000 without errors.
- [ ] Write basic Playwright test verifying page loads with correct title.
- [ ] Run Playwright test locally and confirm it passes.
- [ ] Update `.github/workflows/ci.yaml` to build and test web package.
- [ ] Confirm CI pipeline passes with web server included.

## Phase 1 — API Integration

### Phase 1 Checklist

- [ ] Create `packages/sidflow-web/lib/cli-executor.ts` utility:
  - [ ] Implement `executeCli()` function wrapping `Bun.spawn`.
  - [ ] Add timeout support (default 30s).
  - [ ] Capture stdout, stderr, and exit code.
  - [ ] Return structured result: `{ success: boolean, stdout: string, stderr: string, exitCode: number }`.
  - [ ] Handle spawn errors and timeouts gracefully.
- [ ] Create `packages/sidflow-web/lib/validation.ts`:
  - [ ] Install Zod: `bun add zod`.
  - [ ] Define `PlayRequestSchema` for play endpoint.
  - [ ] Define `RateRequestSchema` for rate endpoint.
  - [ ] Define `ClassifyRequestSchema` for classify endpoint.
  - [ ] Export validation helper functions.
- [ ] Create `packages/sidflow-web/app/api/play/route.ts`:
  - [ ] Implement POST handler accepting `{ sid_path, preset }`.
  - [ ] Validate request body with Zod schema.
  - [ ] Execute `sidflow-play` CLI via `executeCli()`.
  - [ ] Return JSON response with success status and output.
  - [ ] Handle errors with appropriate HTTP status codes.
- [ ] Create `packages/sidflow-web/app/api/rate/route.ts`:
  - [ ] Implement POST handler accepting `{ sid_path, ratings: { e, m, c, p } }`.
  - [ ] Validate request body with Zod schema.
  - [ ] Execute `sidflow-rate` CLI via `executeCli()`.
  - [ ] Return JSON response with success status.
  - [ ] Handle validation and CLI errors appropriately.
- [ ] Create `packages/sidflow-web/app/api/classify/route.ts`:
  - [ ] Implement POST handler accepting `{ path }`.
  - [ ] Validate request body with Zod schema.
  - [ ] Execute `sidflow-classify` CLI via `executeCli()`.
  - [ ] Return JSON response with status and progress.
  - [ ] Handle long-running classification with appropriate timeout.
- [ ] Write unit tests for `cli-executor.ts`:
  - [ ] Test successful CLI execution.
  - [ ] Test CLI failure handling.
  - [ ] Test timeout behavior.
  - [ ] Test stderr capture.
  - [ ] Mock `Bun.spawn` for deterministic tests.
- [ ] Write unit tests for API routes:
  - [ ] Test valid requests return 200 with expected JSON.
  - [ ] Test invalid requests return 400 with validation errors.
  - [ ] Test CLI failures return 500 with error details.
  - [ ] Mock CLI executor for isolated testing.
- [ ] Verify test coverage ≥90% for new code.
- [ ] Manually test API endpoints with curl or Postman:
  - [ ] Test play endpoint with valid and invalid data.
  - [ ] Test rate endpoint with valid ratings.
  - [ ] Test classify endpoint triggering actual classification.
- [ ] Document API endpoints in `packages/sidflow-web/README.md`.

## Phase 2 — Frontend MVP

### Phase 2 Checklist

- [ ] Install shadcn/ui components needed:
  - [ ] Add Button component: `bunx shadcn-ui@latest add button`.
  - [ ] Add Select component: `bunx shadcn-ui@latest add select`.
  - [ ] Add Slider component: `bunx shadcn-ui@latest add slider`.
  - [ ] Add Card component: `bunx shadcn-ui@latest add card`.
  - [ ] Add Alert component: `bunx shadcn-ui@latest add alert`.
- [ ] Create `packages/sidflow-web/components/PlayControls.tsx`:
  - [ ] Add play button with loading state.
  - [ ] Add mood preset dropdown (quiet, ambient, energetic, dark, bright, complex).
  - [ ] Implement onClick handler calling `/api/play`.
  - [ ] Display success/error feedback.
- [ ] Create `packages/sidflow-web/components/RatingPanel.tsx`:
  - [ ] Add sliders for energy (e), mood (m), complexity (c), preference (p).
  - [ ] Add labels with current values (1-5).
  - [ ] Add submit button calling `/api/rate`.
  - [ ] Display success/error feedback.
  - [ ] Clear ratings after successful submission.
- [ ] Create `packages/sidflow-web/components/StatusDisplay.tsx`:
  - [ ] Display current action status (idle, playing, rating, classifying).
  - [ ] Show last action result (success message or error).
  - [ ] Use Alert component for error states.
  - [ ] Auto-dismiss success messages after 5 seconds.
- [ ] Create `packages/sidflow-web/components/QueueView.tsx`:
  - [ ] Display list of recently played tracks.
  - [ ] Show track metadata (composer, title, path).
  - [ ] Show rating values if available.
  - [ ] Limit to last 10 tracks.
  - [ ] Store queue in React state (no persistence needed).
- [ ] Update `packages/sidflow-web/app/page.tsx`:
  - [ ] Import and render PlayControls component.
  - [ ] Import and render RatingPanel component.
  - [ ] Import and render StatusDisplay component.
  - [ ] Import and render QueueView component.
  - [ ] Implement shared state management for status and queue.
  - [ ] Add responsive layout with Tailwind grid/flexbox.
- [ ] Create `packages/sidflow-web/lib/api-client.ts`:
  - [ ] Implement `playTrack()` function.
  - [ ] Implement `rateTrack()` function.
  - [ ] Implement `classifyPath()` function.
  - [ ] Handle fetch errors and network issues.
  - [ ] Return typed responses matching API schemas.
- [ ] Write component unit tests:
  - [ ] Test PlayControls renders and handles user input.
  - [ ] Test RatingPanel sliders and submission.
  - [ ] Test StatusDisplay shows correct states.
  - [ ] Test QueueView displays track list correctly.
  - [ ] Mock API client for isolated component testing.
- [ ] Write integration tests for page:
  - [ ] Test full page renders without errors.
  - [ ] Test components communicate via shared state.
  - [ ] Test error handling across components.
- [ ] Verify UI works in development mode:
  - [ ] Test play functionality with mood presets.
  - [ ] Test rating submission with all dimensions.
  - [ ] Test status updates and error displays.
  - [ ] Test queue updates after playing tracks.
- [ ] Update `packages/sidflow-web/README.md` with:
  - [ ] Component architecture overview.
  - [ ] Development server instructions.
  - [ ] UI usage guide with screenshots.

## Phase 3 — Automated Testing and CI

### Phase 3 Checklist

- [ ] Create `packages/sidflow-web/tests/stubs/` directory.
- [ ] Create stubbed `sidplayfp` executable:
  - [ ] Write Node/Bun script that mimics `sidplayfp` output format.
  - [ ] Accept same command-line flags as real binary.
  - [ ] Return success without actual audio playback.
  - [ ] Make executable: `chmod +x tests/stubs/sidplayfp`.
- [ ] Create stubbed `sidflow-play` CLI wrapper:
  - [ ] Accept mood preset and other flags.
  - [ ] Return mock playlist data.
  - [ ] Log invocation for test verification.
- [ ] Create stubbed `sidflow-rate` CLI wrapper:
  - [ ] Accept rating parameters.
  - [ ] Create mock `*.sid.tags.json` files.
  - [ ] Return success status.
- [ ] Create stubbed `sidflow-classify` CLI wrapper:
  - [ ] Accept path parameters.
  - [ ] Return mock classification progress.
  - [ ] Complete quickly for CI performance.
- [ ] Create `packages/sidflow-web/tests/e2e/play.spec.ts`:
  - [ ] Test navigating to home page.
  - [ ] Test selecting mood preset from dropdown.
  - [ ] Test clicking play button.
  - [ ] Verify status updates shown.
  - [ ] Verify track added to queue.
  - [ ] Test error state when CLI fails.
- [ ] Create `packages/sidflow-web/tests/e2e/rate.spec.ts`:
  - [ ] Test adjusting rating sliders.
  - [ ] Test submitting ratings.
  - [ ] Verify success message displayed.
  - [ ] Verify sliders reset after submission.
  - [ ] Test validation errors for invalid values.
- [ ] Create `packages/sidflow-web/tests/e2e/classify.spec.ts`:
  - [ ] Test triggering classification.
  - [ ] Verify status updates during processing.
  - [ ] Verify completion message.
  - [ ] Test error handling for invalid paths.
- [ ] Update `playwright.config.ts`:
  - [ ] Configure environment variables for stubbed CLI paths.
  - [ ] Set base URL to `http://localhost:3000`.
  - [ ] Configure test timeout (30s default).
  - [ ] Set up test artifacts (screenshots, videos on failure).
- [ ] Create `packages/sidflow-web/tests/setup.ts`:
  - [ ] Set up test environment variables.
  - [ ] Configure PATH to include stub binaries.
  - [ ] Export helper functions for test cleanup.
- [ ] Update `.github/workflows/ci.yaml`:
  - [ ] Add step to build web server: `bun run build --filter=sidflow-web`.
  - [ ] Add step to run unit tests: `bun test --filter=sidflow-web`.
  - [ ] Add step to start dev server in background.
  - [ ] Add step to run Playwright tests: `bunx playwright test`.
  - [ ] Add step to upload test results and coverage.
  - [ ] Configure environment variables for CI stubs.
- [ ] Create `packages/sidflow-web/package.json` scripts:
  - [ ] Add `test` script for unit tests.
  - [ ] Add `test:e2e` script for Playwright tests.
  - [ ] Add `test:coverage` script for coverage reports.
  - [ ] Add `ci` script combining build and all tests.
- [ ] Run full test suite locally:
  - [ ] Verify all unit tests pass.
  - [ ] Verify all E2E tests pass with stubs.
  - [ ] Verify coverage meets 90% threshold.
  - [ ] Check test execution time is reasonable (<5 minutes).
- [ ] Push changes and verify CI pipeline:
  - [ ] Confirm CI builds web server successfully.
  - [ ] Confirm all unit tests pass in CI.
  - [ ] Confirm all E2E tests pass in CI with stubs.
  - [ ] Confirm coverage report uploaded to Codecov.
  - [ ] Verify no regressions in existing CLI tests.
- [ ] Document testing approach in `packages/sidflow-web/README.md`:
  - [ ] Explain stub binary strategy.
  - [ ] Document how to run tests locally.
  - [ ] Document CI integration.
  - [ ] Provide troubleshooting guide for test failures.

## Phase 4 — Local Real Playback Validation

### Phase 4 Checklist

- [ ] Create manual test protocol document:
  - [ ] Define test scenarios (play, rate, classify).
  - [ ] List expected outcomes for each scenario.
  - [ ] Include edge cases (missing files, invalid paths).
  - [ ] Document platform-specific considerations.
- [ ] Test playback on Linux:
  - [ ] Install real `sidplayfp` binary.
  - [ ] Start web server with real CLI tools.
  - [ ] Select mood preset and trigger playback.
  - [ ] Verify audio output through speakers.
  - [ ] Test skip/pause/resume controls (if implemented).
  - [ ] Document any issues or platform quirks.
- [ ] Test playback on macOS:
  - [ ] Install `sidplayfp` via Homebrew.
  - [ ] Repeat Linux test scenarios.
  - [ ] Verify audio output works correctly.
  - [ ] Document any macOS-specific issues.
- [ ] Test playback on Windows:
  - [ ] Install `sidplayfp` binary.
  - [ ] Configure PATH or use explicit binary path.
  - [ ] Repeat test scenarios.
  - [ ] Verify audio output works correctly.
  - [ ] Document Windows-specific issues or workarounds.
- [ ] Test rating workflow:
  - [ ] Adjust sliders for all rating dimensions.
  - [ ] Submit ratings for multiple tracks.
  - [ ] Verify `*.sid.tags.json` files created correctly.
  - [ ] Verify file format matches CLI output exactly.
  - [ ] Test that existing manual ratings are not overwritten.
- [ ] Test classification workflow:
  - [ ] Trigger classification on sample HVSC subset.
  - [ ] Monitor progress through web UI.
  - [ ] Verify WAV cache created correctly.
  - [ ] Verify classification output files generated.
  - [ ] Verify output matches CLI-generated files.
- [ ] Test error handling:
  - [ ] Test with `sidplayfp` not installed.
  - [ ] Test with invalid SID file paths.
  - [ ] Test with corrupted SID files.
  - [ ] Verify graceful error messages displayed.
  - [ ] Verify web server remains stable after errors.
- [ ] Test concurrent operations:
  - [ ] Trigger classification while playing.
  - [ ] Submit ratings during playback.
  - [ ] Verify operations don't interfere with each other.
  - [ ] Check for race conditions or locking issues.
- [ ] Performance validation:
  - [ ] Measure API response times under load.
  - [ ] Verify UI remains responsive during long operations.
  - [ ] Check memory usage during extended sessions.
  - [ ] Profile bottlenecks if performance issues found.
- [ ] Capture validation artifacts:
  - [ ] Take screenshots of successful workflows.
  - [ ] Record screen video of playback session.
  - [ ] Save example API request/response logs.
  - [ ] Document file outputs from each workflow.
- [ ] Update `README.md` with web server section:
  - [ ] Add "Web Control Panel" section to main README.
  - [ ] Explain purpose and capabilities.
  - [ ] Document local setup steps.
  - [ ] Include screenshot of control panel.
  - [ ] Link to detailed web server README.
- [ ] Create `packages/sidflow-web/README.md`:
  - [ ] Document development setup.
  - [ ] Explain architecture and design decisions.
  - [ ] Document API endpoints with examples.
  - [ ] Document component structure.
  - [ ] Include troubleshooting section.
  - [ ] Add platform-specific notes from validation.
- [ ] Create troubleshooting guide:
  - [ ] Common issues and solutions.
  - [ ] Platform-specific gotchas.
  - [ ] How to verify `sidplayfp` installation.
  - [ ] How to check CLI tool availability.
  - [ ] Debug logging instructions.
- [ ] Final validation checklist:
  - [ ] Web server starts without errors on all platforms.
  - [ ] All core workflows (play, rate, classify) work end-to-end.
  - [ ] Error handling is clear and helpful.
  - [ ] Documentation is complete and accurate.
  - [ ] No regressions in existing CLI functionality.
  - [ ] Test coverage maintained at ≥90%.

## Current Status

Phase 0: Not started  
Phase 1: Not started  
Phase 2: Not started  
Phase 3: Not started  
Phase 4: Not started

## Notes

- The web server is designed as a thin orchestration layer over existing CLI tools.
- All business logic remains in CLI packages; web server only handles presentation and invocation.
- Stubbed binaries enable full CI testing without audio hardware dependencies.
- Real playback validation occurs only in Phase 4 after automated tests are established.
- Future extensibility (hosted mode, per-user training) informs architecture but is not implemented.
