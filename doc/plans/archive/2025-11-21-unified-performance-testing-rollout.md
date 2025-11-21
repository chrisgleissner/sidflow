# Unified Performance Testing Rollout (2025-11-21)

**Archived from PLANS.md on 2025-11-21**

**User request (summary)**
- Execute the unified performance-testing rollout (Playwright + k6) using shared journey specs and artifacts from `doc/performance/unified-performance-testing-rollout.md`.
- Deliver end-to-end runner, reporting, and CI/nightly wiring so journeys run in both browser and protocol modes with consistent pacing.

**Context and constraints**
- Journeys defined once and reused by both executors; pacing fixed at one interaction every 3 seconds.
- Playwright runs 1- and 10-user variants; k6 runs 1-, 10-, and 100-user variants with protocol-level mappings for each action.
- Artifacts must include k6 CSV + HTML dashboard + stdout summary, Playwright browser timings/HAR, JSON summaries for LLM guidance, and nightly Markdown linking to timestamped outputs.
- Unified runner must support local ad-hoc runs and nightly CI, leveraging the shared config loader and existing CLI-first patterns.

**Plan (checklist)**
- [x] 1 — Baseline alignment: confirm target environments (local ad-hoc, CI with in-job server, remote/staging/prod guarded + disabled by default), storage layout for `journeys/`, `executors/`, `results/`, `summary/`, and config loader usage.
- [x] 2 — Journey spec + mapping: finalize schema (id/description/steps/data bindings/pacing=3s), authoring guide, and API/action mappings for protocol-mode behaviour.
- [x] 3 — Executors: implement Playwright executor (pacing + HAR/trace outputs) and k6 executor (pacing + 1/10/100 users + CSV/HTML) that consume shared specs.
- [x] 4 — Summaries & reporting: build summarisation module emitting artifacts + Markdown report linking generated scripts and outputs with retention-ready layout.
- [x] 5 — Unified runner & CI: orchestrate local quick-run flags and nightly full runs; wire CI job to upload artifacts and nightly Markdown.
- [x] 6 — Hardening: add SLO thresholds, retries for flaky browser runs, and regression detection across nightly runs.

**Progress log**
- 2025-11-21 — Task opened; scaffolded rollout plan from `doc/performance/unified-performance-testing-rollout.md` and sequenced implementation steps. Added environment targets: local, CI (server started in-job), guarded remote/staging/prod (disabled by default without explicit base URL + enable flag).
- 2025-11-21 — Added `@sidflow/performance` package with journey loader, Playwright/k6 generators, SLO-gated runner, and CLI (`scripts/performance-runner.ts`). Seeded `performance/journeys/play-start-stream.json` and deterministic tmp/results layout.
- 2025-11-21 — Implemented Playwright (+retries) and k6 (HTML + summary export) executors, Markdown/JSON report emission, remote-run guard, and k6 error-rate thresholding. Updated docs with CLI usage and k6 dashboard export reminder.
- 2025-11-21 — Wired nightly CI (`.github/workflows/performance.yml`) to build the web app, start server in-job, install k6/playwright, run unified runner (Playwright + k6), and upload artifacts. Completed local smoke run via `npm run perf:run -- --env local ...`.

**Assumptions and open questions**
- Assumption: Architecture docs in `doc/performance/` are the accepted contract for implementation.
- Assumption: Headless Playwright is acceptable for CI; pacing stays fixed at 3s per interaction.
- Open question: Target base URLs and auth credentials for nightly CI vs local runs to be confirmed during baseline alignment.

**Follow-ups / future work**
- Extend to trend analysis across nightly runs and auto-open regressions once initial rollout stabilizes.
