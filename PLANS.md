# PLANS.md — Multi-hour plans for SIDFlow

<!-- markdownlint-disable MD032 MD036 MD039 MD051 -->

This file is the active planning surface for substantial SIDFlow work. Keep it convergent: it should describe the current execution roadmap, not every historical task ever completed in the repository.

## How to use this file

For each substantial user request or multi-step effort:

- Read this file before acting.
- Prefer updating the existing active roadmap instead of spawning unrelated new tasks.
- Keep a checklist-style plan with clear sequencing and exit criteria.
- Maintain a progress log with dated entries.
- Move completed, superseded, or no-longer-needed tasks into `doc/plans/` rather than leaving them in the active surface.

Template:

```markdown
### Task: <short title> (YYYY-MM-DD)

**User request (summary)**  
- <One or two bullets>

**Plan (checklist)**  
- [ ] Step 1 — ...

**Progress log**  
- YYYY-MM-DD — Started task.

**Follow-ups**  
- <Out of scope items>
```

## Maintenance rules

1. Keep `PLANS.md` focused on active work only.
2. Archive completed/superseded tasks under `doc/plans/archive-*.md`.
3. Preserve request summaries, status, and progress logs when archiving.
4. Prefer one active convergent roadmap at a time unless the user explicitly wants parallel tracks.
5. Every substantial task must keep a dated progress log.
6. Build/test validation is required before marking work complete.

## Archive index

- `doc/plans/README.md` — archive conventions
- `doc/plans/archive-2025-12-to-2026-03.md` — completed, superseded, and retired tasks moved out of the active surface on 2026-03-13

---

## Active tasks

### Task: Production rollout convergence roadmap (2026-03-13)

**User request (summary)**  
- Convert the findings in `doc/audits/audit1/audit.md` into a new multi-phase execution plan with strong convergence.
- Restructure planning so completed or no-longer-needed tasks are archived into `doc/plans/` while active work retains a progress log.

**Convergence rules**  
- Only one phase below may be actively executed at a time.
- Later phases do not start until the current phase exit criteria are met or explicitly re-scoped.
- New work discovered during implementation must be attached to an existing phase or recorded as a follow-up; do not create parallel standalone tasks unless the user asks for them.
- Every progress entry must state what changed, what evidence was gathered, and the next decisive action.
- During implementation, use `bun run build:quick` plus focused tests as the fast sanity loop; reserve full `bun run build` and full `bun run test` validation for the final roadmap gate unless a phase-specific blocker requires the full suite earlier.

**Plan (checklist)**  
- [x] Phase 0 — Planning convergence and archive hygiene.
  Done when: `PLANS.md` contains a single active roadmap, legacy tasks are archived under `doc/plans/`, and archive conventions are documented.
- [ ] Phase 1 — Security and deployment invariants.
  Work:
  - Remove unsafe production fallbacks for admin auth and JWT secrets.
  - Make startup fail fast when required production secrets/config are missing.
  - Narrow Fly deployment stance to the topology the app can actually support today.
  Exit criteria:
  - Production boot cannot succeed with default credentials or dev secrets.
  - Deployment docs and Fly config reflect actual supported topology.
  - Validation: `bun run build:quick` plus focused auth/proxy/render tests during execution; full `bun run build` and `bun run test` 3x deferred to Phase 6 final gate.
- [ ] Phase 2 — Durable state and job architecture.
  Work:
  - Externalize mutable state: sessions, users, preferences, playlists, progress, and rate limiting.
  - Move fetch/classify/train execution behind a durable worker/queue boundary.
  - Remove web-process ownership of long-running job state and in-process scheduler assumptions.
  Exit criteria:
  - Restart/rolling-deploy correctness no longer depends on a single Bun process.
  - Web app becomes a submit/query surface for jobs rather than the job owner.
  - Validation: `bun run build:quick` plus focused persistence/job-route tests during execution; targeted restart/job-resume verification before phase close; full `bun run build` and `bun run test` folded into Phase 6 final gate.
- [x] Phase 3 — Contract, observability, and readiness hardening.
  Work:
  - Define supported public/admin/internal routes.
  - Bring OpenAPI and docs into line with supported API behavior.
  - Replace silent stub/fallback responses with explicit availability semantics where needed.
  - Strengthen health/readiness/metrics and operational documentation.
  Exit criteria:
  - Supported API surface is documented and testable.
  - Health/readiness distinguish “alive” from “ready for traffic”.
  - Runbooks cover deploy, rollback, secrets, and job recovery.
- [ ] Phase 4 — Fly staging architecture and 100-user validation.
  Work:
  - Stand up staging with the intended production topology.
  - Expand performance journeys to search, auth, favorites, playlists, playback, and admin load.
  - Measure realistic mixed load, including rolling deploy behavior under traffic.
  Exit criteria:
  - Repository contains reproducible evidence that the chosen Fly topology supports the target workload.
  - VM sizing and concurrency limits are based on measured p95/p99 behavior, not defaults.
- [ ] Phase 5 — Portable SID correlation export.
  Work:
  - Implement the single-file offline export designed in the audit, with SQLite as the primary format.
  - Add schema/versioning, validation, CLI generation, and optional download metadata.
  - Provide a consumer-oriented example for c64commander-style favorite-to-playlist workflows.
  Exit criteria:
  - Export can be generated reproducibly from repo artifacts.
  - Fixture tests verify offline retrieval from one or more favorites.
  - Docs cover schema, lifecycle, and compatibility expectations.
- [ ] Phase 6 — Launch gate.
  Work:
  - Reconcile the system against Section 13 of `doc/audits/audit1/audit.md`.
  - Close or explicitly defer any remaining launch blockers with documented rationale.
  Exit criteria:
  - Fly rollout criteria are met for the intended topology.
  - Validation evidence exists for build/tests/load/deploy readiness.

**Progress log**  
- 2026-03-13 — Derived this roadmap from `doc/audits/audit1/audit.md`.
- 2026-03-13 — Archived completed, superseded, and no-longer-needed task history into `doc/plans/archive-2025-12-to-2026-03.md`.
- 2026-03-13 — Added archive conventions in `doc/plans/README.md` and reduced `PLANS.md` to a single active roadmap for stronger convergence.
- 2026-03-13 — Validation exposed a full-suite flake: `packages/sidflow-web/tests/unit/playlist-builder.test.ts` leaked `global.fetch` state across files. Fixed the test to reset/restore the mock and re-established 3 consecutive clean runs:
  - Run 1: 1666 pass, 0 fail, 6047 expect() calls. Ran 1666 tests across 165 files. [120.00s]
  - Run 2: 1666 pass, 0 fail, 6047 expect() calls. Ran 1666 tests across 165 files. [119.57s]
  - Run 3: 1666 pass, 0 fail, 6047 expect() calls. Ran 1666 tests across 165 files. [118.76s]
- 2026-03-13 — Next decisive action: start Phase 1 by enforcing production secret/deployment invariants in code, startup checks, Fly config, and deployment docs.
- 2026-03-13 — Phase 1 implementation started. Changed auth/JWT runtime checks to reject weak production secrets, blocked middleware bypass flags in production, added fail-fast Docker startup validation, switched Fly guidance/config to a single-machine topology, and aligned deployment docs/workflows with the new secret requirements. Evidence gathering next: run focused unit tests, then `bun run build` and `bun run test` until Phase 1 exits cleanly.
- 2026-03-13 — Investigated a stalled Phase 1 validation run and found an orphaned `vitest` process plus a hanging `sidplayfp` render integration path. Added a watchdog to `packages/sidflow-classify/test/render-integration.test.ts`, cleared the orphaned runner, and verified the lightweight per-phase sanity path: `tsc -b` completes in 0.268s while the WASM upstream check adds 0.730s. Next decisive action: use `bun run build:quick` plus targeted Phase 1 tests while iterating, then rerun full roadmap validation once Phase 1 is clean.
- 2026-03-13 — Re-scoped validation cadence per user direction: keep `bun run build:quick` (`tsc -b`) as the default phase sanity build and use focused tests while iterating; reserve full `bun run build` and full `bun run test` for the final roadmap gate unless a phase-specific issue requires the whole suite sooner.
- 2026-03-13 — Phase 2 implementation started with restart-sensitive state and durable job submission. Playback sessions now persist under `data/` and survive store resets; `/api/fetch` and `/api/train` now queue durable jobs via the existing manifest-backed orchestrator instead of spawning CLIs inline; admin job routes now reload the shared manifest from the repo-root path each request. Evidence: `bun run build:quick` passed after each slice; targeted tests passed: `packages/sidflow-web/tests/unit/playback-session.test.ts`, `packages/sidflow-web/tests/unit/api/fetch-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/train-jobs-route.test.ts` (5 pass, 0 fail). Next decisive action: finish the remaining Phase 2 gaps by moving classification and remaining in-memory state (rate limiting/progress) onto durable stores or the shared job boundary.
- 2026-03-13 — Extended the durable job boundary to async classification requests and classify progress fallback. `POST /api/classify` with `async=true` now queues a manifest-backed job instead of running inline, and `/api/classify/progress` surfaces queued-job state when no in-process runner is active. Evidence: `bun run build:quick` passed; focused tests passed: `packages/sidflow-web/tests/unit/api/classify-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/classify-route-temp-config.test.ts`, `packages/sidflow-web/tests/unit/api/fetch-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/train-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/playback-session.test.ts` (7 pass, 0 fail). Next decisive action: move the remaining Phase 2 mutable state (`rate-limiter`, classify/fetch progress persistence, scheduler assumptions) off process-local storage and wire operational docs around the job worker.
- 2026-03-13 — Removed two more Phase 2 single-process assumptions. Rate limiting now persists its sliding-window state under `data/rate-limits/` and the proxy uses async rate-limit checks, so abuse protection survives process restarts. The nightly scheduler now queues durable fetch/classify jobs through the manifest-backed orchestrator instead of calling internal HTTP routes, and the default classify UI flow now submits queued jobs by default. Evidence: `bun run build:quick` passed repeatedly; focused tests passed for rate limiting, proxy integration, scheduler, classify client/route behavior, fetch/train job routes, and playback-session persistence (35 pass for rate-limit/proxy slice, 10 pass for scheduler slice, 22 pass for classify/client slice, 0 fail). Next decisive action: begin Phase 3 by hardening the documented API surface and readiness semantics now that the core long-running execution path is queue-backed.
- 2026-03-13 — Completed the first concrete Phase 3 contract/readiness slice. `/api/health` now reports explicit liveness and readiness state, `GET /api/health?scope=readiness` returns `503` only when blocking readiness checks fail, and `GET /api/model/latest` now returns `503` instead of a silent stub when trained model artifacts are unavailable. Updated `packages/sidflow-web/openapi.yaml` and `doc/technical-reference.md` so the supported contract reflects durable queued `202 Accepted` behavior for fetch/train/classify plus the health/model availability semantics. Evidence: `bun run build:quick` passed after the changes; focused tests passed for health/model endpoints and queued API routes/client expectations: `packages/sidflow-web/tests/unit/health-api.test.ts`, `packages/sidflow-web/tests/unit/model-api.test.ts`, `packages/sidflow-web/tests/unit/api/fetch-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/train-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api/classify-jobs-route.test.ts`, `packages/sidflow-web/tests/unit/api-client.test.ts` (30 pass, 0 fail). Next decisive action: continue Phase 3 by tightening operational documentation and metrics/runbook coverage around durable job recovery, deploy rollback, and supported admin/internal endpoints.
- 2026-03-13 — Finished the remaining Phase 3 operational slice. Admin metrics now read durable job state from the shared manifest-backed orchestrator instead of inferring from a guessed filesystem layout, and `doc/deployment.md` now covers readiness checks, model availability, durable job worker recovery, and Fly rollback via the repository deployment script. Evidence: `bun run build:quick` passed; focused tests passed: `packages/sidflow-web/tests/unit/admin-metrics-api.test.ts`, `packages/sidflow-web/tests/unit/health-api.test.ts`, `packages/sidflow-web/tests/unit/model-api.test.ts` (23 pass, 0 fail). Next decisive action: start Phase 4 by inventorying the existing performance journeys, staging deployment assumptions, and current Fly capacity evidence for the 100-user validation plan.
- 2026-03-13 — Started Phase 4 with concrete staging-validation scaffolding. Extended `@sidflow/sidflow-performance` with a protocol-level `apiRequest` step so remote load runs can hit authenticated admin/API routes, added checked-in journeys for mixed search/play/favorite traffic and admin classify queue pressure, and added `scripts/perf/run-staging-validation.sh` as the reviewed wrapper for the remote staging bundle. Evidence: `bun run build:quick` passed after each slice; focused performance-package tests passed: `packages/sidflow-performance/test/action-map.test.ts`, `packages/sidflow-performance/test/playwright-executor.test.ts`, `packages/sidflow-performance/test/journey-loader.test.ts`, `packages/sidflow-performance/test/k6-executor.test.ts` (84 pass, 0 fail) plus a follow-up 43-pass subset after the wrapper script landed. Next decisive action: begin Phase 5 reconnaissance and implementation planning for the portable SID correlation export while Phase 4 awaits real staging credentials/data for execution evidence.
- 2026-03-13 — Phase 5 operator workflow tightened. Added `scripts/run-similarity-export.sh` as the unattended end-to-end helper for both local checkout and GHCR Docker modes, and rewrote `doc/similarity-export.md` to point to the helper with minimal copy-paste entrypoints instead of a long manual sequence. Evidence: `bash -n scripts/run-similarity-export.sh`, `bash scripts/run-similarity-export.sh --help`, and focused export/classify tests passed. Next decisive action: let the active full-HVSC classification complete, then verify the automatic export artifacts and close the remaining launch-gate validation work.
- 2026-03-13 — Hardened the Phase 5 helper for bounded/resumable classify runs and repaired export resiliency against real resumed-corpus data. `POST /api/classify` now accepts `limit`, the helper exposes `--max-songs`, and live local proof runs completed twice at `200/200` with stdout progress reporting. The helper no longer depends on the stale classify progress endpoint; it monitors the synchronous classify request through server-log parsing and request-status completion. Export now deduplicates repeated `sid_path` rows by newest `classified_at` and skips malformed classification rows without ratings, so resumed corpora export successfully again. Evidence: two local capped runs completed `200/200`; `bun run export:similarity -- --profile full --corpus-version hvsc` now succeeds on the live corpus; focused tests passed for `packages/sidflow-common/test/similarity-export.test.ts` (5 pass, 0 fail) and the latest helper syntax/build checks (`bash -n scripts/run-similarity-export.sh`, `bun run build:quick`). Next decisive action: start the unlimited helper-managed resume run and let it carry the full HVSC classification through to the final export artifact.
- 2026-03-13 — PR #82 review follow-up tightened the durability/operations slice. Rate-limit persistence now debounces snapshot writes off the hot request path while keeping explicit reset/cleanup flushes immediate, job-manifest access now reuses a cached orchestrator unless the manifest mtime changes, runtime job/rate-limit snapshots are removed from source control and ignored, and worker docs now consistently point to `bun run jobs:run`. The classify/export helper heredoc was also normalized and documents why it intentionally keeps classify requests synchronous while tailing server logs. Evidence: `bun run build:quick` passed, `bash -n scripts/run-similarity-export.sh` passed, and focused tests passed for `packages/sidflow-web/tests/unit/rate-limiter-persistence.test.ts`, `packages/sidflow-web/tests/unit/proxy-rate-limit.test.ts`, `packages/sidflow-web/tests/unit/admin-auth.test.ts`, and `packages/sidflow-web/tests/unit/admin-metrics-api.test.ts` (32 pass, 0 fail). Next decisive action: push this review-response batch, resolve the outstanding PR threads with clear comments, and continue polling CI/review state until PR #82 is green.
- 2026-03-13 — Follow-up CI triage on PR #82 found the remaining failure in the Next.js production build rather than the unit test phase. Fixed explicit JSON serialization typing for playback-session and rate-limit persisted manifests, and narrowed the synthesized classify per-thread status array to `ClassifyThreadStatus[]` so the web build satisfies the production-only type checks. Evidence: `cd packages/sidflow-web && bun run build` passed; focused tests passed for `packages/sidflow-web/tests/unit/playback-session.test.ts`, `packages/sidflow-web/tests/unit/rate-limiter-persistence.test.ts`, `packages/sidflow-web/tests/unit/proxy-rate-limit.test.ts`, and `packages/sidflow-web/tests/unit/admin-metrics-api.test.ts` (14 pass, 0 fail on the final rerun). Next decisive action: push the CI-fix commit and keep polling PR #82 until the Build and Test workflow finishes green.

**Follow-ups**  
- If older archived work needs to be revived, reopen it by linking the archive entry and attaching it to one of the phases above instead of restoring it as an independent active task.
