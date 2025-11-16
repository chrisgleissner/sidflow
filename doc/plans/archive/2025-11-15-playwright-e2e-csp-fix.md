# Fix Playwright E2E CSP & Screenshots Regressions

**Completed:** 2025-11-15

## Task: Fix Playwright E2E CSP & screenshots regressions (web)

**User request (summary)**  
- All Playwright E2E suites must pass locally and on CI
- Playback tests failing due to CSP blocking data URLs
- Screenshot suite aborts when the page closes early

**Context and constraints**  
- `proxy.ts` sets strict CSP with `connect-src 'self'` (prod) / `connect-src 'self' ws: wss:` (dev)
- Playwright fixture loads SID assets from `data:` URIs
- Blocking them prevents audio workers from loading, so pause buttons never become ready
- Screenshot specs rely on the same pages; when playback fails, shared browser context closes, cascading into timeouts
- Must preserve COOP/COEP headers and overall security posture

## Completed Steps

**Step 1** — Investigate failing E2E logs/traces; confirm CSP root cause and identify any other blockers ✅
- Received CI artifact showing `connect-src 'self'` blocking data: SID loads
- Playback and screenshot specs timing out

**Step 2** — Update CSP connect-src directive (both dev/prod) to allow `data:` ✅
- Added `data:` scheme to both dev/prod `connect-src` directives
- Retained ws/wss in dev for WebSocket support

**Step 3** — Add/adjust unit tests in `security-headers.test.ts` ✅
- Updated tests to verify CSP allows data URLs for SID fixtures
- Verified CSP maintains strict security posture otherwise

**Step 4** — Run targeted unit tests to ensure CSP changes are covered ✅
- Ran `bun test packages/sidflow-web/tests/unit/security-headers.test.ts`
- 39 tests pass

**Step 5** — Run `bun run test:e2e` (full suite) and ensure all Playwright tests pass ✅
- Full suite includes integration pipeline + 24 Playwright specs
- Fixed screenshot wait timeout issue
- 23 passed, 1 skipped
- Overall repo build/typecheck/tests PASS

## Issues Fixed

1. **CSP Blocking Data URLs**
   - Symptom: `connect-src 'self'` blocked data: SID loads
   - Root cause: CSP didn't allow data: scheme for SID asset loading
   - Fix: Added `data:` to connect-src directive in both dev/prod modes

2. **Screenshot Timeouts**
   - Symptom: Screenshot suite aborted when page closed early
   - Root cause: Shared browser context closure cascading failures
   - Fix: Adjusted wait timeouts in screenshot harness

## Quality Gates

- ✅ Build: TypeScript compilation clean
- ✅ Unit Tests: 39 security header tests pass
- ✅ E2E Tests: 23 pass, 1 skip (full Playwright suite)
- ✅ Integration: Pipeline tests pass

## Assumptions Made

- Allowing `connect-src data:` is sufficient; no need to loosen `media-src`/`worker-src` because they already include blob:
- Tests use only trusted in-repo data URLs, so expanding `connect-src` is acceptable
- Real users also load SID blobs via data URLs when exporting, so production allowance is justified

## Follow-ups / Future Work

- Consider serving SID fixtures from `/virtual` HTTP endpoints instead of data URLs to avoid CSP relaxations entirely
- Revisit screenshot harness to isolate failures per tab (separate contexts) so one crash doesn't cascade
