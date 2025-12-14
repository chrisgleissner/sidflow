# Developer Guide

## Setup

```bash
# Clone and install
git clone https://github.com/chrisgleissner/sidflow.git
cd sidflow
bun install

# Build all packages
bun run build

# Run tests
bun run test
bun run test:e2e
```

## Project Structure

```
packages/
  sidflow-fetch/     # HVSC sync
  sidflow-classify/  # Feature extraction
  sidflow-train/     # ML training
  sidflow-play/      # Playback
  sidflow-rate/      # Rating CLI
  sidflow-web/       # Web UI
  sidflow-common/    # Shared utilities
  libsidplayfp-wasm/ # WASM SID emulator
scripts/             # CLI entry points
data/                # Generated data (gitignored)
```

## Common Commands

```bash
bun run build          # Build all packages
bun run test           # Unit tests
bun run test:e2e       # E2E tests (needs Playwright)
tsc -b                 # Type check
```

## Performance tests

The repo has a journey-driven performance runner (k6 + optional Playwright) used by CI and for remote targets (Fly.io / Raspberry Pi):

```bash
# Run against a local server you already started (recommended for dev)
bun run perf:run -- --env local --base-url http://localhost:3000 --profile smoke --execute

# Run against a remote instance (Fly.io / Raspberry Pi) — requires explicit opt-in
bun run perf:run -- --env remote --enable-remote --executor k6 --base-url https://your-app.example --profile reduced --execute
```

Outputs are written under `performance/results/` and `performance/tmp/`. For “hundreds of users” load, use `--profile scale` (remote-only).

## Configuration

SIDFlow reads configuration from `.sidflow.json` in the repository root by default.

- To use a different config file, set `SIDFLOW_CONFIG=/path/to/config.json` (or pass `--config` for CLIs that support it).
- For tests, the repo uses `.sidflow.test.json` as a minimal test config.

Key paths in `.sidflow.json`:
- `sidPath`: Root of your SID collection (HVSC or any folder tree containing `.sid` files)
- `audioCachePath`: Rendered audio cache directory
- `tagsPath`: Manual tags/ratings directory (separate from `data/feedback`)

## Testing

- Unit tests: `bun run test`
- E2E tests: `bun run test:e2e` (requires Playwright browsers; run `bun run setup:tests` if missing)
- Coverage: `bun run test --coverage`

## Code Style

- TypeScript strict mode
- No `any` types
- Use shared utilities from `@sidflow/common`
- Web UI linting is in `packages/sidflow-web` (`cd packages/sidflow-web && npm run lint`)
