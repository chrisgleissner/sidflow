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

### Task: Documentation Phase 2 — Ruthless Cleanup (2025-12-06)

**User request (summary)**
- Remove all docs that serve no purpose, are long-winded, or describe trivialities
- Keep ONLY what the project needs, nothing more

**Status:** ✅ COMPLETE — 16 files, 2,140 lines (86% reduction from Phase 1)

**Completed actions:**
1. Deleted 8 audit/governance docs (security, accessibility, release-readiness, production-rollout, artifact-governance, web-ui, performance-metrics, sid-metadata)
2. Deleted 7 implementation detail docs (AUDIO_CAPTURE, AUDIO_PIPELINE, TELEMETRY, README-INTEGRATION, e2e-resilience-guide, coverage, performance-testing)
3. Deleted 3 archive files and empty directories
4. Replaced technical-reference.md (1595→86 lines)
5. Replaced developer.md (1049→63 lines)
6. Replaced deployment.md (545→40 lines)
7. Replaced 7 package READMEs (1869→89 lines total)

**Final state:**
| File | Lines |
|------|-------|
| CHANGES.md | 901 |
| README.md | 366 |
| AGENTS.md | 200 |
| PLANS.md | ~150 |
| .github/copilot-instructions.md | 138 |
| doc/technical-reference.md | 86 |
| packages/libsidplayfp-wasm/README.md | 70 |
| doc/developer.md | 63 |
| doc/deployment.md | 40 |
| 7× package READMEs | ~90 |
| **TOTAL** | **~2,100** |

**Progress log**
- 2025-12-06 — Executed ruthless cleanup. 39 files → 16 files, 15,570 → 2,140 lines. Build verified.

---

### Task: Documentation Consolidation Phase 1 (2025-12-06)

**Status:** ✅ COMPLETE — 39 files, 15,570 lines (60% file reduction, 40% line reduction)

**Completed work:**
1. Removed `doc/plans/improvements/` (notes.md, ideas.md, plan.md — ~2000 lines)
2. Removed archive subdirs: init/, scale/, wasm/, web/, client-side-playback/
3. Consolidated 31 archive files → single `completed-work-summary.md`
4. Merged testing docs: coverage-baseline.md + coverage-improvement-plan.md → coverage.md
5. Merged performance docs: 4 files (336 lines) → performance-testing.md (73 lines)
6. Removed redundant: fly-deployment-setup-summary.md, docker-release-fix.md, e2e-test-implementation.md, documentation-audit-summary.md, telemetry.md
7. Archived: strategic-feature-analysis.md (planning doc)
8. Removed generated artifacts from playwright-report/, test-results/, performance/results/

**Progress log**
- 2025-12-06 — Task completed. Build verified. 98 files → 39 files, 25,853 lines → 15,570 lines.

---

## Archived Tasks

Completed tasks are in [`doc/plans/archive/`](doc/plans/archive/). Archives consolidated into:

- [completed-work-summary.md](doc/plans/archive/completed-work-summary.md) — All November 2025 completed tasks
- [strategic-feature-analysis.md](doc/plans/archive/strategic-feature-analysis.md) — Strategic roadmap and competitive analysis

---

**Next steps**: When starting new work, create a Task section above following the template.
