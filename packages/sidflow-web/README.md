# SIDFlow Web Server

Local web interface for orchestrating SID playback, rating, and classification through a simple browser control panel.

## Overview

The SIDFlow web server is a thin presentation layer built on Next.js 15 and React 19 that delegates to existing CLI tools (`sidflow-play`, `sidflow-rate`, `sidflow-classify`). It provides a local-first web interface for managing your SID music collection.

## Architecture

### Components

- **API Routes** (`app/api/`): Next.js API endpoints that wrap CLI commands
  - `/api/play` - Trigger playback with mood presets
  - `/api/rate` - Submit manual ratings for tracks
  - `/api/classify` - Trigger classification on file paths
  - `/api/fetch` - Synchronize HVSC collection
  - `/api/train` - Train ML models on feedback data

- **CLI Executor** (`lib/cli-executor.ts`): Utility for spawning and managing CLI processes using Bun.spawn
  - Captures stdout, stderr, and exit codes
  - Supports configurable timeouts
  - Handles errors gracefully

- **Validation** (`lib/validation.ts`): Zod schemas for request/response validation
  - Type-safe request bodies
  - Clear validation error messages
  - Consistent API response format

### Technology Stack

- **Next.js 15** (App Router) - Web framework
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Zod** - Schema validation
- **Bun** - Runtime and package manager
- **Playwright** - E2E testing

### Real-Time Audio

The web interface features a high-performance audio pipeline for glitch-free SID playback:

- **AudioWorklet + SharedArrayBuffer** - Zero main-thread audio processing
- **Web Worker WASM** - libsidplayfp rendering in dedicated thread
- **Lock-free Ring Buffer** - Real-time streaming with backpressure handling
- **Pre-roll Buffering** - Guaranteed glitch-free startup

📖 **[Read the complete Audio Pipeline documentation](./AUDIO_PIPELINE.md)**

## Development

### Prerequisites

- Bun 1.3.1 or later
- Node.js 20 or later (for Next.js)
- SIDFlow CLI tools installed and in PATH

### Setup

```bash
# Install dependencies (from repository root)
bun install

# Start development server
cd packages/sidflow-web
bun run dev
```

The server will start on http://localhost:3000

### API Documentation

OpenAPI 3.0 specification is available in `openapi.yaml`. View it using:
- [Swagger UI](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/chrisgleissner/sidflow/main/packages/sidflow-web/openapi.yaml)
- [Redoc](https://redocly.github.io/redoc/?url=https://raw.githubusercontent.com/chrisgleissner/sidflow/main/packages/sidflow-web/openapi.yaml)
- Or open `openapi.yaml` in any OpenAPI-compatible tool

### Building

```bash
bun run build
```

### Testing

```bash
# Run unit tests
bun run test

# Run E2E tests
bun run test:e2e

# Run with coverage
bun test tests/unit/ --coverage
```

## API Endpoints

### POST /api/play

Trigger SID playback via `sidflow-play` CLI.

**Request:**
```json
{
  "sid_path": "/path/to/file.sid",
  "preset": "energetic"
}
```

**Preset options:** `quiet`, `ambient`, `energetic`, `dark`, `bright`, `complex`

**Response (success):**
```json
{
  "success": true,
  "data": {
    "output": "..."
  }
}
```

### POST /api/rate

Submit manual ratings via `sidflow-rate` CLI.

**Request:**
```json
{
  "sid_path": "/path/to/file.sid",
  "ratings": {
    "e": 3,
    "m": 4,
    "c": 2,
    "p": 5
  }
}
```

Rating dimensions (1-5 scale):
- `e`: Energy
- `m`: Mood
- `c`: Complexity
- `p`: Preference

**Response (success):**
```json
{
  "success": true,
  "data": {
    "message": "Rating submitted successfully"
  }
}
```

### POST /api/classify

Trigger classification via `sidflow-classify` CLI.

**Request:**
```json
{
  "path": "/path/to/sid/directory"
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "output": "..."
  }
}
```

### POST /api/fetch

Synchronize HVSC collection via `sidflow-fetch` CLI.

**Request:**
```json
{
  "configPath": "/path/to/config.json",
  "remoteBaseUrl": "https://example.com/hvsc",
  "hvscVersionPath": "/path/to/version.json"
}
```

All fields are optional.

**Response (success):**
```json
{
  "success": true,
  "data": {
    "output": "..."
  }
}
```

### POST /api/train

Train ML model via `sidflow-train` CLI.

**Request:**
```json
{
  "configPath": "/path/to/config.json",
  "epochs": 10,
  "batchSize": 16,
  "learningRate": 0.001,
  "evaluate": true,
  "force": false
}
```

All fields are optional.

**Response (success):**
```json
{
  "success": true,
  "data": {
    "output": "..."
  }
}
```
  "success": true,
  "data": {
    "output": "..."
  }
}
```

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional error details"
}
```

HTTP status codes:
- `200` - Success
- `400` - Validation error (invalid request body)
- `500` - Server error (CLI execution failed)

## Testing Strategy

### Unit Tests

- Test CLI executor with various command scenarios
- Test validation schemas with valid/invalid inputs
- Mock external dependencies for isolation
- Target: ≥90% code coverage

Located in `tests/unit/`:
- `cli-executor.test.ts` - Tests for command execution utility
- `validation.test.ts` - Schema validation tests
- `api-routes.test.ts` - API route structure tests
- `api-client.test.ts` - Client-side API function tests

### E2E Tests

- Test full user workflows with Playwright
- Verify API endpoints respond correctly
- Test error handling and edge cases
- Run against local dev server

Located in `tests/e2e/`:
- `homepage.spec.ts` - Basic page load and structure
- `play.spec.ts` - Play workflow with mood presets
- `rate.spec.ts` - Rating submission and sliders
- `ui.spec.ts` - Status display, queue, and layout

### Stub CLI Tools

For CI/CD testing without actual `sidplayfp` binary or long-running operations, stub scripts are provided in `tests/stubs/`:
- `sidflow-play` - Simulates playback
- `sidflow-rate` - Simulates rating submission
- `sidflow-classify` - Simulates classification
- `sidflow-fetch` - Simulates HVSC fetch
- `sidflow-train` - Simulates model training

These stubs are automatically added to PATH during E2E tests via Playwright configuration.

### Running Tests

```bash
# Unit tests
bun run test

# E2E tests (starts dev server automatically)
bun run test:e2e

# Unit tests with coverage
bun test tests/unit/ --coverage

# Run specific E2E test
bunx playwright test tests/e2e/play.spec.ts

# Debug E2E tests with UI
bunx playwright test --ui
```

## Configuration

The web server uses the same `.sidflow.json` configuration as CLI tools via `@sidflow/common` package.

## Future Extensibility

While not yet implemented, the architecture supports:
- Per-user training models
- Hosted multi-user mode
- Real-time updates via WebSocket
- Advanced visualizations

## Troubleshooting

### Port 3000 already in use

Stop any other services using port 3000 or set a custom port:
```bash
PORT=3001 bun run dev
```

### CLI commands not found

Ensure SIDFlow CLI tools are installed and in your PATH:
```bash
which sidflow-play
which sidflow-rate
which sidflow-classify
```

If running locally, build the project first:
```bash
cd /path/to/sidflow
bun run build
```

The CLI scripts are in the `scripts/` directory at the repository root.

### Tests failing

Ensure all dependencies are installed:
```bash
bun install
bunx playwright install chromium
```

### E2E tests fail in CI

The E2E tests use stub CLI tools to avoid dependencies on `sidplayfp` and long-running operations. These stubs are in `tests/stubs/` and are automatically added to PATH during tests.

If tests fail:
1. Verify stub scripts are executable: `ls -la tests/stubs/`
2. Check Playwright configuration includes stub PATH
3. Review Playwright report artifact in CI

### Platform-Specific Issues

**Linux:**
- Ensure `sidplayfp` is installed: `sudo apt install sidplayfp`
- Check audio device permissions if playback fails

**macOS:**
- Install `sidplayfp` via Homebrew: `brew install sidplayfp`
- Grant microphone/audio permissions if prompted

**Windows:**
- Download `sidplayfp` from [releases page](https://github.com/libsidplayfp/sidplayfp/releases)
- Add `sidplayfp.exe` to PATH or use absolute path in `.sidflow.json`
- Use WSL2 for best compatibility

### Development Issues

**Next.js build errors:**
```bash
# Clear Next.js cache
rm -rf .next/
bun run build
```

**TypeScript errors:**
```bash
# Rebuild TypeScript project references
cd /path/to/sidflow
bun run build
```

**Stale node_modules:**
```bash
rm -rf node_modules/
bun install
```

## License

GPL-2.0-only (same as parent project)
