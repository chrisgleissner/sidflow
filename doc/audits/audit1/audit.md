# SIDFlow Production Readiness and Feature Completeness Audit

## 1. Executive Summary

Overall verdict: SIDFlow is a substantial and already useful CLI-first SID-analysis system with a working web surface, but it is not currently production-ready for a safe Fly.io rollout as a horizontally scaled web service.

Current Fly.io readiness verdict: not ready for production beyond a tightly controlled single-machine deployment with manual operations and explicitly accepted data-loss/state-loss risk.

100-concurrent-user verdict: not yet credible. The repository contains real performance tooling (`scripts/performance-runner.ts`, `packages/sidflow-performance`, `.github/workflows/performance.yml`), but the checked-in journeys and CI usage do not demonstrate sustained multi-user behavior for the actual application mix that matters: auth, search, favorites/playlists, playback session creation, HLS/WAV streaming, and admin-triggered long-running jobs.

Top 5 launch blockers:

1. Critical mutable state is split across process memory and local JSON files, which is unsafe for Fly rolling deploys or multi-machine scaling. Evidence: `packages/sidflow-web/lib/playback-session.ts`, `packages/sidflow-web/lib/classify-progress-store.ts`, `packages/sidflow-web/lib/fetch-progress-store.ts`, `packages/sidflow-web/lib/preferences-store.ts`, `packages/sidflow-web/lib/server/user-storage.ts`, `packages/sidflow-web/lib/server/playlist-storage.ts`.
2. Security defaults are not production-safe. Evidence: default admin password behavior in `packages/sidflow-web/lib/server/admin-auth-core.ts`; JWT secret fallback in `packages/sidflow-web/lib/server/jwt.ts`; optional auth/rate-limit bypass flags in `packages/sidflow-web/proxy.ts`.
3. Long-running work is still process-bound and only partially durable. Evidence: `/api/classify` child-process orchestration in `packages/sidflow-web/lib/classify-runner.ts`; fetch progress and classify progress stores are in-memory; scheduler is in-process in `packages/sidflow-web/lib/scheduler.ts`.
4. API/documentation maturity is incomplete for external consumers. Evidence: `packages/sidflow-web/openapi.yaml` documents only 5 routes while the actual app contains 60 API routes under `packages/sidflow-web/app/api`.
5. Recommendation quality/explainability is only partly real. Evidence: explanation placeholders in `packages/sidflow-web/lib/server/explain-recommendation.ts`; stub model fallback in `packages/sidflow-web/app/api/model/latest/route.ts`; many “advanced stations” are heuristics over a small E/M/C/P-style representation rather than a separately validated recommender system.

Top 5 strengths:

1. The repository has a coherent CLI-first architecture with explicit pipeline stages across fetch/classify/train/play packages, documented in `README.md` and `doc/technical-reference.md`.
2. The Docker production image is relatively disciplined: pinned Bun digest, checksum verification, non-root runtime, `tini`, and a healthcheck. Evidence: `Dockerfile.production`.
3. Operational startup checks are better than average for a hobby-stage repo: `scripts/docker-startup.sh` validates env, tools, directories, symlinks, and writes `sidplayfp.ini`.
4. The web/API surface is broader than the docs suggest and already includes auth, search, favorites, playlists, health, metrics, job inspection, playback detection, and several recommendation modes under `packages/sidflow-web/app/api`.
5. The codebase already produces source artifacts that can underpin a portable similarity export: classified JSONL, deterministic metadata, feedback JSONL, LanceDB-derived manifests, and similarity lookups. Evidence: `packages/sidflow-classify`, `packages/sidflow-common/src/lancedb-builder.ts`, `packages/sidflow-web/lib/server/similarity-search.ts`, `packages/sidflow-play/src/export.ts`.

## 2. Research Method

Docs reviewed:

- `AGENTS.md`
- `PLANS.md`
- `README.md`
- `doc/developer.md`
- `doc/technical-reference.md`
- `doc/deployment.md`
- `packages/sidflow-web/README.md`
- `packages/sidflow-web/openapi.yaml`

Code/config areas inspected:

- Deployment/config/runtime: `package.json`, `.sidflow.json`, `fly.toml`, `Dockerfile.production`, `scripts/deploy/fly-deploy.sh`, `scripts/build-docker.sh`, `scripts/docker-startup.sh`
- Web/API: route handlers under `packages/sidflow-web/app/api/**/route.ts`
- Auth/session/security: `packages/sidflow-web/proxy.ts`, `packages/sidflow-web/lib/server/admin-auth-core.ts`, `packages/sidflow-web/lib/server/jwt.ts`
- Persistence/state: `packages/sidflow-web/lib/preferences-store.ts`, `packages/sidflow-web/lib/server/user-storage.ts`, `packages/sidflow-web/lib/server/playlist-storage.ts`, `packages/sidflow-web/lib/playback-session.ts`, `packages/sidflow-web/lib/server/rate-limiter.ts`, `packages/sidflow-web/lib/server/search-index.ts`
- Background jobs/orchestration: `packages/sidflow-web/lib/classify-runner.ts`, `packages/sidflow-web/lib/classify-progress-store.ts`, `packages/sidflow-web/lib/fetch-progress-store.ts`, `packages/sidflow-web/lib/scheduler.ts`, `packages/sidflow-web/lib/server/scheduler-init.ts`, `packages/sidflow-common/src/job-orchestrator.ts`, `packages/sidflow-common/src/job-queue.ts`, `packages/sidflow-common/src/job-runner.ts`, `scripts/run-job-queue.ts`
- Recommendation/similarity/playback: `packages/sidflow-web/lib/server/similarity-search.ts`, `packages/sidflow-web/lib/server/explain-recommendation.ts`, `packages/sidflow-web/lib/server/adaptive-station.ts`, `packages/sidflow-web/lib/server/collaborative-filter.ts`, `packages/sidflow-web/lib/server/hidden-gems.ts`, `packages/sidflow-web/lib/server/mood-transition.ts`, `packages/sidflow-web/lib/server/remix-radar.ts`, `packages/sidflow-web/lib/server/composer-discovery.ts`, `packages/sidflow-web/lib/server/chip-model-stations.ts`, `packages/sidflow-web/lib/server/era-explorer.ts`, `packages/sidflow-web/lib/server/availability-service.ts`, `packages/sidflow-web/lib/server/hls-service.ts`, `packages/sidflow-web/lib/audio-cache-service.ts`
- Pipeline/data/modeling: `packages/sidflow-classify/src/index.ts`, `packages/sidflow-train/src/index.ts`, `packages/sidflow-play/src/index.ts`, `packages/sidflow-play/src/export.ts`, `packages/sidflow-common/src/lancedb-builder.ts`, `packages/sidflow-common/src/recommender.ts`
- WASM playback: `packages/libsidplayfp-wasm/src/player.ts`, `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts`
- Performance/ops: `scripts/performance-runner.ts`, `packages/sidflow-performance/src/index.ts`, `.github/workflows/performance.yml`

Search patterns used:

- `TODO`
- `FIXME`
- `placeholder`
- `stub`
- `not implemented`
- `fallback`
- `in-memory`
- `Redis`
- `singleton`
- `JSON-file`
- `rate limit`
- `queue`
- `worker`
- `Fly.io`
- `rolling`

Additional cross-repo inspection:

- High-level research in sibling repo `../c64commander` focused on Play-page track identity and playlist handling: `src/pages/PlayFilesPage.tsx`, `src/pages/playFiles/types.ts`, `src/pages/playFiles/hooks/usePlaylistManager.ts`, `src/pages/playFiles/hooks/useHvscLibrary.ts`, `src/lib/playlistRepository/types.ts`, `doc/research/playback-hvsc-research.md`.

Assumptions:

- This audit treats repository code and docs as the source of truth, not aspirational README claims.
- “Production-ready” is evaluated specifically for Fly.io deployment, rolling updates, operational recovery, and approximately 100 concurrent users.
- “Concurrent users” is treated as a mixed workload, not just raw HTTP connections to a single route.

## 3. Current Architecture Summary

SIDFlow is fundamentally a Bun/TypeScript monorepo built around a CLI-first pipeline:

1. `@sidflow/fetch` downloads or refreshes SID collections and related data.
2. `@sidflow/classify` renders/analyzes SID material and emits classification artifacts under `data/classified`.
3. `@sidflow/train` optionally trains a model or prepares model-related outputs under `data/model`.
4. `@sidflow/play` and the web app expose playback, recommendations, and playlist/export workflows.

Data flow today is file-centric. The system relies heavily on:

- `.sidflow.json` config loaded through `@sidflow/common`
- local workspace folders for HVSC, caches, tags, ROMs, and output
- JSON/JSONL artifacts under `data/`
- a LanceDB/vector DB built from classification and feedback data via `scripts/build-db.ts` and `packages/sidflow-common/src/lancedb-builder.ts`

The web runtime (`packages/sidflow-web`) is a Next.js app that exposes:

- admin/auth surfaces
- playback and playback-session routes
- search
- favorites/preferences/playlists
- fetch/classify/train control routes
- health/metrics/admin job inspection

Deployment/runtime model:

- `Dockerfile.production` builds a single web container image.
- `scripts/docker-startup.sh` prepares runtime directories, symlinks, and diagnostics.
- `fly.toml` deploys the web app on Fly.io with a mounted volume at `/mnt/data`, HTTP health checks against `/api/health`, soft concurrency 200 / hard 250, `min_machines_running = 1`, and scaling up to 3 machines.

Runtime dependencies include Bun, `sidplayfp`, `ffmpeg`, `ffprobe`, HVSC/workspace data, optional model files, and writable local storage for `data/` and runtime-generated assets.

## 4. Implemented and Production-Capable Today

The following areas appear materially implemented and usable today, with caveats noted elsewhere:

### 4.1 CLI-first pipeline foundation

- The monorepo packages and docs consistently describe a fetch/classify/train/play workflow. Evidence: `README.md`, `doc/technical-reference.md`, `package.json`.
- Common infrastructure is centralized in `packages/sidflow-common`, including config loading, deterministic serialization, metadata helpers, LanceDB building, logging, and recommender utilities.

### 4.2 Docker packaging and boot diagnostics

- `Dockerfile.production` is not a placeholder. It pins the Bun base image by digest, verifies Bun install checksums, installs audio/runtime packages, copies the monorepo, builds with `npx tsc -b`, sets up a non-root user, uses `tini`, and defines a container healthcheck.
- `scripts/docker-startup.sh` performs real startup-time checks: symlink setup for Fly volumes, environment inspection, dependency checks (`sidplayfp`, `ffmpeg`, `ffprobe`, `python3`), `sidplayfp.ini` creation, and startup logging.
- `scripts/build-docker.sh` gives a controlled build path rather than ad-hoc `docker build`.

### 4.3 Health and metrics endpoints

- `/api/health` in `packages/sidflow-web/app/api/health/route.ts` performs actual checks against workspace paths, commands, config resolution, permissions, metadata samples, process stats, and optional UI reachability.
- `/api/admin/metrics` in `packages/sidflow-web/app/api/admin/metrics/route.ts` aggregates useful local operational data such as job summaries, storage usage, feedback counts, and uptime.

These are meaningful building blocks, even if they are not sufficient alone for production alerting.

### 4.4 Playback and basic recommendation flows

- The web app exposes a large playable API surface under `packages/sidflow-web/app/api/play/**`.
- `packages/sidflow-web/lib/server/availability-service.ts` and `packages/sidflow-web/lib/server/hls-service.ts` implement actual file/stream availability handling rather than route stubs.
- `packages/sidflow-web/app/api/play/manual/route.ts`, `/api/play/random`, and `/api/play/station-from-song` are real routes wired into playback/session creation.

### 4.5 User-facing stateful features exist

- Favorites, preferences, auth, and playlists are not missing entirely. Evidence: `packages/sidflow-web/app/api/favorites/route.ts`, `packages/sidflow-web/app/api/prefs/route.ts`, `packages/sidflow-web/app/api/auth/*`, `packages/sidflow-web/app/api/playlists/*`.
- The repo has concrete storage implementations for these features. The problem is not absence; it is production durability/scaling design.

### 4.6 Job orchestration foundation exists

- There is a real job model in `packages/sidflow-common/src/job-orchestrator.ts`, `packages/sidflow-common/src/job-queue.ts`, and `packages/sidflow-common/src/job-runner.ts`.
- Admin job inspection routes exist at `/api/admin/jobs` and `/api/admin/jobs/[id]`.
- This is useful groundwork for production job execution, even though the current web runtime is not fully using it as the single source of truth.

### 4.7 Performance/load-test scaffolding exists

- `scripts/performance-runner.ts` supports smoke/reduced/standard/scale profiles, thresholds, and remote execution.
- `packages/sidflow-performance/src/index.ts` is real code, not an empty package.
- `.github/workflows/performance.yml` runs a reduced performance profile in CI.

This is a meaningful strength because many repos at this stage have no reproducible performance harness at all.

## 5. Partial, Placeholder, Stubbed, or Incomplete Features

### Finding 1: Production auth defaults are unsafe

Severity: blocker

Evidence:

- `packages/sidflow-web/lib/server/admin-auth-core.ts` falls back to `admin` / `password` defaults and derives the admin signing secret from the password when `SIDFLOW_ADMIN_SECRET` is absent.
- `README.md` documents default admin login as `admin/password`.
- `packages/sidflow-web/lib/server/jwt.ts` falls back to `sidflow-dev-secret-change-in-production` if `JWT_SECRET` is not set.
- `packages/sidflow-web/proxy.ts` honors env flags that can disable admin auth and rate limiting.

Impact:

- A misconfigured production deploy can silently boot with weak or predictable secrets.
- Session signing and JWT integrity become environment-optional rather than mandatory.

What done should look like:

- Fail fast at startup unless `SIDFLOW_ADMIN_PASSWORD`, `SIDFLOW_ADMIN_SECRET`, and `JWT_SECRET` are explicitly set to strong values in non-dev environments.
- Remove documented default production credentials from user-facing docs.
- Add startup validation in `scripts/docker-startup.sh` and/or server boot.

### Finding 2: Core runtime state is process-local or machine-local

Severity: blocker

Evidence:

- Playback sessions are stored in a module-level `Map` in `packages/sidflow-web/lib/playback-session.ts`.
- Classification progress is kept in memory in `packages/sidflow-web/lib/classify-progress-store.ts`.
- Fetch progress is kept in memory in `packages/sidflow-web/lib/fetch-progress-store.ts`.
- Rate limiting is in-memory only in `packages/sidflow-web/lib/server/rate-limiter.ts`, with comments pointing toward Redis or similar for production.
- Search indexing is a singleton in `packages/sidflow-web/lib/server/search-index.ts`.
- Preferences, users, and playlists persist to local JSON files in `packages/sidflow-web/lib/preferences-store.ts`, `packages/sidflow-web/lib/server/user-storage.ts`, and `packages/sidflow-web/lib/server/playlist-storage.ts`.

Impact:

- A restart loses active playback sessions and progress state.
- Rolling deploys or multiple Fly machines will produce inconsistent user experience depending on which machine handles a request.
- File-based updates can diverge across machines or race under concurrent writes.

What done should look like:

- Move mutable shared state to a real shared store: at minimum SQLite on a single-writer architecture, or preferably Postgres/Redis split by concern.
- Keep local disk only for caches and derived artifacts, not critical user/session/job state.

### Finding 3: Long-running jobs are only partially durable and still tied to the web process

Severity: blocker

Evidence:

- `packages/sidflow-web/lib/classify-runner.ts` spawns a child process from the web app and stores runner state in process memory.
- `/api/classify` and `/api/classify/control` are built around that runner.
- `packages/sidflow-web/lib/fetch-progress-store.ts` tracks fetch state in-memory.
- `packages/sidflow-web/lib/scheduler.ts` runs timers in-process and triggers HTTP requests back into the same app.
- There is a more durable job framework under `packages/sidflow-common/src/job-orchestrator.ts`, but the worker is started separately via `scripts/run-job-queue.ts`, not by the default Fly deployment.

Impact:

- A machine restart loses active job supervision and progress reporting.
- Multiple app instances can double-trigger scheduled work or disagree about whether a job is running.
- Job continuity across deploys is not guaranteed.

What done should look like:

- Move fetch/classify/train execution to a worker process or machine that consumes a durable queue.
- Persist job state transitions, logs, and checkpoints outside process memory.
- Ensure the web app only submits/queries jobs, not owns them.

### Finding 4: OpenAPI coverage is far behind actual implementation

Severity: high

Evidence:

- `packages/sidflow-web/openapi.yaml` defines only `/api/play`, `/api/rate`, `/api/classify`, `/api/fetch`, and `/api/train`.
- Repository route scan found 60 actual API routes under `packages/sidflow-web/app/api`.
- Missing from the spec include `/api/health`, `/api/admin/metrics`, `/api/search`, `/api/auth/*`, `/api/favorites`, `/api/playlists/*`, `/api/play/*`, `/api/playback/*`, and many others.

Impact:

- External integrators do not have a reliable contract.
- Regression detection against public API behavior is weaker than it appears.

What done should look like:

- Decide which routes are public/admin/internal.
- Expand `packages/sidflow-web/openapi.yaml` to cover supported external/admin routes or explicitly publish a narrower “public API only” contract.
- Add spec-vs-route contract tests.

### Finding 5: Model API can return a stub manifest

Severity: high

Evidence:

- `packages/sidflow-web/app/api/model/latest/route.ts` falls back to `buildStubManifest()` and returns `modelVersion: "stub"` if model files are absent.

Impact:

- Clients can receive a 200 response with placeholder model data instead of a hard failure or explicit “model unavailable” contract.
- Production clients may silently rely on fake capabilities.

What done should look like:

- In production mode, return a clear non-200 error or an explicit availability state instead of a stub manifest.
- Restrict stub behavior to tests/dev.

### Finding 6: Recommendation explanations are placeholder-driven

Severity: high

Evidence:

- `packages/sidflow-web/lib/server/explain-recommendation.ts` contains comments such as “For demo purposes, we'll use mock values” and computes explanation fields from placeholder EMC values rather than a validated explanation model.

Impact:

- The UI can present confident-sounding recommendation explanations that are not grounded in the actual recommendation evidence chain.

What done should look like:

- Drive explanations from actual exported feature values, similarity components, and feedback signals.
- Label heuristic explanations as heuristic until validated.

### Finding 7: “Advanced station” modes are mostly heuristic compositions over small vectors

Severity: medium

Evidence:

- `packages/sidflow-web/lib/server/collaborative-filter.ts` states that in production it “would aggregate actual user feedback data” and currently uses vector similarity as a proxy.
- `packages/sidflow-web/lib/server/adaptive-station.ts` tunes thresholds heuristically from session actions.
- `packages/sidflow-web/lib/server/hidden-gems.ts`, `mood-transition.ts`, `composer-discovery.ts`, `chip-model-stations.ts`, `era-explorer.ts`, and `remix-radar.ts` derive results through heuristic rules over E/M/C/P values, metadata parsing, or title token similarity.

Impact:

- The route surface looks more mature than the underlying retrieval science.
- Feature completeness is better described as “experimental modes built on the same primitive similarity substrate.”

What done should look like:

- Mark experimental modes clearly in docs/UI.
- Validate retrieval quality for each mode or narrow the set of production-supported modes.

### Finding 8: Favorites “Play All / Shuffle” is incomplete

Severity: medium

Evidence:

- `packages/sidflow-web/components/FavoritesTab.tsx` explicitly says `TODO: Implement queue system for playing all`.
- `README.md` states that Play All / Shuffle currently start the first selected track and do not queue the rest.

Impact:

- A visible user-facing feature is knowingly partial.

What done should look like:

- Implement queue/session playlist semantics end to end, or remove the affordance until complete.

### Finding 9: Audio cache/prefetch strategy is deliberately disabled

Severity: medium

Evidence:

- `packages/sidflow-web/lib/audio-cache-service.ts` documents disabled WAV prefetching due to long delays and UI responsiveness problems.

Impact:

- Playback startup and stream responsiveness are likely still exposed to cold-start rendering cost.

What done should look like:

- Replace disabled prefetch with bounded, async cache warming and measurable latency targets.

### Finding 10: Some WASM playback capabilities remain incomplete

Severity: low

Evidence:

- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts` notes that cached seek behavior via `seekToSample` is not yet implemented.

Impact:

- Seek/caching behavior for advanced playback scenarios remains limited.

What done should look like:

- Implement or explicitly de-scope seek caching behavior and document it.

## 6. Fly.io Production Readiness Assessment

### Deployment topology assessment

Current config:

- `fly.toml` defines a single app with HTTP service, internal port 3000, auto start/stop, `min_machines_running = 1`, and `[scaling]` `min_machines = 1`, `max_machines = 3`.
- Health checks target `/api/health`.
- A volume mount is configured at `/mnt/data`.
- VM sizing is `shared-cpu-1x` with `512mb`.
- Concurrency is set to `soft_limit = 200`, `hard_limit = 250`.

Assessment:

- The topology suggests horizontal scaling, but the application design is still effectively single-instance for correctness.
- The local volume + local JSON + in-memory state mix is not compatible with “just add more machines.”
- For Fly, this is currently better understood as a single-stateful-machine app with experimental autoscaling settings that should not be trusted yet.

### Persistent storage assessment

- `scripts/docker-startup.sh` symlinks `/sidflow/workspace` and `/sidflow/data` into `/mnt/data/...` on Fly.
- That is useful for a single-machine persistent volume.
- It is not enough for multi-machine consistency because process memory remains local, and Fly volumes are attached per machine rather than magically shared across a scaled cluster.
- Local JSON persistence for users/preferences/playlists also lacks database-style locking and migration discipline.

Assessment:

- Persistent volume support exists, but the storage model is only credible for one machine at a time.

### Health checks

Strengths:

- `/api/health` is more than a “returns 200” route.
- It checks binaries, config, directory access, optional route reachability, and some process/resource stats.

Gaps:

- It does not prove job worker health, shared-state health, or downstream queue health because those systems are not yet externalized.
- It can report healthy while important optional directories are missing.
- It does not encode readiness semantics for “safe to receive user traffic after deploy.”

### Startup/boot diagnostics

Strengths:

- `scripts/docker-startup.sh` is unusually thorough.

Gaps:

- It does not fail hard on insecure auth-secret defaults in production.
- It does not validate that model/database/job-worker dependencies are present when routes depend on them.
- It does not assert that the deployment topology matches app assumptions, for example “single machine only unless shared state configured.”

### Secret management

- `doc/deployment.md` only documents admin username/password and `PORT`.
- It does not document `SIDFLOW_ADMIN_SECRET`, `JWT_SECRET`, or Fly secret-management expectations.
- Code allows insecure fallbacks.

Assessment:

- Secret management is currently underdocumented and too forgiving to be safe.

### Rolling deploy safety

- Unsafe today.
- Active sessions, progress stores, scheduler timers, and in-flight classify child processes are machine-local.
- A rolling deploy can strand jobs or split user interactions across machines.

### Machine sizing and concurrency realism

- `shared-cpu-1x` + `512mb` with 200/250 concurrency is not supported by repository evidence.
- SID playback/rendering, ffmpeg/HLS work, search index loading, and job orchestration are all non-trivial.
- No checked-in benchmark proves that one 512 MB machine can serve 100 interactive concurrent users across realistic workloads.

### Recommended Fly.io target architecture for 100 concurrent users

Recommended target, based on current code shape:

1. Web tier: 2 Fly machines minimum, but only after mutable state is externalized.
2. Worker tier: separate worker process/machine for fetch/classify/train jobs and scheduled tasks, driven by durable queue state.
3. Shared storage:
   - Postgres or SQLite-on-single-writer only for users/preferences/playlists/jobs.
   - Redis or equivalent for sessions, progress, and rate limiting if multi-web-machine routing is expected.
   - Volume/object storage only for large derived files, HLS segments, and caches.
4. Fly sizing starting point:
   - Web: at least `shared-cpu-2x` or `performance-1x`, 1 GB memory, 2 machines.
   - Worker: at least 1 dedicated machine sized for CPU-heavy renders/classification.
5. Concurrency limits should be reduced initially and based on measured p95 latency, not set to 200/250 by default.

## 7. 100-Concurrent-User Readiness Assessment

### Workload model assumptions

For this target, “100 concurrent users” should mean a mix of:

- browsing/searching HVSC
- creating playback sessions
- streaming audio/HLS
- using favorites/playlists
- polling status routes
- occasional admin-triggered fetch/classify/train activity

### Likely bottlenecks

- CPU: SID render/playback work, ffmpeg/HLS generation, metadata parsing, similarity queries, heavy route-side file operations
- Memory: Next.js process, caches/singletons, playback session storage, search index, HLS buffering, Bun runtime overhead
- IO: local disk for JSON files, manifests, HLS artifacts, LanceDB access, generated audio assets
- Contention: admin-triggered jobs competing with user-facing traffic on the same machine

### What current performance tooling proves

- The repo has a reusable performance harness and threshold-based profiles.
- There is at least one real journey definition: `performance/journeys/play-start-stream.json`.
- `scripts/performance-runner.ts` can run remote profiles, including a `scale` profile with VU stages up to 250.

### What it does not prove

- CI does not run the `scale` profile.
- There is no evidence of multi-route, stateful, authenticated workload coverage.
- There is no checked-in result showing 100 simultaneous users against the deployed Fly topology.
- There is no evidence that classify/fetch/train jobs were run concurrently with user traffic in performance tests.

### Specific missing benchmarks/tests

1. Playback session create/start latency under 25/50/100 users.
2. HLS or streamed-audio steady-state behavior over 10-30 minutes.
3. Search + favorites + playlist mutation load under multi-user concurrency.
4. Admin classify/fetch load while user playback traffic is active.
5. Restart/rolling-deploy interruption tests.
6. Multi-machine correctness tests once state is externalized.

### Exact validation plan needed before launch

1. Define user-journey profiles in `performance/journeys/` for search, play, favorite, playlist create/update, login/auth, and admin classify trigger.
2. Stand up a staging Fly deployment with production-like data, secrets, and worker topology.
3. Run baseline tests at 10, 25, 50, 100 concurrent users with no admin jobs.
4. Repeat with background classify/fetch activity.
5. Capture p50/p95/p99 latency, error rate, memory, CPU, disk, and cold-vs-warm behavior.
6. Execute rolling deploy during active load and confirm session/job correctness.
7. Set concurrency/VM sizes from measured data, not guesses.

## 8. Security and Operational Risk Assessment

### Auth/session risk

- High risk.
- Admin auth uses fallback credentials/secrets if env is incomplete.
- User JWTs also have a dev fallback secret.
- Playback sessions are in memory, not shared or durable.

### Secrets risk

- High risk.
- `doc/deployment.md` under-specifies required secrets.
- Startup does not enforce safe secret configuration.

### Data-loss risk

- High risk.
- User records, preferences, playlists, feedback-side effects, and local derived files depend on local storage discipline.
- Process-local state is lost on restart.

### Restart/scale risk

- High risk.
- Rolling deploys, machine restarts, and scale-out will break assumptions around sessions, progress, scheduler state, and active job control.

### Abuse/rate-limit risk

- Medium to high risk.
- There is a rate limiter, but it is process-local in `packages/sidflow-web/lib/server/rate-limiter.ts`.
- In multi-machine or restart scenarios, it will not behave consistently.

### Observability gaps

- No tracing or distributed request correlation.
- No documented dashboards or alerts.
- No SLO/SLA definitions.
- Health and metrics are local/process-centric, not enough for incident response by themselves.

### Operational runbook gaps

- `doc/deployment.md` is thin and does not qualify as a production runbook.
- There is no documented incident/recovery process for:
  - restoring user/auth state
  - rotating secrets
  - draining/restarting workers
  - recovering failed classify/fetch jobs
  - verifying data consistency after deploy

## 9. API and Contract Maturity

### Documented endpoints vs actual implementation

Current mismatch:

- Spec: 5 paths in `packages/sidflow-web/openapi.yaml`
- Actual: 60 route handlers under `packages/sidflow-web/app/api`

Notable implemented-but-undocumented families:

- auth: `/api/auth/*`
- playback session/streaming: `/api/playback/*`
- favorites/preferences/playlists
- search and charts
- health/metrics/admin jobs
- numerous play-mode routes under `/api/play/*`

Assessment:

- The runtime API is much broader than the documented contract.
- Contract maturity is low for external consumers, even though feature count is high.

### Missing or inconsistent contracts

- Some routes behave like internal/admin helpers but are not clearly segregated in docs.
- The model route can return a stub payload with HTTP 200.
- Experimental recommendation routes are not marked as experimental in a published contract.

### Stub/fallback responses

- `packages/sidflow-web/app/api/model/latest/route.ts` returns a stub manifest.
- Several routes degrade to empty arrays if the underlying database is missing, for example recommendation helpers that return `[]` if LanceDB is unavailable.

Assessment:

- Degrading gracefully is useful, but the current contract often does not tell clients whether they received “real empty result” or “feature unavailable.”

### Export/API opportunities for external consumers

- There is already a natural opportunity for a public export workflow because similarity data is mostly file-derived and HVSC-keyed.
- The current `/api/classify/export` route exports merged auto-tag classifications, not reusable offline similarity/correlation data.
- For external clients, the export feature is a better primary contract than exposing the full web API.

## 10. New Feature Research: Portable SID Correlation Export

### Product framing

Goal: after classification and optional feedback aggregation, SIDFlow should emit a single portable file that lets another project find related/similar HVSC SID songs offline, without needing the SIDFlow server, LanceDB runtime, or web app.

Primary consumer:

- The `c64commander` Capacitor app (Android/iOS/web), specifically its Play page and playlist workflow.

Repository evidence for consumer design:

- `../c64commander/src/lib/playlistRepository/types.ts` uses stable track identity fields such as `sourceKind`, `sourceLocator`, `path`, `title`, `author`, `released`, and `subsongCount`.
- `../c64commander/src/pages/playFiles/hooks/useHvscLibrary.ts` and related Play-page code already reason about HVSC-relative paths and local playlist items.
- That means the export should key each track primarily by HVSC-relative SID path, optionally with subsong information if needed later.

Supported workflows:

1. A user favorites one or more HVSC songs in another app.
2. That app loads the SIDFlow export file locally.
3. It finds similar songs from one favorite or a centroid built from many favorites.
4. It builds a playlist without contacting SIDFlow.

Recommended delivery modes:

- Primary: CLI export step for reproducibility and batch generation.
- Secondary: optional web/admin download route that simply serves a previously generated export.
- Optional scheduled generation: yes, but only after the CLI format is stable.

### Data model

The export should be HVSC-centric, portable, and compact. It should include:

Per-track identity:

- `sid_path`: HVSC-relative path, normalized with `/`
- optional `subsong` if later needed
- stable numeric `track_id` for compact indexing
- optional `hvsc_release` or corpus version

Per-track metadata:

- title
- author/composer
- released
- duration or length hint if already known
- chip model if available

Per-track similarity basis:

- compact normalized vector suitable for on-device distance computation
- source quality/version fields indicating which feature schema and build produced it

Per-track precomputed correlations:

- top-N nearest neighbors with score and optional reason code
- this is the most important piece for Android practicality because it avoids full-NN scans for common workflows

Global manifest fields:

- `schema_version`
- `generated_at`
- `sidflow_version` / git revision if available
- `feature_schema_version`
- `hvsc_release`
- corpus counts
- checksum fields

Recommended vector content:

- Include a compact normalized embedding or feature vector, not just raw E/M/C labels.
- Current code already has richer classified features in the classification artifacts; the export should derive a reduced-dimension portable vector from those, not merely copy the 4-value LanceDB vector.

Quality/confidence fields:

- `feature_quality`
- `source_artifact_version`
- optional `similarity_quality` or confidence band

Pairwise similarity feasibility:

- Full pairwise similarity is not feasible for a large HVSC corpus in a single mobile-friendly file because O(n^2) storage grows too fast.
- Precomputed top-K neighbors per track is feasible and practical.

### Format evaluation

#### Option 1: JSON

Pros:

- Excellent portability
- Easy in web/mobile/Node
- Human-inspectable

Cons:

- Large for full corpus
- Poor random access without loading most of the file
- Repeated keys waste space

Verdict:

- Good for small debug exports, not ideal as the primary large portable file.

#### Option 2: JSONL

Pros:

- Streaming-friendly
- Easier incremental generation
- Good for CLI tooling

Cons:

- Still text-heavy
- Multi-part structures are awkward in a single-file portable artifact
- Mobile random access is still weak unless indexed externally

Verdict:

- Good as an intermediate or debug format, not the best primary on-device artifact.

#### Option 3: compressed JSON / JSONL

Pros:

- Better size than plain text
- Still straightforward to produce

Cons:

- On-device random access is poor unless fully decompressed
- Browser/mobile parsing is more cumbersome

Verdict:

- Useful for downloadable archives, but not the best default for Android lookup speed.

#### Option 4: SQLite

Pros:

- Single-file export
- Excellent Android/iOS/web portability through mature libraries
- Strong random access
- Compact with indexed tables
- Easy to version and validate
- Supports both metadata lookup and neighbor lookup efficiently

Cons:

- Less human-inspectable than JSON
- Requires schema management

Verdict:

- Best primary format for the stated use case.

#### Option 5: FlatBuffers / protobuf-like binary

Pros:

- Very compact and fast

Cons:

- Higher implementation complexity
- Harder debugging and ecosystem friction for casual consumers
- Less natural for ad-hoc SQL-like queries and migration

Verdict:

- Not justified as the first production export format.

Primary recommendation:

- SQLite single-file export as the primary production artifact.

Secondary optional formats:

- JSON manifest + JSONL track dump for debugging/research.
- Compressed JSONL for interoperability with data pipelines.

### Recommended schema

Recommended SQLite tables:

1. `manifest`
   - `schema_version`
   - `generated_at`
   - `sidflow_version`
   - `feature_schema_version`
   - `hvsc_release`
   - `track_count`
   - `neighbor_k`
   - `vector_dims`
   - `checksum`

2. `tracks`
   - `track_id INTEGER PRIMARY KEY`
   - `sid_path TEXT UNIQUE NOT NULL`
   - `title TEXT`
   - `author TEXT`
   - `released TEXT`
   - `duration_ms INTEGER`
   - `chip_model TEXT`
   - `vector BLOB NOT NULL`
   - `vector_norm REAL`
   - `quality_score REAL`
   - `metadata_json TEXT NULL`

3. `neighbors`
   - `track_id INTEGER NOT NULL`
   - `neighbor_rank INTEGER NOT NULL`
   - `neighbor_track_id INTEGER NOT NULL`
   - `score REAL NOT NULL`
   - `reason_code TEXT NULL`
   - primary key `(track_id, neighbor_rank)`

4. Optional `feature_names`
   - for introspection/debugging if vectors are not fully opaque

Recommended sample top-level JSON structure for the secondary debug format:

```json
{
  "schema_version": "sidcorr-1",
  "generated_at": "2026-03-13T12:00:00Z",
  "hvsc_release": "79",
  "feature_schema_version": "classify-vX",
  "track_count": 123456,
  "neighbor_k": 64,
  "vector_dims": 16,
  "tracks": [
    {
      "track_id": 101,
      "sid_path": "MUSICIANS/H/Hubbard_Rob/Delta.sid",
      "title": "Delta",
      "author": "Rob Hubbard",
      "vector": [0.12, -0.08, 0.44],
      "neighbors": [
        { "track_id": 502, "score": 0.93, "reason_code": "vector+metadata" }
      ]
    }
  ]
}
```

### Recommended similarity retrieval design

Best design: hybrid.

1. Export compact vectors for every track.
2. Export precomputed top-K neighbors for every track.

Why hybrid:

- For the common case, an app can use precomputed neighbors directly and never run large on-device scans.
- For multi-favorite playlist generation, the app can compute a centroid or weighted blend over the exported vectors from the user’s favorites, then rank candidate tracks by cosine distance on-device.
- This supports offline recommendation without SIDFlow backend dependencies.

External app retrieval algorithm:

Single favorite:

1. Resolve `sid_path` to `track_id`.
2. Read top-K rows from `neighbors`.
3. Filter out already-favorited or already-playlisted tracks.
4. Return highest-scoring candidates.

Multiple favorites:

1. Resolve all selected favorite `track_id`s.
2. Load their vectors.
3. Compute weighted centroid, optionally with user rating weights.
4. Score candidate tracks by cosine similarity.
5. Boost tracks that also appear in many source tracks’ precomputed neighbor lists.
6. Filter and diversify by composer/path if desired.

Offline practicality:

- Yes, if vector dimension is kept modest, for example 8-32 floats per track plus top-32 or top-64 neighbors.
- For Android, SQLite + top-K neighbors means most usage avoids scanning the whole corpus.

### Mobile/Android considerations

- SQLite is a strong fit for Capacitor mobile apps.
- HVSC-relative `sid_path` is the right join key because `c64commander` already models tracks around HVSC path/source identity.
- Prefer integer `track_id`s internally to reduce storage size in neighbor lists.
- Keep vectors quantized or compact:
  - `Float32Array` in BLOB form is acceptable.
  - Quantized int8/uint16 vectors are worth considering for a “mobile export” profile.

### File size / performance tradeoffs

Avoid full pairwise matrices.

Recommended export profiles:

1. Full export:
   - richer metadata
   - vectors
   - top-64 neighbors
   - suited for desktop/server-side reuse

2. Mobile export:
   - essential metadata only
   - quantized vectors or smaller dimensions
   - top-32 neighbors
   - tuned for Android storage and startup cost

Likely size drivers:

- corpus size
- vector dimension
- neighbor count
- metadata verbosity

The strongest size-control levers are:

- smaller vector dimension
- integer track IDs
- top-K neighbors instead of pairwise matrix
- normalized metadata fields with minimal duplication

### Generation and lifecycle

Where generation should happen:

- Best as a separate export step after classification and database build.
- Do not bury it inside `/api/classify/export`, which currently targets auto-tag export only.

Recommended pipeline:

1. classify
2. optional feedback aggregation / build-db
3. export-similarity

Why separate:

- Export needs stable inputs and clear versioning.
- Consumers may want multiple profiles from the same underlying corpus.

Versioning:

- Introduce `schema_version` for export format.
- Include `feature_schema_version` from classification outputs.
- Include corpus/HVSC version and generation timestamp.

Incremental updates:

- Start with full rebuild only.
- Add incremental mode later if/when corpus diffs and feedback churn justify complexity.

Validation:

- Manifest checksum
- referential integrity of neighbor rows
- vector dimension consistency
- unique `sid_path`
- optional spot-check retrieval tests against SIDFlow similarity outputs

### Exact implementation plan

Packages to extend:

- `packages/sidflow-common`
  - add schema types and export builder utilities
- `packages/sidflow-play`
  - add CLI-facing export command wiring if this package remains the user-facing playback/export entry point
- possibly `packages/sidflow-web`
  - add optional admin/download route for a prebuilt export file, not generation-in-request

New CLI:

- Recommended command: `bun run play export-similarity`
- Or a dedicated package script such as `bun run export:similarity`

Suggested CLI flags:

- `--config <path>`
- `--profile full|mobile`
- `--output <file>`
- `--neighbors <k>`
- `--dims <n>`
- `--include-vectors`
- `--format sqlite|jsonl`

Output filename conventions:

- `data/exports/sidcorr-hvsc<release>-full-v1.sqlite`
- `data/exports/sidcorr-hvsc<release>-mobile-v1.sqlite`

Schema versioning:

- Start with `sidcorr-1`
- Bump on incompatible table or scoring changes

API route if needed:

- `GET /api/exports/similarity/latest`
- Route should only serve an already-built file and related manifest metadata

Tests:

1. Unit tests for schema writing/reading
2. Deterministic export snapshot tests on a small fixture corpus
3. Validation tests for manifest integrity
4. Consumer-style retrieval tests:
   - single favorite nearest-neighbor lookup
   - multi-favorite centroid retrieval
5. Cross-check tests comparing exported-neighbor retrieval vs server-side `findSimilarTracks` on fixture data

Docs:

- new doc explaining schema, generation, and consumer usage
- update `README.md`, `doc/technical-reference.md`, and `packages/sidflow-web/openapi.yaml` if a download route is added

Sample consumer expectations:

- provide TypeScript sample for Capacitor/Node
- show lookup by HVSC path and playlist generation from favorites

Backwards compatibility concerns:

- Consumers must be able to detect schema version and reject unsupported files cleanly.
- Export scoring changes should be versioned, not silently replaced.

## 11. Recommended Engineering Roadmap

### Phase 0: Immediate blockers

Goals:

- Remove unsafe deployment defaults.
- Stop pretending multi-machine Fly scaling is safe before shared state exists.

Exact code areas to change:

- `packages/sidflow-web/lib/server/admin-auth-core.ts`
- `packages/sidflow-web/lib/server/jwt.ts`
- `packages/sidflow-web/proxy.ts`
- `scripts/docker-startup.sh`
- `doc/deployment.md`
- `fly.toml`

Dependencies:

- Secret management decisions
- Environment validation policy

Acceptance criteria:

- Production boot fails if required secrets are missing.
- No default admin/password behavior remains for production.
- Fly config is explicitly single-machine until shared-state work is complete, or the shared-state work ships first.

### Phase 1: Production hardening

Goals:

- Externalize mutable state and durable jobs.
- Make health/readiness meaningful.

Exact code areas to change:

- `packages/sidflow-web/lib/playback-session.ts`
- `packages/sidflow-web/lib/classify-progress-store.ts`
- `packages/sidflow-web/lib/fetch-progress-store.ts`
- `packages/sidflow-web/lib/preferences-store.ts`
- `packages/sidflow-web/lib/server/user-storage.ts`
- `packages/sidflow-web/lib/server/playlist-storage.ts`
- `packages/sidflow-web/lib/server/rate-limiter.ts`
- `packages/sidflow-web/lib/classify-runner.ts`
- `packages/sidflow-common/src/job-orchestrator.ts`
- `scripts/run-job-queue.ts`

Dependencies:

- choose shared persistence stack
- worker deployment design

Acceptance criteria:

- Web machines can restart without losing critical user/session/job correctness.
- Scheduler/workers are not duplicated accidentally across web instances.
- Rate limiting and session validity are consistent across machines.

### Phase 2: Scale validation

Goals:

- Produce real evidence for 100-concurrent-user readiness.

Exact code areas to change:

- `scripts/performance-runner.ts`
- `packages/sidflow-performance/src/index.ts`
- new files under `performance/journeys/`
- possible instrumentation in health/metrics/logging routes

Dependencies:

- staging environment close to production
- shared-state hardening completed

Acceptance criteria:

- Reproducible load-test results show acceptable latency/error behavior at target load.
- Rolling deploy under load is verified.
- VM sizing/concurrency settings are chosen from measurements.

### Phase 3: Correlation export feature

Goals:

- Produce a stable, single-file, offline-consumable similarity export.

Exact code areas to change:

- `packages/sidflow-common`
- `packages/sidflow-play`
- optional `packages/sidflow-web/app/api/exports/...`
- docs in `README.md` and `doc/technical-reference.md`

Dependencies:

- stable feature/vector selection
- schema/versioning decision

Acceptance criteria:

- CLI generates a validated SQLite export.
- Fixture tests prove external retrieval works offline.
- c64commander-style sample consumer code can build a playlist from favorites.

### Phase 4: Post-launch hardening

Goals:

- Improve observability, supportability, and product trust.

Exact code areas to change:

- health/metrics/logging infrastructure
- deployment docs/runbooks
- recommendation explanation logic
- API docs/OpenAPI coverage

Dependencies:

- production telemetry feedback

Acceptance criteria:

- Dashboards/alerts/runbooks exist.
- Experimental features are clearly labeled or removed from production surface.
- OpenAPI/public docs match supported endpoints.

## 12. Detailed Gap Matrix

| Area | Current State | Evidence | Risk | Required Work | Priority | Estimated Effort | Launch Blocker? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Admin auth | Weak fallbacks allowed | `packages/sidflow-web/lib/server/admin-auth-core.ts`, `README.md` | Account compromise | Require explicit secrets/passwords and fail fast | P0 | Small | Yes |
| JWT signing | Dev fallback secret | `packages/sidflow-web/lib/server/jwt.ts` | Token forgery if misconfigured | Require `JWT_SECRET`, rotate support | P0 | Small | Yes |
| Playback sessions | In-memory `Map` | `packages/sidflow-web/lib/playback-session.ts` | Session loss on restart/scale | Move to shared store | P0 | Medium | Yes |
| Classify/fetch progress | In-memory only | `packages/sidflow-web/lib/classify-progress-store.ts`, `packages/sidflow-web/lib/fetch-progress-store.ts` | Progress/control breakage | Persist progress/events durably | P0 | Medium | Yes |
| Rate limiting | Process-local only | `packages/sidflow-web/lib/server/rate-limiter.ts` | Inconsistent abuse protection | Shared rate-limit backend | P1 | Medium | No |
| User storage | JSON files | `packages/sidflow-web/lib/server/user-storage.ts` | Race/data consistency issues | Database-backed user store | P0 | Medium | Yes |
| Preferences/favorites | JSON file | `packages/sidflow-web/lib/preferences-store.ts` | Lost/divergent user data | Shared persistence | P0 | Medium | Yes |
| Playlists | JSON files | `packages/sidflow-web/lib/server/playlist-storage.ts` | Multi-instance inconsistency | Shared persistence + locking | P0 | Medium | Yes |
| Scheduler | In-process timers | `packages/sidflow-web/lib/scheduler.ts` | Duplicate or lost scheduled work | Worker/scheduler separation | P0 | Medium | Yes |
| Classify runner | Child proc bound to web proc | `packages/sidflow-web/lib/classify-runner.ts` | Jobs die on deploy/restart | Durable queue + worker | P0 | Large | Yes |
| Fly topology | Config implies scaling before app is ready | `fly.toml`, `scripts/docker-startup.sh` | Incorrect behavior under scale | Single-machine restriction or shared-state redesign | P0 | Small/Medium | Yes |
| OpenAPI | Covers only 5 of 60 routes | `packages/sidflow-web/openapi.yaml`, route scan | Consumer confusion | Define supported API and document it | P1 | Medium | No |
| Model API | Returns stub manifest | `packages/sidflow-web/app/api/model/latest/route.ts` | Silent fake capability | Explicit unavailable/error contract | P1 | Small | No |
| Recommendation explanation | Placeholder values | `packages/sidflow-web/lib/server/explain-recommendation.ts` | Misleading product behavior | Real evidence-based explanation model | P1 | Medium | No |
| Advanced stations | Mostly heuristic modes | `adaptive-station.ts`, `collaborative-filter.ts`, `hidden-gems.ts`, etc. | Overstated maturity | Mark experimental or validate | P2 | Medium | No |
| Favorites queueing | Play All/Shuffle incomplete | `packages/sidflow-web/components/FavoritesTab.tsx`, `README.md` | User-visible incompleteness | Implement queue/session playlist behavior | P2 | Small/Medium | No |
| Audio prefetch | Disabled | `packages/sidflow-web/lib/audio-cache-service.ts` | Cold-start latency | Bounded async cache warming | P2 | Medium | No |
| Performance proof | Tooling exists, evidence insufficient | `scripts/performance-runner.ts`, `.github/workflows/performance.yml` | Scale claims unproven | Real staging load tests | P0 | Medium/Large | Yes |
| Exportable similarity artifact | Not implemented | `/api/classify/export`, `lancedb-builder.ts`, `similarity-search.ts` | Core reuse opportunity blocked | Build portable SQLite export | P1 | Medium/Large | No |

## 13. Definition of “Ready for Production Rollout”

SIDFlow should not be declared ready for a Fly.io rollout for 100 concurrent users until all of the following are true:

1. No production deployment can boot with fallback admin/JWT secrets.
2. User/session/job/progress state survives restarts and rolling deploys correctly.
3. Fly deployment topology matches the persistence architecture, with explicit worker separation for long-running jobs.
4. Health/readiness checks distinguish “process alive” from “safe to receive traffic.”
5. Load tests on production-like Fly staging show acceptable p95 latency and low error rate at 100 concurrent users for realistic mixed journeys.
6. Rolling deploy and restart tests pass under load without losing critical correctness.
7. Public/admin API contracts are documented to match reality, or unsupported routes are explicitly internal-only.
8. Operational documentation covers secrets, backups, recovery, deploy, rollback, and worker/job handling.

## 14. Appendix

### Important files inspected

- `AGENTS.md`
- `PLANS.md`
- `README.md`
- `doc/developer.md`
- `doc/technical-reference.md`
- `doc/deployment.md`
- `package.json`
- `.sidflow.json`
- `fly.toml`
- `Dockerfile.production`
- `scripts/deploy/fly-deploy.sh`
- `scripts/build-docker.sh`
- `scripts/docker-startup.sh`
- `scripts/performance-runner.ts`
- `.github/workflows/performance.yml`
- `packages/sidflow-web/openapi.yaml`
- `packages/sidflow-web/proxy.ts`
- `packages/sidflow-web/app/api/**/route.ts`
- `packages/sidflow-web/lib/server/admin-auth-core.ts`
- `packages/sidflow-web/lib/server/jwt.ts`
- `packages/sidflow-web/lib/playback-session.ts`
- `packages/sidflow-web/lib/classify-progress-store.ts`
- `packages/sidflow-web/lib/fetch-progress-store.ts`
- `packages/sidflow-web/lib/preferences-store.ts`
- `packages/sidflow-web/lib/server/user-storage.ts`
- `packages/sidflow-web/lib/server/playlist-storage.ts`
- `packages/sidflow-web/lib/server/rate-limiter.ts`
- `packages/sidflow-web/lib/server/search-index.ts`
- `packages/sidflow-web/lib/server/similarity-search.ts`
- `packages/sidflow-web/lib/server/explain-recommendation.ts`
- `packages/sidflow-web/lib/classify-runner.ts`
- `packages/sidflow-web/lib/scheduler.ts`
- `packages/sidflow-common/src/job-orchestrator.ts`
- `packages/sidflow-common/src/lancedb-builder.ts`
- `packages/sidflow-play/src/export.ts`
- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts`
- `../c64commander/src/lib/playlistRepository/types.ts`
- `../c64commander/src/pages/playFiles/hooks/useHvscLibrary.ts`

### Commands/search patterns used

- `rg --files`
- `find packages/sidflow-web/app/api -type f | sort`
- `rg -n "TODO|FIXME|placeholder|stub|not implemented|fallback|in-memory|Redis|singleton|JSON-file|rate limit|queue|worker|Fly.io|rolling"`
- targeted `sed -n` file inspections
- route-spec comparison script counting actual routes vs OpenAPI paths

### Notable TODO/stub markers

- `packages/sidflow-web/components/FavoritesTab.tsx`: queue system TODO for Play All/Shuffle
- `packages/sidflow-web/app/api/model/latest/route.ts`: stub manifest fallback
- `packages/sidflow-web/lib/server/explain-recommendation.ts`: demo/mock explanation values
- `packages/sidflow-web/lib/audio-cache-service.ts`: disabled prefetch due to latency issues
- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts`: seek/cache functionality note

### Unresolved questions

1. Which exact classified feature fields are stable enough to become the long-lived portable export vector source? The repo clearly has richer classification features than the 4-dim LanceDB vector, but the final reduced export vector design still needs a deliberate decision.
2. Is the intended production architecture ultimately single-tenant/admin-driven, or should end-user auth/favorites/playlists be treated as first-class multi-user product features? That decision changes the persistence stack urgency.
3. Should the portable correlation export be generated from pure classification data, or should it blend in feedback-derived signals when available? Both are feasible, but they imply different reproducibility/versioning semantics.
