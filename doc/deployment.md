# Deployment

## Docker (Recommended)

```bash
docker run -p 3000:3000 \
  -e SIDFLOW_ADMIN_USER=admin \
  -e SIDFLOW_ADMIN_PASSWORD='your-password' \
  -v /path/to/hvsc:/sidflow/workspace/hvsc \
  -v /path/to/audio-cache:/sidflow/workspace/audio-cache \
  -v /path/to/tags:/sidflow/workspace/tags \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest
```

Access at `http://localhost:3000` (admin at `/admin`).

## Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh
flyctl auth login

# Deploy
./scripts/deploy/fly-deploy.sh -e stg   # Staging
./scripts/deploy/fly-deploy.sh -e prd   # Production
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SIDFLOW_ADMIN_USER` | Yes | Admin username |
| `SIDFLOW_ADMIN_PASSWORD` | Yes | Admin password |
| `PORT` | No | Server port (default: 3000) |

## Health Check

```bash
curl http://localhost:3000/api/health
```
