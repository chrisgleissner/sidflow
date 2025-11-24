# Task: Docker Release Image & GHCR Publishing (2025-11-24)

**Status**: ✅ Complete  
**Archived**: 2025-11-24

## Summary

Extended release workflow to publish hardened Docker images to public GHCR, fixed ZIP release packaging, and implemented container health validation.

## Key Achievements

- ✅ Fixed ZIP release (complete Next.js standalone tree with public/.next/static)
- ✅ Hardened production Dockerfile (multi-stage, node:22-slim, non-root)
- ✅ Multi-platform builds (linux/amd64, linux/arm64)
- ✅ GHCR publishing with :latest and :<version> tags
- ✅ Container health validation in workflow
- ✅ README documentation updated

## Technical Details

- Runtime base: node:22-slim (minimal Node.js for standalone server)
- Security: non-root user, read-only filesystem support, HEALTHCHECK endpoint
- Published to: ghcr.io/chrisgleissner/sidflow
