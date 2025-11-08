# libsidplayfp WASM Migration Plan

**Required reading:** `doc/plans/web/rollout-plan.md`, `doc/plans/web/rollout-tasks.md`

## Vision

Replace every legacy `sidplayfp` process invocation with a fully embedded WebAssembly build (`@sidflow/libsidplayfp-wasm`) so that audio rendering, metadata extraction, and live playback run consistently across the CLI and web layers. The migration mirrors the incremental, shippable approach defined in the web rollout plan: each phase keeps existing workflows usable while progressively swapping out dependencies.

## Alignment with existing web plan

- **Presentation-first mindset:** Just as the web rollout treats the UI as a thin layer over proven logic, the WASM effort keeps business flows intact while swapping the audio engine.
- **Incremental phases:** Each phase ends in a releasable milestone with documented validation, mirroring the Phase tables in `rollout-plan.md`.
- **Testing discipline:** Every phase specifies unit/integration/E2E coverage so the web plan’s CI expectations remain satisfied even as the backend changes.

## Guiding principles

1. **Drop-in parity:** Every replacement must maintain existing CLI/web behaviors (arguments, outputs, lock files) before introducing enhancements.
2. **Shared runtime:** Expose a single `@sidflow/libsidplayfp-wasm` entry point so both server and browser code use identical bindings.
3. **Progressive hardening:** Follow the web rollout pattern—start with offline tooling (classification), then interactive CLIs, then the web control panel.
4. **Measurable milestones:** Each phase yields concrete artifacts (packages, APIs, docs) and validation steps that slot into the existing CI pipeline.
5. **User-config simplicity:** Eliminate the `sidplayPath` requirement from `.sidflow.json`; runtime assets ship with the repo and are located automatically.

## Phase overview

| Phase | Goal | Primary deliverables |
|-------|------|----------------------|
| 0 | Package WASM engine | `@sidflow/libsidplayfp-wasm` workspace, Docker build, typed loader utilities |
| 1 | Offline pipelines | Classification/WAV cache + metadata extraction powered by WASM |
| 2 | Interactive CLIs | `sidflow-rate` and `sidflow-play` refactored to stream audio via WASM-generated PCM |
| 3 | Web playback | Next.js rate/play APIs + UI consuming the WASM engine directly |
| 4 | Cleanup & QA | Config/docs updates, perf benchmarking, rollout checklist |

## Phase 0 — Engine packaging

### Phase 0 Objectives

- Finalize `packages/libsidplayfp-wasm` with reproducible Docker build (`build.sh`, `Dockerfile`, `entrypoint.sh`).
- Emit ESM + `.d.ts` bundle plus ergonomic loader (`loadLibsidplayfp`) and utility class `SidAudioEngine`.
- Publish helper APIs in `@sidflow/common` (`renderSidToPcm`, `renderSidToWav`, `playWavFile`) for downstream consumers.

### Phase 0 Deliverables

- Workspace entry (`package.json`, `tsconfig.json`, `dist/` artifacts).
- README detailing Docker workflow, consumption examples, and troubleshooting.
- Root `tsconfig.base.json` + package dependencies updated to reference the new module.

### Phase 0 Validation

- `./packages/libsidplayfp-wasm/build.sh` produces deterministic `dist/` outputs.
- Bun tests cover loader utilities and audio helpers with mocked modules.

### Phase 0 alignment summary (2025-11-08)

- Confirmed rollout scope with platform stakeholders: Phase 0 focuses strictly on packaging and metadata capture; downstream integrations stay untouched until Phase 1.
- Reviewed every artifact in `doc/plans/wasm/working-code/` to validate build entry points, Docker workflow, and generated bindings.
- Established canonical relocation targets so the known-good sources can be moved into the workspace without churn.

#### Module relocation targets

| Working-code source | Planned repo destination | Notes |
|---------------------|---------------------------|-------|
| `Dockerfile` | `packages/libsidplayfp-wasm/docker/Dockerfile` | Used exclusively for deterministic WASM builds; lives alongside container entrypoint scripts. |
| `entrypoint.sh` | `packages/libsidplayfp-wasm/docker/entrypoint.sh` | Invoked by the Docker image to clone upstream and kick off the build. |
| `build.sh` | `packages/libsidplayfp-wasm/scripts/build.sh` | Thin Bun-compatible wrapper invoked from CI and developers locally. |
| `bindings.cpp` | `packages/libsidplayfp-wasm/src/bindings/bindings.cpp` | Embind bridge compiled by Emscripten. |
| `scripts/apply_thread_guards.py` | `packages/libsidplayfp-wasm/scripts/apply-thread-guards.py` | Retained for pre-build source patching; will be imported by the Docker entrypoint. |
| `package.json` | `packages/libsidplayfp-wasm/package.json` | Becomes the new workspace package manifest (scoped to `@sidflow/libsidplayfp-wasm`). |
| `tsconfig.json` | `packages/libsidplayfp-wasm/tsconfig.json` | Extends `../../tsconfig.base.json`; keeps existing compiler options. |
| `README.md` | `packages/libsidplayfp-wasm/README.md` | Serves as package-level documentation. |
| `dist/**/*` | `packages/libsidplayfp-wasm/dist/**/*` | Deterministic build output committed to the repo once Phase 3 completes. |
| `src/index.ts` | `packages/libsidplayfp-wasm/src/index.ts` | Loader entry point exposing WASM bindings. |
| `src/player.ts` | `packages/libsidplayfp-wasm/src/player.ts` | Higher-level helper consumed by CLI/web packages. |
| `demo/demo.ts` | `packages/libsidplayfp-wasm/examples/demo.ts` | Keeps Bun demo accessible under `examples/`. |
| `demo/debug-render.ts` | `packages/libsidplayfp-wasm/examples/debug-render.ts` | Debug utility for PCM inspection. |
| `demo/assets/test-tone.sid` | `packages/libsidplayfp-wasm/examples/assets/test-tone.sid` | Sample SID retained for demos/tests. |
| `demo/README.md` | `packages/libsidplayfp-wasm/examples/README.md` | Documents the examples folder usage. |
| `Dockerfile`-generated metadata (`dist/README.md`, `dist/package.json`, etc.) | `packages/libsidplayfp-wasm/dist/` | Checked in after each green build to match release artifacts. |

#### Ownership and maintenance

- **Primary maintainer:** Chris Gleissner (audio platform owner) — responsible for upstream monitoring and approving build script updates.
- **Secondary maintainer:** Web platform team — ensures WASM integration remains compatible with Next.js frontends.
- **Operations handoff:** Any rebuild requires updating `data/wasm-build.json`, running the scripted build, and ensuring CI artifacts match the committed WASM outputs.

## Phase 1 — Offline pipelines (classification & training)

### Phase 1 Objectives

- Replace `sidplayfp` usage inside `@sidflow/classify` (WAV cache, metadata extraction, auto-tags, JSONL exports) with WASM helpers.
- Update `@sidflow/common` config schema and dependent docs/tests to drop `sidplayPath`.
- Ensure CLI flags (`--sidplay`) gracefully no-op or warn, preserving backward compatibility until removal.

### Phase 1 Deliverables

- Refactored `buildWavCache`, `defaultRenderWav`, `defaultExtractMetadata` using `renderSidToWav`.
- Updated tests (unit + integration) covering multi-song renders, hashing, and metadata fallbacks.
- Documentation updates (`README.md`, `doc/technical-reference.md`) reflecting the new dependency story.

### Phase 1 Validation

- Bun unit + integration suites pass without `sidplayfp` installed.
- Playwright/web plans remain unaffected because APIs still call the CLI’s stable interface.

### Phase 1 upstream automation summary (2025-11-08)

- Added `scripts/check-libsidplayfp-upstream.ts` to capture upstream changes and update `data/wasm-build.json` alongside build metadata helpers in `@sidflow/common`.
- Wired the upstream check into `bun run build` so CI evaluates remote changes before compiling workspace packages.
- Implemented `shouldSkipWasmBuild` logic with unit tests to guarantee deterministic skip/build behavior.

#### Manual rebuild override

- Run `bun run scripts/check-libsidplayfp-upstream.ts -- --force` to bypass the skip check for a one-off rebuild.
- Alternatively, set `lastSuccessfulBuild.commit` to `null` in `data/wasm-build.json` prior to invocation; the next run will treat the build as stale and proceed.
- After forcing a rebuild, rerun the upstream check to record the newly committed hash and timestamp.

## Phase 2 — Interactive CLIs (rate/play)

### Phase 2 Objectives

- Rework `sidflow-rate` and `sidflow-play` to render SID PCM via WASM, manage temp WAV buffers, and stream audio through lightweight native players (`ffplay`, `afplay`, `aplay`).
- Update playback locks so PID/state tracking continues to work even though the spawned process is an audio player, not `sidplayfp`.
- Preserve keyboard shortcuts, queue management, and logging semantics.

### Phase 2 Deliverables

- New playback abstraction inside `@sidflow/common` (PCM renderer + external player harness).
- Updated CLI help + docs removing `--sidplay`.
- Tests stubbing the audio player process to keep CI deterministic.

### Phase 2 Validation

- Manual smoke tests confirm both CLIs behave identically to the legacy build (pause, seek, quit paths).
- CI runs with mocked players verifying lock hand-offs and queue history.

## Phase 3 — Web playback integration

### Phase 3 Objectives

- Update Next.js API routes (`/api/rate/*`, `/api/play/*`) to use WASM helpers instead of spawning `sidplayfp`.
- Decide on hosting mode:
  - **Server-side render:** Node runtime loads WASM and streams PCM to a lightweight player (mirrors CLI approach).
  - **Client-side render (preferred):** Ship `.wasm` to the browser, run playback directly in the Rate/Play tabs, and treat the API endpoints as control surfaces only.
- Align shadcn UI components (PlayTab, RateTab) with the chosen approach, ensuring slider/seek logic taps into live WASM state.

### Phase 3 Deliverables

- Shared playback service (either server or client) plus React hooks for polling status.
- Updated Playwright tests covering real-time position updates, seek, pause/resume.
- Telemetry/logging so failures surface actionable errors (matching Phase 3 goals from the web plan).

### Phase 3 Validation

- Manual testing verifies seamless transition across CLI and web experiences.
- Playwright E2E suite runs entirely without native `sidplayfp`.

## Phase 4 — Cleanup, benchmarking, rollout

### Phase 4 Objectives

- Remove deprecated config keys (`sidplayPath`), CLI flags, and docs.
- Benchmark CPU/memory usage of the WASM pipeline vs. native `sidplayfp`; document trade-offs.
- Produce rollout checklist (similar to `rollout-tasks.md`) detailing code freeze, manual QA, and communications.

### Phase 4 Deliverables

- `doc/plans/wasm/rollout-tasks.md` enumerating final verification steps.
- README + changelog updates communicating the dependency change.
- Optional telemetry toggle to detect unsupported browsers/environments.

### Phase 4 Validation

- Final CI run (unit + integration + Playwright) green.
- Manual QA sign-off recorded alongside performance notes.

---

By mirroring the structure and rigor of the existing web rollout, this plan ensures the WASM migration lands safely, incrementally, and with full visibility across the CLI and web surfaces. Each phase is independently releasable yet builds toward the shared goal of eliminating native `sidplayfp` dependencies.***
