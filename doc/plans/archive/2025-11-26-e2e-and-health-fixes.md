# E2E Tests and Health Check Fixes (2025-11-26)

**Status**: ✅ COMPLETED

## Tasks Completed

### 1. Fix E2E Test Failures
- **Problem**: Mass `ERR_CONNECTION_REFUSED` when navigating to localhost
- **Root Cause**: `localhost` resolved to IPv6 `::1` but server bound to IPv4 only
- **Solution**: Changed Playwright baseURL to `http://127.0.0.1:3000`
- **Verification**: 115/115 Playwright specs pass × 3 consecutive runs

### 2. Strengthen Health Checks & Fix UI Loading
- **Problem**: UI stuck on "Loading..." due to CSP blocking inline scripts
- **Solutions**:
  - Extended `/api/health` to validate workspace paths and UI route rendering
  - Default CSP now allows inline scripts (strict opt-out via `SIDFLOW_STRICT_CSP=1`)
  - Added install.sh `--build-image` flag and UID/GID overrides
  - Fixed container permission issues by passing host UID/GID to Docker build
  - Added tmpfs mount for Next.js cache to fix ISR rendering
- **Verification**: Health check passes, UI renders correctly

### 3. Reproduce Docker Build & Verification Locally
- **Task**: Mirror CI Docker build/smoke locally
- **Verification**: `scripts/docker-smoke.sh` passed - built image, health OK

## Key Files Modified
- `packages/sidflow-web/playwright.config.ts` - IPv4 baseURL
- `app/api/health/route.ts` - Extended health checks
- `middleware.ts` - CSP policy changes
- `scripts/deploy/install.sh` - UID/GID handling
