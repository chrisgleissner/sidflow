# Changelog

This changelog highlights only the meaningful releases and milestones. Routine “update CHANGES.md” noise is removed.

## 0.3.43 (2025-12-02)
- Refined classify progress counters and data-testid coverage for thread metrics.
- Clarified feature extraction output visibility and terminology in docs/UI.
- Updated Fly.io production configuration and admin credential handling.
- Cleaned README terminology (HVSC → SID Browser) and deployment notes.

## 0.3.42 (2025-11-30)
- Added classification scheduler plus export/import APIs and UI with tests.
- Exposed skip/delete options for classification runs; improved parallelism for exports/imports.
- Optimized unit/E2E tests and Playwright waits for stability.
- Deployment fixes: dynamic staging app name and corrected health-check URL.

## 0.3.41–0.3.40 (2025-11-28–30)
- Large test-speed improvements (phase transitions, accessibility waits, higher worker counts).
- Pause/resume playback sync fixes; inline rendering heartbeat and phase visibility.
- HVSC extraction reliability: p7zip-full support and richer error logging.
- Fly.io deployment hardening: health checks, dynamic app selection, admin password workflow.

## 0.3.39–0.3.35 (2025-11-27–28)
- Classification pipeline tightening: inline render per song, Essentia-first defaults, thread state verification.
- Docker/health adjustments: precreate workspace/data paths, roms dir, sudo-safe install paths.
- Security/health: auth-safe health checks, sidplayfp CLI rendering simplification, WAV duration fixes.

## 0.3.34–0.3.32 (2025-11-26–27)
- Added default sidplayfp.ini creation and force-rebuild flag for classification.
- Improved render engine ordering, UI display of active engines, and non-root Docker execution.
- Config tidying: preferred engines, render defaults, and CPU limit tuning for deploy scripts.

## Earlier milestones (≤0.3.31)
- 0.3.31 (2025-11-25): Unified performance runner (Playwright + k6) with deterministic tmp/results layout.
- 0.3.28–0.3.24: End-to-end classification pipeline with Essentia defaults and JSONL export; WAV render cache + songlength safeguards; improved retry/backoff.
- 0.3.20–0.3.15: HVSC fetch pipeline hardened, sidplayfp/ffmpeg integration, workspace layout finalized.
- 0.3.10: Initial public release with fetch, classify (heuristic), rate, play, and Fly/Docker deployment scaffolding.
- 0.3.9–0.3.6: Release packaging hardening (standalone Next.js bundle, size cuts, symlink handling), GHCR images, and smoke-testable artifacts.
- 0.3.5–0.3.3: CI stabilization (path filters, retries, sharding) and E2E coverage ramp.
- 0.3.2–0.3.1: AudioWorklet/SAB pipeline, telemetry, similarity search, favorites, playlists, adaptive station, and first comprehensive web rollout phases.

## 0.2.x (2025-10)
- Introduced web UI flows for browse/search/play with early rating storage.
- Added basic progress reporting for classification, initial Playwright E2E harness, and unified performance journey scaffolding.
- Release automation and Docker/Fly scripts stabilized with health checks and config defaults.

## 0.1.x (2025-09)
- First internal prototypes: HVSC fetcher, WASM-based SID rendering, heuristic ratings.
- Seeded workspace layout (`hvsc`, `wav-cache`, `tags`) and minimal CLI wrappers.
- Laid groundwork for future feature extraction and training flows.
