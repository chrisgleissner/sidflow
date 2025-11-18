# PLANS.md — Multi‑hour plans for SIDFlow

<!-- markdownlint-disable MD032 MD036 MD039 MD051 -->

This file is the long‑lived planning surface for complex or multi‑hour tasks in this repository, following the “Using PLANS.md for multi‑hour problem solving” pattern.

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
    - [Task: Play Tab Feature-Rich Enhancements (Modern Music Streaming UX)](#task-play-tab-feature-rich-enhancements-modern-music-streaming-ux)
      - [Step 8: Advanced Search \& Discovery](#step-8-advanced-search--discovery)
      - [Step 9: Playlist Management](#step-9-playlist-management)
      - [Step 10: Social \& Community](#step-10-social--community)
      - [Step 11: Quality Gates \& Polish](#step-11-quality-gates--polish)
    - [Task: Search \& Favorites Performance + E2E Hardening](#task-search--favorites-performance--e2e-hardening)

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
- When a Task is completed, move the entire Task section to \`doc/plans/archive/YYYY-MM-DD-<task-name>.md\`.
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

### Task: Play Tab Feature-Rich Enhancements (Modern Music Streaming UX)

**Current focus**
- Step 8 — Advanced Search & Discovery (global search bar, filters, surprise-me, coverage)
- Step 9 — Playlist Management (Save/CRUD/drag-drop/sharing)
- Step 10 — Social & Community Features (listening activity, charts, profiles, comments, badges)
- Step 11 — Quality Gates & Polish (test gates, coverage proof, screenshots, perf/a11y audits, docs/user guide)

**Why**
Play tab already ships Mood Transitions, Era Explorer, composer discovery, hidden gems, chip stations, remix radar, game journeys, collaborative/adaptive stations, and Recently Played/Favorites with tests. What remains is the playlist/social/search/QA backlog.

**Recent progress**
- 2025‑11‑18 — Re-verified Steps 6–7 during Playwright stabilization; confirmed mood/era/composer/hidden-gem/chip/remix/game/collaborative/adaptive stations plus history/favorites are exercised by the latest suites (details archived under `doc/plans/archive/2025-11-18-completed-phases.md`).

#### Step 8: Advanced Search & Discovery

- [ ] 8.1 — Global search bar (title/artist/game/year facets)
- [ ] 8.2 — Advanced filters (chip model, SID model, duration, rating)
- [ ] 8.3 — Results list with instant playback preview
- [ ] 8.4 — "Surprise Me" CTA
- [ ] 8.5 — Unit tests for search parsing/filter scope
- [ ] 8.6 — Playwright coverage for search flows

#### Step 9: Playlist Management

- [ ] 9.1 — "Save Current Queue" UX (name input + button)
- [ ] 9.2 — Playlist CRUD endpoints (`/api/playlists`)
- [ ] 9.3 — Playlist browser drawer in Play tab
- [ ] 9.4 — Drag-and-drop reordering within playlists
- [ ] 9.5 — Sharing/export (URL + M3U)
- [ ] 9.6 — Unit tests for playlist storage/reordering
- [ ] 9.7 — E2E for playlist creation/edit/playback

#### Step 10: Social & Community

- [ ] 10.1 — Real-time listening activity stream
- [ ] 10.2 — Daily/weekly/all-time top charts with live data
- [ ] 10.3 — Public user profiles (listening stats, favorites)
- [ ] 10.4 — Track comments & reviews
- [ ] 10.5 — Badges & achievements system

#### Step 11: Quality Gates & Polish

- [ ] 11.1 — Automated full-suite gate (unit + e2e) documented per release
- [ ] 11.2 — ≥90% coverage proof for new playlist/social/search code
- [ ] 11.3 — Updated screenshots for every new feature
- [ ] 11.4 — Perf audit: folder browser w/ ≥1000 files
- [ ] 11.5 — Accessibility audit (keyboard navigation + screen reader)
- [ ] 11.6 — Update `doc/web-ui.md`
- [ ] 11.7 — User guide for ML-powered stations & advanced features

### Task: Search & Favorites Performance + E2E Hardening

**User request (summary)**  
- Investigate slow/failing E2Es by measuring CPU/RAM during runs and produce actionable analysis.  
- Deliver durable fixes plus profiling UX triggered via `bun run` to inspect specific tests (flamegraph + textual report).

**Context and constraints**  
- Playwright server must stay in production mode with render-disabled env flags.  
- Favorites/search already have caches; ensure consistency between `.sidflow-preferences.json` and API responses.  
- Tests should run with ≤2 workers globally; favorites suite remains serial.  
- Profiling flows must log CPU+RAM at least every 10 s and persist user-friendly artifacts.

**Plan (checklist)**  
- [x] Step 1 — Baseline E2E resource usage with automated CPU/RAM logging (≥10 s cadence) reproducing current failures.  
- [x] Step 2 — Analyze logs/runtime reports to pinpoint hotspots (favorites/search endpoints, Next.js server) and document findings.  
- [x] Step 3 — Implement performance + stability fixes (API/query optimizations, caching, worker limits) and update docs/config.  
- [x] Step 4 — Provide `bun run profile:e2e` workflow (spec filters, flamegraph, textual summary) and document usage.  
- [x] Step 5 — Run full unit + E2E suites; ensure they pass without flakes and capture runtime summary.  
- [x] Step 6 — Eliminate benign-but-noisy `ECONNRESET/aborted` logs in the prod-mode Next test server after confirming the underlying condition is harmless.  
- [x] Step 7 — Profile additional top-5 longest Playwright specs (e.g., screenshots, song-browser) with detailed logging enabled and summarize bottlenecks + remediation ideas.

**Progress log**  
- 2025-11-18 — Profiling baseline captured with `bun run profile:e2e` against the three slowest specs (audio fidelity, search clear, personalized station) while `pidstat -rud -p ALL 10` logged CPU/RAM every 10 s; artifacts under `tmp/profiles/e2e-profile-2025-11-18T21-06-30/` etc.  
- 2025-11-18 — Runtime analysis via `npm run analyze:e2e` confirmed audio-fidelity and search flows dominate wall-clock (30–35 s); V8 CPU summaries show the majority of time spent spawning Next production server + idle waiting for network rather than app logic.  
- 2025-11-18 — Hardened favorites/search: Playwright now seeds favorites through `/api/favorites` with retries instead of mutating `.sidflow-preferences.json`, Playwright web server skips redundant `next build` (`SIDFLOW_SKIP_NEXT_BUILD=1`), and favorites tests run serially with reload-aware helper → flaky ECONNRESETs eliminated.  
- 2025-11-18 — Documented the profiling workflow in `doc/developer.md` (how to run `bun run profile:e2e`, artifact locations, how to share `cpu-summary.txt` with LLMs).  
- 2025-11-18 — Validation: `npm run test:e2e` (61 specs, 2 workers + serial favorites) now passes green; `SIDFLOW_SKIP_WASM_UPSTREAM_CHECK=1 npm run test` also passes (upstream git check guarded so transient GitHub 500s no longer block builds).  
- 2025-11-18 — New follow-up request: confirm/suppress benign `ECONNRESET` server logs and capture deeper profiles for screenshots/song-browser suites; steps 6–7 added to plan.
- 2025-11-18 — Added log suppression in `start-test-server.mjs` (`SIDFLOW_SUPPRESS_ABORT_LOGS` + `SIDFLOW_DEBUG_REQUEST_ERRORS`) to drop `ECONNRESET/EPIPE` noise while keeping opt-in diagnostics; reran `npm run test:e2e` to confirm green output and quiet server logs.  
- 2025-11-18 — Profiled `screenshots.spec.ts` and `song-browser.spec.ts` via `bun run profile:e2e -- --grep ... --workers=1`; captured `tmp/profiles/e2e-profile-2025-11-18T21-32-32` and `…21-33-42` showing <100 ms CPU but long wall-clock due to Next process thrash + repeated UI stabilization waits (`waitForStableUi` theme timeouts, `Song Browser` hitting HVSC listing). Summaries logged for follow-up optimization.

**Assumptions and open questions**  
- Assumption: `pidstat` available locally for sampling CPU/RAM every 10 s.  
- Assumption: Bottlenecks originate server-side rather than Playwright harness.  
- Open questions: None (decide autonomously and document in log if new uncertainties arise).

**Follow-ups / future work**  
- Extend profiling tooling to per-endpoint microbenchmarks if additional regressions appear.
