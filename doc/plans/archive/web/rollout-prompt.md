# Prompt: Create a Rollout Plan for the SIDFlow Web Server

You are to produce two coordinated Markdown documents for extending the existing SIDFlow project with a **modern local web server and frontend**.  
SIDFlow already consists of **TypeScript/Bun-based command-line tools** that fetch, rate, classify (TensorFlow), and play SID songs via `sidplayfp`.  
All CLI packages are fully implemented and well-structured — the new work concerns only the **web server** layer.

---

## Context

The new web server should:

- Be implemented using **Next.js 15 (React 19, TypeScript)** with **Bun** as the runtime.  
- Run locally (default **port 3000**) as a control panel that orchestrates the existing CLI tools.  
- Expose **API endpoints** that internally invoke CLI commands such as playback, rating, and classification.  
- Provide a minimal **frontend** for local use — simple buttons, queue view, and task triggers.  
- Be designed for **extensibility** (e.g. per-user training, hosted mode) without implementing those yet.  
- Follow modern, idiomatic TypeScript and testing practices (Playwright for E2E testing, clean separation of API and UI).  
- Avoid over-engineering; this is a local-first rollout.  

The plan must describe an **incremental, verifiable rollout** with clear phases and test checkpoints.

---

## Reference and Documentation Style

Look at the existing documents under `doc/plans/init/` for inspiration.  
That folder contains multiple Markdown files — one describing the **overall rollout sequencing** and another describing the **detailed implementation tasks**.

Replicate that structure for the new web server by creating two documents under `doc/plans/web/`:

1. **`doc/plans/web/rollout-plan.md`**  
   - A phase-based document that outlines *how* the rollout will proceed.  
   - Should contain high-level phases, objectives, deliverables, testing strategy, and success criteria.  
   - Acts as a readable roadmap and coordination artifact.

2. **`doc/plans/web/rollout-tasks.md`**  
   - A sequential, actionable checklist that can be **ticked off step by step**.  
   - Mirrors the phases but breaks them down into smaller concrete tasks.  
   - Serves as a progress-tracking and validation document during implementation.

---

## Required Phases

The rollout plan should include approximately these phases:

### Phase 0 – Preparation
- Set up the `src/web` workspace.
- Configure Bun, TypeScript, Tailwind, shadcn/ui, and Playwright.
- Align with existing repo conventions and test that `bun run dev` serves a blank page locally.

### Phase 1 – API Integration
- Create minimal Next.js API endpoints that wrap existing CLI tools via `Bun.spawn`.
- Ensure robust validation, JSON responses, and error handling.
- Confirm commands execute correctly on localhost.

### Phase 2 – Frontend MVP
- Add a simple control panel UI:
  - Buttons for play, rate, and classify.
  - Basic feedback (current action or status).
- Keep the UI clean, local, and functional.

### Phase 3 – Automated Testing and CI
- Integrate **Playwright** for E2E testing of the full flow (UI → API → CLI).
- Stub `sidplayfp` for CI environments to avoid real playback.
- Define unit and integration test strategies using Bun's test runner.
- Add CI workflow integration for automated validation.

### Phase 4 – Local Real Playback Validation
- Perform manual local validation using the real `sidplayfp` binary.
- Confirm that the CLI and API orchestration behave correctly under real playback conditions.

---

## Output Requirements

The LLM should generate:

- **Two Markdown documents** (`rollout-plan.md` and `rollout-tasks.md`) located under `doc/plans/web/`.  
- Both must:
  - Use concise, professional engineering language.
  - Be formatted consistently with the existing style of documents in `doc/plans/init/`.
- `rollout-plan.md` focuses on *phased sequencing and intent*.  
- `rollout-tasks.md` provides *specific, verifiable steps*.  

---

## Exclusions

- No implementation code or UI mockups.  
- No hosting, authentication, or multi-user considerations — only note future extensibility.  
- No discussion of data persistence beyond the local context.  

---

## Deliverable Format

Output a **single Markdown file** containing this entire prompt text, suitable for inclusion in the repository under `doc/plans/web/rollout-prompt.md`.  
It will serve as the meta-instruction for generating the two required rollout documents.
