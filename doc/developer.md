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

## 14. Pull Request Checklist

- `bun run build`
- `bun run test`
- `bun run test:e2e`
- `bun run validate:config`
- Ensure new features have accompanying tests and keep coverage ≥90%.
- Update `README.md` or `doc/developer.md` when behaviour changes.
- For observability changes, update `doc/admin-operations.md` and `doc/technical-reference.md`.
- Verify accessibility with keyboard navigation and screen reader testing.

Happy hacking! 🎶
