# Client-Side Playback Scale Migration Tasks

Required reading (skim before starting any phase):
- `doc/plans/scale/plan.md`
- `doc/plans/scale/c64-rest-api.md`
- `doc/plans/scale/c64-stream-spec.md`
- `doc/technical-reference.md`
- `doc/developer.md`

> Phase gating: Complete phases sequentially. All checkboxes in the current phase must be done before advancing. Maintain ≥90% unit+integration test coverage for changed packages, ensure `bun run test:all` passes, and verify E2E smoke tests before moving to the next phase.

## Phase 0 – Architectural Readiness
- [x] Inventory existing playback/session code paths (`packages/sidflow-web/app/api/play`, `lib/player/`, `lib/audio/`) and confirm SAB/HLS prerequisites (COOP/COEP headers, WASM asset hosting) are in place and documented.
- [x] Map dependencies across `@sidflow/common`, `@sidflow/fetch`, `@sidflow/classify`, `@sidflow/train`, and confirm no server-side audio rendering remains in production builds.
- [x] Define non-functional targets (latency, CPU, concurrency, storage limits) and document baseline metrics for current server workload.
- [x] Draft playback facade design (interface, adapter responsibilities, dependency injection strategy) reviewed with engineering leads.

## Phase 1 – Persona Separation & Component Reuse
- [x] Introduce role-aware routing (`/` vs `/admin`) with shared layout/components; verify Play/Prefs tabs render identically in both contexts with zero duplicated JSX/logic.
- [x] Implement admin authentication middleware and add automated tests for unauthorized access, role escalation, and session expiry.
- [x] Update design system (shadcn/ui) tokens to support persona-specific chrome while ensuring shared components inherit styles without overrides.

## Phase 2 – Public Local-First Experience
- [x] Expand preferences schema (theme, ROM set, playback engine selection, Ultimate 64 configuration, training toggle, iteration budget, sync cadence) and persist to `localStorage` + IndexedDB with migration/versioning tests.
- [x] Implement ROM manifest validation workflow (local upload + hash check + caching) plus error states for missing/invalid ROMs.
- [x] Surface playback engine selector with availability checks (WASM default, sidplayfp CLI detection, streaming readiness, Ultimate 64 connectivity test) and automated fallback rules.
- [x] Build offline/poor-network handling: queue playback requests, cache recent tracks, surface banner states, and add E2E tests covering offline/resume scenarios.
- [x] Instrument playback path to ensure worklet pipeline never blocks UI thread (profiling + regression alerts) and confirm fallback HLS path triggers on browsers without SAB.
- [x] Standardize Playwright screenshot theming so all captures use the dark background, including resetting mutated themes between tests (`tests/e2e/screenshots.spec.ts`, README screenshot refresh).

## Phase 3 – Local Feedback & Training
- [ ] Stand up client-side feedback store (IndexedDB) and background worker that batches implicit/explicit events without impacting playback latency.
- [ ] Integrate local TensorFlow.js fine-tuning using latest global model manifest; measure CPU budget (<5% average) and provide pause/resume controls tied to Preferences.
- [ ] Implement optional sync pipeline (upload deltas, retry/backoff, conflict resolution) and verify privacy guardrails (no raw personal data uploaded).
- [ ] Wire playback facade to feed consistent telemetry and feedback events regardless of adapter (WASM, CLI, streaming, Ultimate 64).

## Phase 4 – Admin Background Jobs & Data Governance
- [ ] Build job orchestration service (queues, manifests, resumable execution) wrapping `sidflow-fetch`, `sidflow-classify`, `sidflow-train`; include unit + integration coverage for restart/idempotency.
- [ ] Define render-engine orchestration covering `libsidplayfp-wasm`, optional `sidplayfp` CLI, and Ultimate 64 hardware playback: automate CLI availability checks, surface graceful fallbacks, and document the Ultimate 64 REST/workflow using `doc/plans/scale/c64-rest-api.md`.
- [ ] Capture UDP audio from the Ultimate 64 stream, transform it into WAV/M4A/FLAC assets, and publish availability manifests referencing the packet/stream nuances documented in `doc/plans/scale/c64-stream-spec.md`.
- [ ] Design UDP capture pipeline to track packet sequence numbers, reorder out-of-order deliveries, and detect/compensate for missing packets before transcoding to PCM.
- [ ] Build resiliency around UDP packet loss: time-based buffering and minimal gap handling; log basic packet loss metrics.
- [ ] Implement the TypeScript PCM→WAV pipeline (44-byte RIFF header + aggregated s16le samples) so render jobs can materialize `output.wav` for downstream encoding.
- [ ] Provide WAV→M4A and WAV→FLAC conversion paths: `ffmpeg.wasm` for portable builds and native `ffmpeg` for optimized runners; basic tests for both.
- [ ] Standardize M4A bitrate at 256k across encoders and configuration; add a smoke test validating target bitrate in produced files.
- [ ] Expose Render Mode selection (location, time, technology, target) in admin job configuration; validate and reject unsupported combinations per Render Matrix.
- [ ] Extend admin UI to monitor HVSC sync status, cache coverage, job progress/logs, and expose targeted backfill/invalidation actions.
- [ ] Publish model versioning workflow: train, evaluate, approve, and atomically expose new manifests/weights with rollback capability.
- [ ] Ensure canonical data (`data/classified`, `data/feedback`, `data/model`, manifests) update deterministically and append audit trail entries for all admin actions.
- [ ] Implement classify conversion pipeline to generate and publish streaming WAV/M4A/FLAC assets with manifests for availability checks.

### Phase 4 – Acceptance Criteria (MVP)
- Render Engine Orchestration: selecting a render mode from the Render Matrix validates against supported combinations; unsupported selections are rejected with actionable errors.
- Ultimate 64 capture: UDP pipeline reorders out-of-order packets and fills gaps minimally; basic packet-loss rate is logged; jobs succeed despite ≤1% loss and fail fast above a configurable threshold.
- PCM→WAV/M4A/FLAC: WAV files open in standard players; M4A encodes at 256k (smoke test verifies bitrate/codec); FLAC is crated successfully and is structurally correct; both paths (`ffmpeg.wasm` and native ffmpeg) are exercised in CI on at least one platform each.
- Manifests: generated assets are discoverable via availability manifests and are referenced by `/api/playback/{id}/{format}` endpoints.
- Tests: unit+integration coverage ≥90% for changed packages; E2E covers one end-to-end capture→encode→stream happy path.

## Phase 5 – Observability, Scalability & Resilience
- [ ] Implement telemetry endpoints (client beacon + admin metrics) and dashboards tracking playback success, underruns, job KPIs, cache freshness, and sync health.
- [ ] Define alert thresholds and automated notifications for degradation (session failures, stale HVSC cache, job stalls, high CPU/memory).
- [ ] Execute load tests simulating ≥5k concurrent sessions (mix of WASM, streaming, and Ultimate 64 handoffs), validate CDN/offload strategy, and capture resulting CPU/memory utilization.
- [ ] Conduct failure injection drills (job crash, cache corruption, network outage) and document recovery steps validated via runbooks.
- [ ] Add health checks for each playback adapter (WASM readiness, sidplayfp binary status, streaming asset availability, Ultimate 64 endpoint health) with alert integration.

## Phase 6 – Launch & Documentation
- [ ] Update `doc/technical-reference.md`, `doc/developer.md`, and produce new admin operations guide covering job controls, model publishing, incident response.
- [ ] Finalize accessibility review (keyboard navigation, ARIA labels, color contrast) for both personas and fix gaps.
- [ ] Complete security review: auth secret storage, rate limits, telemetry anonymization, audit logs; address findings.
- [ ] Sign off on rollout checklist (performance targets met, telemetry live, docs published, runbooks approved) before enabling public access.
