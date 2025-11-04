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

### E2E Tests

- Test full user workflows with Playwright
- Verify API endpoints respond correctly
- Test error handling and edge cases
- Run against local dev server

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

### Tests failing

Ensure all dependencies are installed:
```bash
bun install
bunx playwright install chromium
```

## License

GPL-2.0-only (same as parent project)
