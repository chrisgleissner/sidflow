# Agent Instructions for SIDFlow

This repository is optimized for long‑running, mostly autonomous LLM work across tools (Codex CLI, GitHub Copilot, Cursor, and others).

If you are an LLM agent working in this repo:

- Treat this file as **required reading** before you write or edit code.
- Obey these instructions together with any system/developer prompts from your host tool. If they conflict, system‑level instructions win.
- Prefer acting directly (editing files, running tests, updating plans) over merely suggesting code.

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

## Testing, validation, and safety

- Prefer writing or updating tests alongside non‑trivial changes.
- Use the existing commands from `doc/developer.md`:
  - Build/typecheck: `bun run build`.
  - Unit tests: `bun run test` (coverage is enforced).
  - End‑to‑end: `bun run test:e2e` when pipeline changes are involved.
  - Config and data validations: `bun run validate:config`, `bun run build:db`, and other scripts as documented.
- When you cannot run tests (environment limits), reason carefully about edge cases and call them out in `PLANS.md` and your final summary.
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

