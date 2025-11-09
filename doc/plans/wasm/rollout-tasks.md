# SIDFlow libsidplayfp WASM Rollout Tasks

**Required reading:** `refactor-plan.md`, `invocations.md`, every source file under `working-code/`, and `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts`.

The code in `doc/plans/wasm/working-code/` is a known-good baseline. It must be fully understood before any implementation work begins, adopted verbatim, and only relocated to its proper package destinations.

## Execution Rules

- Progress through phases in order; do not advance until the prior phase's checklist is complete and reviewed.
- Before checking any box, ensure CI tests pass, coverage remains ≥90%, and new tooling is wired into `bun run build`.
- Each WASM build must check the upstream `libsidplayfp` repository for commits newer than the last recorded build; if no changes exist, the build step must exit cleanly without rebuilding.
- Successful builds must output deterministic artifacts and commit the resulting WASM binary into the repository.
- Preserve CLI stability: no regressions in existing native pathways while the WASM flow is introduced.

## Phase 0 — Foundation

### Phase 0 Checklist

- [x] Read `doc/plans/wasm/refactor-plan.md` and align scope with stakeholders.
- [x] Review every file in `doc/plans/wasm/working-code/` to understand entry points, expected inputs, and current integration assumptions.
- [x] Document target destinations for each working-code module (package, directory, filename).
- [x] Capture current upstream `libsidplayfp` commit hash and last-successful WASM build metadata in a shared location (e.g., `data/wasm-build.json`).
- [x] Define ownership for ongoing maintenance and upstream synchronisation.

## Phase 1 — Upstream Monitoring & Tooling

### Phase 1 Checklist

- [x] Implement a script (e.g., `scripts/check-libsidplayfp-upstream.ts`) that fetches the upstream repository and records the latest commit hash.
- [x] Persist the last-built upstream hash alongside the local WASM artifact metadata.
- [x] Update the build pipeline (`bun run build`, CI workflow) to invoke the upstream check before compiling WASM.
- [x] Ensure the build step skips compilation when the upstream hash matches the stored last-built hash and exits with a clear log message.
- [x] Add unit tests covering the skip-vs-build logic and hash persistence helper functions.
- [x] Document manual override procedure for forcing a rebuild despite no upstream changes.

## Phase 2 — Archive Tooling Modernization

### Phase 2 Checklist

- [x] Add `7zip-min` as a shared dependency (root `package.json` + relevant packages).
- [x] Implement archive helper in `@sidflow/common` wrapping `7zip-min` extraction/unpack calls.
- [x] Replace all direct `7z` CLI invocations (CLIs, scripts, tests) with the new helper.
- [x] Update CI workflows to drop `p7zip` installation and rely on the bundled binary.
- [x] Adjust mocks/stubs so tests cover success and failure paths without shelling out.
- [x] Refresh documentation to state that archive tooling is bundled and no manual 7-Zip installation is required.

## Phase 3 — Code Relocation & Integration

### Phase 3 Checklist

- [x] Relocate known-good sources from `working-code/` into their designated package directories while preserving functionality.
- [x] Replace temporary paths/imports with workspace-relative module imports (prefer `@sidflow/common` helpers where applicable).
- [x] Ensure configuration loading uses `loadConfig` and respects `--config` overrides. *(No new runtime configuration was introduced in this phase.)*
- [x] Integrate the relocated code into the existing CLI/runner entry points without duplicating logic.
- [x] Update bundler/rollup/esbuild configurations to include the relocated WASM glue code.
- [x] Remove the original files from `doc/plans/wasm/working-code/` only after the relocated versions are referenced and tests pass.
- [x] Provide a temporary header-patching fallback inside `SidAudioEngine` so individual songs can be targeted while the native `selectSong` binding is revisited.

## Phase 4 — Build & Verification

### Phase 4 Checklist

- [x] Implement deterministic WASM build script leveraging the relocated code.
- [x] Produce `libsidplayfp.wasm` and associated JS glue files into a stable location (e.g., `packages/libsidplayfp-wasm/dist/`).
- [x] Commit the generated WASM artifact and update `.gitignore` if required.
- [x] Verify the build script records the new upstream hash and timestamps in the metadata file.
- [x] Add automated tests ensuring the WASM module loads correctly within Bun/Node (smoke test invoking exported entry points).
- [x] Run `bun run test`, `bun run build`, and `bun run test:e2e` to confirm no regressions.
- [x] Update CI to cache the upstream repository clone to avoid redundant downloads.

## Phase 5 — Documentation & Rollout

### Phase 5 Checklist

- [ ] Document the WASM build process, upstream check workflow, and artifact locations in `doc/plans/wasm/refactor-plan.md` or linked README.
- [x] Document the WASM build process, upstream check workflow, and artifact locations in `doc/plans/wasm/refactor-plan.md` or linked README.
- [x] Add operational runbook entries describing how to detect when a rebuild is required.
- [x] Publish guidance for consuming packages on how to load the committed WASM artifact.
- [x] Update release notes (`CHANGES.md`) describing the WASM integration and upstream sync policy.
- [x] Present rollout summary to stakeholders and obtain sign-off.
- [x] Archive `doc/plans/wasm/working-code/` once relocation and validation are complete (or replace with note pointing to new canonical sources).

## Current Status

Phase 0: Complete  
Phase 1: Complete  
Phase 2: Complete  
Phase 3: Complete  
Phase 4: Complete  
Phase 5: Complete  
Phase 6: Complete
Phase 7: Complete

## Notes

- `doc/plans/wasm/working-code/` is archived; it now links directly to `packages/libsidplayfp-wasm/` for historical references.
- Maintain parity between native and WASM builds; feature gaps must be explicitly documented.
- Skipping a rebuild when upstream is unchanged is mandatory to keep CI fast and deterministic.
- Committed WASM artifacts should be reproducible by rerunning the build with the same upstream hash and toolchain versions.
- Use `bun run scripts/check-libsidplayfp-upstream.ts -- --force` to override the skip guard when a manual rebuild is required.
- Archive extraction is handled by `7zip-min`; drop any assumptions that `7z` exists on the host system.

## Phase 6 — Offline pipelines (classification & training)

### Phase 6 Checklist

- [x] Ensure `buildWavCache`, auto-tag, and JSONL emission paths in `@sidflow/classify` exclusively use `SidAudioEngine` (including header patching for song selection) and continue emitting deterministic WAV + hash sidecars.
- [x] Update metadata extraction to prefer `parseSidFile`, fall back to `SidAudioEngine.getTuneInfo()`, and finally path-derived heuristics; add regression tests covering failure cases called out in `invocations.md`.
- [x] Update `@sidflow/common` config schema/tests/docs so `sidplayPath` is optional with a deprecation warning; confirm CLI flags like `--sidplay` log guidance but do not break existing scripts.
- [x] Backfill unit/integration coverage for multi-song renders, cache hits, and metadata fallbacks with no native binary present; portable fixtures must match the browser playback expectations.
- [x] Refresh documentation (`README.md`, `doc/technical-reference.md`, plan addenda) to describe the WASM-only dependency story for classification and training flows.

## Phase 7 — Interactive CLIs (rate/play)

### Phase 7 Checklist

- [x] Build a shared playback harness that renders PCM through `SidAudioEngine` and streams it to lightweight native players (`ffplay`/`afplay`/`aplay`), reusing the caching/seeking logic captured in `invocations.md`.
- [x] Update playback-lock plumbing so PID/state tracking continues to work when the spawned process is the host player rather than `sidplayfp`.
- [x] Preserve CLI UX (keyboard shortcuts, queue management, logging) while emitting deprecation warnings for `--sidplay` until removal in Phase 9.
- [x] Provide comprehensive tests/mocks so CI remains deterministic (audio player stubs, playback-lock assertions, seek/pause edge cases).
- [x] Revise CLI help text and docs to explain the WASM renderer, list supported host players, and mark legacy flags as deprecated.

## Phase 8 — Web playback integration

### Phase 8 Checklist

- [x] Convert the Next.js `/api/rate/*` and `/api/play/*` routes into control endpoints only; actual audio rendering must occur in the browser via a shared client-side loader for `@sidflow/libsidplayfp-wasm`. *(RateTab and PlayTab now consume session descriptors entirely in-browser, leaving the routes responsible solely for session orchestration.)*
- [x] Wire PlayTab/RateTab components to the browser engine, reusing cache/seek patterns from `invocations.md`, and expose hooks for pause/resume/status polling that scale to many concurrent listeners.
  - [x] RateTab uses the new `SidflowPlayer` wrapper around `libsidplayfp-wasm`, including local seek/pause and session-based SID fetching.
  - [x] PlayTab migrated to the browser engine.
- [x] Ship the WASM asset through the web build (static asset or dynamic loader), document caching/versioning expectations, and ensure the browser path mirrors the Bun loader semantics. *(WASM artifacts copied to `public/wasm/` and served as static assets; `SidflowPlayer` configured to load from `/wasm/` path; Turbopack/webpack configured to prevent SSR bundling of Node-only dependencies.)*
- [ ] Extend Playwright E2E coverage to verify real-time updates (position, seek, cache warm-up) without native `sidplayfp`, asserting that no server-side PCM streaming occurs.
- [ ] Instrument telemetry/logging (client + server) so playback failures surface actionable context, laying groundwork for future multi-user readiness while keeping multi-tenant rollout explicitly out of scope.

## Phase 9 — Cleanup, benchmarking, rollout

### Phase 9 Checklist

- [ ] Remove the remaining `sidplayPath` config key, CLI flags, and doc references after all consumers migrate to the WASM pipeline.
- [ ] Benchmark CPU/memory usage of the WASM renderer versus legacy native runs; capture findings in `doc/technical-reference.md` (and any mitigations).
- [ ] Produce a final rollout checklist (code freeze, QA, comms) so the `sidplayfp` dependency removal is coordinated across teams.
- [ ] Ensure CI (unit + integration + Playwright) is green with only the WASM path available.
- [ ] Gather manual QA sign-off and document any residual risk or follow-up tasks before closing the rollout.
