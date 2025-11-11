# Client-Side Playback Scale Migration Plan

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

## Public Playback Flow (`/`)
1. User loads `/` → Next.js middleware (`middleware.ts`) enforces COOP/COEP for SharedArrayBuffer (SAB) support.
2. Preferences bootstrap from `localStorage`/IndexedDB; apply theme (foreground/background/font) via CSS custom properties before first paint to avoid flash.
3. Play flow:
   - Client requests playlist or single track using existing `PlayRequestSchema`; `/api/play` (Next.js route) validates input, resolves SID path via `@sidflow/common`, and issues `createPlaybackSession` (15 min TTL).
   - Browser fetches SID bytes and ROM assets via `/api/playback/{id}/sid` and `/api/playback/{id}/rom/*`; Worklet pipeline loads them into `libsidplayfp-wasm` on dedicated Worker → AudioWorklet (see `lib/audio/worklet-player.ts`).
   - Implicit events (`play`, `skip`) log locally immediately (IndexedDB queue) and asynchronously POST to `/api/rate/feedback` batch endpoint when online to avoid blocking playback.
4. Inline rating writes to local feedback store first; background sync persists aggregated actions to server canonical JSONL via admin-controlled ingestion (see “Feedback & Training”).
5. Offline mode: if `/api/play` unreachable, surface fallback state (cached queue, ability to play tracks stored locally if downloaded previously).

## Preferences & Persistence
- Preferences schema expands to include UI theming, ROM selection, local training toggles, iteration budget, and sync cadence. Represent them as a versioned record stored in `localStorage` (for fast bootstrap) with a mirrored IndexedDB object store (for validation history and rollback).
- ROM selection validation:
  - Public persona: provide curated ROM bundles hashed server-side. Preference UI lists allowed `(basic, kernal, chargen)` combinations with SHA-256 fingerprints pulled from `/api/prefs/rom-manifest`. Client validates downloaded ROM bytes against manifest before enabling playback.
  - Admin persona: can upload new ROM bundles via `/admin` panel; server-side validation reuses `readSidplayfpConfig` and ensures new files are saved under secured storage (`/workspace/roms`).
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
- Ensure `Cross-Origin-Resource-Policy: same-origin` and HTTP caching (`Cache-Control: private, max-age=30`) remain as in `playback-session.ts`, but front additional CDN caching for static ROM bundles and WASM assets under `/public/wasm`.
- Implement HLS/AAC fallback:
  - Admin job optionally pre-generates HLS playlists to `/public/hls/{sidHash}/index.m3u8`.
  - `/api/play` advertises fallback URLs when available; client chooses based on SAB support (feature detection).
- Thousands of concurrent users rely on edge caching for static assets and minimal server compute (only session metadata). Rate limit session creation to protect from abuse (e.g., sliding window per IP).

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
- **Local Persistence & Training:** Preferences persist between sessions; ROM manifests validated against hashes; local model training runs asynchronously without blocking playback (<5% CPU when active) and sync can be disabled.
- **Global Model Governance:** Admin can publish new model versions with metadata, clients detect and adopt within configured cadence; local deltas mark stale on new publish.
- **Background Jobs:** Fetch/Classify/Train jobs resumable, idempotent, and expose progress + logs in admin UI; cache directories remain consistent after interruption.
- **Scalability:** Load test demonstrates 5k concurrent playback sessions with <5% server CPU (mostly static asset serving), SAB path success rate ≥95%, fallback HLS path functional on Safari/iOS.
- **Telemetry & Observability:** Playback, feedback, job metrics visible in admin dashboard; alerts configured for stale caches and high error rates.
- **Security & Compliance:** `/admin` requires auth, audit log entries for every admin action, preference storage complies with local-only storage (no PII leakage), and public UI surfaces no admin terminology.
- **Documentation:** Updated references in `doc/technical-reference.md`, `doc/developer.md`, and new admin guide covering job controls, model publishing, recovery steps.
