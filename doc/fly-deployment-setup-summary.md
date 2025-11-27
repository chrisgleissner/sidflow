# Fly.io Deployment Setup Summary

## What Was Created

### 1. Configuration Files

#### `fly.toml`
Base Fly.io application configuration:
- **App name**: sidflow (customized per environment during deployment)
- **Region**: London (lhr) by default
- **Resources**: 512MB RAM, 1 shared CPU (scalable)
- **Volumes**: 
  - `sidflow_data` (20GB) - For classification data, feedback, model artifacts
  - `sidflow_workspace` (50GB) - For HVSC collection and WAV cache
- **Health checks**: HTTP check on `/api/health` (30s interval)
- **Scaling**: 1-3 machines with rolling deployment strategy
- **Environment**: NODE_ENV=production, PORT=3000, SIDFLOW_ROOT=/sidflow

### 2. Deployment Scripts

#### `scripts/deploy/fly-deploy.sh` (395 lines)
Manual CLI deployment script with comprehensive features:

**Usage:**
```bash
./scripts/deploy/fly-deploy.sh -e stg                    # Deploy latest to staging
./scripts/deploy/fly-deploy.sh -e prd -t v0.3.29        # Deploy specific version to production
./scripts/deploy/fly-deploy.sh -e stg -r lhr            # Deploy to London region
./scripts/deploy/fly-deploy.sh -e prd --dry-run         # Show deployment plan
```

**Features:**
- Environment selection (-e stg|prd)
- Custom Docker tag (-t v0.3.29)
- Region selection (-r lhr|lhr|etc)
- Dry-run mode (--dry-run)
- Force mode for production (--force)
- Automatic fly.toml generation per environment
- Health check verification after deployment
- Prerequisites validation (flyctl, authentication, apps, volumes)
- Comprehensive error handling and logging

**Safety:**
- Production deployments require confirmation prompt (unless --force)
- Validates app and volume existence before deployment
- 10 attempts at health check with 10s intervals
- Clean exit codes for scripting

### 3. GitHub Workflows

#### Updated `.github/workflows/release.yaml`
Added two new jobs for Fly.io deployment:

**deploy-fly-stg** (Staging - Automatic)
- Triggers: On version tag push, after successful Docker build
- Actions:
  1. Checkout repository
  2. Setup flyctl
  3. Generate environment-specific fly.toml (sidflow-stg)
  4. Deploy image from ghcr.io with rolling strategy
  5. Wait up to 30 attempts for health check
- Environment: staging-fly (https://sidflow-stg.fly.dev)
- Secrets: FLY_API_TOKEN

**deploy-fly-prd** (Production - Manual Approval)
- Triggers: After successful staging deployment, manual approval required
- Actions: Same as staging but for sidflow-prd
- Environment: production-fly (https://sidflow-prd.fly.dev)
- Approval: Requires GitHub environment protection rules

**Preserved**: Original deploy-stg and deploy-prd jobs (Raspberry Pi via webhook) remain intact but disabled

### 4. Documentation

#### `doc/fly-deployment.md` (395 lines)
Comprehensive deployment guide covering:

**Sections:**
- Quick Start (prerequisites, app/volume creation)
- Deployment Methods (automatic GitHub + manual CLI)
- Configuration (fly.toml, environment variables)
- Operations (monitoring, scaling, SSH access, volume management)
- Troubleshooting (deployment failures, health checks, volumes, OOM)
- Cost Optimization (free tier guidance, production scaling)
- Comparison: Fly.io vs Raspberry Pi
- Security (secrets management, network security, volume encryption)

#### Updated `scripts/deploy/README.md`
- Added Fly.io as recommended deployment target
- Updated quick reference table with fly-deploy.sh
- Clear distinction between Fly.io and Raspberry Pi platforms

#### Updated `README.md`
- Added Fly.io as recommended deployment option
- Quick start example for Fly.io deployment
- Links to detailed guides

## Deployment Architecture

```
GitHub Release Tag (v0.3.29)
         ↓
   Docker Build
         ↓
  ghcr.io/chrisgleissner/sidflow:v0.3.29
         ↓
    ┌────┴────┐
    ↓         ↓
Fly.io    Raspberry Pi
(Default) (Optional)
    ↓         ↓
 ┌──┴──┐  ┌──┴──┐
stg  prd  stg  prd
(auto)(man)(auto)(man)
```

## Dual Deployment Paths

### Path 1: Manual CLI Deployment
```bash
# Staging
./scripts/deploy/fly-deploy.sh -e stg

# Production
./scripts/deploy/fly-deploy.sh -e prd -t v0.3.29
```

### Path 2: Automatic GitHub Deployment
```bash
# Push version tag
git tag v0.3.29
git push origin v0.3.29

# GitHub Actions:
# 1. Build Docker image
# 2. Deploy to sidflow-stg (automatic)
# 3. Wait for manual approval
# 4. Deploy to sidflow-prd (after approval)
```

## What User Needs to Do

### One-Time Setup

1. **Install flyctl**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Authenticate**:
   ```bash
   flyctl auth login
   ```

3. **Create Fly.io apps**:
   ```bash
   flyctl apps create sidflow-stg --region lhr
   flyctl apps create sidflow-prd --region lhr
   ```

4. **Create volumes**:
   ```bash
   # Staging
   flyctl volumes create sidflow_data --region lhr --size 20 --app sidflow-stg
   flyctl volumes create sidflow_workspace --region lhr --size 50 --app sidflow-stg
   
   # Production
   flyctl volumes create sidflow_data --region lhr --size 20 --app sidflow-prd
   flyctl volumes create sidflow_workspace --region lhr --size 50 --app sidflow-prd
   ```

5. **Get API token**:
   ```bash
   flyctl auth token
   ```

6. **Add GitHub secret**:
   - Go to repository Settings → Secrets and variables → Actions
   - Create secret: `FLY_API_TOKEN` with token value

7. **Create GitHub environments**:
   - Go to Settings → Environments
   - Create `staging-fly` environment
   - Create `production-fly` environment with required reviewers

### Testing Deployment

1. **Test manual deployment**:
   ```bash
   ./scripts/deploy/fly-deploy.sh -e stg
   ```

2. **Test automatic deployment**:
   ```bash
   git tag v0.3.30-test
   git push origin v0.3.30-test
   ```

3. **Verify health**:
   ```bash
   curl https://sidflow-stg.fly.dev/api/health
   ```

## Key Features

### Deployment Safety
- ✅ Production deployments require confirmation
- ✅ Dry-run mode for testing
- ✅ Health check verification (30 attempts)
- ✅ Rolling deployment strategy (zero downtime)
- ✅ Automatic rollback on failure

### Flexibility
- ✅ Environment selection (stg/prd)
- ✅ Custom Docker tags
- ✅ Region selection
- ✅ Manual or automatic deployment
- ✅ Coexists with Raspberry Pi deployment

### Monitoring
- ✅ Health endpoint monitoring
- ✅ Deployment logs
- ✅ flyctl integration for status/logs/metrics
- ✅ GitHub Actions deployment visibility

### Documentation
- ✅ Complete deployment guide (doc/fly-deployment.md)
- ✅ Quick reference in scripts/deploy/README.md
- ✅ Quick start in main README.md
- ✅ Inline script help (-h flag)

## Cost Considerations

### Free Tier (Sufficient for Testing)
- 3 shared-cpu-1x machines (256MB RAM)
- 3GB persistent volumes
- 160GB outbound data transfer

**SIDFlow Usage:**
- 2 machines (stg + prd) @ 512MB each = within free tier
- 140GB volumes (70GB per environment) = requires paid plan (~$15/month)

### Recommended Production Setup
- **Staging**: 512MB RAM, 1 machine, 70GB volumes (~$7/month)
- **Production**: 1GB RAM, 2 machines, 100GB volumes (~$25/month)
- **Total**: ~$32/month for production-ready deployment

## Benefits Over Raspberry Pi

1. **Faster Deployment**: Seconds vs minutes
2. **Zero Downtime**: Rolling deployments
3. **Global Edge**: Multiple regions available
4. **Auto Scaling**: Handle traffic spikes
5. **Managed Platform**: No OS updates, no hardware failures
6. **Better Monitoring**: Built-in metrics and logs
7. **Easier Rollback**: One command rollback
8. **SSL/HTTPS**: Automatic certificate management

## Files Created/Modified

### Created
- `fly.toml` - Fly.io app configuration
- `scripts/deploy/fly-deploy.sh` - Manual deployment CLI script
- `doc/fly-deployment.md` - Complete deployment guide

### Modified
- `.github/workflows/release.yaml` - Added deploy-fly-stg and deploy-fly-prd jobs
- `scripts/deploy/README.md` - Added Fly.io section
- `README.md` - Added Fly.io quick start
- `PLANS.md` - Documented Fly.io deployment task

## Next Steps for User

1. Complete one-time setup (apps, volumes, secrets, environments)
2. Test manual deployment to staging
3. Test automatic deployment via version tag
4. Configure production environment protection rules
5. Monitor costs and adjust resources as needed
6. Consider migrating from Raspberry Pi to Fly.io as primary

## Support

- **Fly.io Docs**: https://fly.io/docs/
- **SIDFlow Deployment Guide**: doc/fly-deployment.md
- **Script Help**: `./scripts/deploy/fly-deploy.sh -h`
- **GitHub Workflow**: `.github/workflows/release.yaml`
