# Unified Performance Testing Architecture

Unified system for running performance journeys once across Playwright (browser-mode) and k6 (protocol-mode) to cover client behaviour and SID-streaming APIs without duplicating scenarios.

## Component Overview

- **Journey specs**: Declarative journeys describing navigation, clicks, waits, and track selection once; consumed by both executors.
- **Client-action → API mapping**: Maps spec actions to backend calls for protocol-mode (search, queue, playback start/stream, favorites).
- **Executors**:
  - Playwright executor: real browser interactions, HAR/trace timing capture, enforced 3s pacing.
  - k6 executor: protocol-level scripts generated from the same spec + mapping, 3s `sleep`, scalable user counts.
- **Unified runner**: Orchestrates local and CI runs, fans journeys to the right executor variants, applies environment + pacing, and writes timestamped result folders.
- **Summarisation module**: Reads k6 CSV + Playwright timings, emits compact JSON (p95/p99/throughput/error rates) for LLM/reporting.
- **Reporting**: Nightly Markdown references CSVs, HTML dashboards, browser timing data, and JSON summaries.

## Directory Layout (proposed)

- `performance/journeys/` — shared declarative journey specs (JSON/YAML).
- `performance/executors/playwright/` — executor harness + templates for temporary scripts.
- `performance/executors/k6/` — executor harness + protocol mapping + templates.
- `performance/results/<timestamp>/` — per-run outputs (subfolders per executor/journey/variant).
- `performance/summary/` — summarisation module and emitted JSON summaries.
- `performance/tmp/` — generated scripts (git-ignored) used by both executors.

## Journey Spec Shape

Minimal JSON structure to avoid duplication:

```json
{
  "id": "play-start-stream",
  "description": "Search, pick a track, start SID stream, and let it play briefly",
  "pacingSeconds": 3,
  "steps": [
    { "action": "navigate", "target": "/" },
    { "action": "click", "selector": "[data-testid='search-input']" },
    { "action": "type", "selector": "[data-testid='search-input']", "value": "ambient" },
    { "action": "waitForText", "text": "results" },
    { "action": "selectTrack", "trackRef": "firstResult" },
    { "action": "startPlayback", "expectStream": true }
  ],
  "data": {
    "trackRefs": { "firstResult": { "sidPath": "C64Music/MUSICIANS/Test_Artist/test1.sid" } }
  }
}
```

- `pacingSeconds` defaults to 3; each executor enforces one interaction every 3 seconds (Playwright uses waits; k6 uses `sleep(3)`).
- Action vocabulary stays DOM-oriented (`navigate`, `click`, `type`, `waitForText`, `selectTrack`, `startPlayback`) so both executors can interpret consistently.
- Journey specs are versioned in git; runner copies the spec into each result folder for traceability.

## Client-Action → API Mapping (protocol-mode)

- Defined in `performance/executors/k6/action-map.ts` (configurable per environment).
- Examples:
  - `navigate "/"` → `GET /api/health` (sanity) to mirror page load.
  - `search` → `GET /api/search?q=<term>`.
  - `selectTrack` → `POST /api/play` with `sid_path`/metadata from `trackRefs`; response includes playback session + stream assets.
  - `startPlayback` → `GET session.streamUrl` or `fallbackHlsUrl` returned from `/api/play` to simulate SID streaming.
  - `favoriteToggle` → `POST/DELETE /api/favorites`.
  - `waitForText` → `GET /api/playback/detect` as a lightweight existence/progress poll.
- Mapping layer centralizes headers/auth tokens and lets k6 operate without DOM knowledge while still matching the user journey intent.

## Executors

### Playwright Executor (browser-mode)

- Input: journey spec + environment (base URL, auth, dataset).
- Generation: creates a temporary spec-specific script under `performance/tmp/playwright/<timestamp>/<journey>.spec.ts` that replays steps with Playwright APIs.
- Pacing: inserts `await page.waitForTimeout(pacingSeconds * 1000)` after each interaction to keep one action per 3 seconds.
- Concurrency: runs per-journey variants with 1 and 10 users (workers/parallel contexts), isolating storage/state per user.
- Outputs per variant (under `performance/results/<ts>/playwright/<journey>/u<users>/`):
  - `trace.zip` / `har.json` or `timings.json` for browser timing data.
  - Console/network logs as needed for debugging.

### k6 Executor (protocol-mode)

- Input: same journey spec + mapping.
- Generation: writes `performance/tmp/k6/<timestamp>/<journey>.js` using the mapping to call APIs instead of DOM clicks.
- Pacing: after each mapped action, inserts `sleep(3)` to guarantee one interaction per 3 seconds.
- Scenarios:
  - `u01` and `u10` mirror browser variants.
  - `u100` adds high-load backend coverage (browser not run at 100).
- Outputs per variant (under `performance/results/<ts>/k6/<journey>/u<users>/`):
  - `metrics.csv` (k6 CSV output).
  - `report.html` (self-contained HTML dashboard).
  - `summary.json` (k6 summary export) and summary stats always printed to stdout.
- HTML dashboard generation uses k6’s built-in web dashboard export:
  ```shell
  K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run script.js
  ```

## Unified Runner

- Reads journey specs, expands them into required variants, and triggers executor runs in the required order (Playwright 1/10 users → k6 1/10/100 users).
- Accepts environment flags (`--config` path, base URL, auth, dataset seeds, pacing override), reusing shared config loader.
- Produces a timestamped result root: `performance/results/YYYYMMDD-HHmmss/`.
  - Copies the exact spec into `journeys/`.
  - Stores generated scripts under `tmp/` for debugging (git-ignored).
  - Aggregates artifacts under executor-specific directories.
- Local mode: allow `--journey`/`--executor` filters and headful Playwright for debugging.
- Nightly mode: full matrix run with artifact collection + Markdown report emission.

## Summaries & Reporting

- Summarisation module (`performance/summary/index.ts`):
  - Reads k6 CSV files + `summary.json` to compute p50/p95/p99, throughput, error rates per journey/variant.
  - Reads Playwright `har.json` or `timings.json` to extract navigation/request timings and failure counts.
  - Emits `performance/results/<ts>/summary/summary.json` + `coverage.json` for LLM consumption.
- Markdown report (`performance/results/<ts>/report.md`):
  - Links to each CSV, HTML dashboard, browser timing artifact, and JSON summary.
  - Highlights p95/p99 deltas and error rates; flags regressions against previous runs when available.

## Nightly Pipeline Flow

1. Create timestamped result root; copy journey specs in.
2. Run Playwright executor for each journey with 1-user then 10-user variants (3s pacing).
3. Run k6 executor for each journey with 1/10/100-user variants (3s `sleep` pacing).
4. Run summarisation module to emit aggregated JSON.
5. Generate Markdown report referencing all artifacts in the result folder.
6. Upload artifacts (CSV, HTML dashboards, browser timings, JSON summaries, Markdown) to CI storage.

## Concurrency, Pacing, and Environment

- Pacing is enforced per interaction via `pacingSeconds` (default 3s) in both executors; runner prohibits faster pacing without explicit override.
- Concurrency limits per executor:
  - Playwright: 1 and 10 users per journey, configurable workers but default serialized per journey to avoid shared-state flakes.
  - k6: VU counts 1/10/100 with constant pacing; scenarios defined per journey to isolate metrics.
- Environment configuration pulled from shared loader (base URL, auth headers, dataset seeds, feature flags); runner resets config cache between executor phases to honor overrides.
- Target environments (with gating):
  - **Local (ad-hoc)** — default base URL from local dev server; supports headful Playwright and quick journey subsets.
  - **CI (nightly on GH runner)** — starts the web server inside the job (self-hosted in the workflow), then points both executors to that URL.
  - **Remote/staging/prod (future)** — accepts explicit base URL when `--env remote --base-url <url>` (or config equivalent) and an `--enable-remote` guard; disabled by default to avoid accidental prod hits. Runner must refuse remote runs unless both a base URL and the guard flag are present.

## Output Collection & Versioning

- All outputs live under `performance/results/<timestamp>/`, never overwritten.
- Artifact naming: `<journey>-u<users>-<executor>.<ext>` where appropriate to simplify Markdown linking.
- Markdown report references artifacts by relative paths inside the same timestamped folder, enabling easy browsing and archival.
