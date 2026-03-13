# Deployment

## Docker (Recommended)

```bash
docker run -p 3000:3000 \
  -e SIDFLOW_ADMIN_USER=admin \
  -e SIDFLOW_ADMIN_PASSWORD='your-password' \
  -e SIDFLOW_ADMIN_SECRET='replace-with-a-32-character-secret-minimum' \
  -e JWT_SECRET='replace-with-a-32-character-secret-minimum' \
  -v /path/to/hvsc:/sidflow/workspace/hvsc \
  -v /path/to/audio-cache:/sidflow/workspace/audio-cache \
  -v /path/to/tags:/sidflow/workspace/tags \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest
```

Access at `http://localhost:3000` (admin at `/admin`).

## Fly.io

Current supported topology: one stateful machine. Do not scale out or use rolling deploys until the shared-state and worker separation roadmap phases are complete.

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
| `SIDFLOW_ADMIN_USER` | No | Admin username (defaults to `admin` outside production) |
| `SIDFLOW_ADMIN_PASSWORD` | Yes | Admin password |
| `SIDFLOW_ADMIN_SECRET` | Yes | Admin session signing secret, minimum 32 characters in production |
| `JWT_SECRET` | Yes | User JWT signing secret, minimum 32 characters in production |
| `PORT` | No | Server port (default: 3000) |

Production boot fails fast when these conditions are not met:

- `SIDFLOW_ADMIN_PASSWORD` is missing, too short, or still set to the development default.
- `SIDFLOW_ADMIN_SECRET` is missing, too short, or derived from the admin password.
- `JWT_SECRET` is missing, too short, or still set to the development fallback.
- `SIDFLOW_DISABLE_ADMIN_AUTH=1` or `SIDFLOW_DISABLE_RATE_LIMIT=1` is present.

## Health Check

```bash
curl http://localhost:3000/api/health
```
