# PLANS.md — Multi‑hour plans for SIDFlow

<!-- markdownlint-disable MD032 MD036 MD039 MD051 -->

This file is the long‑lived planning surface for complex or multi‑hour tasks in this repository, following the "Using PLANS.md for multi‑hour problem solving" pattern.

Any LLM agent (Copilot, Cursor, Codex, etc.) working in this repo must:

- Read this file at the start of a substantial task or when resuming work.
- Keep an explicit, checklist‑style plan here for the current task.
- Update the plan and progress sections as work proceeds.
- Record assumptions, decisions, and known gaps so future contributors can continue smoothly.

## Table of Contents

<!-- TOC -->

- [PLANS.md — Multi‑hour plans for SIDFlow](#plansmd--multihour-plans-for-sidflow)
  - [How to use this file](#how-to-use-this-file)
  - [Maintenance rules](#maintenance-rules)
  - [Active tasks](#active-tasks)
    - [Task: Feature Extraction (2025-11-29)](#task-feature-extraction-2025-11-29)
    - [Task: Achieve >90% Test Coverage (2025-11-24)](#task-achieve-90-test-coverage-2025-11-24)
    - [Task: Documentation Consolidation (2025-12-06)](#task-documentation-consolidation-2025-12-06)
  - [Archived Tasks](#archived-tasks)

<!-- /TOC -->

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

### Task: Feature Extraction (2025-11-29)

**User request (summary)**
- Classification pipeline must show Essentia feature extraction in web UI
- Per-thread live status with phase + SID filename, counters, stalled indicators
- Structured logging for phase transitions

**Plan (checklist)**
- [x] Step 1 — Reproduce missing JSONL/progress via admin flow ✓ Confirmed Essentia runs but visibility missing
- [ ] Step 2 — Document state machine contract (worker lifecycle, heartbeats, message schema)
- [ ] Step 3 — State-machine enforcement: per-thread ordering render→metadata→tagging→finalize
- [ ] Step 4 — Event routing & heartbeats with stall thresholds
- [ ] Step 5 — UI progress: per-thread phase/SID, counters, stalled indicators
- [ ] Step 6 — Error handling & retries per phase
- [ ] Step 7 — Documentation & diagrams
- [ ] Step 8 — Test matrix design
- [ ] Step 9 — Implement tests (~90% coverage)
- [ ] Step 10 — Validation (build, test 3×, E2E)

**Progress log**
- 2025-12-06 — Step 1 complete. CLI writes JSONL correctly; issue is web visibility.

**Follow-ups**
- Consider splitting render vs feature extraction into discrete phases for UX
- Telemetry/metrics endpoint after stabilization

---

### Task: Achieve >90% Test Coverage (2025-11-24)

**User request (summary)**
- Raise coverage from ~60% to ≥90%
- Focus on high-impact modules (browser code, CLI utilities)

**Plan (checklist)**
- [x] Phase 1 — Baseline ✓ 60% coverage, 1437 tests passing
- [x] Phase 2.1-2.4 — E2E coverage integration ✓ Merge script, CI workflow updated
- [ ] Phase 2.5 — Add targeted tests to reach 90% (+30pp needed)
- [ ] Phase 2.6 — Update copilot-instructions.md with new baseline
- [ ] Phase 3 — Validation and documentation

**Progress log**
- 2025-11-24 — E2E coverage pipeline working. Merged coverage: 59.53%. All tests pass.

**Follow-ups**
- CLI mocking utilities for systematic CLI test coverage
- Web API mocks for browser-only modules

---

### Task: Documentation Consolidation (2025-12-06)

**User request (summary)**
- 98 markdown files totaling 27,033 lines with redundancy and contradictions
- Goal: <15,000 lines, <40 files, concise and accurate

**Plan (checklist)**

Phase 1: Audit
- [ ] 1.1 — Create inventory with overlap analysis
- [ ] 1.2 — Identify duplicates across files
- [ ] 1.3 — Flag contradictions
- [ ] 1.4 — Categorize: essential, merge, archive, delete

Phase 2: Archive cleanup
- [ ] 2.1 — Review doc/plans/archive/ (45 files)
- [ ] 2.2 — Consolidate doc/plans/improvements/
- [ ] 2.3 — Archive completed plans in doc/plans/web/, scale/, wasm/

Phase 3: Core consolidation
- [ ] 3.1 — Make doc/developer.md authoritative
- [ ] 3.2 — Condense doc/technical-reference.md
- [ ] 3.3 — Merge deployment docs into single guide
- [ ] 3.4 — Condense doc/admin-operations.md

Phase 4-7: Package READMEs, testing docs, agent instructions, validation

**Progress log**
- 2025-12-06 — Task created. Analysis shows significant redundancy.

---

## Archived Tasks

Completed tasks are in [`doc/plans/archive/`](doc/plans/archive/). Recent archives:

**2025-11-28:**
- [Classification Pipeline Fixes](doc/plans/archive/2025-11-28-classification-pipeline-fixes.md) — Essentia default, inline rendering, progress UI
- [Audio Format and UI Fixes](doc/plans/archive/2025-11-28-audio-format-and-ui-fixes.md) — Preferences API, rate limiting, pause/resume

**2025-11-27:**
- [Docker and Deployment Fixes](doc/plans/archive/2025-11-27-docker-and-deployment-fixes.md) — Health checks, CLI resolution, WAV duration
- [Fly.io Deployment](doc/plans/archive/2025-11-27-fly-io-deployment.md) — Complete Fly.io infrastructure

**2025-11-26:**
- [E2E and Health Fixes](doc/plans/archive/2025-11-26-e2e-and-health-fixes.md) — IPv4 fix, CSP, UI loading

**Earlier:** See [`doc/plans/archive/`](doc/plans/archive/) for complete history.

---

**Next steps**: When starting new work, create a Task section above following the template.
