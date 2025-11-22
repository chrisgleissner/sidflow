# Deployment Guide

This guide covers running SIDFlow in production with Docker, reproducing the release flow locally, and running the CLI tools from inside the container.

## Standard Docker Scenario (Recommended)

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
