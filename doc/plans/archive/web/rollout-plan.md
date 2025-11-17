# SIDFlow Web Server Rollout Plan

**Required reading:** `rollout-prompt.md`

## Vision

SIDFlow Web Server extends the existing CLI-first toolkit with a local web control panel that orchestrates playback, rating, and classification through a simple browser interface. The web layer delegates to the proven CLI implementations, keeping the boundary thin and maintainable while preparing for future extensibility (hosted mode, per-user models, collaborative playlists).

## Guiding Principles

- Treat the web server as a **presentation layer** over existing CLI tools — avoid duplicating CLI logic.
- Keep the frontend **minimal and local-first** — this is a control panel, not a public web application.
- Use **Next.js 15 App Router** with React 19 for a modern, maintainable architecture.
- Maintain **strict TypeScript** with explicit types throughout; share types with `@sidflow/common` where appropriate.
- Integrate **Playwright** for E2E testing to validate the full UI → API → CLI flow.
- Stub `sidplayfp` in CI to enable automated testing without audio hardware dependencies.
- Keep the rollout **incremental** with each phase producing a shippable, testable artifact.

## Phase Overview

| Phase | Goal | Primary Deliverables |
|-------|------|---------------------|
| 0 | Workspace setup and tooling | `packages/sidflow-web/` scaffolded, Next.js 15 + Tailwind + shadcn/ui configured, blank page served |
| 1 | API integration with CLI | API routes for play, rate, classify using `Bun.spawn`, robust error handling, JSON responses |
| 2 | Frontend MVP | Control panel UI with buttons, status feedback, queue view |
| 3 | Automated testing & CI | Playwright E2E tests, CI integration with stubbed `sidplayfp`, unit tests for API layer |
| 4 | Local validation | Manual testing with real `sidplayfp`, verification of orchestration under real playback |

## Phase 0 — Preparation

### Objectives
- Establish `packages/sidflow-web/` workspace within the existing Bun monorepo.
- Configure Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui component library.
- Set up Playwright for E2E testing infrastructure.
- Align with existing repository conventions (`.sidflow.json` loading, shared types, error handling patterns).
- Verify `bun run dev` serves a blank Next.js page on `http://localhost:3000`.

### Deliverables
- `packages/sidflow-web/package.json` with Next.js 15, React 19, TypeScript, Tailwind, shadcn/ui, Playwright dependencies.
- `packages/sidflow-web/tsconfig.json` extending `tsconfig.base.json` with Next.js-specific settings.
- `packages/sidflow-web/app/layout.tsx` and `app/page.tsx` serving a minimal "SIDFlow Control Panel" header.
- `packages/sidflow-web/tailwind.config.ts` and `components.json` for shadcn/ui integration.
- `packages/sidflow-web/playwright.config.ts` with headless browser configuration.
- Updated root `package.json` workspace configuration including `sidflow-web`.

### Testing Strategy
- Smoke test: `bun run dev` starts without errors and serves content on port 3000.
- Playwright setup test: Run a single test that navigates to localhost and verifies page title.

### Success Criteria
- Development server starts cleanly with no compilation errors.
- Browser displays minimal page with SIDFlow branding.
- Playwright test passes in CI environment.

## Phase 1 — API Integration

### Objectives
- Create Next.js API routes (`/api/play`, `/api/rate`, `/api/classify`) that invoke corresponding CLI commands.
- Use `Bun.spawn` to execute CLI tools with proper argument passing and error capture.
- Implement robust validation of incoming request bodies (Zod schemas).
- Return structured JSON responses with success/error states, command output, and timing metrics.
- Handle CLI failures gracefully with appropriate HTTP status codes and error messages.

### Deliverables
- `packages/sidflow-web/app/api/play/route.ts` — POST endpoint accepting `sid_path`, `preset` (mood), delegating to `sidflow-play`.
- `packages/sidflow-web/app/api/rate/route.ts` — POST endpoint accepting `sid_path`, `ratings` object `{e, m, c, p}`, invoking `sidflow-rate`.
- `packages/sidflow-web/app/api/classify/route.ts` — POST endpoint triggering `sidflow-classify` on specified paths.
- `packages/sidflow-web/lib/cli-executor.ts` — Shared utility wrapping `Bun.spawn` with timeout, stderr capture, and exit code handling.
- `packages/sidflow-web/lib/validation.ts` — Zod schemas for request/response validation.
- Unit tests for `cli-executor.ts` with mocked `Bun.spawn`.

### Testing Strategy
- Unit tests for API routes using Bun's test runner with mocked CLI execution.
- Integration tests verifying successful CLI invocation and error propagation.
- Manual curl/Postman tests confirming endpoints respond with correct JSON structure.

### Success Criteria
- All API routes respond to valid requests with 200 status and structured JSON.
- Invalid requests return 400 status with validation error details.
- CLI failures propagate as 500 status with error messages captured from stderr.
- Unit test coverage ≥90% for API and CLI executor modules.

## Phase 2 — Frontend MVP

### Objectives
- Build a minimal control panel UI using React 19 and shadcn/ui components.
- Provide buttons for core actions: play (with mood preset selector), manual rating, trigger classification.
- Display current playback status, last action result, and basic error feedback.
- Show a simple queue/history view of recently played tracks.
- Maintain clean, accessible UI following shadcn/ui patterns.

### Deliverables
- `packages/sidflow-web/app/page.tsx` — Main control panel page with action buttons.
- `packages/sidflow-web/components/PlayControls.tsx` — Play button with mood preset dropdown (quiet, energetic, dark, bright, complex).
- `packages/sidflow-web/components/RatingPanel.tsx` — Manual rating interface with sliders for e/m/c/p dimensions.
- `packages/sidflow-web/components/StatusDisplay.tsx` — Current action status and error messages.
- `packages/sidflow-web/components/QueueView.tsx` — Recently played tracks with metadata.
- Client-side API integration using React hooks and fetch.

### Testing Strategy
- Component unit tests using Bun test runner and React Testing Library patterns.
- Playwright E2E tests covering happy paths: clicking play button, submitting ratings, triggering classification.
- Visual regression tests (optional) using Playwright screenshots.

### Success Criteria
- Control panel UI is functional and accessible in modern browsers.
- All user actions trigger corresponding API calls and display results.
- Error states are clearly communicated to the user.
- UI matches shadcn/ui design patterns with consistent styling.

## Phase 3 — Automated Testing and CI

### Objectives
- Implement comprehensive Playwright E2E test suite covering full user workflows.
- Create stubbed `sidplayfp` binary for CI environments to enable testing without audio hardware.
- Define unit and integration test strategies for both frontend and API layers.
- Integrate web server tests into existing CI pipeline (GitHub Actions).
- Ensure all tests pass in headless CI environment.

### Deliverables
- `packages/sidflow-web/tests/e2e/` directory with Playwright test scenarios:
  - `play.spec.ts` — Test playback flow with different mood presets.
  - `rate.spec.ts` — Test manual rating submission and feedback.
  - `classify.spec.ts` — Test classification trigger and status updates.
- `packages/sidflow-web/tests/stubs/sidplayfp` — Mock binary that outputs expected format without actual playback.
- `packages/sidflow-web/tests/unit/` directory for API route and utility unit tests.
- `.github/workflows/ci.yaml` updated with web server build, test, and E2E steps.
- Environment variable configuration for CI to use stubbed binaries.

### Testing Strategy
- E2E tests run against local dev server with stubbed CLI tools.
- Unit tests verify API logic independently of CLI execution.
- Integration tests confirm CLI executor handles success/failure scenarios.
- CI pipeline runs full test suite on every commit with coverage reporting.

### Success Criteria
- All Playwright E2E tests pass in CI environment with stubbed `sidplayfp`.
- Unit test coverage ≥90% for web server code.
- CI pipeline completes successfully with web server tests integrated.
- Test failures provide actionable error messages and logs.

## Phase 4 — Local Real Playback Validation

### Objectives
- Perform manual validation of web server using real `sidplayfp` binary.
- Verify that CLI orchestration behaves correctly under actual playback conditions.
- Confirm audio output works as expected through web-triggered playback.
- Validate that rating and classification workflows integrate seamlessly with existing CLI tooling.
- Document any environment-specific configuration required for local development.

### Deliverables
- Manual test protocol documenting validation steps and expected outcomes.
- Screenshots/recordings of successful playback, rating, and classification flows.
- Updated `README.md` section for web server usage and local setup.
- Troubleshooting guide for common local development issues.

### Testing Strategy
- Manual testing on developer machines with real `sidplayfp` installed.
- Validation across supported platforms (Linux, macOS, Windows).
- Test various HVSC files to ensure compatibility across different SID formats.
- Verify graceful degradation when `sidplayfp` is not available.

### Success Criteria
- Web server successfully triggers playback using real `sidplayfp`.
- Manual ratings are correctly saved to `*.sid.tags.json` files via API.
- Classification can be triggered and outputs are generated correctly.
- Documentation covers local setup and troubleshooting for all supported platforms.

## Governance

- Each phase requires passing tests and updated documentation before proceeding.
- Phase reviews validate API contracts and UI/UX against acceptance criteria.
- Changes land through reviewed pull requests with Tech Lead approval.
- Web server integration does not break existing CLI functionality.

## Success Criteria

- Web server runs locally on port 3000 with minimal configuration.
- All API endpoints correctly delegate to existing CLI tools.
- Frontend provides functional control panel for core workflows.
- E2E tests validate complete UI → API → CLI flow in CI.
- Manual validation confirms real playback orchestration works correctly.
- Documentation covers setup, usage, and troubleshooting.
- Test coverage remains ≥90% with Codecov integration.

## Future Extensibility Notes

While not implemented in this rollout, the architecture should accommodate:

- **Per-user training models:** User-specific preference learning without shared state.
- **Hosted mode:** Multi-user deployment with authentication and session management.
- **Collaborative playlists:** Shared queues and recommendations across users.
- **Real-time updates:** WebSocket or SSE for live playback status and queue changes.
- **Advanced visualizations:** Waveforms, spectral analysis, metadata displays.

These considerations inform architectural decisions (e.g., stateless API design, user context handling) but are not implemented in the initial rollout.
