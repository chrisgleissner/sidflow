# libsidplayfp WASM Migration Plan

**Required reading:** `doc/plans/wasm/rollout-tasks.md`, `doc/plans/wasm/invocations.md`.

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
| 1 | Upstream monitoring | Upstream hash tracker, metadata store, build skip guard |
| 2 | Archive tooling modernization | Replace 7-Zip CLI usage with `7zip-min`, update docs/CI tooling |
| 3 | Code relocation & integration | Migrate working-code assets into the workspace package and wire the loader into the build graph |
| 4 | Build & verification | Deterministic WASM build script, metadata updates, CI cache, and smoke tests |
| 5 | Documentation & rollout | Updated plan, runbook, consumer guidance, and changelog notes |
| 6 | Offline pipelines | Classification/WAV cache + metadata extraction powered by WASM |
| 7 | Interactive CLIs | `sidflow-rate` and `sidflow-play` refactored to stream audio via WASM-generated PCM |
| 8 | Web playback | Next.js rate/play APIs + UI consuming the WASM engine directly |
| 9 | Cleanup & QA | Config/docs updates, perf benchmarking, rollout checklist |

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
| `dist/**/*` | `packages/libsidplayfp-wasm/dist/**/*` | Deterministic build output committed to the repo once Phase 4 completes. |
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

## Phase 1 — Upstream monitoring & gating

### Phase 1 Objectives

- Create a reusable upstream commit check invoked by CI and local builds.
- Persist the latest upstream hash, last-checked timestamp, and last successful build metadata in `data/wasm-build.json`.
- Provide guardrails to skip redundant WASM rebuilds while supporting manual overrides when a rebuild is required.

### Phase 1 Deliverables

- `scripts/check-libsidplayfp-upstream.ts` Bun script plus shared helpers in `@sidflow/common`.
- Build pipeline updates so `bun run build` (and CI) executes the upstream check before compiling TypeScript packages.
- Deterministic metadata serialization with unit tests covering read/write, skip, and completion flows.

### Phase 1 Validation

- `bun run build` logs the latest upstream hash and whether a rebuild is required.
- `packages/sidflow-common/test/wasm-build.test.ts` exercises skip and rebuild decision branches.
- `data/wasm-build.json` changes only when the upstream hash updates or a manual override runs.

### Phase 1 upstream automation summary (2025-11-08)

- Added `scripts/check-libsidplayfp-upstream.ts` to capture upstream changes and update `data/wasm-build.json` alongside build metadata helpers in `@sidflow/common`.
- Wired the upstream check into `bun run build` so CI evaluates remote changes before compiling workspace packages.
- Implemented `shouldSkipWasmBuild` logic with unit tests to guarantee deterministic skip/build behavior.

#### Manual rebuild override

- Run `bun run scripts/check-libsidplayfp-upstream.ts -- --force` to bypass the skip check for a one-off rebuild.
- Alternatively, set `lastSuccessfulBuild.commit` to `null` in `data/wasm-build.json` prior to invocation; the next run will treat the build as stale and proceed.
- After forcing a rebuild, rerun the upstream check to record the newly committed hash and timestamp.

## Phase 2 — Archive tooling modernization

### Phase 2 Objectives

- Replace all direct `7z` CLI usage with the `7zip-min` library so archive extraction works cross-platform without system dependencies.
- Ensure fetch pipelines, sample scripts, and supporting utilities consume the shared `7zip-min` helper instead of spawning binaries.
- Remove documentation and CI steps that instruct users to install 7-Zip manually, replacing them with guidance about the bundled dependency.

### Phase 2 Deliverables

- Shared archive helper in `@sidflow/common` that wraps `7zip-min` for extraction/compression needs.
- Updated `@sidflow/fetch` implementation, sample scripts, and tests to wire in the new helper.
- CI workflow adjustments dropping `p7zip` installation while caching the `7zip-min` package artifacts.

### Phase 2 Validation

- `bun run fetch:sample` and `sidflow-fetch` succeed on clean environments without system 7-Zip installed.
- Unit tests cover success and failure paths of the `7zip-min` integration, including error propagation and logging.
- Documentation clearly states that archive tooling is bundled and no manual install is required.

### Phase 2 archive tooling summary (2025-11-08)

- Added `7zip-min` dependency at the workspace root and exposed `createSevenZipArchive`/`extractSevenZipArchive` helpers via `@sidflow/common`.
- Refactored `@sidflow/fetch` pipelines and sample scripts to consume the shared helper, eliminating direct `7z` shell invocations.
- Updated unit tests (`packages/sidflow-common/test/archive.test.ts`) to exercise happy-path and error-path behaviors without spawning external binaries.
- Removed `p7zip` installs from CI workflows and refreshed developer/README docs to highlight the bundled extractor.

## Phase 3 — Code relocation & integration

### Phase 3 Objectives (Code relocation)

- Promote the `doc/plans/wasm/working-code/` artifacts into a first-class workspace package (`packages/libsidplayfp-wasm`).
- Wire the new package into the TypeScript project graph (`tsconfig.json`, `tsconfig.base.json`) so downstream packages can depend on the loader.
- Preserve the Docker build workflow, scripts, and examples while aligning them with repository conventions.
- Retire the duplicated "working-code" sources and replace them with documentation that points to the canonical package.

### Phase 3 Deliverables (Code relocation)

- `packages/libsidplayfp-wasm/` containing Docker assets, build scripts, TypeScript sources, dist artifacts, and Bun demos.
- Updated workspace configuration (project references, path aliases, README) highlighting the new package entry point.
- `doc/plans/wasm/working-code/README.md` rewritten as a pointer to the relocated sources, with legacy files removed to prevent drift.

### Phase 3 Validation (Code relocation)

- `npm run build` (project-wide `tsc -b`) completes with the new package referenced.
- Bun demo assets remain runnable from `packages/libsidplayfp-wasm/examples/` using the committed `dist/` artifacts.
- Phase checklist in `doc/plans/wasm/rollout-tasks.md` marked complete after verifying the relocation steps.

### Phase 3 relocation summary (2025-11-09)

- Created `packages/libsidplayfp-wasm` with Dockerfile, entrypoint, build script, bindings, TypeScript loader, and Bun examples aligned to workspace paths.
- Copied committed `dist/` outputs and sample assets, ensuring the loader defaults to the packaged artifacts and exposing `SidAudioEngine` via workspace exports.
- Updated root TypeScript config references and path aliases so other packages can import `@sidflow/libsidplayfp-wasm` directly.
- Replaced the `doc/plans/wasm/working-code/` contents with a relocation notice and removed the obsolete source copies to avoid divergence.

### Interim song-selection fallback

The native `SidPlayerContext::selectSong` binding still throws a WASM signature mismatch at runtime. Until we can expose a stable C++ shim, the SidAudioEngine now rewrites the SID header (start-song field) and reloads the buffer to “pin” playback to a specific song. This keeps multi-song playback functional across both CLI and web paths, and the approach is encapsulated so we can swap it out once the binding issue is resolved.

## Phase 4 — Build & verification

### Phase 4 Objectives (Build & verification)

- Provide a reproducible build entrypoint that wraps the Docker workflow, updates metadata, and records successful builds.
- Reduce upstream download time by caching the cloned repository between invocations (both locally and in CI).
- Add automated smoke tests that load the WASM module under Bun to ensure the committed artifacts remain functional.

### Phase 4 Deliverables (Build & verification)

- Bun helper script `scripts/build-libsidplayfp-wasm.ts` plus `npm run wasm:build` wiring to orchestrate the Docker build and metadata updates.
- Cached upstream clone mounted via `packages/libsidplayfp-wasm/.cache/upstream` with matching `actions/cache` integration in CI.
- WASM loader smoke tests in `packages/libsidplayfp-wasm/test/loader.test.ts` validating module instantiation and engine behavior without SID data.

### Phase 4 Validation (Build & verification)

- `bun test packages/libsidplayfp-wasm/test/loader.test.ts` exercises the committed `dist/` artifacts inside Bun.
- CI restores the upstream cache prior to running `bun run build`, keeping future `wasm:build` executions fast and deterministic.
- Full regression coverage maintained by running `bun run test`, `bun run build`, and `bun run test:e2e` after the new pipeline landed.

### Phase 4 build summary (2025-11-09)

- Introduced `bun run wasm:build` to run the upstream check, invoke the Docker build, and persist success details to `data/wasm-build.json`.
- Enhanced the Docker entrypoint to reuse a mounted cache clone, synchronizing it with `git fetch` before each build.
- Updated `packages/libsidplayfp-wasm/scripts/build.sh` to mount the cache volume and ensured CI restores the directory via `actions/cache`.
- Added loader smoke tests so future `bun run test` runs cover WASM instantiation alongside the new artifacts.

## Phase 5 — Documentation & rollout

### Phase 5 Objectives (Documentation & rollout)

- Document the deterministic build workflow, metadata lifecycle, and consumer expectations across `refactor-plan`, `rollout-tasks`, and package-level READMEs.
- Provide an operational runbook describing how to detect when a rebuild is required and how to force one safely.
- Clarify for downstream packages how to load the committed WASM artifact in both Node/Bun and browser environments.
- Capture the milestone in `CHANGES.md` and confirm stakeholders understand the new responsibilities.

### Phase 5 Deliverables (Documentation & rollout)

- Updated `doc/plans/wasm/refactor-plan.md` covering the new phase, operational runbook, and validation requirements.
- `doc/plans/wasm/rollout-tasks.md` checklist with Phase 5 items marked complete once documentation lands.
- Expanded `packages/libsidplayfp-wasm/README.md` highlighting integration patterns and rebuild steps.
- Changelog entry summarizing the completed build pipeline and guidance updates.

### Phase 5 Validation (Documentation & rollout)

- Runbook instructions verified against `bun run wasm:check-upstream` and `bun run wasm:build` outputs.
- Stakeholder review (audio platform + web platform) confirms the documented process covers both CLI and web consumers.
- All legacy references now point at `packages/libsidplayfp-wasm`, with the working-code folder retained purely as a pointer.

#### Operational runbook (2025-11-09)

1. Execute `bun run wasm:check-upstream` during CI or local builds; if it reports "No upstream changes detected" you may skip the rebuild.
2. When a rebuild is required (or forced via `--force`), run `bun run wasm:build` to mount the cached upstream clone, execute the Docker toolchain, and refresh `packages/libsidplayfp-wasm/dist/*`.
3. Review `data/wasm-build.json` to confirm `lastSuccessfulBuild` reflects the new commit hash, artifact path, and timestamp recorded by the script.
4. Commit the regenerated artifacts together with the metadata update and re-run `bun run test` plus `bun run test:e2e` to ensure the committed outputs load correctly.

### Phase 5 documentation summary (2025-11-09)

- Added integration and rebuild guidance to `packages/libsidplayfp-wasm/README.md`, including asset resolution expectations.
- Recorded the deterministic build metadata in `data/wasm-build.json` and expanded this plan with runbook instructions.
- Updated the rollout checklist and changelog so the documentation milestone is visible to release management.

## Phase 6 — Offline pipelines (classification & training)

### Phase 6 Objectives (Offline pipelines)

- Finish migrating the classification + training toolchain to `SidAudioEngine`, eliminating every remaining dependency on the native `sidplayfp` binary.
- Remove the hard requirement for `sidplayPath` from configuration files, treating the key as deprecated while emitting clear warnings when it is present.
- Ensure metadata extraction relies on direct SID parsing with a WASM tune-info fallback so that all metadata continues to resolve even when heuristics fail.

### Phase 6 Deliverables (Offline pipelines)

- `buildWavCache`, `defaultRenderWav`, and related helpers rendering PCM via `SidAudioEngine.renderCycles`/`renderSeconds`, writing deterministic WAV buffers, and preserving existing cache hashes.
- Updated metadata flow that first calls `parseSidFile`, then `SidAudioEngine.getTuneInfo()`, and finally the existing filename fallback to guarantee titles/authors for problematic files.
- Config/test/doc updates reflecting that `sidplayPath` is optional today and scheduled for removal after downstream consumers switch to WASM.

### Phase 6 Validation (Offline pipelines)

- Bun unit + integration suites execute without `sidplayfp` installed; multi-song renders, hashed outputs, and metadata fallbacks remain stable.
- CLI warnings confirm `--sidplay` and `sidplayPath` are ignored, guiding users toward the WASM-first flow while keeping legacy scripts functional during the transition.

## Phase 7 — Interactive CLIs (rate/play)

### Phase 7 Objectives (Interactive CLIs)

- Introduce a shared playback harness that feeds WASM-rendered PCM into lightweight host players while retaining lock semantics and queue management.
- Gradually phase out `--sidplay` overrides from CLI UX, replacing the flag with deprecation messaging until removal in Phase 9.
- Reuse the `SidAudioEngine` caching and song-selection behavior from offline flows so seeking and multi-song playback behave the same across tools.

### Phase 7 Deliverables (Interactive CLIs)

- A new `@sidflow/common` helper that spawns host audio processes (e.g., `aplay`, `afplay`, `ffplay`) using PCM buffers produced by the WASM engine, including retry/error reporting hooks.
- Updated `sidflow-rate` and `sidflow-play` CLIs plus documentation reflecting the WASM renderer, deprecating `--sidplay`, and outlining OS-level audio prerequisites.
- Deterministic tests that stub the host process while exercising playback locks, queue transitions, and keyboard shortcuts.

### Phase 7 Validation (Interactive CLIs)

- Manual smoke tests cover pause/resume/seek workflows and confirm no regressions in log output or queue ordering.
- CI mocks validate that lock files and PID tracking behave correctly when the spawned process is the host player instead of `sidplayfp`.

## Phase 8 — Web playback integration

### Phase 8 Objectives (Web playback)

- Deliver a browser-first playback experience: the `.wasm` bundle must load on the client, render PCM locally, and stream it through the Web Audio API so every listener hears audio on their own device.
- Treat Next.js API routes as control surfaces only (enqueue, state sync, metadata); they must never render audio on the server. This aligns the architecture with future multi-user scaling goals.
- Wire PlayTab/RateTab components to the client-side engine, including warm-up caching, seek/jump operations, and UI feedback consistent with the CLI flows.

### Phase 8 Deliverables (Web playback)

- A reusable browser loader that mirrors the Bun/Node `loadLibsidplayfp` semantics, caches module instantiation, and exposes hooks/utilities for React components.
- Updated Next.js routes sending compact control payloads (e.g., SID bytes, playback commands) while delegating actual rendering to the browser; legacy server-render flags removed.
- Expanded Playwright coverage verifying that playback, seek, pause/resume, and error-handling operate entirely client side, plus telemetry wiring that surfaces failures to both UI and logs.

### Phase 8 Validation (Web playback)

- Manual tests confirm that browsers without native audio plugins still play SID tracks via WASM and that the server never streams PCM.
- Playwright E2E suite passes using only the WASM path, ensuring `sidplayfp` is no longer required in CI or deployment environments.

## Phase 9 — Cleanup, benchmarking, rollout

### Phase 9 Objectives (Cleanup)

- Remove deprecated config keys (`sidplayPath`), CLI flags, and docs.
- Benchmark CPU/memory usage of the WASM pipeline vs. native `sidplayfp`; document trade-offs.
- Produce rollout checklist (similar to `rollout-tasks.md`) detailing code freeze, manual QA, and communications.

### Phase 9 Deliverables (Cleanup)

- `doc/plans/wasm/rollout-tasks.md` enumerating final verification steps.
- README + changelog updates communicating the dependency change.
- Optional telemetry toggle to detect unsupported browsers/environments.

### Phase 9 Validation (Cleanup)

- Final CI run (unit + integration + Playwright) green.
- Manual QA sign-off recorded alongside performance notes.

---

By mirroring the structure and rigor of the existing web rollout, this plan ensures the WASM migration lands safely, incrementally, and with full visibility across the CLI and web surfaces. Each phase is independently releasable yet builds toward the shared goal of eliminating native `sidplayfp` dependencies.***
