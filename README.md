# SID Flow

SID Flow is a CLI toolkit for tagging, classifying and playing Commodore 64 SID music.

Built on Bun and TypeScript.

## Required Reading

- `doc/plans/init/sidflow-project-spec.md`
- `doc/plans/init/plan.md`
- `doc/plans/init/rollout.md`

## Prerequisites

- [Bun](https://bun.sh/) `>= 1.1.10`
- `sidplayfp` available on your `PATH` (override via `--sidplay` when needed)
- 7-Zip capable of extracting `.7z` archives

## Quick Start

1. `bun install`
2. `bun run test`
3. `bun run validate:config`

The default configuration lives in `.sidflow.json`. Each CLI also accepts `--sidplay` to override the SID player binary.

## Workspace Layout

```text
packages/
  sidflow-common/    # shared config loader, logging, deterministic JSON helpers
  sidflow-fetch/     # HVSC downloader + updater (Phase 2)
  sidflow-tag/       # manual tagging workflow (Phase 3)
  sidflow-classify/  # automated classification pipeline (Phase 4)
```

Additional directories under `data/` will be created by the CLIs during runtime for HVSC content, WAV caches, and tag outputs.

## Development Standards

- Write strict TypeScript with explicit types and deterministic JSON serialization via `@sidflow/common`.
- Keep test coverage ≥90% (enforced in CI with Codecov).
- Run `bun run build` before packaging artifacts; run `bun run test` to execute tests with coverage locally.
- Use `stringifyDeterministic` for all JSON emission to keep diffs clean.

## License

GPL v2 – see `LICENSE`.
