# Phase 2 – Public Local-First Experience Implementation Plan

## Goals
- Deliver a preferences and playback experience that boots instantly on the client, survives offline/poor connectivity, and defers to the server only for orchestration and asset retrieval.
- Keep public persona flows (`/` routes) functional with zero admin dependencies while preserving deterministic canonical data on the server.
- Provide the scaffolding required by future phases (local feedback + training) without blocking current deliverables.

## Success Criteria
- Preferences load from local storage on first paint, migrate transparently between schema versions, and mirror to IndexedDB without data loss.
- ROM bundles are validated against server-provided manifests before enabling playback; invalid or stale files fail fast with actionable guidance.
- Users can select an available playback engine; unsupported selections fall back automatically and emit telemetry for follow-up.
- Offline or degraded network conditions retain queue state, cache recent tracks, and surface status banners without crashing the player.
- Worklet audio pipeline keeps the UI thread responsive (<2 ms frame budget impact); fallback HLS path activates on SAB-incompatible browsers.

## Current Gaps (Baseline)
- Preferences persist only via `.sidflow-preferences.json` on the server; browser-side local storage supports theme/font only and lacks schema/migration.
- No IndexedDB layer exists for public persona to buffer queue, tracks, or feedback.
- ROM validation relies on manual file path inputs rather than manifest-approved bundles.
- Playback adapter availability checks are manual; `PlaybackFacade` exposes registration but not yet persona-aware selection.
- Offline handling is limited to standard fetch retries; the play queue and rate flow assume online connectivity.

## Phase 2 Workstreams

### 1. Preferences Schema & Storage
- Define a versioned `BrowserPreferences` schema in `packages/sidflow-web/lib/preferences/schema.ts` using `zod`; include `version` and `migratedFrom` fields.
- Target schema fields:
  - `theme`: `'system' | 'c64-light' | 'c64-dark' | 'classic'`.
  - `font`: `'c64' | 'mono' | 'sans'`.
  - `romBundleId`: string identifier from manifest (nullable).
  - `playbackEngine`: `'wasm' | 'sidplayfp-cli' | 'stream-wav' | 'stream-m4a' | 'ultimate64'`.
  - `ultimate64`: `{ host: string; https: boolean; secretHeader?: string } | null`.
  - `training`: `{ enabled: boolean; iterationBudget: number; syncCadenceMinutes: number; allowUpload: boolean }`.
  - `localCache`: `{ maxEntries: number; maxBytes: number; preferOffline: boolean }`.
  - `lastSeenModelVersion`: string | null.
- Build migration helpers (`migratePreferences`) that accept persisted records and return the current schema; maintain inline unit tests in `packages/sidflow-web/tests/unit/preferences-schema.test.ts`.
- Implement `PreferencesStore` abstraction in `packages/sidflow-web/lib/preferences/store.ts`:
  - Primary bootstrap reads from `localStorage` (`sidflow.preferences` deterministic key via `stringifyDeterministic`).
  - Secondary mirror to IndexedDB (use `idb` package already in repo or add minimal wrapper) under store `sidflow-local` with object store `preferences` (single key `'current'`).
  - Expose async API: `loadPreferences()`, `savePreferences(next)`, `subscribe(listener)` for UI hooking.
- Update `SidflowApp` to load preferences before rendering child tabs; add suspense fallback for first paint.
- Keep server-side `.sidflow-preferences.json` for admin persona only; expose conversion utilities so admin settings can seed browser defaults when necessary.

### 2. ROM Manifest Validation
- Create manifest builder in `packages/sidflow-web/lib/server/rom-manifest.ts` leveraging `@sidflow/common/loadConfig` to locate curated ROM bundles under `workspace/roms`.
  - Manifest shape: `{ version: string; bundles: Array<{ id: string; label: string; basic: RomEntry; kernal: RomEntry; chargen: RomEntry; defaultChip: '6581' | '8580r5'; }>; }` where `RomEntry` includes absolute path (server), SHA-256 hash, size, and lastModified.
  - Serialize using `stringifyDeterministic` and memoize per request.
- Add API route `packages/sidflow-web/app/api/prefs/rom-manifest/route.ts` returning manifest with cache headers (`Cache-Control: private, max-age=300`).
- Client workflow:
  - `PrefsTab` fetches manifest via new `useRomManifest` hook; manifest entries populate ROM selection UI.
  - When a user selects a curated bundle, prompt them to supply their own BASIC/KERNAL/CHARGEN ROM files locally; validate hashes against the manifest before persisting to IndexedDB (`rom-bundles`, keyPath `['bundleId','file']`).
  - For `manual` bundles, allow the user to associate arbitrary ROM paths while still storing validation metadata locally.
  - Expose status messages (validating, hash mismatch, download failed) through existing `onStatusChange` callback.
- When preferences reference invalid bundle or hash mismatch occurs, block playback and show inline remediation (retry download, choose different bundle).

### 3. Playback Engine Selection & Availability
- Extend `PlaybackFacade` (`packages/sidflow-web/lib/player/playback-facade.ts`) to surface `checkAvailability(persona, preferences)` promise for each adapter.
  - WASM adapter: ensure SharedArrayBuffer supported; fall back to HLS if not.
  - `sidplayfp` CLI adapter: add detection endpoint `app/api/playback/detect/route.ts` that probes server-side bridge or returns unsupported; cache result per session.
  - Streaming adapters: require streaming manifest for SID path (`/api/playback/{id}/wav|m4a` HEAD request) before marking available.
  - Ultimate 64: perform reachability ping (`/api/play/ultimate64/test` hitting device or returning status) with timeout and report latency.
- Update preferences UI to show availability badges (`Available`, `Unavailable`, `Requires Setup`) and auto-select highest priority available engine.
- On playback start, the facade should:
  - Re-check availability if last probe older than configurable TTL (default 5 minutes).
  - Emit telemetry event (`playback_adapter_selection`) via existing telemetry pipeline.
  - Fall back to next adapter if `load()` rejects; surface toast with reason and new adapter choice.

### 4. Offline & Poor-Network Handling
- Implement `PlaybackRequestQueue` in `packages/sidflow-web/lib/offline/playback-queue.ts`:
  - Store queue entries (`{ request: PlayRequest; enqueuedAt: number; status: 'pending' | 'sent' | 'failed'; }`) in IndexedDB store `playback-queue`.
  - Expose API to enqueue new requests, flush when online, and mark failed entries with retry backoff.
- Cache last N playback sessions (configurable via preferences `localCache.maxEntries`, default 25) in store `playback-cache` with SID metadata + resolved asset URLs.
- Register Service Worker (`packages/sidflow-web/public/sw.js`) to intercept `/api/play` calls:
  - When offline, if matching cached session exists, return cached descriptor and mark playback as offline.
  - Otherwise enqueue request and show offline banner via new `OfflineNotice` component.
- Add UI state management to `PlayTab`:
  - Show banner when offline or queue length > 0.
  - Provide manual “Retry queued requests” button.
  - Display cached track list with ability to clear entries.
- Implement profile for slow network using `navigator.connection` when available; degrade by prefetching assets in background and postponing large downloads.
- Ensure Rate tab handles offline by caching implicit events (prework for Phase 3) but only acknowledging toasts after local persistence.

### 5. Worklet Telemetry & SAB Fallback
- Instrument `packages/sidflow-web/lib/player/sidflow-player.ts` to emit `performance.mark` entries for `worklet-init`, `sid-load`, `buffer-ready`; aggregate into telemetry events batched via existing `/api/telemetry` stub.
- Add `WorkletGuard` utility that measures main-thread frame drops using `requestAnimationFrame` delta; log warning if >2 ms average over 120 frames.
- Implement HLS fallback adapter using `<audio>` element + Media Source; register with facade at lower priority and automatically select when SAB unsupported.
- Provide regression alert by adding Playwright performance test that visits `/` with SAB disabled (use `--disable-features=SharedArrayBuffer`) and asserts fallback path taken.

## Data Contracts
- Persisted preferences JSON structure stored under key `sidflow.preferences`:
```json
{
  "version": 2,
  "theme": "system",
  "font": "mono",
  "romBundleId": null,
  "playbackEngine": "wasm",
  "ultimate64": null,
  "training": { "enabled": false, "iterationBudget": 200, "syncCadenceMinutes": 60, "allowUpload": false },
  "localCache": { "maxEntries": 25, "maxBytes": 33554432, "preferOffline": false },
  "lastSeenModelVersion": null
}
```
- IndexedDB stores use deterministic keys:
  - `preferences`: key `'current'`, value `{ data: BrowserPreferences; updatedAt: number; }`.
  - `rom-bundles`: key `[bundleId, fileName]`, value `{ hash: string; bytes: ArrayBuffer; updatedAt: number; }`.
  - `playback-queue`: auto-increment, value `PlaybackQueueEntry` with retry metadata.
  - `playback-cache`: key SID path, value `CachedPlaybackSession` including descriptor and expiry timestamp.

## API & Routing Additions
- `GET /api/prefs/rom-manifest` – Returns manifest; gated by admin auth for `/admin`, public read-only for `/`.
- `GET /api/playback/rom/[bundleId]/[file]` – Admin-only helper to deliver curated ROM bytes to trusted rendering jobs; must remain disabled for public personas.
- `GET /api/playback/detect` – Reports adapter availability (`{ wasm: true, sidplayfpCli: false, streamWav: boolean, streamM4a: boolean, ultimate64: { supported: boolean, latencyMs?: number } }`).
- `POST /api/playback/offline/report` – Optional endpoint for clients to report queued requests and flush when back online (future-proof for Phase 3, stubbed now).
- Ensure each route loads config via `@sidflow/common/loadConfig`, reads/writes with `ensureDir`/`pathExists`, and serializes responses deterministically.

## Testing Strategy
- Unit tests:
  - Preferences schema migrations (`preferences-schema.test.ts`).
  - ROM manifest builder (`rom-manifest.test.ts`) using fixture bundles.
  - Playback facade availability logic (`playback-facade.test.ts`) with mocked adapters.
  - Offline queue operations (`offline/playback-queue.test.ts`).
- Integration tests (Bun):
  - Service worker offline replay using `packages/sidflow-web/tests/integration/offline-playback.test.ts`.
  - ROM manifest + validation flow with temporary bundle directory.
- Playwright E2E:
  - Offline scenario: toggle network offline, queue request, return online, assert playback resumes.
  - SAB-disabled scenario: ensure HLS fallback.
  - Ultimate 64 config UI: enters host, sees reachability result (use mocked endpoint).
- Maintain ≥90% coverage delta; update `bun run test:all` and `bun run test:e2e` to include new suites.

## Telemetry & Observability
- Extend telemetry payloads in `packages/sidflow-web/lib/telemetry/client.ts`:
  - `playback_adapter_selection`, `offline_queue_event`, `rom_validation_result`.
- Ensure `/api/telemetry` batches include persona and preference version for debugging.
- Admin UI additions: small widget on `/admin` showing adapter availability stats and offline queue backlog counts (read-only for now).

## Risks & Mitigations
- **Large IndexedDB storage**: enforce `localCache.maxBytes` guard; prune oldest entries before storing new ones.
- **Manifest drift**: include `version` + `generatedAt` in manifest; clients invalidate cached bundles when version changes.
- **Ultimate 64 reachability false positives**: implement exponential backoff and surface manual override to disable hardware.
- **Service worker complexity**: keep SW scoped to `/` and isolate logic to avoid interfering with admin persona; provide feature flag to disable in dev via `NEXT_PUBLIC_DISABLE_SW`.

## Deliverables Checklist
- Preferences schema modules, migrations, and UI integration.
- ROM manifest builder + API + client validation UI.
- Playback adapter availability detection integrated with facade and preferences.
- Offline queue + caching + service worker with banner UX.
- Telemetry hooks and tests exercising the new behaviour.

> Completion of these items unlocks Phase 3 (local feedback & training) by providing durable local state, manifest validation, and offline-safe playback queues.
