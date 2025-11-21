# Unified Performance Testing Rollout Plan

Goal: ship a unified performance-testing system for the Next.js web UI and SID-streaming backend that reuses declarative journey specs across Playwright (browser-mode) and k6 (protocol-mode), avoids duplicated journeys, and produces consumable artifacts for humans and LLM-driven tuning.

## Scope

- Shared journey specifications drive both executors; single source of truth for user journeys.
- Two execution modes: Playwright for high-fidelity client+server behaviour; k6 for scalable backend load (1/10/100 users).
- Unified runner supports local ad-hoc runs and scheduled nightly CI with timestamped result folders.
- Artifacts: k6 CSV + HTML dashboard + stdout summary, Playwright browser timings (JSON/HAR), JSON summaries for LLM guidance, Markdown reports referencing all outputs.

## Success Criteria

- Journeys defined once, executed by both executors with identical pacing (one interaction every 3 seconds).
- Playwright runs 1- and 10-user variants; k6 runs 1-, 10-, and 100-user variants.
- Results stored under timestamped folders with Markdown linking to CSV, dashboards, browser timings, and JSON summaries.
- Summarisation module emits p95/p99/throughput/error-rate JSON across both executors.

## Phases

### Phase 0 — Baseline Alignment (0.5 day)

- Confirm target environments (base URLs, credentials, data seeding) for local and CI.
- Pick storage structure for `journeys/`, `executors/`, `results/`, `summary/` under `doc/performance` + repo root.

### Phase 1 — Shared Journey Specs & Mapping (1–2 days)

- Define journey spec schema (id, description, steps, data bindings, pacing=3s).
- Add authoring guidelines + examples for navigation, clicks, waits, and track selection.
- Implement client-action-to-API mapping definitions for protocol-mode (e.g., search, select track, start stream).

### Phase 2 — Executors (2–3 days)

- Playwright executor: consume journey spec, enforce 3s pacing via timed waits, emit browser timings (HAR/trace JSON).
- k6 executor: convert journey spec to protocol-level script with mapping layer, honor 3s pacing via `sleep(3)`, run 1/10/100 user options, emit CSV + HTML dashboard + stdout summary.
- Ensure both executors generate temporary scripts from the shared spec and respect environment overrides.
- HTML dashboard generation for k6 uses the built-in web dashboard export:
  ```shell
  K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run script.js
  ```

### Phase 3 — Summaries & Reporting (1–2 days)

- Summarisation module: read k6 CSV + Playwright timings → emit compact JSON (p95/p99/throughput/error rates) for LLM consumption.
- Results layout: timestamped folders collecting raw outputs, dashboards, summaries, and Markdown report with links.
- Document retention/rotation rules for local vs CI artifacts.

### Phase 4 — Unified Runner & CI (1–2 days)

- Unified runner CLI/script: orchestrate per-journey executions (Playwright 1/10 users; k6 1/10/100 users) with consistent pacing/concurrency.
- Local mode flags for quick subsets; CI nightly job wiring with artifact uploads.
- Nightly Markdown report references CSVs, HTML dashboards, browser timings, and JSON summaries in the versioned results folder.

### Phase 5 — Hardening & Scale (optional, post-MVP)

- Add SLO thresholds and failure gates per journey.
- Parallelize journeys safely; add retries for flaky browser runs.
- Integrate trend analysis across nightly runs and auto-open issues on regressions.

## Run Modes & Environments

- **Local ad-hoc**: developer-triggered runs against a locally started server; supports headful Playwright and journey filtering. Default base URL comes from the shared loader or `http://localhost:3000`.
- **Nightly CI**: runs on GitHub runner; workflow starts the web server inside the job, then executes Playwright (1/10 users) followed by k6 (1/10/100 users); uploads CSV/HTML/HAR/JSON/Markdown artifacts.
- **Remote/staging/prod (future)**: runner accepts `--env remote --base-url <url>` (or config equivalent) plus an explicit `--enable-remote` guard to target a pre-deployed environment. Default is disabled; without the guard or base URL, the runner must refuse remote execution to prevent accidental prod hits.
- Environment config via the shared loader (base URL, auth, dataset knob, pacing override if needed), reused by both executors and runner.
- **Runner CLI**: `npm run perf:run -- --env ci --base-url http://localhost:3000 --results performance/results --tmp performance/tmp --execute` (Playwright + k6). Remote targets require `--enable-remote`.
- **K6 HTML dashboard**: `K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html` (baked into runner env).
