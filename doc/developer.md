# SID Flow Developer Guide

Designed for contributors maintaining or extending the SID Flow toolchain.

---

## 1. Environment

- **Bun** `>= 1.1.10`
- **Node.js** (optional) for editor tooling, but Bun drives scripts and tests.
- **`7zip-min`** ships with the repo; no system-level 7-Zip install required.
- **Host audio player** (`ffplay` preferred; `aplay` works on ALSA systems) for PCM output from the WASM playback harness.

Install dependencies once: `bun install`.

> `bun run build` now runs `bun install --frozen-lockfile` automatically, so vectordb, `7zip-min`, and other runtime dependencies are always present before compilation. As long as `sidplayfp` is on your PATH, a clean checkout can run `bun run build` followed by `bun run test` without extra setup.

---

## 2. Configuration

`./.sidflow.json` controls runtime paths:

| Key | Purpose |
| --- | --- |
| `hvscPath` | Mirrors the HVSC tree produced by `sidflow fetch`. |
| `wavCachePath` | Receives rendered WAV files. |
| `tagsPath` | Stores manual and automatic tag files. |
| `threads` | Worker pool size (`0` = auto). |
| `classificationDepth` | Folder depth for `auto-tags.json` aggregation. |

Optional blocks:

### Availability Manifests

| Key | Purpose |
| --- | --- |
| `availability.manifestPath` | Deterministic JSON manifest listing rendered WAV/M4A/FLAC assets. |
| `availability.assetRoot` | Filesystem root used to resolve `storagePath` entries inside manifests. |
| `availability.publicBaseUrl` | Optional CDN/base URL; prepended to `storagePath` when publishing `publicPath`. |

Validate edits with `bun run validate:config`.

---

## 3. Workspace Commands

| Command | Result |
| --- | --- |
| `bun run build` | Install dependencies (frozen-lockfile) and compile all packages with project references. |
| `bun run test` | Build then run the Bun test suite with coverage (≥90% enforced). |
| `bun run test:e2e` | Run end-to-end integration test with real SID files. |
| `bun run validate:config` | Smoke-test the active configuration file. |
| `./scripts/sidflow-fetch` | Run the fetch CLI with Bun hidden behind a repo-local shim. |
| `./scripts/sidflow-rate` | Launch the interactive rating CLI (TTY required). |
| `bun run fetch:sample` | Spin up a local mirror and run the `sidflow fetch` CLI end-to-end (used in CI). |
| `bun run classify:sample` | Execute the end-to-end classification sample, including metadata extraction and auto-tag heuristics. |

CI mirrors these steps before uploading coverage to Codecov.

---

## 4. Packages at a Glance

| Package | Responsibility |
| --- | --- |
| `@sidflow/common` | Shared config loader, deterministic JSON serializer, logging, filesystem helpers. |
| `@sidflow/fetch` | HVSC sync logic and CLI (`./scripts/sidflow-fetch`). |
| `@sidflow/rate` | Rating session planner (`sidflow-rate` CLI). |
| `@sidflow/classify` | Classification planner (feature extraction + ML pipeline scheduled for Phase 4). |

All packages share `tsconfig.base.json` and strict TypeScript settings; avoid introducing `any`.

---

## 5. Coding Standards

- Keep all reusable logic inside `@sidflow/common` to prevent duplication.
- Prefer small, composable functions; add concise comments only where intent is non-obvious.
- Use `fs/promises` for filesystem access and bubble detailed errors.
- Reuse the shared `retry` helper for transient network or IO operations instead of hand-rolling loops.
- Serialize JSON with `stringifyDeterministic` for stable output.
- Treat `ffplay`/`aplay` as the only native dependencies; the WASM `SidPlaybackHarness` streams PCM into whichever player is detected.

---

## 6. Developing CLIs

- The fetch CLI is live; run `./scripts/sidflow-fetch --help` to inspect options.
- The rating CLI requires a TTY; run `./scripts/sidflow-rate --help` for controls and flags.
- Both `sidflow-play` and `sidflow-rate` rely on the shared WASM `SidPlaybackHarness`; ensure your development machine has `ffplay` or `aplay` to hear audio while iterating.
- Upcoming CLIs for tagging and classification should follow the same pattern: parse args in a dedicated `cli.ts`, expose a testable `run*Cli` function, and guard the executable entry point with `import.meta.main`.
- Keep option parsing minimal and dependency-free; write focused tests similar to `packages/sidflow-fetch/test/cli.test.ts`.

---

## 7. Testing Notes

- Use Bun’s native test runner (`bun:test`).
- Mock filesystem/network interactions with temporary directories and fetch stubs; see `packages/sidflow-fetch/test` for patterns.
- Coverage reports print uncovered lines—address these before sending PRs.
- Remember to restore any monkey-patched globals (e.g., `fetch`, `process.stdout.write`) during tests.

---

## 8. Workspace

```text
workspace/
  hvsc/          # HVSC mirror maintained by fetch CLI
  wav-cache/     # WAV renders and audio features (future phases)
  tags/          # Manual and auto-generated tags
hvsc-version.json  # Version manifest stored alongside hvscPath

The entire `workspace/` directory is git-ignored; keep long-lived local mirrors and experiments there without touching version control.
```

Generated content can be reproduced; avoid committing large artefacts unless explicitly required.

---

## 9. Test Data

The `test-data/` directory contains sample SID files from HVSC Update #83 for end-to-end testing:

```text
test-data/
└── C64Music/
    └── MUSICIANS/
        ├── Test_Artist/
        │   ├── test1.sid
        │   └── test2.sid
        └── Another_Artist/
            └── test3.sid
```

These SID files are committed to the repository and used by the end-to-end test (`bun run test:e2e`) to validate the complete SIDFlow pipeline including:

- WAV cache building
- Feature extraction
- Classification and rating prediction
- Playlist generation
- Playback flow

The test SID files are minimal valid PSID v2 files created for testing purposes. To use real SID files from HVSC Update #83:

1. Download `HVSC_Update_83.7z` from <https://hvsc.brona.dk/HVSC/>
2. Extract 3 SID files with their folder hierarchy
3. Replace the files in `test-data/C64Music/MUSICIANS/`

See `test-data/README.md` for detailed instructions.

---

## 10. Testing Observability & Monitoring

SIDFlow includes health checks, metrics, and telemetry for production deployments. These endpoints are located in `packages/sidflow-web/app/api/`:

- `/api/health` - System health checks (WASM, CLI, streaming, Ultimate64)
- `/api/admin/metrics` - Operational KPIs (jobs, cache, sync)
- `/api/telemetry/beacon` - Anonymous telemetry collection

### Testing Health Endpoints

Health checks validate system readiness across multiple render engines:

```typescript
// packages/sidflow-web/tests/unit/health-api.test.ts
import { GET } from "@/app/api/health/route";

test("health check returns 200 when all systems healthy", async () => {
  const response = await GET(new Request("http://localhost/api/health"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("healthy");
  expect(body.checks).toHaveProperty("wasm");
  expect(body.checks).toHaveProperty("cli");
});
```

Mock external dependencies (filesystem, exec) to test different health states (healthy, degraded, unhealthy).

### Testing Metrics Aggregation

Metrics endpoints return operational data for monitoring dashboards:

```typescript
// packages/sidflow-web/tests/unit/admin-metrics-api.test.ts
import { GET } from "@/app/api/admin/metrics/route";

test("metrics endpoint returns job statistics", async () => {
  // Mock job queue with test data
  const response = await GET(new Request("http://localhost/api/admin/metrics"));
  const body = await response.json();
  expect(body.jobs).toHaveProperty("pending");
  expect(body.cache).toHaveProperty("totalSize");
});
```

Use temporary directories and mock data to simulate realistic metric scenarios.

### Alert Configuration

Alerts are configured in `.sidflow.json`:

```json
{
  "alerts": {
    "enabled": true,
    "thresholds": {
      "failureRate": 0.1,
      "cacheAgeHours": 168,
      "cpuPercent": 85,
      "memoryPercent": 90
    }
  }
}
```

Test alert validation in `packages/sidflow-common/test/config.test.ts` by providing invalid thresholds and asserting error messages.

---

## 11. Working with Render Orchestrator

The RenderOrchestrator (`packages/sidflow-web/src/lib/render/orchestrator.ts`) manages multi-engine rendering:

### Render Modes

```typescript
import { RenderOrchestrator } from "@/lib/render/orchestrator";

const orchestrator = new RenderOrchestrator({
  wasmEnabled: true,
  cliEnabled: true,
  ultimate64Enabled: false
});

// Orchestrator selects optimal engine based on availability
const result = await orchestrator.render(sidFile, subtune);
```

### Ultimate64 Network Capture

For Ultimate64 hardware rendering, configure network capture in `.sidflow.json`:

```json
{
  "ultimate64": {
    "host": "192.168.1.100",
    "port": 64,
    "captureMethod": "network",
    "audioFormat": "raw"
  }
}
```

Test Ultimate64 integration by mocking network responses with sample PCM data.

### Availability Manifests

Availability manifests track render engine health over time:

```json
{
  "timestamp": "2025-01-15T10:00:00Z",
  "engines": {
    "wasm": { "available": true, "lastCheck": "2025-01-15T09:59:00Z" },
    "cli": { "available": true, "lastCheck": "2025-01-15T09:59:00Z" },
    "ultimate64": { "available": false, "lastCheck": "2025-01-15T09:55:00Z" }
  }
}
```

These manifests enable graceful degradation when engines fail. See `doc/technical-reference.md` for schema details.

---

## 12. Contributing to Monitoring Infrastructure

When adding new background jobs or critical paths, instrument them for observability:

1. Add health checks to `/api/health/route.ts` if introducing new external dependencies
2. Add metrics to `/api/admin/metrics/route.ts` for tracking operational state
3. Emit telemetry events via `/api/telemetry/beacon` for user interactions
4. Update `doc/admin-operations.md` with operational guidance for new features

All monitoring additions require tests demonstrating healthy, degraded, and failure scenarios.

---

## 13. Accessibility Guidelines

SIDFlow web UI follows WCAG 2.1 Level AA standards for accessibility. All components must be:

### Keyboard Navigation

- All interactive elements (buttons, inputs, links) must be keyboard accessible
- Use semantic HTML (`<button>`, `<input>`, `<a>`) rather than styled `<div>` elements
- Provide visible focus indicators (`:focus-visible` pseudo-class)
- Support standard keyboard shortcuts:
  - `Tab`/`Shift+Tab` for navigation
  - `Enter`/`Space` for activation
  - `Escape` for dismissing modals/dropdowns
  - Arrow keys for sliders and radio groups

### ARIA Labels

- Icon-only buttons must have `aria-label` attributes describing their action
- Form inputs should have associated `<label>` elements with `htmlFor` or `aria-labelledby`
- Complex widgets (sliders, custom selects) should have appropriate ARIA roles and states
- Use `aria-describedby` for additional context or error messages

### Screen Reader Support

- Use semantic HTML structure (`<main>`, `<nav>`, `<article>`, `<section>`)
- Provide alt text for all images with `alt` attribute
- Use `role="alert"` for status messages and errors
- Announce dynamic content changes with `aria-live` regions
- Hide decorative elements with `aria-hidden="true"`

### Color Contrast

- Text must meet WCAG AA contrast ratios:
  - Normal text: 4.5:1 minimum
  - Large text (≥18pt or ≥14pt bold): 3:1 minimum
- Do not rely on color alone to convey information
- Test with browser DevTools accessibility audits

### Focus Management

- Modals should trap focus and restore it on close
- Skip links should be provided for long navigation menus
- Focus should be moved to appropriate elements after actions (e.g., error messages)

### Testing Accessibility

```bash
# Run automated accessibility checks with Playwright
bun run test:e2e -- --grep "@a11y"

# Manual testing checklist:
# 1. Navigate entire UI with keyboard only
# 2. Test with screen reader (NVDA on Windows, VoiceOver on macOS)
# 3. Test with browser zoom at 200%
# 4. Use browser DevTools Lighthouse audit
# 5. Verify color contrast with Chrome DevTools or axe DevTools
```

### Common Patterns

**Icon Button:**
```tsx
<Button aria-label="Play track" size="icon">
  <PlayIcon />
</Button>
```

**Form Input:**
```tsx
<label htmlFor="sid-path" className="text-sm font-medium">
  SID File Path
</label>
<input
  id="sid-path"
  type="text"
  aria-describedby="sid-path-hint"
  // ...
/>
<p id="sid-path-hint">Enter relative path from HVSC root</p>
```

**Slider:**
```tsx
<Slider
  value={energy}
  onValueChange={setEnergy}
  min={1}
  max={5}
  aria-label="Energy level"
  aria-valuetext={`Energy level ${energy[0]} out of 5`}
/>
```

---

## 14. Job Orchestration & Background Processing

SIDFlow includes a comprehensive job orchestration system for admin operations that need to run asynchronously in the background.

### Job Queue Architecture

Jobs are stored as JSON files in `data/jobs/` with the following structure:

```typescript
interface Job {
  id: string;                    // UUID
  type: 'fetch' | 'classify' | 'train' | 'render';
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;             // ISO 8601 timestamp
  startedAt?: string;
  completedAt?: string;
  priority: number;              // Higher = runs first
  config: JobConfig;             // Job-specific configuration
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
  error?: {
    message: string;
    stack?: string;
  };
  checkpoints?: Record<string, unknown>;  // Resume data
}
```

### Creating Jobs

Jobs are created via admin API endpoints:

```typescript
// POST /api/admin/jobs
{
  "type": "classify",
  "config": {
    "path": "/workspace/hvsc/MUSICIANS/Rob_Hubbard",
    "depth": 2,
    "renderModes": ["wasm", "cli"]
  },
  "priority": 1
}
```

### Job Runner Service

The job runner (`packages/sidflow-web/lib/jobs/runner.ts`) orchestrates job execution:

**Key Responsibilities:**
1. Poll job queue for pending jobs
2. Execute jobs via CLI wrappers
3. Track progress and update job status
4. Handle checkpointing for resume
5. Manage concurrency limits
6. Cleanup stale jobs

**Running the Service:**

```bash
# Development mode with hot reload
bun run scripts/run-job-queue.ts

# Production deployment
NODE_ENV=production bun run scripts/run-job-queue.ts
```

### CLI Integration

Each job type invokes the corresponding CLI command:

**Fetch Job:**
```bash
./scripts/sidflow-fetch \
  --config /path/to/.sidflow.json \
  --remote https://hvsc.brona.dk/HVSC/
```

**Classify Job:**
```bash
./scripts/sidflow-classify \
  --config /path/to/.sidflow.json \
  --path /workspace/hvsc/MUSICIANS/Rob_Hubbard \
  --depth 2
```

**Train Job:**
```bash
./scripts/sidflow-train \
  --config /path/to/.sidflow.json \
  --epochs 20 \
  --batch-size 32
```

**Render Job:**
```bash
./scripts/sidflow-render \
  --sid-path MUSICIANS/Rob_Hubbard/Delta.sid \
  --format m4a \
  --engine ultimate64
```

### Checkpointing & Resume

Long-running jobs support checkpointing to enable graceful restart:

```typescript
// Save checkpoint during job execution
await saveJobCheckpoint(jobId, {
  processedFiles: 1500,
  lastFilePath: "MUSICIANS/R/Rob_Hubbard/Delta.sid",
  cacheStats: { hits: 1200, misses: 300 }
});

// Resume from checkpoint
const checkpoint = await loadJobCheckpoint(jobId);
if (checkpoint) {
  startFrom = checkpoint.lastFilePath;
}
```

**Checkpoint Storage:**
- Stored in job JSON under `checkpoints` field
- Updated atomically with file rename
- Validated on load (corrupt checkpoints ignored)

### Testing Job Orchestration

**Unit Tests** (`packages/sidflow-web/test/unit/job-queue.test.ts`):
```typescript
import { JobQueue } from "@/lib/jobs/queue";

describe("JobQueue", () => {
  it("prioritizes high-priority jobs", async () => {
    const queue = new JobQueue();
    await queue.enqueue({ type: "fetch", priority: 1 });
    await queue.enqueue({ type: "classify", priority: 5 });
    
    const next = await queue.dequeue();
    expect(next.type).toBe("classify"); // priority 5 runs first
  });

  it("handles concurrent job execution", async () => {
    const queue = new JobQueue({ maxConcurrent: 2 });
    // ... test concurrent execution limits
  });

  it("resumes from checkpoint after crash", async () => {
    // ... test checkpoint restore logic
  });
});
```

**Integration Tests** (`packages/sidflow-web/test/integration/job-runner.test.ts`):
```typescript
import { JobRunner } from "@/lib/jobs/runner";

describe("JobRunner", () => {
  it("executes fetch job end-to-end", async () => {
    const runner = new JobRunner();
    const job = await runner.createJob({
      type: "fetch",
      config: { remote: "https://test.example.com" }
    });
    
    await runner.executeJob(job.id);
    
    const completed = await runner.getJob(job.id);
    expect(completed.status).toBe("completed");
  });
});
```

### Monitoring Jobs

**Admin UI** (`/admin/jobs`):
- View all jobs with status filters
- Cancel running jobs
- Retry failed jobs
- View logs and error details
- Download job results

**Metrics Endpoint** (`GET /api/admin/metrics`):
```json
{
  "jobs": {
    "pending": 2,
    "running": 1,
    "completed": 42,
    "failed": 3,
    "avgDurationMs": 45000
  }
}
```

### Job Best Practices

1. **Idempotency**: Jobs should be safe to run multiple times
2. **Atomicity**: Write output atomically (temp file + rename)
3. **Progress Reporting**: Update progress at reasonable intervals (not every item)
4. **Error Handling**: Fail fast on unrecoverable errors, retry transient failures
5. **Resource Limits**: Respect CPU/memory constraints
6. **Cleanup**: Remove temporary files on completion or failure

---

## 15. Testing Playback Adapters

SIDFlow's playback system uses multiple adapters for different rendering technologies. Comprehensive testing ensures consistent behavior across all adapters.

### Adapter Interface

All adapters implement the `PlaybackAdapter` interface:

```typescript
interface PlaybackAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  load(sidPath: string, options: PlaybackOptions): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  getState(): PlaybackState;
  cleanup(): Promise<void>;
}
```

### Unit Testing Adapters

**WASM Adapter** (`packages/sidflow-web/test/unit/wasm-adapter.test.ts`):

```typescript
import { WasmPlaybackAdapter } from "@/lib/playback/adapters/wasm";

describe("WasmPlaybackAdapter", () => {
  let adapter: WasmPlaybackAdapter;

  beforeEach(() => {
    adapter = new WasmPlaybackAdapter();
  });

  it("checks WASM availability", async () => {
    const available = await adapter.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("loads SID file", async () => {
    await adapter.load("/test/file.sid", { subtune: 1 });
    expect(adapter.getState()).toBe("loaded");
  });

  it("handles missing WASM module gracefully", async () => {
    // Mock missing WASM
    global.WebAssembly = undefined;
    
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it("cleans up resources", async () => {
    await adapter.load("/test/file.sid");
    await adapter.cleanup();
    
    expect(adapter.getState()).toBe("unloaded");
  });
});
```

**CLI Adapter** (`packages/sidflow-web/test/unit/cli-adapter.test.ts`):

```typescript
import { CliPlaybackAdapter } from "@/lib/playback/adapters/cli";
import { exec } from "node:child_process";

jest.mock("node:child_process");

describe("CliPlaybackAdapter", () => {
  it("detects sidplayfp binary", async () => {
    (exec as jest.Mock).mockImplementation((cmd, cb) => {
      if (cmd.includes("which sidplayfp")) {
        cb(null, { stdout: "/usr/bin/sidplayfp" });
      }
    });

    const adapter = new CliPlaybackAdapter();
    const available = await adapter.isAvailable();
    
    expect(available).toBe(true);
  });

  it("handles missing binary gracefully", async () => {
    (exec as jest.Mock).mockImplementation((cmd, cb) => {
      cb(new Error("not found"));
    });

    const adapter = new CliPlaybackAdapter();
    const available = await adapter.isAvailable();
    
    expect(available).toBe(false);
  });
});
```

**Streaming Adapter** (`packages/sidflow-web/test/unit/streaming-adapter.test.ts`):

```typescript
import { StreamingPlaybackAdapter } from "@/lib/playback/adapters/streaming";
import { loadAvailabilityManifest } from "@sidflow/common";

jest.mock("@sidflow/common");

describe("StreamingPlaybackAdapter", () => {
  it("checks asset availability via manifest", async () => {
    (loadAvailabilityManifest as jest.Mock).mockResolvedValue({
      assets: {
        "Test/file.sid": {
          formats: { m4a: { path: "/cache/test.m4a" } }
        }
      }
    });

    const adapter = new StreamingPlaybackAdapter();
    await adapter.load("Test/file.sid");
    
    expect(adapter.getState()).toBe("loaded");
  });

  it("handles missing assets", async () => {
    (loadAvailabilityManifest as jest.Mock).mockResolvedValue({
      assets: {}
    });

    const adapter = new StreamingPlaybackAdapter();
    
    await expect(adapter.load("Test/missing.sid"))
      .rejects.toThrow("No streaming asset available");
  });
});
```

**Ultimate 64 Adapter** (`packages/sidflow-web/test/unit/ultimate64-adapter.test.ts`):

```typescript
import { Ultimate64PlaybackAdapter } from "@/lib/playback/adapters/ultimate64";
import { fetch } from "node:fetch";

jest.mock("node:fetch");

describe("Ultimate64PlaybackAdapter", () => {
  const mockConfig = {
    host: "ultimate64.local",
    port: 64
  };

  it("checks connectivity via REST API", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "idle" })
    });

    const adapter = new Ultimate64PlaybackAdapter(mockConfig);
    const available = await adapter.isAvailable();
    
    expect(available).toBe(true);
  });

  it("handles network errors", async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));

    const adapter = new Ultimate64PlaybackAdapter(mockConfig);
    const available = await adapter.isAvailable();
    
    expect(available).toBe(false);
  });

  it("sends load command via REST API", async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true });

    const adapter = new Ultimate64PlaybackAdapter(mockConfig);
    await adapter.load("/test/file.sid", { subtune: 2 });
    
    expect(fetch).toHaveBeenCalledWith(
      "http://ultimate64.local:64/api/load",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/test/file.sid", subtune: 2 })
      })
    );
  });
});
```

### Integration Testing

**Adapter Facade** (`packages/sidflow-web/test/integration/playback-facade.test.ts`):

```typescript
import { PlaybackFacade } from "@/lib/playback/facade";

describe("PlaybackFacade", () => {
  it("selects WASM adapter when available", async () => {
    const facade = new PlaybackFacade();
    await facade.initialize();
    
    expect(facade.getActiveAdapter()).toBe("wasm");
  });

  it("falls back to streaming when WASM unavailable", async () => {
    // Mock WASM unavailable
    jest.spyOn(window, "SharedArrayBuffer").mockImplementation(() => {
      throw new Error("SAB not available");
    });

    const facade = new PlaybackFacade();
    await facade.initialize();
    
    expect(facade.getActiveAdapter()).toBe("streaming");
  });

  it("maintains state across adapter switches", async () => {
    const facade = new PlaybackFacade();
    await facade.load("/test/file.sid");
    
    // Simulate adapter failure
    await facade.switchAdapter("streaming");
    
    expect(facade.getState()).toBe("loaded");
  });
});
```

### E2E Playback Tests

**Browser Playback** (`packages/sidflow-web/test/e2e/playback.spec.ts`):

```typescript
import { test, expect } from "@playwright/test";

test.describe("Playback Flow", () => {
  test("plays SID via WASM adapter", async ({ page }) => {
    await page.goto("/");
    
    await page.click('[data-testid="play-button"]');
    await page.selectOption('[data-testid="mood-selector"]', "energetic");
    
    // Wait for playback to start
    await expect(page.locator('[data-testid="player-status"]'))
      .toHaveText("Playing", { timeout: 5000 });
    
    // Verify audio context is active
    const isPlaying = await page.evaluate(() => {
      return window.audioContext?.state === "running";
    });
    expect(isPlaying).toBe(true);
  });

  test("falls back to streaming on SAB error", async ({ page, context }) => {
    // Disable SharedArrayBuffer
    await context.addInitScript(() => {
      delete window.SharedArrayBuffer;
    });

    await page.goto("/");
    await page.click('[data-testid="play-button"]');
    
    // Should automatically use streaming
    await expect(page.locator('[data-testid="adapter-status"]'))
      .toHaveText("Streaming");
  });
});
```

### Mock Ultimate 64 Server

For testing Ultimate 64 integration without hardware:

```typescript
// test/mocks/ultimate64-server.ts
import { createServer } from "node:http";

export function createMockUltimate64Server(port = 64) {
  const server = createServer((req, res) => {
    if (req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "idle", connected: true }));
    } else if (req.url === "/api/load" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
    } else if (req.url === "/api/play" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ playing: true }));
    }
  });

  server.listen(port);
  return server;
}
```

Usage in tests:

```typescript
import { createMockUltimate64Server } from "../mocks/ultimate64-server";

describe("Ultimate64 Integration", () => {
  let server: Server;

  beforeAll(() => {
    server = createMockUltimate64Server();
  });

  afterAll(() => {
    server.close();
  });

  it("communicates with mock server", async () => {
    const adapter = new Ultimate64PlaybackAdapter({
      host: "localhost",
      port: 64
    });
    
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });
});
```

### Testing Render Modes

**Render Matrix Validation** (`packages/sidflow-classify/test/render-matrix.test.ts`):

```typescript
import { validateRenderMode } from "@/render/render-matrix";

describe("Render Matrix", () => {
  it("accepts valid WASM real-time client mode", () => {
    const result = validateRenderMode({
      location: "client",
      time: "real-time",
      technology: "wasm",
      target: "live"
    });
    
    expect(result.valid).toBe(true);
  });

  it("rejects invalid offline client WASM mode", () => {
    const result = validateRenderMode({
      location: "client",
      time: "offline",
      technology: "wasm",
      target: "wav"
    });
    
    expect(result.valid).toBe(false);
    expect(result.suggestions).toContain("Use server+offline+cli for WAV");
  });

  it("provides actionable suggestions", () => {
    const result = validateRenderMode({
      location: "client",
      time: "offline",
      technology: "wasm"
    });
    
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]).toMatch(/server|cli/i);
  });
});
```

### Performance Testing

**Latency Benchmarks** (`packages/sidflow-web/test/performance/playback-latency.test.ts`):

```typescript
import { performance } from "node:perf_hooks";

describe("Playback Latency", () => {
  it("WASM adapter loads within 100ms", async () => {
    const adapter = new WasmPlaybackAdapter();
    
    const start = performance.now();
    await adapter.load("/test/file.sid");
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(100);
  });

  it("maintains <50ms frame budget", async () => {
    const adapter = new WasmPlaybackAdapter();
    await adapter.load("/test/file.sid");
    await adapter.play();
    
    // Monitor frame timing for 5 seconds
    const frameTimes = await monitorFrameTimes(5000);
    const avgFrameTime = frameTimes.reduce((a, b) => a + b) / frameTimes.length;
    
    expect(avgFrameTime).toBeLessThan(50); // 50ms = ~20fps acceptable
  });
});
```

---

## 16. Pull Request Checklist

- `bun run build`
- `bun run test`
- `bun run test:e2e`
- `bun run validate:config`
- Ensure new features have accompanying tests and keep coverage ≥90%.
- Update `README.md` or `doc/developer.md` when behaviour changes.
- For observability changes, update `doc/admin-operations.md` and `doc/technical-reference.md`.
- Verify accessibility with keyboard navigation and screen reader testing.

Happy hacking! 🎶
