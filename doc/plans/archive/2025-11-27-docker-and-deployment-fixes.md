# Docker and Deployment Fixes (2025-11-27)

**Status**: ✅ COMPLETED

This archive consolidates Docker and deployment infrastructure fixes from 2025-11-27.

## Tasks Completed

### 1. Fix Docker Health Check Permission Regression
- **Problem**: Container health unhealthy; permission denied on `/sidflow/workspace` and `/sidflow/data`
- **Solution**: Pre-created directories owned by `node` user in Dockerfile.production
- **Verification**: `bun run test` passed 3× (1440 pass each)

### 2. Fix Docker CLI Executable Resolution
- **Problem**: "spawn sidflow-fetch ENOENT" in container
- **Solution**: Added `SIDFLOW_CLI_DIR=/sidflow/app/scripts` env var; added config symlink
- **Verification**: `/api/fetch` returns success:true; health check passes

### 3. Fix Temporary Directory Space Issues
- **Problem**: /tmp ran out of space during Docker testing, truncating WAV files
- **Solution**: Created `getTmpDir()` helper respecting `SIDFLOW_TMPDIR`; added `/opt/sidflow/tmp` in Docker
- **Files**: `packages/sidflow-common/src/fs.ts`, `Dockerfile.production`

### 4. Root Cause WAV Duration Truncation
- **Problem**: WAV files rendering too short (15s instead of 46s)
- **Root Causes Fixed**:
  1. renderWavCli ignored targetDurationMs
  2. WasmRendererPool bypassed defaultRenderWav
  3. Config loading wrong file
  4. Songlength lookup failing for subdirectories
  5. sidplayfp-cli `-t` flag format (needs no space: `-t48`)
- **Verification**: 1st_Chaff.sid renders 50.0s (expected 46s + padding)

### 5. Simplify WAV Rendering
- **Decision**: Let sidplayfp-cli read Songlengths.md5 automatically via sidplayfp.ini
- **Verification**: Direct invocation WITHOUT `-t` produces correct durations

## Key Files Modified
- `Dockerfile.production` - Directory creation, env vars, p7zip-full
- `packages/sidflow-common/src/fs.ts` - getTmpDir helper
- `packages/sidflow-classify/src/render/render-orchestrator.ts` - Duration fixes
- `scripts/docker-startup.sh` - Permission handling
