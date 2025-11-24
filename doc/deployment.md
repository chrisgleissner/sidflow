# Deployment Guide

This guide covers running SIDFlow in production with Docker, reproducing the release flow locally, and running the CLI tools from inside the container.

## Standard Docker Scenario (Recommended)

Basic deployment (good for development/testing):

```bash
docker run -p 3000:3000 \
  -e SIDFLOW_ADMIN_USER=admin \
  -e SIDFLOW_ADMIN_PASSWORD='change-me' \
  -v /path/to/hvsc:/sidflow/workspace/hvsc \
  -v /path/to/wav-cache:/sidflow/workspace/wav-cache \
  -v /path/to/tags:/sidflow/workspace/tags \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest
```

**Security-Hardened Deployment (recommended for production):**

```bash
docker run -p 3000:3000 \
  -e SIDFLOW_ADMIN_USER=admin \
  -e SIDFLOW_ADMIN_PASSWORD='change-me' \
  --cap-drop=ALL \
  --cap-add=CHOWN,SETUID,SETGID,NET_BIND_SERVICE \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --security-opt=no-new-privileges:true \
  --user 1001:1001 \
  -v /path/to/hvsc:/sidflow/workspace/hvsc:ro \
  -v /path/to/wav-cache:/sidflow/workspace/wav-cache \
  -v /path/to/tags:/sidflow/workspace/tags \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest
```

**Security Features:**

- ✅ Non-root runtime (UID/GID 1001)
- ✅ SHA256-verified Bun downloads
- ✅ Pinned base image (`node:22-slim@sha256:...`)
- ✅ SUID/SGID bits stripped from all binaries
- ✅ Minimal package set (~650MB, removed Playwright libs)
- ✅ tini init for proper signal handling
- ✅ Restrictive file permissions (packages/scripts read-only)
- ✅ Startup script validates mount ownership
- ✅ Built-in health check (`/api/health`)

**Security Flags Explained:**

- `--cap-drop=ALL --cap-add=...`: Drop all Linux capabilities, add only required ones
- `--read-only`: Make root filesystem read-only (requires `--tmpfs /tmp`)
- `--tmpfs /tmp`: Writable temporary space with noexec/nosuid
- `--security-opt=no-new-privileges`: Prevent privilege escalation
- `--user 1001:1001`: Run as non-root sidflow user
- Mount HVSC as `:ro` (read-only) since it's never written to

**Key Information:**

- Web UI: <http://localhost:3000> (admin at `/admin`)
- Default config: `/sidflow/.sidflow.json`
- Non-root runtime, built-in Docker `HEALTHCHECK` hitting `/api/health`

## Reproduce Release Flow Locally (Build + Smoke Test)

Run the same build/smoke sequence used in CI:

```bash
npm run docker:smoke
# Optional overrides:
# IMAGE_TAG=sidflow:test PORT=4000 npm run docker:smoke
```

What it does:

- Builds `Dockerfile.production` and tags the image (`IMAGE_TAG`, default `sidflow:local`)
- Runs a container with admin creds, waits for Docker health to turn `healthy`
- Calls `/api/health` and shows the response
- Cleans up the container automatically

Prereqs: Docker daemon available; no HVSC volumes required for the smoke test.

## Images & Tags

- GHCR: `ghcr.io/chrisgleissner/sidflow:<version>` and `:latest`
- Multi-platform: `linux/amd64`, `linux/arm64`
- Production Dockerfile: `Dockerfile.production`

## Volumes and Paths

| Host path               | Container path                 | Purpose                          |
| ----------------------- | ------------------------------ | -------------------------------- |
| `/path/to/hvsc`         | `/sidflow/workspace/hvsc`      | HVSC mirror                      |
| `/path/to/wav-cache`    | `/sidflow/workspace/wav-cache` | Rendered WAV cache               |
| `/path/to/tags`         | `/sidflow/workspace/tags`      | Rating/tag files                 |
| `/path/to/data`         | `/sidflow/data`                | Classified data, availability    |

`SIDFLOW_ROOT` defaults to `/sidflow`, so the CLI and web server share the same config and data.

## Environment

Common variables:

- `SIDFLOW_ADMIN_USER` / `SIDFLOW_ADMIN_PASSWORD` (required)
- `HOST` (default `0.0.0.0`), `PORT` (default `3000`)
- `SIDFLOW_ROOT` (default `/sidflow`)
- `SIDFLOW_CONFIG` (custom config path if needed)

## CLI Usage Inside the Container

CLIs are available with Bun and native tools (ffmpeg, sidplayfp):

```bash
# Fetch HVSC
docker run --rm -w /sidflow \
  -v /path/to/hvsc:/sidflow/workspace/hvsc \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest \
  bun ./scripts/sidflow-fetch --config /sidflow/.sidflow.json

# Classify collection
docker run --rm -w /sidflow \
  -v /path/to/hvsc:/sidflow/workspace/hvsc \
  -v /path/to/wav-cache:/sidflow/workspace/wav-cache \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest \
  bun ./scripts/sidflow-classify --config /sidflow/.sidflow.json
```

Use `docker exec -w /sidflow <container>` for long-running containers.

## Health Checks & Troubleshooting

- Check status: `docker inspect --format='{{.State.Health.Status}}' <container>`
- Logs: `docker logs <container>`
- Manual health: `curl http://localhost:3000/api/health`
- If health is `unhealthy`, inspect container logs for stack traces or missing config/volumes.

## Release Zip (Alternative)

Each GitHub release publishes `sidflow-<version>.zip` containing the workspace and standalone server. Use `./scripts/start-release-server.sh` from the extracted directory when not using Docker.
