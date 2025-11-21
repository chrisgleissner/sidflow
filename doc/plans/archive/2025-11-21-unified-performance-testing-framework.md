# Unified Performance Testing Framework (2025-11-21)

**Archived from PLANS.md on 2025-11-21**

**User request (summary)**
- Design a unified performance-testing system for Next.js with client/browser journeys and SID-streaming backend, minimizing duplication.
- Produce a rollout plan and target architecture covering shared journey specs, Playwright + k6 executors, unified runner, and reporting outputs.

**Context and constraints**
- Two execution modes: Playwright browser-mode for fidelity; k6 protocol-mode for scalable load (1/10/100 users).
- Journeys defined once in a shared declarative spec consumed by both executors; pacing is one interaction every 3 seconds.
- Outputs must include k6 CSV + HTML dashboard + stdout summary, Playwright browser timing, JSON summaries for LLM guidance, and nightly Markdown referencing all artifacts.
- Unified runner must support local ad-hoc runs and nightly CI with versioned/timestamped results folders.

**Plan (checklist)**
- [x] 1 — Draft rollout plan defining phases, directory layout, execution modes, and reporting expectations.
- [x] 2 — Draft target architecture doc detailing journey specs, executors, runner orchestration, pacing/concurrency, and outputs.
- [x] 3 — Update PLANS.md progress and validate docs for clarity/consistency with repo conventions.

**Progress log**
- 2025-11-21 — Task opened, requirements captured, draft plan started.
- 2025-11-21 — Added rollout plan at `doc/performance/unified-performance-testing-rollout.md` covering phases, deliverables, and run modes.
- 2025-11-21 — Added architecture doc at `doc/performance/unified-performance-testing-architecture.md` with journey specs, executors, runner, pacing, and artifact layout; updated PLANS.md.

**Assumptions and open questions**
- Assumption: Scope limited to planning/architecture docs; no code changes or CI wiring in this iteration.
- Open question: Whether to integrate with existing build/test workflows or introduce dedicated perf pipelines later.

**Follow-ups / future work**
- Implement journey spec schema, executor adapters, and unified runner scripts.
- Extend CI workflows to trigger nightly runs and attach artifacts per plan.
- Add summarisation module code + tests once architecture is approved.
