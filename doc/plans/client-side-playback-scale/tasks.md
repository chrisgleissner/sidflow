# Client-Side Playback Scale Migration Tasks

> Complete phases sequentially. Do not advance until all checkboxes in the current phase are verified (tests, reviews, and telemetry where applicable).

## Phase 0 – Architectural Readiness
- [ ] Inventory existing playback/session code paths (`packages/sidflow-web/app/api/play`, `lib/player/`, `lib/audio/`) and confirm SAB/HLS prerequisites (COOP/COEP headers, WASM asset hosting) are in place and documented.
- [ ] Map dependencies across `@sidflow/common`, `@sidflow/fetch`, `@sidflow/classify`, `@sidflow/train`, and confirm no server-side audio rendering remains in production builds.
- [ ] Define non-functional targets (latency, CPU, concurrency, storage limits) and document baseline metrics for current server workload.
- [ ] Draft playback facade design (interface, adapter responsibilities, dependency injection strategy) reviewed with engineering leads.

## Phase 1 – Persona Separation & Component Reuse
- [ ] Introduce role-aware routing (`/` vs `/admin`) with shared layout/components; verify Play/Prefs tabs render identically in both contexts with zero duplicated JSX/logic.
- [ ] Implement admin authentication middleware and add automated tests for unauthorized access, role escalation, and session expiry.
- [ ] Update design system (shadcn/ui) tokens to support persona-specific chrome while ensuring shared components inherit styles without overrides.

## Phase 2 – Public Local-First Experience
- [ ] Expand preferences schema (theme, ROM set, playback engine selection, Ultimate 64 configuration, training toggle, iteration budget, sync cadence) and persist to `localStorage` + IndexedDB with migration/versioning tests.
- [ ] Implement ROM manifest validation workflow (download, hash check, caching) plus error states for missing/invalid ROMs.
- [ ] Surface playback engine selector with availability checks (WASM default, sidplayfp CLI detection, streaming readiness, Ultimate 64 connectivity test) and automated fallback rules.
- [ ] Build offline/poor-network handling: queue playback requests, cache recent tracks, surface banner states, and add E2E tests covering offline/resume scenarios.
- [ ] Instrument playback path to ensure worklet pipeline never blocks UI thread (profiling + regression alerts) and confirm fallback HLS path triggers on browsers without SAB.

## Phase 3 – Local Feedback & Training
- [ ] Stand up client-side feedback store (IndexedDB) and background worker that batches implicit/explicit events without impacting playback latency.
- [ ] Integrate local TensorFlow.js fine-tuning using latest global model manifest; measure CPU budget (<5% average) and provide pause/resume controls tied to Preferences.
- [ ] Implement optional sync pipeline (upload deltas, retry/backoff, conflict resolution) and verify privacy guardrails (no raw personal data uploaded).
- [ ] Wire playback facade to feed consistent telemetry and feedback events regardless of adapter (WASM, CLI, streaming, Ultimate 64).

## Phase 4 – Admin Background Jobs & Data Governance
- [ ] Build job orchestration service (queues, manifests, resumable execution) wrapping `sidflow-fetch`, `sidflow-classify`, `sidflow-train`; include unit + integration coverage for restart/idempotency.
- [ ] Extend admin UI to monitor HVSC sync status, cache coverage, job progress/logs, and expose targeted backfill/invalidation actions.
- [ ] Publish model versioning workflow: train, evaluate, approve, and atomically expose new manifests/weights with rollback capability.
- [ ] Ensure canonical data (`data/classified`, `data/feedback`, `data/model`, manifests) update deterministically and append audit trail entries for all admin actions.
- [ ] Implement classify conversion pipeline to generate and publish streaming WAV/MP3 assets with manifests for availability checks.

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
