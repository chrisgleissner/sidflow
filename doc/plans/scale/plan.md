# Client-Side Playback Scale Migration Plan

## Required Reading
- `doc/developer.md` – developer setup, scripts, testing
- `doc/technical-reference.md` – architecture, APIs, data flow
- `doc/plans/scale/c64-rest-api.md` – C64 Ultimate REST control
- `doc/plans/scale/c64-stream-spec.md` – C64 Ultimate data streams (UDP)

## Scope & Objectives
- Deliver client-side SID playback for thousands of concurrent listeners while keeping the server responsible only for orchestration, cached assets, and administration.
- Maintain the existing HVSC → classify → train pipeline (`@sidflow/fetch`, `@sidflow/classify`, `@sidflow/train`) but ensure heavy computation is limited to admins and background jobs.
- Provide a consistent, component-reused UI where the public root (`/`) focuses on Play + Preferences and the admin path (`/admin`) adds orchestration, observability, and job controls without duplicating views.
- Preserve determinism of canonical data (`data/classified/*.jsonl`, `data/feedback/**/*.jsonl`, `data/model/*.json`, manifests) and ensure client-local state never overwrites it silently.

## Personas & Access Paths
| Path | Audience | Capabilities | Data Scope |
|------|----------|--------------|------------|
| `/` | Anonymous end user | Play, rate, adjust preferences, view playback status, implicit training controls | Local browser storage (IndexedDB/localStorage); read-only access to public APIs (`/api/play`, `/api/rate` limited metadata) |
| `/admin` | Authenticated operator | Full user experience **plus** fetch/classify/train dashboards, cache telemetry, job controls, health checks | Requires password or SSO; reads/writes canonical data, manages background jobs, inspects global telemetry |

## Shared Experience & Component Strategy
- Consolidate `packages/sidflow-web/app/page.tsx` into role-specific layouts that compose the same `PlayTab`, `PrefsTab`, and underlying stores (`preferences-store`, `playback-session`, `telemetry`) via a shared UI package (e.g., `components/public`).
- Extract persona-specific wrappers (e.g., `PublicShell`, `AdminShell`) that inject context (auth, permissions) but render the same tabs.
- Guard admin-only actions (Fetch/Classify/Train dashboards, telemetry detail charts) behind feature flags derived from an `AdminCapabilityContext` instead of branching inside components, ensuring component code paths remain single-source.

## Playback Facade Architecture
- Introduce a playback facade (`PlaybackService`) decoupling UI from transport specifics. Concrete adapters:
  - `WasmPlaybackAdapter` (default) – uses `libsidplayfp-wasm` AudioWorklet pipeline.
  - `SidplayfpCliAdapter` – shells out to locally-installed `sidplayfp` binary (requires availability check and error messaging).
  - `StreamingWavAdapter` / `StreamingMp3Adapter` – stream pre-rendered WAV/MP3 from server (cached assets produced during admin classify conversions).
  - `Ultimate64Adapter` – calls Ultimate 64 REST API to push SID to hardware (configurable IP/hostname + optional auth header/secret).
- Facade enforces common interface (`load`, `play`, `pause`, `stop`, telemetry hooks) so `PlayTab` and background rating workflows remain agnostic. Adapters registered through dependency injection based on user preference.
- Adapter selection validated at startup; unsupported modes surface actionable errors and fall back to default when possible.

## Public Playback Flow (`/`)
1. User loads `/` → Next.js middleware (`middleware.ts`) enforces COOP/COEP for SharedArrayBuffer (SAB) support.
2. Preferences bootstrap from `localStorage`/IndexedDB; apply theme (foreground/background/font) via CSS custom properties before first paint to avoid flash.
3. Play flow:
   - Client requests playlist or single track using existing `PlayRequestSchema`; `/api/play` (Next.js route) validates input, resolves SID path via `@sidflow/common`, and issues `createPlaybackSession` (15 min TTL).
   - Playback facade selects adapter per preferences:
     - **WASM**: fetch SID + ROM assets via `/api/playback/{id}/sid` and `/api/playback/{id}/rom/*`, stream into `libsidplayfp-wasm`.
     - **sidplayfp CLI**: enqueue command invocation via local bridge (Electron/WebView shell). UI warns if binary missing and offers fallback to WASM.
     - **WAV/MP3 streaming**: request `/api/playback/{id}/{format}` (new endpoints) delivering cached PCM/compressed assets generated via admin classify conversions; leverages browser `<audio>` with MediaSource.
     - **Ultimate 64**: REST call to configured hardware (`http(s)://<ip>/api/play`) with SID payload; include optional secret header from preferences.
   - Implicit events (`play`, `skip`) log locally immediately (IndexedDB queue) and asynchronously POST to `/api/rate/feedback` batch endpoint when online to avoid blocking playback.
4. Inline rating writes to local feedback store first; background sync persists aggregated actions to server canonical JSONL via admin-controlled ingestion (see “Feedback & Training”).
5. Offline mode: if `/api/play` unreachable, surface fallback state (cached queue, ability to play tracks stored locally if downloaded previously).

## Audio Conversion Tools

The Play (Client-side) and Render (Server-side) flows must support conversion of raw PCM samples (from libsidplayfp-wasm, sidplayfp, or a C64 Ultimate) into WAV and MP3 files.

### 1. PCM → WAV (TypeScript)
- Aggregate raw PCM samples (s16le, 44.1 kHz, stereo).
- Prepend a 44-byte RIFF/WAVE header.
- Save as `output.wav`.

### 2A. WAV → MP3 (TypeScript + WASM)
- **Tool:** `ffmpeg.wasm`
- **Use:** Portable, works in Node/Bun/browser without system dependencies.
```ts
import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";
const ffmpeg = createFFmpeg({ log: false });
await ffmpeg.load();
ffmpeg.FS("writeFile", "in.wav", await fetchFile("output.wav"));
await ffmpeg.run("-i","in.wav","-b:a","320k","out.mp3");
const mp3 = ffmpeg.FS("readFile","out.mp3");
```

### 2B. WAV → MP3 (Native)
- **Tool:** `ffmpeg` (libmp3lame)
- **Use:** System-level encoder for environments with native `ffmpeg` installed.
```bash
ffmpeg -i output.wav -b:a 320k output.mp3
```

> **Note:** Steps 2A and 2B are user-selectable options.  
> Choose 2A for portability (browser or sandboxed runtime), or 2B for native performance and integration with system binaries. MP3 bitrate is standardized at `320k` for MVP.

### Render vs Playback

- Render: the process that produces shareable audio assets (WAV/MP3) from SID inputs. Runs as admin jobs on the server or via hardware capture. Output feeds streaming endpoints and caches.
- Playback: end-user audio output in real time. Default is browser playback via `libsidplayfp-wasm`. Optional hardware playback via a locally accessible C64 Ultimate device is supported for local runs and enthusiasts.

### Render Matrix

| Location | Time      | Technology                         | Target              | Typical Use                            | Status |
|----------|-----------|------------------------------------|---------------------|----------------------------------------|--------|
| Server   | Prepared  | `sidplayfp` CLI (native)           | WAV + MP3 (320k)    | Batch classify conversions to cache     | MVP    |
| Server   | Prepared  | `libsidplayfp-wasm` (Node/Bun)     | WAV + MP3 (320k)    | Portable render where CLI unavailable   | Future |
| Server   | Prepared| C64 Ultimate (REST + UDP capture)  | WAV + MP3 (320k)    | Hardware-authentic captures             | MVP    |
| Server   | Real-time | C64 Ultimate (REST + UDP capture)  | WAV + MP3 (320k)    | Hardware-authentic live streams           | MVP    |
| Client   | Real-time | `libsidplayfp-wasm` (browser)      | N/A (playback only) | Default playback                        | MVP    |
| Client   | Real-time | `sidplayfp` CLI (local bridge)     | N/A (playback only) | Optional local playback                 | Future |
| Client   | Real-time | C64 Ultimate (direct hardware play)| N/A (device plays)  | Local hardware playback                 | MVP    |

### Render Caching and User Preferences

- Filenames must encode renderer, chip, and encoding:
  `$name[-$trackIndex]-$platform-$chip.$encoding`
  - `$name`: SID base name
  - `$trackIndex`: 1-based index, omit if single-track
  - `$platform`: sidplayfp | c64u
  - `$chip`: 6581 | 8580r5
  - `$encoding`: wav | mp3
  - Examples:
    - foo-2-sidplayfp-6581.wav
    - foo-c64u-6581.wav
    - foo-3-c64u-8580r5.mp3
- Expose available render variants to users.
- User prefs:
  - Rendering: (1) HW if available, else SW [default]; (2) HW only
  - Chipset:
    1. Use song metadata; if unspecified, default to 6581 [default]
    2. Use song metadata; if unspecified, default to 8580R5
    3. Always use 6581
    4. Always use 8580R5
- Cache all server-produced audio files (converted from SID) for reuse; avoid redundant rendering.
  - Supported cache formats: **WAV**, **FLAC**, and **MP3** — any combination can be enabled.
  - By default, only **MP3** and **FLAC** are cached; **WAV** caching is optional and disabled by default.
  - Disk caching thresholds must be configurable:
    - Default: stop caching WAV at **70%** total disk usage.
    - Default: stop caching FLAC at **80%** total disk usage.
    - Default: stop all caching (including MP3 and FLAC) at **90%** total disk usage.
  - Respect the user-configurable max disk use (default: 90%) and terminate rendering with a clear error message if the threshold is reached.
  - MP3 bit rate must be configurable (default: **320 kbps**).
  - Caching decisions are based solely on current disk usage; no usage tracking or eviction logic is required.


## Preferences & Persistence
- Preferences schema expands to include UI theming, ROM selection, playback engine choice, Ultimate 64 device configuration (IP/port, HTTPS flag, optional auth header), local training toggles, iteration budget, and sync cadence. Represent them as a versioned record stored in `localStorage` (for fast bootstrap) with a mirrored IndexedDB object store (for validation history and rollback).
- ROM selection validation:
  - Public persona: provide curated ROM bundles hashed server-side. Preference UI lists allowed `(basic, kernal, chargen)` combinations with SHA-256 fingerprints pulled from `/api/prefs/rom-manifest`. Client validates downloaded ROM bytes against manifest before enabling playback.
  - Admin persona: can upload new ROM bundles via `/admin` panel; server-side validation reuses `readSidplayfpConfig` and ensures new files are saved under secured storage (`/workspace/roms`).
- Playback engine validation:
  - WASM: always available if browser supports SAB. Detect support and set as default.
  - `sidplayfp` CLI: run detection routine on first selection; store error state if binary missing/not executable.
  - Streaming formats: only selectable once server reports asset availability for requested SID (requires classify conversion job completion).
  - Ultimate 64: verify IP reachability and optional secret header via test endpoint; surface latency warnings.
- Startup application: on hydrate, `PreferencesProvider` loads persisted preferences, applies CSS variables, primes `WorkletPlayer` with ROM asset URLs, and triggers local training scheduler if enabled.

## Feedback & Training (Public Persona)
- Local feedback store: IndexedDB `sidflow-feedback` with stores for `ratings`, `implicitEvents`, and `modelSnapshots`. Each record links to SID path and includes timestamp and model version used.
- Background web worker consumes feedback records, updates an in-browser TensorFlow.js model fine-tuned from the latest base model manifest (downloaded from `/api/train/model` when admin publishes). Training parameters (iterations, learning rate, compute budget) come from Preferences and run during idle time (use `requestIdleCallback` with CPU guard).
- Playback continues using cached inference results; ratings update queue ensures predictions refresh asynchronously without blocking audio.
- Optional sync: if user opts in, local deltas upload periodically to `/api/feedback/upload` (authenticated via per-session token). Server merges contributions into canonical JSONL with dedupe by UUID.

## Admin Surface (`/admin`)
- Authentication: Next.js middleware on `/admin` enforces password/SSO (e.g., `Authorization: Basic` backed by environment secret) and rate limits login attempts.
- Layout reuses public tabs plus adds admin navigation (e.g., “Jobs”, “Telemetry”, “Caches”). Play and Prefs tabs render identically but display additional instrumentation when `adminMode=true`.
- Fetch/Classify controls:
  - UI drives job orchestration service (server module wrapping `@sidflow/fetch.syncHvsc`, `@sidflow/classify`). Commands enqueue jobs with explicit job IDs persisted under `tmp/jobs/*.json`.
  - Provide resumable execution by persisting progress markers (e.g., last processed HVSC delta, classification shard). Re-run uses same job ID to continue.
  - File system writes stay under configured cache roots (HVSC mirror, WAV cache) with `@sidflow/common.ensureDir` to guarantee idempotency.
- Render engine: When rendering SID files to their WAV and MP3 equivalents, one of the following engines can be selected:
  - libsidplayfp-wasm (default): WASM version of libsidplayfp. Requires no further tooling.
  - sidplayfp CLI tool: Requires installation of CLI tool. Faster than libsidplayfp-wasm.
  - C64 Ultimate Hardware: Most authentic, but requires C64 Ultimate or Ultimate 64 and uses its [REST API](./c64-rest-api.md) and [Audio Stream Protocol](./c64-stream-spec.md):
    1. Correct hardware SID chip is activated on C64 Ultimate via REST as specified in SID song: `6581` (default if not specified) or `8580R5`
    1. SID sent to C64 via REST API
    1. Audio streaming start requested via REST API
    1. Audio stream UDP packets captured and transformed into WAV and 320 kbps MP3 (ideally concurrently). 
- Train controls: extend to accept dataset filters, schedule GPU/offline runs, and publish new model versions. Publishing writes new `data/model/` artifacts and updates manifest served to clients.
- Health & metrics: embed dashboards that call `/api/admin/metrics` for queue depth, job status, cache freshness, and worker health (CPU, memory). Include manual invalidation/backfill triggers (e.g., “Rebuild WAV cache chunk”).

## Global Data & Model Management
- Canonical store hierarchy remains as documented in `doc/artifact-governance.md`: 
  - HVSC + WAV cache on disk (derived, not in Git).
  - `data/classified/*.jsonl` and `data/feedback/**/*.jsonl` committed as canonical.
  - `data/model/*` as manifests/weights (model JSON only committed when needed).
- Precedence rules:
  1. **Global base model** (trained/published by admin) is authoritative starting point for all clients.
  2. **Local personal model delta** runs on top; inference uses local delta if recency < TTL (configurable, default 7 days) else rehydrate from latest global model.
  3. Conflicts: if admin publishes newer base model, client snapshots mark previous local delta as stale; next idle window retrains using new baseline.
- Admin can ingest anonymized local deltas by bundling weight updates plus metadata into training dataset; ingestion pipeline validates schema via `@sidflow/common.validateFeedbackLogs` before merging.

## Playback & Asset Delivery
- Session descriptors served via `/api/play` referencing `createPlaybackSession` with TTL to limit stale access. For scale, serve SID binaries through CDN-backed static route once session validated (issue signed URLs or tokenized headers).
- Extend playback APIs:
  - `/api/playback/{id}/sid` (existing) for WASM/Ultimate 64.
  - `/api/playback/{id}/wav` and `/api/playback/{id}/mp3` streaming endpoints returning ranged responses with long-lived caching headers (assets generated during classify conversions).
  - `/api/playback/{id}/handoff/ultimate64` to broker hardware dispatch when clients cannot reach device directly (optional).
- Ensure `Cross-Origin-Resource-Policy: same-origin` and HTTP caching (`Cache-Control: private, max-age=30`) remain as in `playback-session.ts`, but front additional CDN caching for static ROM bundles, WASM assets, and streaming audio.
- HLS/AAC fallback remains available for browsers lacking SAB; playback facade maps this to streaming adapter internally.
- Thousands of concurrent users rely on edge caching for static assets and minimal server compute (only session metadata). Rate limit session creation and enforce per-adapter quotas (e.g., `sidplayfp` CLI not available on shared devices by default).

## Background Jobs & Idempotency
- Job manager provides CRUD for jobs with `pending | running | completed | failed | paused` statuses stored in durable queue (e.g., SQLite file or JSON manifest).
- `sidflow-fetch` integration:
  - Checks HVSC manifest via `syncHvsc` (already idempotent with checksum verification).
  - Supports resumable delta application by tracking last applied version in manifest and verifying before applying new patch.
- `sidflow-classify` orchestration:
  - Shard classification by directory depth; worker pool (Bun worker threads) handles 8 concurrent renders while respecting CPU budgets.
  - Cache WAV + feature output; rerun should skip existing files unless `--force` set.
- `sidflow-train` orchestration:
  - Jobs load canonical JSONL, merge with staged external feedback, produce new model metadata with versioned semver. Training logs appended to `data/training/training-log.jsonl`.
- Reconciliation tasks monitor job manifests; if process dies mid-run, admin UI surfaces “resume” button using saved progress markers.

## Concurrency, Resilience & Failure Handling
- Playback sessions: TTL cleanup already in `playback-session.ts`. Scale by sizing Map evacuation and instrumenting eviction metrics. On expiry, client auto-requests new session if playback still active.
- Rated feedback queue: gracefully handles offline (stores events with `synced=false`). Exponential backoff for uploads; after 5 failures, user notified via toast with manual retry.
- Background jobs: enforce single-writer lock using `@sidflow/common/playback-lock` (or new `JobLock`) to prevent duplicate fetch/classify runs. Jobs run under Bun worker threads with heartbeats; if heartbeat missed, mark job `staled` and allow manual resume.
- Cache invalidation: Admin UI exposes “mark stale” action that triggers targeted reclassification/backfill.
- Disaster recovery: Document procedure to rebuild derived data (fetch HVSC, rebuild WAV cache, rerun classify, rerun train) using canonical JSONL + manifests.

## Telemetry & Observability
- Client telemetry:
  - `telemetry` module already tracks playback; extend to emit events for SAB fallback usage, underruns, queue latency. Ship via beacon endpoint `/api/telemetry` with batching and sampling for scale.
  - Measure preference changes, training iterations, sync success/failure.
- Server telemetry:
  - Track job durations, bytes downloaded, classification throughput, training loss metrics. Publish to `/api/admin/metrics` and push to logging backend (structured JSON).
  - Implement health probes for HVSC cache freshness (compare manifest timestamp) and WAV cache coverage (expected vs actual files).
- Alerting: thresholds (e.g., playback session creation errors >1% per 5 min, HVSC sync stale >7 days) notify admin via webhook/email.

## Access Control & Security
- `/admin` protected by configurable auth (initially password env var; future SSO). Store secrets outside repo, rotate via env injection.
- All admin APIs require CSRF protection (Next.js middleware) and audit log of actions (job starts/stops, model publishes) persisted to `data/audit/admin-actions.jsonl`.
- Public APIs sanitize paths to prevent directory traversal (already enforced by `resolveSidPath` using config). Continue to validate and restrict to configured HVSC root.
- Telemetry and feedback uploads rate-limited per client to mitigate abuse; implement request signing for optional authenticated channels.

## Acceptance Criteria
- **UX & Accessibility:** Public `/` loads play + prefs in <2s on 3G, supports keyboard navigation and ARIA labeling; offline and error banners present; admin UI hides administrative language on `/`.
- **Component Reuse:** 100% of Play and Preferences UI code shared between personas (verified by component import graph); admin adds features via wrappers only.
- **Playback Facade:** Playback facade provides uniform telemetry across adapters; switching engines in preferences updates active adapter on next session without reload; unsupported selections fall back gracefully with actionable messaging.
- **Local Persistence & Training:** Preferences persist between sessions; ROM manifests validated against hashes; local model training runs asynchronously without blocking playback (<5% CPU when active) and sync can be disabled.
- **Global Model Governance:** Admin can publish new model versions with metadata, clients detect and adopt within configured cadence; local deltas mark stale on new publish.
- **Background Jobs:** Fetch/Classify/Train jobs resumable, idempotent, and expose progress + logs in admin UI; cache directories remain consistent after interruption.
- **Scalability:** Load test demonstrates 5k concurrent playback sessions with <5% server CPU (mostly static asset serving), SAB path success rate ≥95%, streaming adapters sustain expected throughput, fallback HLS path functional on Safari/iOS.
- **Telemetry & Observability:** Playback, feedback, job metrics visible in admin dashboard; alerts configured for stale caches and high error rates.
- **Security & Compliance:** `/admin` requires auth, audit log entries for every admin action, preference storage complies with local-only storage (no PII leakage), and public UI surfaces no admin terminology.
- **Documentation:** Updated references in `doc/technical-reference.md`, `doc/developer.md`, and new admin guide covering job controls, model publishing, recovery steps.
