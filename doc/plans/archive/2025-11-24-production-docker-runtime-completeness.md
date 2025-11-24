# Task: Production Docker Runtime Completeness (2025-11-24)

**Status**: ✅ Complete  
**Archived**: 2025-11-24

## Summary

Extended production Docker image to include full CLI/runtime tools (sidplayfp, ffmpeg, Bun, libsidplayfp-wasm) and fixed release workflow for reliable GHCR publishing.

## Key Changes

- ✅ Arch-aware Bun download (x64 + arm64)
- ✅ Runtime apt tools added (ffmpeg, sidplayfp, curl, unzip, jq, bash, zip)
- ✅ SIDFLOW_ROOT config for workspace assets
- ✅ Release workflow: correct ref checkout, :latest tagging, GHCR visibility
- ✅ Deployment docs refreshed with CLI/volume guidance

## Outcomes

All runtime requirements satisfied. Docker image now supports full pipeline usage (fetch, classify, train, play) in addition to web server.
