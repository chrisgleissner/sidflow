## Task: Containerized Perf Tooling & Prebaked Binaries (2025-11-21)

**User request (summary)**
- Prebake k6 (and other lazily downloaded binaries) into the CI Dockerfile to support k6-based perf runs.
- Keep perf test tooling resilient, fast, and maintainable with documentation updates.

**Context and constraints**
- Docker image underpins CI; perf workflow requires k6 and Playwright browsers.
- Avoid slow or flaky downloads during CI by installing binaries at build time.
- Local runs should remain fast (smoke-mode) while CI/nightly can run fuller matrices.

**Plan (checklist)**
- [x] 1 — Inventory lazily downloaded binaries (k6, Playwright Chromium).
- [x] 2 — Update Dockerfile to install k6 at build time; verify no other downloads remain.
- [x] 3 — Update docs (developer guide, perf guide, README) with perf runner usage and prebaked binaries.
- [x] 4 — Validate perf runner locally (smoke) and ensure tests pass 3x consecutively.

**Progress log**
- 2025-11-21 — Added k6 prebake to `Dockerfile` (v0.52.0) alongside Playwright; local smoke perf run via `npm run perf:run -- --env local ...` completes with best-effort selectors and relaxed thresholds.
- 2025-11-21 — Ran full doc sweep (README + `doc/**`), wired perf runner guidance/links, and highlighted remote guard + k6 HTML export; local perf smoke run produced `performance/results/2025-11-21-1250` with k6 summary/report; `npm run test` green 3x consecutively with core-source coverage ~73% (excluding generated/dist/audio-player files).

