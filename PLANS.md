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
  - Validation: `bun run build`, `bun run test` 3x.
- [ ] Phase 2 — Durable state and job architecture.
  Work:
  - Externalize mutable state: sessions, users, preferences, playlists, progress, and rate limiting.
  - Move fetch/classify/train execution behind a durable worker/queue boundary.
  - Remove web-process ownership of long-running job state and in-process scheduler assumptions.
  Exit criteria:
  - Restart/rolling-deploy correctness no longer depends on a single Bun process.
  - Web app becomes a submit/query surface for jobs rather than the job owner.
  - Validation: build/tests plus targeted restart/job-resume verification.
- [ ] Phase 3 — Contract, observability, and readiness hardening.
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

**Follow-ups**  
- If older archived work needs to be revived, reopen it by linking the archive entry and attaching it to one of the phases above instead of restoring it as an independent active task.
