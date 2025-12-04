# Fly.io Deployment Infrastructure (2025-11-27 to 2025-11-29)

**Status**: ✅ COMPLETED

## Summary
Set up Fly.io deployment infrastructure as an alternative to Raspberry Pi deployment.

## Key Decisions
1. **Single volume mount**: Fly.io only supports one volume per machine; mount at `/mnt/data`
2. **Symlink strategy**: Startup script creates symlinks from `/sidflow/workspace` and `/sidflow/data` to `/mnt/data`
3. **Standard node user**: Switched from custom UID 1001 to standard node:1000 for platform compatibility
4. **App code location**: Moved to `/sidflow/app` to avoid volume mount shadowing

## Files Created
- `fly.toml` - Base Fly.io configuration
- `fly.stg.toml` - Staging environment
- `fly.prd.toml` - Production environment
- `scripts/deploy/fly-deploy.sh` - Manual deployment script
- `doc/fly-deployment.md` - Complete deployment guide

## Files Modified
- `.github/workflows/release.yaml` - Added deploy-fly-stg and deploy-fly-prd jobs
- `scripts/docker-startup.sh` - Conditional symlink creation for Fly.io
- `Dockerfile.production` - App code in `/sidflow/app`, standard node user
- `scripts/deploy/README.md` - Added Fly.io section

## Deployment Status
- Staging: https://sidflow-stg.fly.dev (deployed)
- Production: https://sidflow.fly.dev (deployed, health check passing)

## Configuration
- 512MB RAM, 1 shared CPU, London region
- Volumes: 3GB for workspace + data
- Health checks: `/api/health` with 15s intervals
