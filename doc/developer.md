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
bun run lint           # ESLint
tsc -b                 # Type check
```

## Configuration

Copy `.sidflow.example.json` to `.sidflow.json` and set paths:
- `sidPath`: HVSC collection location
- `wavCachePath`: Rendered WAV cache
- `tagsPath`: User ratings

## Testing

- Unit tests: `bun run test`
- E2E tests: `bun run test:e2e` (requires `npx playwright install chromium`)
- Coverage: `bun run test --coverage`

## Code Style

- TypeScript strict mode
- No `any` types
- Use shared utilities from `@sidflow/common`
- Run `bun run lint` before committing
