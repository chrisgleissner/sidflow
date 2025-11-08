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

- [ ] Implement a script (e.g., `scripts/check-libsidplayfp-upstream.ts`) that fetches the upstream repository and records the latest commit hash.
- [ ] Persist the last-built upstream hash alongside the local WASM artifact metadata.
- [ ] Update the build pipeline (`bun run build`, CI workflow) to invoke the upstream check before compiling WASM.
- [ ] Ensure the build step skips compilation when the upstream hash matches the stored last-built hash and exits with a clear log message.
- [ ] Add unit tests covering the skip-vs-build logic and hash persistence helper functions.
- [ ] Document manual override procedure for forcing a rebuild despite no upstream changes.

## Phase 2 — Code Relocation & Integration

### Phase 2 Checklist

- [ ] Relocate known-good sources from `working-code/` into their designated package directories while preserving functionality.
- [ ] Replace temporary paths/imports with workspace-relative module imports (prefer `@sidflow/common` helpers where applicable).
- [ ] Ensure configuration loading uses `loadConfig` and respects `--config` overrides.
- [ ] Integrate the relocated code into the existing CLI/runner entry points without duplicating logic.
- [ ] Update bundler/rollup/esbuild configurations to include the relocated WASM glue code.
- [ ] Remove the original files from `doc/plans/wasm/working-code/` only after the relocated versions are referenced and tests pass.

## Phase 3 — Build & Verification

### Phase 3 Checklist

- [ ] Implement deterministic WASM build script leveraging the relocated code.
- [ ] Produce `libsidplayfp.wasm` and associated JS glue files into a stable location (e.g., `packages/sidflow-play/wasm/`).
- [ ] Commit the generated WASM artifact and update `.gitignore` if required.
- [ ] Verify the build script records the new upstream hash and timestamps in the metadata file.
- [ ] Add automated tests ensuring the WASM module loads correctly within Bun/Node (smoke test invoking exported entry points).
- [ ] Run `bun run test`, `bun run build`, and `bun run test:e2e` to confirm no regressions.
- [ ] Update CI to cache the upstream repository clone to avoid redundant downloads.

## Phase 4 — Documentation & Rollout

### Phase 4 Checklist

- [ ] Document the WASM build process, upstream check workflow, and artifact locations in `doc/plans/wasm/refactor-plan.md` or linked README.
- [ ] Add operational runbook entries describing how to detect when a rebuild is required.
- [ ] Publish guidance for consuming packages on how to load the committed WASM artifact.
- [ ] Update release notes (`CHANGES.md`) describing the WASM integration and upstream sync policy.
- [ ] Present rollout summary to stakeholders and obtain sign-off.
- [ ] Archive `doc/plans/wasm/working-code/` once relocation and validation are complete (or replace with note pointing to new canonical sources).

## Current Status

Phase 0: Complete  
Phase 1: Not started  
Phase 2: Not started  
Phase 3: Not started  
Phase 4: Not started

## Notes

- Always treat `doc/plans/wasm/working-code/` as authoritative until the relocated code is reviewed and merged.
- Maintain parity between native and WASM builds; feature gaps must be explicitly documented.
- Skipping a rebuild when upstream is unchanged is mandatory to keep CI fast and deterministic.
- Committed WASM artifacts should be reproducible by rerunning the build with the same upstream hash and toolchain versions.
