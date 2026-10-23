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

```text
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
bun run build:quick    # Fast incremental TypeScript sanity build
bun run build          # Build all packages
bun run test           # Unit tests
bun run test:e2e       # E2E tests (needs Playwright)
bun run export:similarity -- --profile full   # Build offline similarity bundle
bun run jobs:run      # Run the durable background job worker
tsc -b                 # Type check
```

For iterative phase work, prefer `bun run build:quick` plus targeted test files for the area you changed. Reserve `bun run build` and the full coverage suite from `bun run test` for phase gates and final validation.

### HVSC ROM requirement research

For listener-relevant ROM comparisons, full documented horizons and a
versioned consumer lookup, use [methodology 4](research/hvsc-rom-production.md). The
older command below is retained as a historical research example. Rollout is gated:
a pilot (at most 5% of subtunes and of files, counted in a durable ledger) needs a reviewed
`--selection`, and a full run needs a hardening certificate:

```sh
bun scripts/rom-audit/select-pilot.ts /path/C64Music workspace/rom-audit-selection.json
bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms --out workspace/rom-audit-v4 \
  --workers 7 --rollout pilot --selection workspace/rom-audit-selection.json
bun scripts/rom-audit/publish.ts --production workspace/rom-audit-v4 doc/research/hvsc-rom-catalogue/v4
bun scripts/rom-audit/harden.ts --hvsc /path/C64Music --roms /path/roms --pilot workspace/rom-audit-v4 \
  --review doc/research/hvsc-rom-adversarial-review.md   # writes workspace/rom-audit-hardening/certificate.json
bun scripts/rom-audit/audit.ts ... --rollout full --hardening workspace/rom-audit-hardening/certificate.json
```

The [ROM requirement report](research/hvsc-rom-requirements.md) distinguishes
BASIC header declarations, changed execution and PCM differences with similar
register sequences. Its audit reads the complete HVSC release index and checks all
files before starting checkpointed parallel native workers:

```sh
bash scripts/rom-audit/build-native.sh
bun scripts/rom-audit/verify-native.ts /path/C64Music /path/roms
bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms \
  --out workspace/rom-audit --workers 7 --seconds 2
```

The native build uses the complete source bundled in the locked WASM dependency;
it needs `g++`, `make`, `autoreconf`, `libtoolize`, `pkg-config` and `xa` (`xa65`),
without Docker or a different distro SID engine. `--seconds` is a bounded start
window; BASIC and inconclusive or changed cases receive at least ten seconds.
Repeated identical commands resume only matching manifests. `--selection` accepts
a JSON array of relative `path` and one-based `song` pairs for longer follow-ups.
Never interpret a passing short window as proof that a song never needs ROMs.

The sanitizer regression requires the actual HVSC failure input as well as
synthetic stimuli:

```sh
ROM_AUDIT_SANITIZE=1 bash scripts/rom-audit/build-native.sh   # ASan + UBSan
bun scripts/rom-audit/native-regression.ts \
  workspace/rom-audit-native-asan/render /path/roms /path/C64Music
bun scripts/rom-audit/decision-regression.ts \
  workspace/rom-audit-native-asan/render /path/roms
```

Queued web jobs created through `/api/fetch`, `/api/train`, and `/api/classify` with `async=true` rely on the manifest-backed worker started by `bun run jobs:run`. The web app now submits those jobs and reports their state; the worker owns execution.

For offline consumer integrations, generate the portable similarity bundle after classification:

```bash
bun run export:similarity -- --profile full
```

The default artifacts land in `data/exports/`. See [doc/similarity-export.md](doc/similarity-export.md) for the bundle schema and the c64commander-style favorite-to-playlist workflow.

For long-running local wrapper runs, use the dedicated helper instead of killing processes manually:

```bash
bash scripts/stop-similarity-export.sh
```

## Performance tests

The repo has a journey-driven performance runner (k6 + optional Playwright) used by CI and explicitly enabled remote targets:

```bash
# Run against a local server you already started (recommended for dev)
bun run perf:run -- --env local --base-url http://localhost:3000 --profile smoke --execute

# Run against a remote instance — requires explicit opt-in
bun run perf:run -- --env remote --enable-remote --executor k6 --base-url https://your-app.example --profile reduced --execute
```

Outputs are written under `performance/results/` and `performance/tmp/`. For “hundreds of users” load, use `--profile scale` (remote-only).

Checked-in journeys now include:

- `performance/journeys/play-start-stream.json` for public playback startup
- `performance/journeys/search-favorite-stream.json` for mixed search/play/favorite traffic
- `performance/journeys/admin-classify-queue.json` for authenticated admin queue pressure

Remote admin journeys that hit protected `/admin` or admin-only `/api/*` routes require:

```bash
export SIDFLOW_PERF_ADMIN_BASIC_AUTH="$(printf '%s:%s' "$SIDFLOW_ADMIN_USER" "$SIDFLOW_ADMIN_PASSWORD" | base64 -w0)"
```

Then run the scale profile against staging, for example:

```bash
bun run perf:run -- --env remote --enable-remote --executor k6 --base-url https://your-staging-app.example --profile scale --journey search-favorite-stream --journey admin-classify-queue --execute
```

For the reviewed Phase 4 staging bundle, prefer the wrapper script:

```bash
export SIDFLOW_PERF_BASE_URL=https://your-staging-app.example
./scripts/perf/run-staging-validation.sh
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
