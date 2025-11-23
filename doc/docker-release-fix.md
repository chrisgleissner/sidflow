# Docker Release Upload Fix

## Problem

Between releases 0.3.13 and 0.3.14, Docker image uploads to GitHub Container Registry (GHCR) began failing with 502 errors during the layer upload phase. The error occurred when pushing large multi-platform (linux/amd64 + linux/arm64) images.

### Error Signature

```
#78 writing layer sha256:80e602c8d6675dd4ea5a1d8083974cb56cffdcc1248a847e24b055a83587951f 20.4s done
#78 ERROR: error writing layer blob: failed to parse error response 502: <!DOCTYPE html>
...
```

## Root Cause

The issue was caused by changes in `docker/build-push-action@v6`:

1. **SBOM Attestations**: Version 6 of the action changed how Software Bill of Materials (SBOM) attestations are handled, even when provenance is disabled
2. **Large Manifest Lists**: Multi-platform builds create large manifest lists that can timeout during upload to GHCR
3. **Registry Limits**: GitHub Container Registry has stricter timeouts and size limits for manifest uploads

## Solution

### 1. Disable SBOM Attestations

Added `sbom: false` to complement the existing `provenance: false`:

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v6
  with:
    # ... other config ...
    provenance: false
    sbom: false  # NEW: Reduces manifest complexity
```

**Impact**: Reduces manifest size and complexity, avoiding GHCR upload timeouts.

### 2. Optimize Buildx Configuration

Configure buildx with latest buildkit and host networking:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3
  with:
    driver-opts: |
      image=moby/buildkit:latest
      network=host
```

**Impact**: Uses the latest buildkit version with better reliability and network performance.

### 3. Add Automated Smoke Test

Added comprehensive smoke test after image upload:

```yaml
- name: Smoke test Docker image
  run: |
    # Pull the uploaded image (verifies upload succeeded)
    docker pull "ghcr.io/${{ github.repository }}:${{ steps.version.outputs.version }}"
    
    # Start container and wait for health check
    CONTAINER_ID=$(docker run -d -p 3000:3000 --name sidflow-smoke-test "${IMAGE_TAG}")
    
    # Wait for Docker health check to pass (max 2 minutes)
    # Health check uses /api/health endpoint
    
    # Verify /api/health endpoint responds correctly
    curl -f http://localhost:3000/api/health
    
    # Cleanup
    docker stop "${CONTAINER_ID}" && docker rm "${CONTAINER_ID}"
```

**Benefits**:
- ✅ Verifies image was successfully uploaded
- ✅ Validates container starts correctly
- ✅ Confirms health check endpoint works
- ✅ Catches deployment issues before they reach production
- ✅ Provides confidence for automated releases

## Health Check

The Docker image includes a health check that verifies:

- **WASM files**: Checks for sidplayfp.wasm in public/wasm/
- **sidplayfp CLI**: Verifies binary is executable and working
- **Streaming assets**: Checks for availability manifest
- **Ultimate 64** (optional): Tests connectivity if configured

Health check configuration (from `Dockerfile.production`):

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1
```

## Local Testing

You can reproduce the full release flow locally:

```bash
# Run the same build + smoke test sequence used in CI
npm run docker:smoke

# Or with custom settings
IMAGE_TAG=sidflow:test PORT=4000 npm run docker:smoke
```

This script:
1. Builds the production Docker image
2. Starts a container with the image
3. Waits for the health check to pass
4. Verifies the `/api/health` endpoint
5. Cleans up the container

## Prevention

To avoid similar issues in the future:

1. **Always disable attestations for large multi-platform images**:
   - Set `provenance: false`
   - Set `sbom: false`

2. **Use latest buildkit**: Keep buildx configuration updated with `image=moby/buildkit:latest`

3. **Test releases locally**: Use `npm run docker:smoke` before pushing tags

4. **Monitor CI logs**: Watch for build/push duration increases that might indicate upload issues

## Related Files

- `.github/workflows/release.yaml` - Release workflow with smoke test
- `scripts/docker-smoke.sh` - Local smoke test script
- `Dockerfile.production` - Production Docker image definition
- `packages/sidflow-web/app/api/health/route.ts` - Health check endpoint
- `doc/deployment.md` - Deployment guide with health check documentation

## References

- [docker/build-push-action v6 changes](https://github.com/docker/build-push-action/releases/tag/v6.0.0)
- [GitHub Container Registry limits](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker buildx documentation](https://docs.docker.com/build/buildx/)
