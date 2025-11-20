# SIDFlow Copilot Guardrails

## Agent quickstart
- Read `AGENTS.md` at the repo root for repo-wide agent behavior, ExecPlan usage, and multi-hour workflow expectations.
- Read `PLANS.md` and follow it for any multi-step work.
- For Cursor users: also honor `.cursorrules` at the repo root; it mirrors these guardrails and points to the same execution plan.
- For short Q&A or trivial code snippets, you may answer directly, but prefer making concrete edits and running fast checks when feasible.

## Agent autonomy and execution plans
- This repository opts into persistent, autonomous agents. When you begin any non-trivial task, first load and follow the central execution plan in `PLANS.md` at the repo root. Treat it as the single source of truth for plan-then-act, progress logging, quality gates, and verification.
- Do not stop early. Continue working until the user’s request is fully satisfied or you are genuinely blocked by missing credentials or external access. Prefer research and reasonable assumptions over asking for clarification; document assumptions you make in your plan’s Decision Log.
- Keep going across long sessions. Use the plan’s Progress, Surprises & Discoveries, Decision Log, and Outcomes sections to maintain continuity over hours of work. Always update these sections as you proceed.
- Always run quick validation after substantive edits (Build, Lint/Typecheck, Tests). Record PASS/FAIL and errors encountered in the plan’s Progress section and iterate up to three targeted fixes before surfacing a summary to the user.
- Prefer minimal, additive edits; keep public APIs stable unless the task requires changes. Preserve repository coding conventions and shared utilities as defined below.

## Architecture & Data Flow
- SIDFlow is a CLI-first pipeline: fetch SID collections (currently HVSC via `@sidflow/fetch`), classify audio (`@sidflow/classify`), train ML (`@sidflow/train`), and play/recommend (`@sidflow/play`); each stage reads/writes `data/` JSONL and relies on `.sidflow.json` paths.
- The project is designed to work with any locally available SID file collection, not just HVSC. While the fetch feature currently focuses on HVSC, the classification, training, playback, and browsing features work with any SID files in the configured collection path.
- Classification splits into WAV cache rendering, heuristic feature extraction (`heuristicFeatureExtractor`), auto-tag generation, and JSONL emission; reuse the planner in `packages/sidflow-classify/src/index.ts`.
- Training consumes `data/classified` and `data/feedback` JSONL, merges explicit/implicit samples, and persists LanceDB-ready artifacts under `data/model`; respect feedback weights defined in `@sidflow/train`.
- Scripts in `scripts/` are thin wrappers invoking the package CLIs; treat them as the contract for end-to-end flows and keep CLI UX stable.

## Shared Libraries & Conventions
- Keep shared utilities in `@sidflow/common` (config loader, deterministic JSON, logger, retry, LanceDB builder) and import rather than reimplementing.
- Always load configuration through `loadConfig` and honor `--config` overrides; cache resets via `resetConfigCache` in long-running tools.
- Serialize JSON with `stringifyDeterministic` to avoid diff churn and normalize nested structures before writing.
- Use `fs/promises` helpers like `ensureDir`/`pathExists` from `common/fs.ts`; extend these utilities instead of mixing sync APIs.

## CLI Patterns
- Follow the CLI structure: parse args in `cli.ts`, call a `plan*` function to validate inputs, then run pure helpers that accept explicit dependencies (see `runClassifyCli` and `runFetchCli`).
- Provide progress reporting via callbacks with throttling (`createProgressLogger` in classify CLI) to keep TTY output smooth.
- Archive extraction relies on bundled `7zip-min` helpers that should be injected via shared utilities.

## Data & Persistence
- `.sidflow.json` defines `sidPath` (the path to the local SID collection, regardless of source), `wavCachePath`, `tagsPath`, optional `classifiedPath`; default to config values but accept explicit paths when provided by callers.
- Classification writes metadata and tags using `resolve*` helpers and stores WAV hashes in sidecar `.hash` files—preserve this caching scheme.
- Feedback lives in date-partitioned `data/feedback/<year>/<month>/events.jsonl`; training and LanceDB builders must tolerate missing folders and skip corrupt lines with warnings, not hard failures.
- Store derived artifacts (manifest, LanceDB) with deterministic checksums using `generateManifest` in `common/lancedb-builder.ts`.

## Tooling & Dependencies
- Bun is the runtime: install deps with `bun install`; build with `bun run build`; execute tests and CLIs through `bun run ...`.
- LanceDB (`vectordb`) powers similarity search; ensure builds call `buildDatabase` before generating manifests.
- Archive extraction uses the `7zip-min` npm dependency bundled with the workspace.

## Testing & Quality Gates

### Test Coverage Requirements
- **Target Coverage**: ≥90%
- **Current Baseline**: 65.89% (11,929/18,105 lines) as of 2025-11-20
- Coverage is measured across source files in `packages/*/src/` (excluding `dist/` build artifacts)
- Use Bun's test runner (`bun run test`) with `--coverage` flag
- Add focused unit tests under `packages/*/test` for all new features
- Files marked with `/* c8 ignore file */` are intentionally excluded (integration/system code)

**Note**: Codecov integration was added in PR #46 (2025-11-20). The current 65.89% represents the first automated measurement. Previous "90%" references were documentation goals, not actual measurements.

### Coverage Improvement Plan (65.89% → 90%)
Priority areas by package (excluding dist/ artifacts):
1. **sidflow-web** browser code: Needs unit tests with Web API mocks or E2E coverage
   - player/sidflow-player.ts (568 lines, 24.8%)
   - audio/worklet-player.ts (523 lines, 23.3%)
   - feedback/storage.ts (402 lines, 16.6%)
2. **sidflow-common** infrastructure: High ROI for unit tests
   - audio-encoding.ts (382 lines, 27.8%)
   - playback-harness.ts (296 lines, 10.0%)
   - job-runner.ts (206 lines, 34.4%)
3. **sidflow-classify** rendering: Needs CLI mocking infrastructure
   - render/cli.ts (416 lines, 36.4%)
   - render/render-orchestrator.ts (317 lines, 53.9%)
4. **libsidplayfp-wasm** (35.90%): WASM boundary - integration tests only

### Unit Test Stability
- **CRITICAL**: All unit tests must pass 3x consecutively before code is considered complete
- Current stability: 1148/1150 tests passing consistently (99.8% pass rate)
- Verify with: `bun run test && bun run test && bun run test`
- Unit tests run in ~46s and must remain stable across runs

### E2E Test Requirements
- Run end-to-end validation with `bun run test:e2e` to cover full fetch→classify→play pipeline
- **Performance Requirements**:
  - No single E2E test may exceed 20 seconds
  - Total E2E suite runtime must be under 4 minutes (current: 3.9min)
  - Tests run with 3 Playwright workers in parallel
- **Stability Requirements**:
  - E2E tests must pass 3x consecutively
  - Current status: 79/89 tests passing, 10 flaky tests being fixed
  - Known flaky patterns: Missing data-testid attributes, waitForTimeout usage
- **Best Practices**:
  - Never use `waitForTimeout` - always use proper `waitFor` conditions with specific selectors
  - Always add `data-testid` attributes to interactive elements
  - Use `aria-label` for buttons with icon-only content
  - Read `doc/testing/e2e-test-resilience-guide.md` before writing E2E tests

### Quality Gate Checklist
Before completing any substantial work, verify:
1. ✅ Build passes: `bun run build`
2. ✅ Lint/typecheck passes: `tsc -b`
3. ✅ Unit tests pass 3x: `bun run test` (run 3 times)
4. ✅ E2E tests pass: `bun run test:e2e`
5. ✅ Coverage reported: Check final coverage % in test output
6. ✅ Performance verified: E2E runtime < 4min

### Test Execution in CI
- **CRITICAL**: All tests must pass before completing any work. It is never acceptable to leave failing tests, even if they appear to be pre-existing
- **ABSOLUTE REQUIREMENT**: 100% of tests must pass 3 times consecutively before any work is considered complete. "Mostly working" or "89% passing" is NEVER acceptable.
- **NO EXCEPTIONS**: Every single test must pass. If a test cannot pass due to missing dependencies, it must be explicitly skipped with a clear comment explaining why.
- Investigate and fix all test failures, or skip tests that require unavailable external dependencies (e.g., ffmpeg)
- The build must be left in better condition than it was found
- For config and JSON validations, run `bun run validate:config` and `bun run build:db`
- Ensure new commands have tests mirroring existing CLI suites (`packages/*/test/cli.test.ts`)

### Running E2E Tests in Remote Agent Sessions
- **Use Docker for E2E tests**: CI runs e2e tests inside `ghcr.io/chrisgleissner/sidflow-ci:latest` which has Playwright browsers pre-installed.
- **Run e2e tests in Docker**: `docker run --rm -v $(pwd):/workspace -w /workspace ghcr.io/chrisgleissner/sidflow-ci:latest bash -c "cd packages/sidflow-web && npx playwright test"`
- **Config resolution**: E2E tests use `SIDFLOW_CONFIG` env var (set in `playwright.config.ts`) to locate `.sidflow.test.json` at repo root. The `loadConfig()` function in `@sidflow/common` respects this env var.
- **Local testing**: If running locally without Docker, install Playwright browsers first: `cd packages/sidflow-web && npx playwright install chromium`.

## Coding Practices
- Stick to strict TypeScript (`tsconfig.base.json`); avoid `any`, keep types explicit, and expose pure helpers for unit testing.
- Compose functionality from small functions; use concise comments only to explain non-obvious steps (e.g., cache heuristics).
- Use shared error types like `SidflowConfigError` for config issues and preserve informative messaging when wrapping errors.
- Never duplicate logging/serialization patterns; extend `@sidflow/common` if a new cross-cutting helper is required.
