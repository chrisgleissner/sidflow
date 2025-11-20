# Search & Favorites Performance + E2E Hardening (2025-11-18 to 2025-11-19)

**Archived from PLANS.md on 2025-11-20**

## Task Summary

Investigated slow/failing E2E tests, implemented performance profiling infrastructure, and delivered durable fixes for test stability.

## Completed Steps

### Step 1: Baseline E2E Resource Usage ✅
- Automated CPU/RAM logging with `pidstat -rud -p ALL 10` (10s cadence)
- Created `bun run profile:e2e` workflow
- Captured baseline artifacts under `tmp/profiles/`

### Step 2: Analyze Logs/Runtime Reports ✅
- Runtime analysis via `npm run analyze:e2e`
- Identified audio-fidelity and search flows dominate wall-clock (30-35s)
- Confirmed majority of time spent spawning Next production server + idle network waits
- V8 CPU summaries show minimal app logic overhead

### Step 3: Performance + Stability Fixes ✅
- Playwright now seeds favorites through `/api/favorites` with retries instead of mutating `.sidflow-preferences.json`
- Playwright web server skips redundant `next build` (`SIDFLOW_SKIP_NEXT_BUILD=1`)
- Favorites tests run serially with reload-aware helper
- Flaky ECONNRESETs eliminated

### Step 4: Profile E2E Workflow ✅
- `bun run profile:e2e` workflow with spec filters, flamegraph, textual summary
- Documented usage in `doc/developer.md`
- Artifacts: CPU profiles, memory snapshots, V8 summaries

### Step 5: Run Full Test Suites ✅
- `npm run test:e2e`: 61 specs, 2 workers + serial favorites - ALL PASS
- `SIDFLOW_SKIP_WASM_UPSTREAM_CHECK=1 npm run test`: ALL PASS
- Upstream git check guarded against transient GitHub 500s

### Step 6: Eliminate Benign Logs ✅
- Added log suppression in `start-test-server.mjs`
- `SIDFLOW_SUPPRESS_ABORT_LOGS` + `SIDFLOW_DEBUG_REQUEST_ERRORS` flags
- Drops `ECONNRESET/EPIPE` noise while keeping opt-in diagnostics
- Reran `npm run test:e2e` - green output with quiet server logs

### Step 7: Profile Additional Specs ✅
- Profiled `screenshots.spec.ts` and `song-browser.spec.ts`
- Captured CPU profiles showing <100ms CPU but long wall-clock
- Identified Next process thrash + repeated UI stabilization waits
- `waitForStableUi` theme timeouts and HVSC listing bottlenecks
- Summaries logged for follow-up optimization

## Key Deliverables

1. **Profiling Infrastructure**: `bun run profile:e2e` with CPU/RAM logging
2. **Test Stability**: Favorites seeding via API, serial execution, reload-aware helpers
3. **Performance Fixes**: Skip redundant Next builds, guard upstream checks
4. **Log Management**: Benign error suppression with opt-in diagnostics
5. **Documentation**: Profiling workflow in `doc/developer.md`, runtime data in `doc/performance/e2e-runtime-2025-11-18.md`

## Performance Improvements

**Before:**
- Flaky ECONNRESETs from file mutations
- Redundant `next build` on every test run
- Noisy server logs obscuring real errors

**After:**
- API-based favorites seeding (stable)
- Build cache reuse (faster)
- Clean test output (readable)
- Audio/telemetry suites: ≈5s per test
- Full E2E suite: 61 specs passing reliably

## Artifacts

- `tmp/profiles/e2e-profile-*/`: CPU profiles, V8 summaries, memory snapshots
- `doc/performance/e2e-runtime-2025-11-18.md`: Before/after runtime analysis
- `doc/developer.md`: Profiling workflow documentation

## Follow-ups / Future Work

- Further UI trim optimization for favorites + song-browser suites
- Reduce `waitForStableUi` timeouts
- Optimize HVSC listing for large collections
- Consider parallel test execution for independent suites
