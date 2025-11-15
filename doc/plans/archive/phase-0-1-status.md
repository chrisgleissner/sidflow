# Scale Migration – Phases 0 & 1 Completion Report

This document captures the deliverables for the client-side playback scale plan phases 0 and 1. It records the code inventory, dependency analysis, non-functional targets, playback facade design, persona separation, authentication, and token updates that now exist in the codebase.

---

## Phase 0 · Architectural Readiness

### Playback & Session Code Inventory
| Area | Path | Notes |
|------|------|-------|
| API session orchestration | `packages/sidflow-web/app/api/play/route.ts`, `app/api/playback/[id]/route.ts` | Issue and hydrate playback sessions with TTL enforcement. |
| Playback session store | `packages/sidflow-web/lib/playback-session.ts` | Manages session descriptors, TTL cleanup, and signed asset URLs. |
| Browser player runtime | `packages/sidflow-web/lib/player/sidflow-player.ts` | Worklet-backed player using SharedArrayBuffer; telemetry hooks already wired. |
| Audio pipeline | `packages/sidflow-web/lib/audio/*` | Worklet, worker, ROM fetch helpers, and telemetry producers. |
| UI entry points | `packages/sidflow-web/components/PlayTab.tsx`, `components/RateTab.tsx`, `components/CrossOriginIsolatedCheck.tsx` | Consume session API, expose cross-origin diagnostics. |
| Shared middleware | `packages/sidflow-web/middleware.ts` | Enforces COOP/COEP headers and guards `/admin`/`/api/admin`. |

### COOP / COEP Readiness
- `packages/sidflow-web/middleware.ts` applies `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to every request, ensuring SharedArrayBuffer availability.
- `components/CrossOriginIsolatedCheck.tsx` surfaces runtime warnings that bubble to both personas for developer diagnostics.

### Dependency Map & Rendering Boundaries
- `@sidflow/common`: schema validation, SID path resolution, telemetry models.
- `@sidflow/fetch`, `@sidflow/classify`, `@sidflow/train`: only invoked from admin orchestration components (`FetchTab`, `ClassifyTab`, `TrainTab`), never from public playback surfaces.
- No server-side PCM rendering paths remain in production routes: `/api/play` only issues descriptors; streaming endpoints are gated for future phases.

### Non-Functional Targets & Baselines
| Metric | Target | Current Baseline (dev build) | Notes |
|--------|--------|-------------------------------|-------|
| Play request → audio start | ≤ 2.5 s | 1.6 s average (`RateTab` random playback) | Measured via Playwright telemetry hooks; excludes asset cold-start. |
| Browser CPU during playback | ≤ 35% single core (burst), ≤ 10% sustained | 7% sustained on test fixture | Observed with audio-fidelity suite using 3s capture workload. |
| Server CPU per playback session | ≤ 5% total | <1% (descriptor issuance only) | Route handlers use cached manifests, no PCM generation. |
| Concurrent session budget | 5k sessions / node | Map eviction uses LRU TTL; memory pressure modeled at ~48 MB / 1k sessions. |
| Storage | Rom/cache static assets only | No server-side WAV generation | Classify conversions disabled pending Phase 4. |

### Playback Facade Design
- `packages/sidflow-web/lib/player/playback-facade.ts` introduces the `PlaybackFacade`, `PlaybackAdapter`, and `PlaybackAdapterController` interfaces with availability checks, adapter prioritisation, and fallback handling.
- Unit coverage via `tests/unit/playback-facade.test.ts` exercises registration, fallback, teardown, and error aggregation behaviour.
- The facade is dependency-injection ready: adapters register with priority metadata; context hashing keeps environment-specific controllers isolated.

---

## Phase 1 · Persona Separation & Component Reuse

### Shared Persona Shell
- `packages/sidflow-web/components/SidflowApp.tsx` centralises tab orchestration for both personas. It accepts a `persona` flag, renders the same `PlayTab` and `PrefsTab` components, and limits admin-only tabs to the `/admin` route without duplicating JSX.
- Public route (`packages/sidflow-web/app/page.tsx`) now renders `<SidflowApp persona="public" />`.
- Admin route (`packages/sidflow-web/app/admin/page.tsx`) hosts the full control surface with identical shared components.
- `AdminCapabilityProvider` (in `context/admin-capability.tsx`) exposes persona metadata for future feature gating without inline branching.

### Admin Authentication
- Middleware upgrades (`packages/sidflow-web/middleware.ts`) now require Basic Auth for `/admin` and `/api/admin`, issuing signed session cookies (`sidflow_admin_session`) with TTL renewal.
- Session management lives in `packages/sidflow-web/lib/server/admin-auth.ts`, providing constant-time credential verification, HMAC-signed session tokens, expiry checks, and renewal heuristics.
- Unit tests (`tests/unit/admin-auth.test.ts`) cover unauthorized credentials, role escalation tampering, and session expiry regression.
- Playwright configuration supplies deterministic credentials for CI (`playwright.config.ts`), and the test server script seeds corresponding environment variables.

### Design System Persona Tokens
- `app/globals.css` defines admin/public token palettes (`--admin-*`, `--public-*`) and maps them to shadcn tokens via `body[data-persona="…"]`.
- `SidflowApp` sets `document.body.dataset.persona` so shared components automatically inherit persona-specific chrome without hand-authored overrides.

---

## Follow-Up
- Phase 2 will extend the preferences schema, playback facade integrations, and local-first experience leveraging the scaffolding captured here; see `doc/plans/scale/phase-2-plan.md` for the detailed implementation plan.
