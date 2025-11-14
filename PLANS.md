# SIDFlow Execution Plan (ExecPlan)

This document is the central, living plan for long-running, autonomous work in this repository. Agents and contributors must follow it for any multi-step change. It is self-contained: a novice should be able to complete a task by reading this file plus the current working tree.

If you are an agent (Copilot, Cursor, Codex): read this file first, then keep it updated as you proceed. Do not stop until the user’s request is fully satisfied or you are genuinely blocked by missing credentials or external access. Prefer research and reasonable assumptions; record assumptions in Decision Log.

## Purpose

Provide a consistent, plan-then-act workflow that enables multi-hour autonomous work with validation. After following this plan, you will: make minimal, correct edits; validate builds/tests; document progress and decisions; and leave the repository in a green state.

## Repository orientation

- Runtime/tooling: Bun (build/test/CLI). Package manager: bun. Language: strict TypeScript.
- Monorepo packages under `packages/*` (fetch, classify, train, play, rate, web, common, libsidplayfp-wasm, etc.).
- Scripts under `scripts/` are the contract for end-to-end flows (fetch → classify → train → play). Keep CLI UX stable.
- Shared conventions live in `packages/sidflow-common` and `.github/copilot-instructions.md`.
- Data artifacts under `data/` (classified, model, feedback, training logs) and `workspace/` for large assets.

## Non‑negotiable requirements

- Self-contained plans: include all context a novice needs; avoid “see X doc” unless quoting or summarizing it here.
- Living document: keep Progress, Surprises & Discoveries, Decision Log, and Outcomes up to date as you work.
- Outcome-focused: acceptance is observable behavior (CLI output, HTTP responses, passing tests), not just code diffs.
- Validation is mandatory: after substantive edits, run Build, Lint/Typecheck, and Tests; record PASS/FAIL succinctly.
- Idempotent and safe steps: prefer additive, small changes; specify retry/rollback for risky edits.

## Plan of work (contract)

When beginning a task:
1) Research and orient
   - Skim repository structure and relevant files (prefer reading larger, meaningful chunks over many small reads).
   - Reuse shared utilities from `@sidflow/common`; do not reimplement helpers.
2) Draft minimal edits
   - Keep public APIs stable unless required. Compose small functions and pure helpers for testability.
   - Serialize JSON deterministically with `stringifyDeterministic` and normalize structures before writing.
3) Implement with progress logging
   - Make concrete edits; after batches of 3–5 edits, summarize what changed and what’s next.
   - Prefer single, coherent patches per file to limit churn.
4) Validate quickly
   - Build and typecheck (Bun/TypeScript) and run unit tests; for CLI changes, run the smallest representative script.
   - Record PASS/FAIL and key error messages below; iterate up to three targeted fixes before surfacing blockers.
5) Finish green
   - Ensure Build, Lint/Typecheck, and Tests are PASS. Note residual risks or follow-ups in Outcomes.

## Concrete steps

- Build: run Bun build per package or at repo root as appropriate (see package.json scripts). Expect no type errors.
- Test: `bun run test` at repo root; E2E with `bun run test:e2e` when relevant. Expect passing tests; WASM ffmpeg tests may be skipped depending on runtime.
- CLIs: Use wrappers in `scripts/` (e.g., `scripts/sidflow-fetch`, `scripts/sidflow-classify`, etc.) for end-to-end flows.

## Validation and acceptance

- Build PASS; TypeScript errors: none.
- Tests PASS; any skipped tests documented with reason.
- For web/API changes: `/api/health` returns 200; `/api/admin/metrics` responds with JSON metrics. For training/playback changes: minimal demo flow completes via scripts.

## Idempotence and recovery

- Additive patches are safe to re-apply. If a change partially applies, re-run the step; avoid destructive ops.
- For config changes, document defaults and honor `--config` overrides via `loadConfig`; use `resetConfigCache` in long-running tools.

## Interfaces and dependencies

- Prefer existing helpers in `@sidflow/common` (config loader, deterministic JSON, logger, retry, LanceDB builder, fs helpers like `ensureDir`/`pathExists`).
- Use LanceDB builder to prepare similarity search artifacts during training; call `buildDatabase` before generating manifests.
- Use bundled `7zip-min` via shared utilities for archive extraction.

## Progress

- [ ] (YYYY-MM-DD hh:mmZ) Task started: …
- [ ] …

## Surprises & discoveries

- Observation: …  Evidence: …

## Decision log

- Decision: …  Rationale: …  Date/Author: …

## Outcomes & retrospective

Summarize outcomes, gaps, and lessons learned. Compare results against Purpose and acceptance above.

## Notes on agent behavior

- Persistence: Do not stop early; continue until done or truly blocked. Prefer research and reasonable assumptions, and document them.
- Autonomy: Avoid asking for permission for obvious next steps; take action and validate.
- Minimalism: Small, targeted edits; keep public APIs stable unless explicitly required.
- Reporting cadence: After 3–5 edits or tool interactions, provide a compact status update and what’s next.

## Pointers

- Repository guardrails and conventions: `.github/copilot-instructions.md`.
- Cursor users: `.cursorrules` at repo root mirrors these expectations and points here first.
