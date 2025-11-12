# SIDFlow Copilot Guardrails

## Architecture & Data Flow
- SIDFlow is a CLI-first pipeline: fetch HVSC (`@sidflow/fetch`), classify audio (`@sidflow/classify`), train ML (`@sidflow/train`), and play/recommend (`@sidflow/play`); each stage reads/writes `data/` JSONL and relies on `.sidflow.json` paths.
- Classification splits into WAV cache rendering, heuristic feature extraction (`heuristicFeatureExtractor`), auto-tag generation, and JSONL emission; reuse the planner in `packages/sidflow-classify/src/index.ts`.
- Training consumes `data/classified` and `data/feedback` JSONL, merges explicit/implicit samples, and persists LanceDB-ready artifacts under `data/model`; respect feedback weights defined in `@sidflow/train`.
- Scripts in `scripts/` are thin wrappers invoking the package CLIs; treat them as the contract for end-to-end flows and keep CLI UX stable.

## Shared Libraries & Conventions
- Keep shared utilities in `@sidflow/common` (config loader, deterministic JSON, logger, retry, LanceDB builder) and import rather than reimplementing.
- Always load configuration through `loadConfig` and honor `--config` overrides; cache resets via `resetConfigCache` in long-running tools.
- Serialize JSON with `stringifyDeterministic` to avoid diff churn and normalize nested structures before writing.
- Use `fs/promises` helpers like `ensureDir`/`pathExists` from `common/fs.ts`; extend these utilities instead of mixing sync APIs.

## CLI Patterns
- Follow the CLI structure: parse args in `cli.ts`, call a `plan*` function to validate inputs, then run pure helpers that accept explicit dependencies (see `runClassifyCli` and `runFetchCli`).
- Provide progress reporting via callbacks with throttling (`createProgressLogger` in classify CLI) to keep TTY output smooth.
- Archive extraction relies on bundled `7zip-min` helpers that should be injected via shared utilities.

## Data & Persistence
- `.sidflow.json` defines `hvscPath`, `wavCachePath`, `tagsPath`, optional `classifiedPath`; default to config values but accept explicit paths when provided by callers.
- Classification writes metadata and tags using `resolve*` helpers and stores WAV hashes in sidecar `.hash` files—preserve this caching scheme.
- Feedback lives in date-partitioned `data/feedback/<year>/<month>/events.jsonl`; training and LanceDB builders must tolerate missing folders and skip corrupt lines with warnings, not hard failures.
- Store derived artifacts (manifest, LanceDB) with deterministic checksums using `generateManifest` in `common/lancedb-builder.ts`.

## Tooling & Dependencies
- Bun is the runtime: install deps with `bun install`; build with `bun run build`; execute tests and CLIs through `bun run ...`.
- LanceDB (`vectordb`) powers similarity search; ensure builds call `buildDatabase` before generating manifests.
- Archive extraction uses the `7zip-min` npm dependency bundled with the workspace.

## Testing & Quality Gates
- Use Bun’s test runner (`bun run test`) and keep coverage ≥90% (Codecov enforced); add focused unit tests under `packages/*/test`.
- Run end-to-end validation with `bun run test:e2e` to cover full fetch→classify→play pipeline against `test-data/C64Music`.
- For config and JSON validations, run `bun run validate:config` and `bun run build:db`; ensure new commands have tests mirroring existing CLI suites (`packages/*/test/cli.test.ts`).

## Coding Practices
- Stick to strict TypeScript (`tsconfig.base.json`); avoid `any`, keep types explicit, and expose pure helpers for unit testing.
- Compose functionality from small functions; use concise comments only to explain non-obvious steps (e.g., cache heuristics).
- Use shared error types like `SidflowConfigError` for config issues and preserve informative messaging when wrapping errors.
- Never duplicate logging/serialization patterns; extend `@sidflow/common` if a new cross-cutting helper is required.
