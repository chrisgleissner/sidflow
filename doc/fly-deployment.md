# Fly.io Deployment Guide

This guide covers deploying SIDFlow to Fly.io, which is now the default deployment target alongside the optional Raspberry Pi deployment.

## Quick Start

### Prerequisites

1. **Install flyctl**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Authenticate**:
   ```bash
   flyctl auth login
   ```

3. **Create apps** (one-time):
   ```bash
   # Staging
   flyctl apps create sidflow-stg --region lhr

   # Production
   flyctl apps create sidflow-prd --region lhr
   ```

4. **Create volumes** (one-time):
   > **Note**: Fly.io supports only ONE volume per machine. We mount at `/data` (universal path across Docker Compose, Fly.io, K8s). Symlinks are created automatically at startup to `/sidflow/workspace` and `/sidflow/data`.
   
   ```bash
   # Staging volume (3GB for free tier)
   flyctl volumes create sidflow_data --region lhr --size 3 --app sidflow-stg

   # Production volume (increase size as needed)
   flyctl volumes create sidflow_data --region lhr --size 10 --app sidflow-prd
   ```

5. **Set GitHub secret for admin password** (one-time):
   - Add repository secret `SIDFLOW_ADMIN_PASSWORD` (or environment-specific `SIDFLOW_ADMIN_PASSWORD_STG` / `SIDFLOW_ADMIN_PASSWORD_PRD`).
   - The release workflow syncs this secret into Fly via `flyctl secrets set SIDFLOW_ADMIN_PASSWORD=...` before deploying.

## Deployment Methods

### Method 1: Automatic Deployment via GitHub Actions (Recommended)

Triggered automatically when you push a version tag:

```bash
git tag v0.3.29
git push origin v0.3.29
```

This will:
1. Build Docker image and push to `ghcr.io/chrisgleissner/sidflow:v0.3.29`
2. Deploy to `sidflow-stg` (staging) automatically
3. Wait for manual approval in GitHub
4. Deploy to `sidflow-prd` (production) after approval

**Setup Steps:**

1. **Get your Fly.io API token**:
   ```bash
   flyctl auth token
   ```

2. **Add GitHub secret**:
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `FLY_API_TOKEN`
   - Value: (paste your token)

3. **Create GitHub environments** (for manual approval):
   - Go to Settings → Environments
   - Create `staging-fly` environment
   - Create `production-fly` environment with required reviewers

### Method 2: Manual Deployment via CLI Script

For manual deployments or local testing:

```bash
# Deploy latest to staging
./scripts/deploy/fly-deploy.sh -e stg

# Deploy specific version to production
./scripts/deploy/fly-deploy.sh -e prd -t v0.3.29

# Deploy to different region
./scripts/deploy/fly-deploy.sh -e stg -r lhr

# Dry run (show what would be deployed)
./scripts/deploy/fly-deploy.sh -e prd -t v0.3.29 --dry-run
```

**Script Options:**
- `-e, --environment <stg|prd>`: Target environment (required)
- `-t, --tag <tag>`: Docker image tag (default: latest)
- `-r, --region <region>`: Fly.io region (default: lhr)
- `-f, --force`: Skip production confirmation prompt
- `-n, --dry-run`: Show deployment plan without deploying
- `-h, --help`: Show help message

## Configuration

### fly.toml

The base configuration is in `fly.toml`. It defines:

- **Resources**: 512MB RAM, 1 shared CPU
- **Volumes**: Persistent storage for data and workspace
- **Health checks**: HTTP check on `/api/health`
- **Scaling**: 1-3 machines
- **Region**: London (lhr) by default

The deployment scripts automatically generate environment-specific configurations:
- `fly.stg.toml` for staging
- `fly.prd.toml` for production

### Environment Variables

Set via `flyctl secrets`:

```bash
# Example: Set secrets for staging
flyctl secrets set \
  SOME_API_KEY=xxx \
  SOME_SECRET=yyy \
  --app sidflow-stg

# Example: Set secrets for production
flyctl secrets set \
  SOME_API_KEY=xxx \
  SOME_SECRET=yyy \
  --app sidflow-prd
```

## Operations

### Monitoring

```bash
# View application status
flyctl status --app sidflow-stg

# View logs (live)
flyctl logs --app sidflow-stg

# View metrics
flyctl dashboard --app sidflow-stg
```

### Scaling

```bash
# Scale to 2 machines
flyctl scale count 2 --app sidflow-prd

# Upgrade to performance CPU
flyctl scale vm performance-1x --app sidflow-prd

# Increase memory
flyctl scale memory 1024 --app sidflow-prd
```

### Accessing the App

```bash
# SSH into running instance
flyctl ssh console --app sidflow-stg

# Run command in container
flyctl ssh console --app sidflow-stg --command "ls -la /sidflow"

# Access PostgreSQL proxy (if using Fly Postgres)
flyctl proxy 5432 --app sidflow-stg
```

### Volume Management

```bash
# List volumes
flyctl volumes list --app sidflow-stg

# Expand volume size
flyctl volumes extend <volume-id> --size 100 --app sidflow-stg

# Snapshot volume
flyctl volumes snapshots create <volume-id> --app sidflow-stg

# List snapshots
flyctl volumes snapshots list <volume-id> --app sidflow-stg
```

### Rollback

```bash
# List releases
flyctl releases --app sidflow-prd

# Rollback to previous version
flyctl releases rollback --app sidflow-prd

# Rollback to specific version
flyctl releases rollback <version> --app sidflow-prd
```

## Troubleshooting

### Deployment Fails

1. **Check logs**:
   ```bash
   flyctl logs --app sidflow-stg
   ```

2. **Check deployment status**:
   ```bash
   flyctl status --app sidflow-stg
   ```

3. **Verify volumes exist**:
   ```bash
   flyctl volumes list --app sidflow-stg
   ```

4. **Check app configuration**:
   ```bash
   flyctl config show --app sidflow-stg
   ```

### Health Check Fails

1. **Check application logs** for startup errors
2. **Verify health endpoint** responds locally:
   ```bash
   curl https://sidflow-stg.fly.dev/api/health
   ```
3. **Adjust health check timeouts** in `fly.toml` if needed

### Volume Issues

If volume mount fails:

1. **Check volume region matches app region**:
   ```bash
   flyctl volumes list --app sidflow-stg
   flyctl regions list --app sidflow-stg
   ```

2. **Destroy and recreate volume** (data will be lost):
   ```bash
   flyctl volumes destroy <volume-id> --app sidflow-stg
   flyctl volumes create sidflow_data --region lhr --size 20 --app sidflow-stg
   ```

### Out of Memory

If the app crashes with OOM:

1. **Increase memory allocation**:
   ```bash
   flyctl scale memory 1024 --app sidflow-stg
   ```

2. **Check memory usage**:
   ```bash
   flyctl ssh console --app sidflow-stg --command "free -h"
   ```

## Cost Optimization

### Free Tier

Fly.io offers generous free tier:
- 3 shared-cpu-1x machines (256MB RAM)
- 3GB persistent volumes
- 160GB outbound data transfer

For SIDFlow:
- Use 1 machine per environment (stg + prd = 2 machines)
- Keep volumes under 3GB total
- Monitor data transfer

### Production Scaling

For better performance:

```bash
# Upgrade to dedicated CPU
flyctl scale vm performance-1x --app sidflow-prd

# Increase memory
flyctl scale memory 1024 --app sidflow-prd

# Add more machines for redundancy
flyctl scale count 2 --app sidflow-prd
```

## Comparison: Fly.io vs Raspberry Pi

| Feature | Fly.io | Raspberry Pi |
|---------|--------|--------------|
| **Setup Time** | 5 minutes | 1-2 hours |
| **Cost** | Free tier / $5-20/mo | Hardware cost + electricity |
| **Scalability** | Instant | Manual hardware upgrade |
| **Reliability** | 99.95% SLA | Depends on setup |
| **Maintenance** | Managed | Self-managed |
| **Deployment** | Instant | 2-5 minutes |
| **Networking** | Global edge | Single location |
| **Storage** | Limited (paid volumes) | Unlimited (local disk) |
| **SSH Access** | Via flyctl | Direct |
| **Best For** | Production, public access | Development, private use |

## Migration from Raspberry Pi

To migrate from Raspberry Pi to Fly.io:

1. **Export data** from Pi:
   ```bash
   scp -r pi@raspberry:/path/to/sidflow/data ./backup/
   ```

2. **Create Fly.io volumes** (see Prerequisites)

3. **Deploy to Fly.io**:
   ```bash
   ./scripts/deploy/fly-deploy.sh -e stg
   ```

4. **Copy data to Fly.io**:
   ```bash
   flyctl ssh sftp shell --app sidflow-stg
   # Then use sftp commands to upload data
   ```

5. **Update DNS** to point to Fly.io app
6. **Keep Pi deployment** as backup (disabled in GitHub Actions)

## Security

### Secrets Management

- Never commit secrets to git
- Use `flyctl secrets` for sensitive values
- Rotate secrets regularly

### Network Security

- All traffic is HTTPS by default
- Internal IPs for machine-to-machine communication
- Optional: Private networks via `flyctl wireguard`

### Volume Encryption

Fly.io volumes are encrypted at rest by default.

## Further Reading

- [Fly.io Documentation](https://fly.io/docs/)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Fly.io Regions](https://fly.io/docs/reference/regions/)
- [Fly.io CLI Reference](https://fly.io/docs/flyctl/)
- [Docker Deployment Guide](https://fly.io/docs/languages-and-frameworks/dockerfile/)
