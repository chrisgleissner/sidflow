# Similarity Export Multi-Format Implementation Plan

Status: Active
Owner: Copilot
Last updated: 2026-04-07

## Goal

Implement end-to-end support for all three similarity export formats described in:

- `doc/similarity-export.md`
- `doc/similarity-export-lite.md`
- `doc/similarity-export-tiny.md`

The result must satisfy all of the following:

1. The repo can generate:
   - full SQLite export (`sidcorr-1`)
   - lite export (`sidcorr-lite-1`) from the full SQLite export
   - tiny export (`sidcorr-tiny-1`) from the full SQLite export
2. The CLI SID station/player can switch at runtime between any of the 3 export formats.
3. The same station builder path used by the CLI playback tool is leveraged for all formats.
4. The README documents the new workflows directly below the current full `sidcorr` export instructions.
5. The implementation proves, in a fully automated way, that stations built from full/lite/tiny exports are broadly equivalent from a user perspective.
6. Unit tests prove that the tiny export preserves the information needed for user station building closely enough relative to the full export from which it was derived.
7. Validation includes a real conversion of `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite` into at least a lite export and a successful CLI station run using that lite export with no interactive user input.

## Scope Boundaries

In scope:

- export-file generation and loading
- runtime format selection in CLI station playback
- test fixtures and automated equivalence proof
- README and developer-documentation updates

Out of scope for this phase unless required by tests:

- web UI support for lite/tiny export selection
- delta-update publication workflows from `sidcorr-lite-1`
- GitHub release automation for lite/tiny formats beyond local generation

## Architecture Direction

### A. Shared recommendation backend interface

Introduce a shared abstraction for recommendation backends so the CLI station queue builder does not hardcode SQLite semantics.

Candidate shape:

- inspect dataset capabilities
- sample seed tracks
- read rows by track ID
- build recommendations from favorites
- optionally expose approximate vectors or graph traversal support

The station queue builder in `packages/sidflow-play/src/station/queue.ts` should depend on this interface rather than directly calling SQLite helpers.

### B. Keep the existing station builder authoritative

Do not create a second station algorithm only for tests.

The existing station flow in:

- `packages/sidflow-play/src/station/run.ts`
- `packages/sidflow-play/src/station/queue.ts`

must remain the user-facing path. The proof tests should call this same queue-building surface, either directly or via `runStationCli`, with different dataset backends.

### C. Full export remains the reference implementation

Use the current SQLite export and its recommendation behavior as the reference model.

Lite and tiny formats are judged against that reference by:

- queue overlap
- bucket/cluster composition
- broad rating/persona consistency
- absence of pathological divergence

Exact byte-for-byte queue equality is not required.

## Work Phases

### Phase 1. Backend abstraction and plan plumbing

Acceptance criteria:

- Add an active task entry to `PLANS.md` pointing to this document.
- Define the backend interface and identify which station functions move from SQLite-only helpers to backend-driven helpers.
- Preserve backward compatibility for the current SQLite CLI flow.

Expected files:

- `PLANS.md`
- `packages/sidflow-play/src/station/types.ts`
- `packages/sidflow-play/src/station/queue.ts`
- `packages/sidflow-play/src/station/dataset.ts`

### Phase 2. Lite export generator and reader

Acceptance criteria:

- Implement a base-bundle lite export generator that consumes a full SQLite export.
- Implement a lite export reader/backend usable by the station queue builder.
- Support local CLI selection of a lite export file.

Expected files:

- `packages/sidflow-common/src/similarity-export-lite.ts`
- `packages/sidflow-common/src/index.ts`
- `packages/sidflow-play/src/similarity-export-cli.ts`
- `packages/sidflow-play/src/station/*`

Notes:

- Base-bundle generation is required for this task.
- Delta-bundle generation from the lite spec may remain documented but not implemented in this phase unless needed by tests.

### Phase 3. Tiny export generator and reader

Acceptance criteria:

- Implement tiny export generation from a full SQLite export.
- Implement local-file matching and in-memory widening logic required by the tiny spec.
- Implement tiny recommendation behavior compatible with the station builder.

Expected files:

- `packages/sidflow-common/src/similarity-export-tiny.ts`
- `packages/sidflow-common/src/index.ts`
- `packages/sidflow-play/src/station/*`

### Phase 4. Runtime format selection in the CLI player

Acceptance criteria:

- `sidflow-play station` can target full, lite, or tiny exports at runtime.
- `scripts/sid-station.sh` can pass through the new selection commands.
- The runtime switch does not require rebuilding the CLI.

Required UX:

- explicit command-line format selection
- explicit local path override for each format
- backward-compatible SQLite defaults when no new flag is supplied

Expected files:

- `packages/sidflow-play/src/station/args.ts`
- `packages/sidflow-play/src/station/run.ts`
- `packages/sidflow-play/src/station/dataset.ts`
- `scripts/sid-station.sh`
- relevant CLI tests

### Phase 5. Automated equivalence proof

Acceptance criteria:

- Add an automated test suite that builds stations from full, lite, and tiny exports using the existing station builder path.
- The proof requires no user interaction.
- The proof fails if one format diverges materially from the others.

Required proof outputs:

- top-N overlap metrics between full/lite/tiny queues
- cluster or bucket composition comparison
- acceptable-threshold assertions documented in test names/comments

Required approach:

- use the same `buildStationQueue(...)` surface or the same `runStationCli(...)` path used by the CLI station tool
- avoid a special-purpose offline recommender used only by tests

Expected files:

- new `packages/sidflow-play/test/*equivalence*.test.ts`
- possibly shared fixture helpers under `packages/sidflow-play/test/helpers`

### Phase 6. Tiny-vs-full fidelity unit tests

Acceptance criteria:

- Add unit tests in `@sidflow/common` that compare tiny-derived recommendations or neighbor expansion against the full export.
- The tests prove no significant station-building information is lost.

Required checks:

- file identity resolution is stable for the fixture corpus
- track identity mapping survives conversion
- seed-driven recommendation overlap against the full export stays above the chosen threshold
- style-mask and graph traversal retain the expected dominant cluster/bucket behavior

Expected files:

- new `packages/sidflow-common/test/*tiny*.test.ts`

### Phase 7. README and docs

Acceptance criteria:

- Update `README.md` directly below the current `sidcorr` export creation instructions.
- Document how to build lite and tiny exports from the full SQLite export.
- Document how to switch the CLI station/player between full, lite, and tiny at runtime.

Expected files:

- `README.md`
- possibly `doc/developer.md`
- possibly `doc/similarity-export.md`

### Phase 8. Real local validation

Acceptance criteria:

- Convert `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite` into a lite export locally.
- Use that lite export to create a station through the CLI SID player with no manual interaction.
- If feasible within time and environment limits, also generate a tiny export and exercise it through the same CLI path.
- Record the exact commands and outcomes in `PLANS.md` and/or this document.

## Automated Equivalence Criteria

The proof should use broad user-facing equivalence, not exact queue identity.

Minimum required assertions:

1. For a fixed rating set and deterministic random seed, all three formats return non-empty queues of the requested length.
2. Full vs lite and full vs tiny have substantial queue overlap.
3. The dominant cluster or bucket selected by the reference queue remains dominant in the lite and tiny queues.
4. The mean or median recommendation score proxy does not collapse for lite or tiny.
5. No format produces obvious garbage behavior such as empty queues, cross-cluster collapse, or pathological cycling.

Initial threshold proposal:

- Jaccard overlap on final station track IDs: at least `0.50`
- dominant bucket share difference versus full: at most `0.20`
- queue length equality: exact

If the real implementation supports stronger thresholds without flakiness, tighten them.

## Runtime Switch Proposal

Proposed station CLI additions:

- `--similarity-format full|lite|tiny|auto`
- `--similarity-bundle <path>` for any local export format
- keep `--local-db` as a backward-compatible alias for SQLite/full

`auto` policy:

- infer from file extension and/or magic bytes when a specific bundle path is provided
- otherwise keep the existing default SQLite behavior

## Validation Checklist

- `bun run build:quick`
- targeted common tests for lite/tiny builders and readers
- targeted play tests for dataset resolution and queue building
- targeted automated equivalence tests
- CLI non-interactive station run against a generated lite export

## Progress Log

- 2026-04-07: Added a portable similarity dataset abstraction and kept the existing station builder authoritative. `buildStationQueue(...)` now works with sqlite, lite, and tiny handles instead of depending only on a SQLite path.
- 2026-04-07: Implemented `packages/sidflow-common/src/similarity-export-lite.ts` and `packages/sidflow-common/src/similarity-export-tiny.ts`, exported them from `@sidflow/common`, and extended `packages/sidflow-play/src/similarity-export-cli.ts` to convert an existing full sqlite export into lite or tiny bundles.
- 2026-04-07: Extended the station dataset/runtime path in `packages/sidflow-play/src/station/{args,dataset,queue,run}.ts` so `sidflow-play station` can switch between `.sqlite`, `.sidcorr`, and `.tiny.sidcorr` at runtime via `--similarity-format`.
- 2026-04-07: Added automated proof tests using the real station builder path: `packages/sidflow-play/test/station-portable-equivalence.test.ts` verifies broad queue equivalence across sqlite/lite/tiny, and `packages/sidflow-common/test/similarity-export.test.ts` now covers lite conversion plus tiny recommendation overlap against the source sqlite export.
- 2026-04-07: Targeted validation passed with `bun test packages/sidflow-common/test/similarity-export.test.ts packages/sidflow-play/test/station-dataset.test.ts packages/sidflow-play/test/station-portable-equivalence.test.ts` (`30 pass, 0 fail`).
- 2026-04-07: Real local validation passed. Converted `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite` into `data/exports/sidcorr-hvsc-full-sidcorr-1.sidcorr` and then ran `runStationCli(...)` non-interactively against the lite bundle; the station reached the built-playlist phase and exited with code `0`.
- if possible, `bun run build`
- if feasible, the full test suite according to repo policy

## Decision Log

- The equivalence proof must exercise the same station builder surface used by the CLI station tool.
- Tiny and lite should be generated from the authoritative full SQLite export, not rebuilt independently from JSONL, so the comparison stays anchored to one source of truth.
- The CLI runtime switch must be explicit and changeable per invocation.

## Progress

- 2026-04-07: Confirmed the current station path is SQLite-only. `resolveStationDataset(...)` only resolves `.sqlite` bundles, and `buildStationQueue(...)` directly calls `recommendFromFavorites(dbPath, ...)` plus SQLite row readers.
- 2026-04-07: Confirmed `sidflow-play export-similarity` currently only supports `--format sqlite`, so lite and tiny export creation need new generator paths.
- 2026-04-07: Added the requirement that the implementation include an automated equivalence proof across full/lite/tiny and unit tests demonstrating tiny-vs-full fidelity for station building.