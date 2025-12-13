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

### Task: Enable all skipped tests + fix classify-heartbeat idle timeout (2025-12-13)

**User request (summary)**  
- Enable and fix all currently disabled tests (unit + e2e).
- Fix failing e2e `classify-heartbeat` timeout: "Timed out waiting for classification to become idle".
- Prove stability with 3 consecutive fully green runs.

**Plan (checklist)**  
- [ ] Inventory all skipped/disabled tests (unit + e2e) and identify why they’re skipped.
- [ ] Fix `classify-heartbeat` by making “classification idle” deterministic (cleanup + self-healing progress state).
- [ ] Re-enable skipped e2e specs by making them self-contained + fast (synthetic inputs, no dependency on existing `data/`).
- [ ] Re-enable skipped unit tests (remove manual-only skips; make runtime bounds stable).
- [ ] Validation: `bun run build && bun run test && bun run test:e2e` 3× consecutive (paste outputs).

**Progress log**  
- 2025-12-13 — Started: identified 5 skipped tests (3 e2e, 2 unit) and confirmed heartbeat fails while waiting for `/api/classify/progress` to report idle.

### Task: Configurable intro skip + updated render/classify constraints (2025-12-13)

**User request (summary)**
- Fix the prefs copy/validation for timeouts: min `maxRenderSec` should be sensible (≥ 20s and ≥ `maxClassifySec + introSkipSec`).
- Make the intro skip seconds configurable (default 10s) and apply it during representative-window selection; only reduce the skip when the song is too short.

**Plan (checklist)**
- [ ] Add `introSkipSec` to SIDFlow config schema and prefs API/UI.
- [ ] Update representative-window selection to skip `introSkipSec` (clamped when audio too short).
- [ ] Update min-render constraint logic and prefs UI copy (≥ 20s and ≥ `maxClassifySec + introSkipSec`).
- [ ] Update/extend unit tests for API validation + representative-window behavior.
- [ ] Validation: `bun run build`; `bun run test` 3× consecutive (paste outputs).

**Progress log**
- 2025-12-13 — Started task.

### Task: Respect format prefs; trim WAV intro/silence; enforce render>=classify (2025-12-13)

**User request (summary)**
- Stop generating FLAC/M4A when deselected in prefs.
- Remove ~1s silence at start of rendered WAVs.
- When generating capped render artifacts (per `maxRenderSec`), skip intros in the rendered audio itself (postprocess to a representative snippet).
- Enforce `maxRenderSec >= maxClassifySec` in UI + API.
- Add unit tests; ensure full unit tests pass 3× consecutively (paste outputs).

**Plan (checklist)**
- [x] Wire web classify temp config to include prefs `defaultFormats`.
- [x] Enforce `maxRenderSec >= maxClassifySec` in `/api/prefs`, UI, and config validation.
- [x] Postprocess rendered WAVs: trim leading silence; select/slice representative snippet when `maxRenderSec` is active.
- [x] Add fast unit tests for: prefs constraint rejection; temp config formats; WAV postprocessing.
- [x] Validation: `bun run build`; `bun run test` 3× consecutive (paste outputs).

**Progress log**
- 2025-12-13 — Started task; locating render format selection, prefs persistence, and WAV postprocessing hooks.
- 2025-12-13 — Implemented: classify temp config respects `defaultFormats`; WAV leading-silence trim; representative-window slicing for capped renders; prefs/UI validation for render/classify constraints; added unit tests.
- 2025-12-13 — Validation: `bun run test` 3× consecutive (all show `0 fail`):

  Run #1:
  1656 pass
  2 skip
  0 fail
  Ran 1658 tests across 163 files. [50.61s]

  Run #2:
  1656 pass
  2 skip
  0 fail
  Ran 1658 tests across 163 files. [50.33s]

  Run #3:
  1656 pass
  2 skip
  0 fail
  Ran 1658 tests across 163 files. [50.72s]

**Follow-ups**
- None yet.

### Task: Preserve cached WAVs; cap feature extraction window (2025-12-13)

**User request (summary)**
- If an oversized WAV is already present in the cache, never reduce its size (no truncation/rewrites on cache hits).
- Cap **feature extraction** by analyzing only a representative fragment according to `maxClassifySec` (max extract duration), not necessarily the first seconds (skip intro when possible).
- Only when cache artifacts do not exist should rendering be limited (respect `maxRenderSec` when creating new artifacts).
- Add relevant unit tests; ensure build + unit tests pass 3× consecutively (capture output).

**Plan (checklist)**
- [x] Remove cache-hit WAV truncation (preserve existing cached audio artifacts).
- [x] Add representative-window selection logic (intro-skipping) used by Essentia extraction (main thread + worker).
- [x] Ensure render-time limiting applies only when creating new artifacts (use `maxRenderSec`).
- [x] Update/replace tests to cover: no cache-hit truncation; window-limited extraction; render caps remain enforced for new renders.
- [x] Validation: `bun run build`; `bun run test` 3× consecutively (paste outputs).

**Progress log**
- 2025-12-13 — Started implementation; locating cache-hit truncation and full-WAV extraction code paths.
- 2025-12-13 — Implemented representative-window extraction (intro skip + energy pick) and removed cache-hit truncation.
- 2025-12-13 — Validation: `bun run build` x3 (passes; upstream check prints “Upstream changed; WASM rebuild required.” but exits 0).
- 2025-12-13 — Validation: `bun run test` x3 consecutive: 1650 pass, 2 skip, 0 fail.

**Follow-ups**
- None yet.

### Task: Wire maxRenderSec/maxClassifySec into prefs UI/API (2025-12-13)

**User request (summary)**
- Make `maxRenderSec` and `maxClassifySec` controllable via the prefs tab UI and the prefs REST API.
- Add exceptionally fast tests covering edge conditions; ensure full build + tests pass 3× consecutively.

**Plan (checklist)**
- [x] Add prefs REST API support for reading/updating these config keys.
- [x] Add prefs UI controls that round-trip through the API.
- [x] Add fast unit tests for prefs route validation + persistence.
- [x] Add fast unit tests for classification duration capping across edge values.
- [x] Run `bun run build` and `bun run test` 3× consecutively (capture output).

**Progress log**
- 2025-12-13 — Wired config limits through /api/prefs and Admin prefs UI; added fast unit tests for API route + classification edge cases.
- 2025-12-13 — Validation: `bun run build && bun run test` x3: 1643 pass, 2 skip, 0 fail (all 3 runs).

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
