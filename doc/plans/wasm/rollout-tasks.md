# SIDFlow libsidplayfp WASM Rollout Tasks

**Required reading:** `refactor-plan.md` and every source file under `working-code/`.

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

## Notes

- `doc/plans/wasm/working-code/` is archived; it now links directly to `packages/libsidplayfp-wasm/` for historical references.
- Maintain parity between native and WASM builds; feature gaps must be explicitly documented.
- Skipping a rebuild when upstream is unchanged is mandatory to keep CI fast and deterministic.
- Committed WASM artifacts should be reproducible by rerunning the build with the same upstream hash and toolchain versions.
- Use `bun run scripts/check-libsidplayfp-upstream.ts -- --force` to override the skip guard when a manual rebuild is required.
- Archive extraction is handled by `7zip-min`; drop any assumptions that `7z` exists on the host system.

## Phase 6 — Offline pipelines (classification & training)

### Phase 6 Checklist

- [ ] Swap `sidplayfp` usage in `@sidflow/classify` WAV-cache, metadata extraction, auto-tag, and JSONL pipelines with the WASM helpers (`renderSidToWav`, `SidAudioEngine`).
- [ ] Update `@sidflow/common` config schema/tests/docs to drop the `sidplayPath` requirement (retaining backward-compatible warnings until removal).
- [ ] Ensure CLI flags such as `--sidplay` warn and fall back to the WASM path without crashing.
- [ ] Expand unit/integration tests to cover multi-song renders, hashing, and metadata fallbacks with the WASM renderer (no native binary installed).
- [ ] Refresh documentation (`README.md`, `doc/technical-reference.md`, plan addenda) to reflect the new dependency story for classification workflows.

## Phase 7 — Interactive CLIs (rate/play)

### Phase 7 Checklist

- [ ] Rework `sidflow-rate` and `sidflow-play` to stream PCM rendered via WASM, buffering to temp files and delegating playback to lightweight native players (`ffplay`/`afplay`/`aplay`).
- [ ] Update playback-lock plumbing so PID/state tracking still works when the spawned process is the audio player instead of `sidplayfp`.
- [ ] Preserve all CLI UX behaviors (keyboard shortcuts, queue management, logging) when running against the new playback pipeline.
- [ ] Provide comprehensive tests/mocks so CI remains deterministic (audio player stubs, playback-lock assertions).
- [ ] Update CLI help text and documentation to remove `--sidplay` guidance once the fallback period ends.

## Phase 8 — Web playback integration

### Phase 8 Checklist

- [ ] Switch the Next.js `/api/rate/*` and `/api/play/*` routes to the WASM playback flow (either server-side streaming or browser-based, per the final hosting decision).
- [ ] Wire PlayTab/RateTab components to the new playback service, including seek, pause/resume, and status polling hooks.
- [ ] Ship the WASM asset appropriately (bundle to client or keep server-side) and document the loading strategy for browser consumers.
- [ ] Extend Playwright E2E coverage to assert real-time updates (position, seek) without native `sidplayfp` present.
- [ ] Instrument logging/telemetry so any WASM playback failure surfaces actionable context in both server and client logs.

## Phase 9 — Cleanup, benchmarking, rollout

### Phase 9 Checklist

- [ ] Remove the remaining `sidplayPath` config key, CLI flags, and doc references after all consumers migrate to the WASM pipeline.
- [ ] Benchmark CPU/memory usage of the WASM renderer versus legacy native runs; capture findings in `doc/technical-reference.md` (and any mitigations).
- [ ] Produce a final rollout checklist (code freeze, QA, comms) so the `sidplayfp` dependency removal is coordinated across teams.
- [ ] Ensure CI (unit + integration + Playwright) is green with only the WASM path available.
- [ ] Gather manual QA sign-off and document any residual risk or follow-up tasks before closing the rollout.
