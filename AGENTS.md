# Agent Instructions for SIDFlow

This repository is optimized for long‑running, mostly autonomous LLM work across tools (Codex CLI, GitHub Copilot, Cursor, and others).

If you are an LLM agent working in this repo:

- Treat this file as **required reading** before you write or edit code.
- Obey these instructions together with any system/developer prompts from your host tool. If they conflict, system‑level instructions win.
- Prefer acting directly (editing files, running tests, updating plans) over merely suggesting code.

## ⚠️ ABSOLUTE TEST REQUIREMENTS — READ THIS FIRST ⚠️

**BEFORE YOU DO ANYTHING ELSE, READ AND INTERNALIZE THESE RULES:**

### 🔴 NON-NEGOTIABLE TEST QUALITY RULES 🔴

1. **100% PASS RATE REQUIRED**: ALL tests must pass 3 times consecutively before ANY work is considered complete.
   - ❌ NEVER say "855 pass, 50 fail" is acceptable or "stable"
   - ❌ NEVER claim "perfect stability" with ANY failing tests
   - ❌ "Mostly working" or "95% passing" is COMPLETE FAILURE
   - ✅ ONLY "100% pass" across 3 consecutive runs is acceptable

2. **ALWAYS LEAVE TESTS BETTER THAN YOU FOUND THEM**:
   - If baseline is 844 pass / 40 fail, you must reach 844+ pass / 0 fail
   - Fix ALL pre-existing test failures - NEVER skip them
   - NEVER introduce new failing tests
   - NEVER stop working while ANY tests are failing or flaky

3. **FAILING TESTS MUST BE FIXED, NOT SKIPPED**:
   - Failing tests indicate real problems that must be resolved
   - If a test fails due to missing test dependencies (test fixtures, mock data): CREATE the missing dependencies
   - If a test fails due to missing external tools (ffmpeg/ffprobe) that are expected to be installed: FIX the installation or make the code handle their absence gracefully
   - ONLY skip tests with explicit `test.skip()` when they test features not yet implemented
   - Document WHY each test is skipped at the top of the test file
   - A skipped test is a TODO item, not a permanent solution

4. **TEST BEFORE YOU COMMIT**:
   - Run full test suite 3x: `for i in 1 2 3; do bun test packages/...; done`
   - Verify 100% pass rate on ALL three runs
   - If ANY test fails on ANY run: STOP and fix it
   - Only commit when you have 3 consecutive clean runs

5. **WHEN IN DOUBT, RUN THE TESTS**:
   - After every code change: run tests
   - Before every commit: run tests 3x
   - If you see failures: STOP EVERYTHING and fix them
   - Never rationalize away test failures

**YOU HAVE JUST LEARNED THIS LESSON THE HARD WAY. NEVER FORGET IT.**

## Required reading and orientation

Before making non‑trivial changes, you must read or skim, in this order:

1. `PLANS.md` — central ExecPlan for multi‑hour work and validation workflow.
2. `README.md` — high‑level overview, user goals, and entry points.
3. `doc/developer.md` — local setup, workspace commands, and coding standards.
4. `doc/technical-reference.md` — architecture, CLIs, data flow, and key components.
5. Relevant rollout or design plans under `doc/plans/**` (for example:
   - `doc/plans/web/rollout-plan.md` for web UI and API work.
   - `doc/plans/scale/plan.md` for scale‑out and production readiness.
   - `doc/plans/wasm/refactor-plan.md` for WASM / playback internals.)

Re‑open `PLANS.md` whenever you start a new user request or resume work after a pause.

## Multi‑hour planning (`PLANS.md` / ExecPlans)

This repo follows the PLANS pattern from the OpenAI Cookbook article “Using PLANS.md for multi‑hour problem solving”.

In this repository, an **ExecPlan** is any concrete, checklist‑style plan you maintain in `PLANS.md` for a substantial task.

As an agent:

- Always open `PLANS.md` when you start working and treat it as the **contract** for plan‑then‑act behavior.
- For each substantial user request or feature, create or update a **Task/ExecPlan entry** in `PLANS.md` rather than keeping the plan only in transient memory or tool‑specific state.
- Maintain a concrete, checklist‑style plan there (phases/steps, not just prose), and keep it in sync with your actual work.
- Append short progress updates to the relevant task as you complete steps; do not silently diverge from the written plan.
- When you finish a task, clearly mark it as completed in `PLANS.md` and record any follow‑ups, risks, or known gaps.

`PLANS.md` is the shared memory for multi‑hour problem solving. Prefer editing it incrementally over rewriting large sections.

## Persistence and autonomy

When responding to a user request in this repo:

- Default to **persistent, end‑to‑end execution**: keep going until the request is fully implemented, validated (Build, Lint/Typecheck, Tests), and reflected in documentation or `PLANS.md`.
- Do **not** stop early just because you hit an uncertainty; instead, make the most reasonable assumption you can based on the docs and code, and record that assumption in `PLANS.md` (or in your plan tool) for later adjustment.
- Avoid asking the user to clarify edge cases unless the environment explicitly requires it. Prefer to decide, act, and document.
- Use your host tool’s planning mechanisms (e.g., explicit plan/execute phases, task lists, or planning tools like `update_plan`) alongside `PLANS.md`.
- Prioritize high‑leverage actions (tests, small refactors, doc updates) that move the codebase closer to the documented architecture and rollout plans.

Always stay within the safety and capability constraints of your host environment (sandboxing, approvals, network restrictions).

## Coding conventions and architecture

Follow the existing conventions rather than inventing new ones:

- Language and tooling:
  - TypeScript monorepo driven by Bun (`bun run build`, `bun run test`, `bun run test:e2e`).
  - Strict TypeScript settings from `tsconfig.base.json`; avoid `any` and keep types explicit.
- Shared utilities and config:
  - Keep cross‑cutting helpers in `@sidflow/common` and **reuse** them instead of re‑implementing (config loader, deterministic JSON, logger, retry, LanceDB builder, filesystem helpers).
  - Always load configuration through `loadConfig` and honor `--config` overrides; use `resetConfigCache` in long‑running tools.
  - Serialize JSON deterministically with `stringifyDeterministic` to avoid diff churn and normalize structures before writing.
- CLIs and flows:
  - SIDFlow is a CLI‑first pipeline: fetch HVSC (`@sidflow/fetch`), classify (`@sidflow/classify`), train (`@sidflow/train`), and play/recommend (`@sidflow/play`); each stage reads/writes JSON/JSONL under `data/` and respects `.sidflow.json`.
  - Follow the existing CLI pattern: parse args in `cli.ts`, plan/validate inputs, then call pure helpers that accept explicit dependencies.
  - Treat scripts under `scripts/` as the contract for end‑to‑end flows; keep their UX and flags stable.
- Web/API:
  - For web UI and API work, align with the contracts and expectations in `doc/web-ui.md`, `doc/technical-reference.md`, and `doc/plans/web/rollout-plan.md`.
  - Preserve health/metrics endpoints (`/api/health`, `/api/admin/metrics`) and their responsibilities.

Do not introduce new top‑level frameworks or major dependencies without a strong justification that is consistent with the existing design documents and rollout plans.

## Maintenance scripts and operational discipline

**CRITICAL: Never interact directly with Docker, system services, or application infrastructure using ad-hoc commands.**

All operational tasks must be performed through dedicated maintenance scripts in the `scripts/` directory:

- **Docker builds**: Use `scripts/build-docker.sh`, NOT `docker build` directly
- **Docker deployment**: Use `scripts/deploy/install.sh`, NOT `docker run` or `docker-compose` directly
- **Container management**: Extend scripts in `scripts/deploy/` for stop/start/restart/logs operations
- **Database operations**: Use `scripts/build-db.ts` and related validation scripts
- **CI/test operations**: Use package.json scripts (`bun run test`, `bun run build`, etc.)

**Rationale**: 
- Maintenance scripts encode institutional knowledge (correct flags, environment variables, paths)
- Scripts are version-controlled, reviewed, and tested
- Ad-hoc commands lead to configuration drift and undocumented changes
- Scripts serve as living documentation of operational procedures

**If a needed script doesn't exist**:
1. Create it in the appropriate `scripts/` subdirectory
2. Make it idempotent and safe (check preconditions, provide clear error messages)
3. Document its purpose and usage in a comment header
4. Update `doc/developer.md` or `doc/deployment.md` as appropriate
5. Then use the new script for the task at hand

**Exception**: Exploratory commands during development (e.g., `grep`, `find`, `cat`, one-off TypeScript checks) are fine, but anything that modifies system state or interacts with running services must go through a script.

## Testing, validation, and safety

**⚠️ CRITICAL: See "ABSOLUTE TEST REQUIREMENTS" section above before proceeding ⚠️**

- **MANDATORY**: Run tests 3x consecutively and achieve 100% pass rate before considering any work complete
- Prefer writing or updating tests alongside non‑trivial changes.
- Use the existing commands from `doc/developer.md`:
  - Build/typecheck: `bun run build`.
  - Unit tests: `bun run test` (coverage is enforced).
  - End‑to‑end: `bun run test:e2e` when pipeline changes are involved.
  - Config and data validations: `bun run validate:config`, `bun run build:db`, and other scripts as documented.
- **Before changing or adding e2e tests**, read `doc/testing/e2e-test-resilience-guide.md` for best practices on writing resilient, non‑flaky tests that work reliably in CI environments.
- **If you cannot run tests** due to environment limits: STOP and document this in `PLANS.md` as a blocker. Do NOT proceed with untested changes.
- **Missing dependencies**: If tests require unavailable tools (ffmpeg, sidplayfp), skip them explicitly with clear comments, NOT let them fail
- Prefer additive, idempotent changes. Avoid destructive operations (e.g., deleting data or large refactors) unless explicitly requested or clearly necessary; when you must perform them, describe rollback steps in the plan.

## Tool‑specific guidance

These notes help different tools discover and obey the same instructions:

- **GitHub Copilot (including Workspace/Agents)**:
  - Always read `.github/copilot-instructions.md` (which points back to this file, `PLANS.md`, and the key docs) before large changes.
  - For multi‑step work, keep `PLANS.md` in sync with any internal Copilot plan or workspace state.
  - Prefer concrete edits plus validation over long speculative code dumps.
- **Cursor**:
  - Always obey `.cursorrules` in the repo root, which require reading this file and `PLANS.md` before editing.
  - Keep Cursor’s inline “Plan” or “Agent” view consistent with the ExecPlans you maintain in `PLANS.md`.
- **Codex / Codex CLI / other terminal agents**:
  - Treat `AGENTS.md` and `PLANS.md` as required reading before starting a task.
  - Use explicit plan/execute cycles and reflect each major step in `PLANS.md` as a checklist item with progress notes.

## When in doubt

When you are unsure how to proceed, prefer this sequence:

1. Read or re‑read relevant docs (`README.md`, `doc/developer.md`, `doc/technical-reference.md`, and the appropriate `doc/plans/**` file).
2. Update `PLANS.md` with your intended approach and any assumptions.
3. Implement the smallest coherent slice that moves the task forward.
4. Run targeted validation (build/tests/scripts) and record results in `PLANS.md`.
5. Summarize changes, decisions, and remaining work in `PLANS.md` and in your final user‑facing summary.

