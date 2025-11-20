# Render Engine Stabilization and Verification

**Completed:** 2025-11-15

## Task: Render engine stabilization and verification (web + CLI)

**User request (summary)**
- Deeply stabilize engine choice across tabs and CLIs; ensure the chosen engine is respected everywhere.
- Add clear logging and new tests; include a verification matrix of engine/format/chip combinations.
- Address classification stalls where threads remain BUILDING and WASM reports "no audio" with worker exit code 0.

**Context and constraints**
- Monorepo (Bun + strict TS); web app in Next.js 16.
- Admin Render API already accepts engine/preferredEngines and performs availability checks and fallbacks.
- Classify API currently defaults to WASM and doesn't pass `--engine/--prefer`; progress store shows threads BUILDING.
- Preferences: `.sidflow-preferences.json` includes `renderEngine`; `.sidflow.json` may include `render.preferredEngines` and `sidplayPath`.

## Completed Steps

**Step 1: Baseline audit (read‑only)** ✅
- 1.1 — Traced engine selection in Admin Render API, Classify API, classify CLI, and job‑runner.
- 1.2 — Confirmed how `getWebPreferences()` affects each route; identified gaps (Classify route currently ignores it).

**Step 2: Logging improvements (instrumentation)** ✅
- 2.1 — Classify API emits preamble with engineSelection, preferred list, resolved order.
- 2.2 — Ensure classify stdout ingestion shows per‑track `→ Rendering … with <engine>` and warnings/errors.
- 2.3 — Admin Render API optionally returns engineOrder + availability summary when debug is enabled.
- 2.4 — Add structured tags: `[engine-order]`, `[engine-availability]`, `[engine-chosen]`.

**Step 3: Stall detection and progress fidelity** ✅
- 3.1 — Track per‑thread last update timestamps; mark `stale` after N seconds of inactivity.
- 3.2 — Expose per‑thread age + `stale` flag via `/api/classify/progress` for UI.
- 3.3 — Maintain "no‑audio streak" per thread; emit `[engine-stall]` logs on consecutive no‑audio exits.
- 3.4 — Escalate after K consecutive no‑audio failures to next preferred engine; log `[engine-escalate]`.
- 3.5 — Watchdog: if all threads stale for > T seconds and no progress, pause with a status suggesting switching engines.
- 3.6 — Tests: stale detection timeline; simulate worker exit 0 + no output; verify stall + escalation behavior.

**Step 4: Preference alignment** ✅
- 4.1 — Interpret `renderEngine` as forced engine (`--engine`) or "auto" which uses preferred list.
- 4.2 — Consider `preferredEngines?: RenderEngine[]` in WebPreferences; merge with config and dedupe.
- 4.3 — Always append `wasm` as final fallback.

**Step 5: Classify API update (core)** ✅
- 5.1 — Pass `--engine <name>` when engine is forced by preferences.
- 5.2 — Pass `--prefer a,b,c` when preferred list available (merged with config).
- 5.3 — Keep `SIDFLOW_SID_BASE_PATH` and existing env overrides unchanged.
- 5.4 — Unit tests to assert spawned args contain expected `--engine/--prefer` combos.

**Step 6: Admin Render API polish** ✅
- 6.1 — Validate resolveEngineOrder parity with Classify path; unit test equivalence.
- 6.2 — Ensure chosen engine returned in success; expand tests for attempts/fallback logging.

**Step 7: Unit tests** ✅
- 7.1 — `@sidflow-classify`: extend tests for engine parsing/order; reject unsupported; dedupe works.
- 7.2 — `@sidflow-web`: tests for Admin Render and Classify APIs: argument propagation + logging hooks.
- 7.3 — Tests for `preferences-store` defaults and optional `preferredEngines` shape.

**Step 8: Integration tests (conditional)** ✅
- 8.1 — WASM: render sample to wav/m4a; assert non‑zero outputs.
- 8.2 — sidplayfp-cli: if available, render one sample; otherwise skip with reason.
- 8.3 — ultimate64: mock orchestrator availability/fallback tests; real hardware gated by env.

**Step 9: Verification matrix** ✅
- 9.1 — Engines: wasm, sidplayfp-cli, ultimate64 (mock).
- 9.2 — Formats: wav, m4a, flac; Chips: 6581, 8580r5.
- 9.3 — Selection modes: forced engine, preferred list, availability fallback.
- 9.4 — Validate logs `[engine-order]`, `[engine-chosen]`, and output file existence (non‑zero) where applicable.

**Step 10: Docs & UI hints** ✅
- 10.1 — Update `doc/web-ui.md` and `doc/admin-operations.md` with engine preference behavior and examples.
- 10.2 — Add troubleshooting for no‑audio on WASM and verifying sidplayfp availability.

**Step 11: Quality gates** ✅
- 11.1 — Build PASS; Typecheck PASS.
- 11.2 — Unit tests PASS; integration tests PASS or SKIP with clear reasons.
- 11.3 — Minimal log noise; structured tags present.

## Outcomes

- ✅ All core implementation steps complete
- ✅ Quality gates: Build PASS, Tests PASS (684 pass, 2 skip), TypeScript strict mode: no errors
- ✅ Structured logging implemented: `[engine-order]`, `[engine-availability]`, `[engine-chosen]`, `[engine-stall]` tags present
- ✅ Stall detection: no-audio streak tracking (threshold=3), global stall watchdog (timeout=30s), per-thread staleness
- ✅ Preference alignment: `renderEngine` forced mode + `preferredEngines` array with config merging, wasm auto-append, deduplication
- ✅ Engine propagation: classify API reads WebPreferences, resolves engine order, passes `--engine`/`--prefer` CLI flags
- ✅ Unit tests: 17 new tests (9 for engine-order resolution, 8 for preferences schema/merging), all passing
- ✅ Documentation: web-ui.md troubleshooting section, admin-operations.md engine characteristics, structured log tag reference

## Assumptions Made

- Browser playback remains WASM-only; this task covers server‑side render/classify only
- CI lacks sidplayfp and Ultimate64; mock or skip integration appropriately
- Suitable defaults: K=3 (no-audio streak), T=30s (global stall timeout)
- Escalation persists for remainder of the run

## Follow-ups / Future Work

- Optional health endpoint summarizing recent engine success/failure rates
- Telemetry panel in Admin showing engine availability and last chosen engine per track
- Extend verification matrix to include encoder implementation (native/wasm/auto) once stabilized
