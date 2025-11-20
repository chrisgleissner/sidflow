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
  - [Table of Contents](#table-of-contents)
  - [How to use this file](#how-to-use-this-file)
  - [Maintenance rules (required for all agents)](#maintenance-rules-required-for-all-agents)
    - [Table of Contents](#table-of-contents-1)
    - [Pruning and archiving](#pruning-and-archiving)
    - [Structure rules](#structure-rules)
    - [Plan-then-act contract](#plan-then-act-contract)
  - [Active tasks](#active-tasks)
  - [Archived Tasks](#archived-tasks)

<!-- /TOC -->

## How to use this file

For each substantial user request or multi‑step feature, create a new Task section like this:

```markdown
## Task: <short title>

**User request (summary)**  
- <One or two bullet points capturing the essence of the request.>

**Context and constraints**  
- <Key architecture or rollout constraints from the docs.>

**Plan (checklist)**  
- [ ] Step 1 — ...
- [ ] Step 2 — ...
- [ ] Step 3 — ...

**Progress log**  
- YYYY‑MM‑DD — Started task, drafted plan.  
- YYYY‑MM‑DD — Completed Step 1 (details).  

**Assumptions and open questions**  
- Assumption: ...  
- Open question (only if strictly necessary): ...

**Follow‑ups / future work**  
- <Items out of scope for this task but worth noting.>
```

Guidelines:

- Prefer small, concrete steps over vague ones.
- Update the checklist as you go—do not wait until the end.
- Avoid deleting past tasks; instead, mark them clearly as completed and add new tasks below.
- Keep entries concise; this file is a working log, not polished documentation.
- Progress through steps sequentially. Do not start on a step until all previous steps are done and their test coverage exceeds 90%.
- Perform a full build after the final task of a step. If any errors occur, fix them and rerun all tests until they are green.
- Then Git commit and push all changes with a conventional commit message indicating the step is complete.

## Maintenance rules (required for all agents)

### Table of Contents

- Maintain an automatically generated TOC using the "<!-- TOC --> … <!-- /TOC -->" block at the top of this file.
- After adding, removing, or renaming a Task section, regenerate the TOC using the standard Markdown All-in-One command.
- Do not manually edit TOC entries.

### Pruning and archiving

To prevent uncontrolled growth of this file:

- Keep only active tasks and the last 2–3 days of progress logs in this file.
- When a Task is completed, move the entire Task section to [`doc/plans/archive/YYYY-MM-DD-<task-name>.md`](doc/plans/archive/).
- When progress logs exceed 30 lines, summarize older entries into a single "Historical summary" bullet at the bottom of the Task.
- Do not delete information; always archive it.

### Structure rules

- Each substantial task must begin with a second-level header:

  \`## Task: <short title>\`

- Sub-sections must follow this order:
  - User request (summary)
  - Context and constraints
  - Plan (checklist)
  - Progress log
  - Assumptions and open questions
  - Follow-ups / future work

- Agents must not introduce new section layouts.

### Plan-then-act contract

- Agents must keep the checklist strictly synchronized with actual work.
- Agents must append short progress notes after each major step.
- Agents must ensure that Build, Lint/Typecheck, and Tests are PASS before a Task is marked complete.
- All assumptions must be recorded in the "Assumptions and open questions" section.

## Active tasks

### Task: Fix E2E Test Regression & Improve Coverage (2025-11-20)

**User request (summary)**
- A) E2E tests do not run at all - SEVERE REGRESSION
- B) Coverage for several files is critically low

**Context and constraints**
- E2E test files were renamed from `.spec.ts` to `.e2e.ts` but Playwright config still looks for `.spec.ts`
- Current coverage: 68.55% overall, but many critical files below 50%
- Test count: 1133 pass, 2 skip, 0 fail (unit tests working)
- E2E tests: 0 found (Playwright reports "No tests found")

**Plan (checklist)**
- [x] Phase 1: Fix E2E test regression (CRITICAL)
  - [x] 1.1 — Identify root cause: `.e2e.ts` vs `.spec.ts` mismatch
  - [x] 1.2 — Rename all 13 `.e2e.ts` files back to `.spec.ts`
  - [x] 1.3 — Verify Playwright finds all tests (89 tests found)
  - [ ] 1.4 — Run E2E tests to confirm they pass
  
- [ ] Phase 2: Improve coverage for critically low files
  - [ ] 2.1 — Identify files with <30% coverage needing tests
  - [ ] 2.2 — Create tests for sidflow-web lib files (cli-executor, rate-playback, similarity-search)
  - [ ] 2.3 — Create tests for sidflow-common dist files (feedback, job-runner, lancedb-builder)
  - [ ] 2.4 — Create tests for audio encoding and playback files
  - [ ] 2.5 — Verify coverage improvement to target levels

- [ ] Phase 3: Final validation
  - [ ] 3.1 — Run full test suite (unit + E2E) 3x consecutively
  - [ ] 3.2 — Verify coverage ≥70% (stepping stone to 92%)
  - [ ] 3.3 — Document known gaps and follow-up work

**Progress log**
- 2025-11-20 — Identified root cause: E2E test files renamed to `.e2e.ts` but Playwright config expects `.spec.ts`
- 2025-11-20 — Starting Phase 1.2: Renaming E2E test files

**Assumptions and open questions**
- Assumption: E2E tests were working before recent rename
- Assumption: Coverage gaps are due to missing tests, not dead code
- Question: Should we standardize on `.e2e.ts` or `.spec.ts` for E2E tests?

**Follow-ups / future work**
- Decide on test file naming convention and document it
- Set up pre-commit hook to prevent config/filename mismatches
- Create coverage improvement roadmap to reach 92% target

## Archived Tasks

All completed tasks have been moved to [`doc/plans/archive/`](doc/plans/archive/). Recent archives (2025-11-19 to 2025-11-20):

- **2025-11-19**: [Play Tab Feature-Rich Enhancements (Steps 8-11)](doc/plans/archive/2025-11-19-play-tab-enhancements-steps-8-11.md) ✅
  - Advanced search with filters, playlist management, social features, quality gates

- **2025-11-19**: [Search & Favorites Performance + E2E Hardening](doc/plans/archive/2025-11-19-search-favorites-performance-e2e.md) ✅
  - E2E profiling infrastructure, test stability fixes, log management

- **2025-11-19**: [Codebase Audit & Documentation Accuracy Review (Round 1)](doc/plans/archive/2025-11-19-codebase-audit-round-1.md) ✅
  - Line-by-line review, documentation fixes, missing README creation

- **2025-11-19**: [Performance & Caching Optimization](doc/plans/archive/2025-11-19-performance-caching-optimization.md) ✅
  - Config/metadata/feature caching, buffer pooling, CLI throttling

- **2025-11-19**: [Render Engine Naming Clarification](doc/plans/archive/2025-11-19-render-engine-naming.md) ✅
  - Clarified libsidplayfp-wasm naming in all user-facing contexts

- **2025-11-19**: [Comprehensive Line-by-Line Audit (Round 2)](doc/plans/archive/2025-11-19-codebase-audit-round-2.md) ✅
  - Second detailed audit achieving perfection in code and documentation

**Earlier archives**: See [`doc/plans/archive/`](doc/plans/archive/) directory for complete history including:
- 2025-11-18: E2E test stabilization and performance profiling
- 2025-11-16: Play tab phases 1-5, main merge stabilization
- 2025-11-15: Playwright E2E CSP fixes, render engine stabilization

---

**Next steps**: When starting new work, create a Task section above following the template in "How to use this file".
