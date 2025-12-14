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
