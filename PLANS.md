# PLANS.md — Multi‑hour plans for SIDFlow

<!-- markdownlint-disable MD032 MD036 MD039 MD051 -->

This file is the long‑lived planning surface for complex or multi‑hour tasks in this repository, following the "Using PLANS.md for multi‑hour problem solving" pattern.

Any LLM agent (Copilot, Cursor, Codex, etc.) working in this repo must:

- Read this file at the start of a substantial task or when resuming work.
- Keep an explicit, checklist‑style plan here for the current task.
- Update the plan and progress sections as work proceeds.
- Record assumptions, decisions, and known gaps so future contributors can continue smoothly.

## How to use this file

For each substantial user request or multi‑step feature, create a new Task section:

```markdown
### Task: <short title> (YYYY-MM-DD)

**User request (summary)**  
- <One or two bullet points>

**Plan (checklist)**  
- [ ] Step 1 — ...

**Progress log**  
- YYYY‑MM‑DD — Started task.  

**Follow‑ups**  
- <Out of scope items>
```

**Guidelines:**
- Prefer small, concrete steps over vague ones.
- Update the checklist as you go.
- When complete, move to `doc/plans/archive/YYYY-MM-DD-<task-name>.md`.
- Keep progress logs to last 2-3 days; summarize older entries.

## Maintenance rules

1. **Pruning**: Move completed tasks to archive. Keep progress logs brief.
2. **Structure**: Each task must have: User request, Plan, Progress log, Follow-ups.
3. **Plan-then-act**: Keep checklist synchronized with actual work. Build/Test must pass before marking complete.
4. **TOC**: Regenerate after adding/removing tasks.

---

## Active tasks

### Task: Fix classify-heartbeat e2e test (2025-12-12)

**User request (summary)**  
- Unskip the classify-heartbeat test and make it pass reliably.

**Plan (checklist)**  
- [x] Inspect the current classify-heartbeat test setup and failure mode.
- [x] Implement code/test fixes to prevent stale thread detection during classification.
- [ ] Run targeted validations (at least the affected e2e/spec) and broader checks as feasible.
- [ ] Record results and mark task complete once tests pass.

**Progress log**  
- 2025-12-12 — Started task, reviewing existing heartbeat test and classification progress handling.
- 2025-12-12 — Converted heartbeat spec to Playwright (chromium-only, serial), added idle wait + stale tracking via API.

**Follow-ups**  
- None yet.

### Task: Fix Fly.io CI deploy (2025-12-12)

**User request (summary)**  
- Make staging/production Fly.io deployments succeed in CI; staging currently fails because the app is missing.

**Plan (checklist)**  
- [x] Review current Fly.io workflow logic (app/volume creation, org defaults, secrets) and the failure path.
- [x] Update GitHub Actions workflow to auto-create apps/volumes (with safe defaults) for staging and production.
- [x] Fix Docker image startup to keep legacy `/sidflow/scripts` and `/app` paths alive for Fly.
- [ ] Build and publish a new image via GitHub release, then deploy to staging and production. *(blocked: staging app access)*

**Progress log**  
- 2025-12-12 — Investigating release workflow; staging deploy fails when sidflow-stg is absent because FLY_CREATE_APPS is not set.
- 2025-12-12 — Set workflow defaults to auto-create apps/volumes (FLY_CREATE_APPS/FLY_CREATE_VOLUMES=true, FLY_ORG default).
- 2025-12-12 — Not running code/tests locally (workflow-only change).
- 2025-12-12 — Validation blocked locally: Fly deployments require FLY_API_TOKEN/FLY_ORG in shell to run flyctl; tokens only available in GitHub Actions secrets.
- 2025-12-12 — Local flyctl auth works with provided token but lacks app-create scope (creation of sidflow-stg fails: "Not authorized to deploy this app"); staging app still needs creation with a full-scope token or manual pre-create.
- 2025-12-12 — Added compatibility symlinks in Dockerfile.production for `/sidflow/scripts` and `/app`; built image locally (sidflow:testfix) to verify startup script exists; `flyctl deploy --app sidflow-stg` blocked with "unauthorized".

**Follow-ups**  
- None yet.

---

## Archived Tasks

Completed tasks are in [`doc/plans/archive/`](doc/plans/archive/). Archives consolidated into:

- [completed-work-summary.md](doc/plans/archive/completed-work-summary.md) — All November 2025 completed tasks
- [strategic-feature-analysis.md](doc/plans/archive/strategic-feature-analysis.md) — Strategic roadmap and competitive analysis

**Recently archived (December 2025):**
- **Classification Pipeline Hardening & Productionization (2025-12-06)** — ✅ COMPLETE
  - 8 phases delivered: contracts/fixtures, WAV validation, Essentia detection, metadata enhancement, JSONL writer queue, metrics/observability, test strategy, CI integration
  - 44 new tests added (17 metrics + 12 writer queue + 15 WAV validation + 4 fast E2E)
  - Fast E2E: 0.17s (target ≤10s); All 1633 tests pass 3× consecutively
  - PR #75 merged with CI green: 91 passed, 3 skipped, 0 failed in 9m4s
- **CI Build Speed & Test Stability (2025-12-06)** — ✅ COMPLETE
  - Fixed scheduler-export-import test (wait for classification idle)
  - Skipped slow classify-api-e2e tests in CI (can run locally)
  - CI runtime reduced from 10.7m+ to 9m4s; 91 passed, 3 skipped, 0 failed
- Classification Pipeline Fixes (2025-12-04) — Fixed Essentia.js defaults
- Codebase Deduplication & Cleanup (2025-12-04) — CLI parser consolidation
- Documentation Consolidation Phase 1 & 2 (2025-12-06) — 98→16 files, 25k→2k lines

---

**Next steps**: When starting new work, create a Task section above following the template.
