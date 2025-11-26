# SIDFlow Deployment Scripts

This directory contains scripts for deploying and managing SIDFlow on production servers, particularly Raspberry Pi systems.

## Quick Reference

| Script | Purpose | Example |
|--------|---------|---------|
| `install.sh` | Initial deployment | `install.sh -P 'password'` |
| `update.sh` | Update to new version | `update.sh -t v0.3.28` |
| `backup.sh` | Backup data | `backup.sh --full` |
| `restore.sh` | Restore from backup | `restore.sh -i backup.tar.gz` |
| `status.sh` | Check status | `status.sh --json` |
| `logs.sh` | View logs | `logs.sh -f` |
| `start.sh` | Start container | `start.sh --wait` |
| `stop.sh` | Stop container | `stop.sh --force` |
| `webhook-server.sh` | Webhook for CI/CD | `webhook-server.sh -s secret` |

## Installation

### Initial Setup

```bash
# Download and run install script
curl -O https://raw.githubusercontent.com/chrisgleissner/sidflow/main/scripts/deploy/install.sh
chmod +x install.sh
./install.sh -P 'your-secure-password'
```

### With Specific Version

```bash
./install.sh -P 'password' -t v0.3.28 -e prd
```

### Staging Environment

```bash
./install.sh -P 'password' -e stg -p 3001
```

## Script Details

### install.sh

Performs initial deployment of SIDFlow.

```
Usage: install.sh [OPTIONS]

Options:
  -d, --dir DIR           Base installation directory (default: /opt/sidflow)
  -t, --tag TAG           Docker image tag (default: latest)
  -p, --port PORT         Port to expose (default: 3000)
  -u, --user USER         Admin username (default: admin)
  -P, --password PASS     Admin password (required)
  -e, --env ENV           Environment: stg or prd (default: prd)
  --skip-pull             Skip pulling Docker image
  --dry-run               Show actions without executing
  -h, --help              Show help
```

### update.sh

Updates SIDFlow to a new version with automatic backup and rollback.

```
Usage: update.sh [OPTIONS]

Options:
  -t, --tag TAG           Target version (default: latest)
  -e, --env ENV           Environment: stg or prd (default: prd)
  --no-backup             Skip pre-update backup
  --force                 Continue even if health check fails
  --dry-run               Show actions without executing
```

### backup.sh

Creates compressed backups of SIDFlow data.

```
Usage: backup.sh [OPTIONS]

Options:
  -o, --output DIR        Backup destination (default: /opt/sidflow/backups)
  -e, --env ENV           Environment: stg or prd (default: prd)
  --full                  Include HVSC and wav-cache (large)
  --retention DAYS        Delete old backups (default: 30)
  --quiet                 Suppress output (for cron)
```

**Cron Setup (daily at 2 AM):**

```bash
# Add to crontab
0 2 * * * /opt/sidflow/scripts/backup.sh --quiet
```

### restore.sh

Restores SIDFlow data from a backup.

```
Usage: restore.sh [OPTIONS]

Options:
  -i, --input FILE        Backup archive (required)
  -e, --env ENV           Environment: stg or prd
  --skip-stop             Don't stop container before restore
  --skip-start            Don't start container after restore
  --force                 Overwrite without confirmation
```

### status.sh

Displays deployment status.

```
Usage: status.sh [OPTIONS]

Options:
  -e, --env ENV           Environment: stg or prd
  --json                  Output as JSON (for scripting)
```

### logs.sh

View container logs.

```
Usage: logs.sh [OPTIONS]

Options:
  -n, --lines N           Lines to show (default: 100)
  -f, --follow            Follow log output
  --since TIME            Show logs since time (e.g., "1h")
```

### start.sh / stop.sh

Start or stop the container.

```
Usage: start.sh [OPTIONS]
       stop.sh [OPTIONS]

Options:
  -e, --env ENV           Environment: stg or prd
  --wait                  (start) Wait for health check
  --timeout SEC           Timeout seconds
  --force                 (stop) Force kill
```

## Webhook Deployment

For automated deployment from GitHub Actions via Cloudflare Tunnel:

### Setup Webhook Server

1. Install as systemd service:

```bash
sudo tee /etc/systemd/system/sidflow-webhook.service > /dev/null << 'EOF'
[Unit]
Description=SIDFlow Deployment Webhook Server
After=network.target docker.service

[Service]
Type=simple
User=root
Environment=WEBHOOK_SECRET=your-secret-here
ExecStart=/opt/sidflow/scripts/webhook-server.sh -p 9000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable sidflow-webhook
sudo systemctl start sidflow-webhook
```

2. Configure Cloudflare Tunnel:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: sidflow.yourdomain.com
    service: http://localhost:3000
  - hostname: deploy.yourdomain.com
    service: http://localhost:9000
  - service: http_status:404
```

3. Trigger deployment from GitHub Actions:

```bash
curl -X POST "https://deploy.yourdomain.com/deploy/stg?secret=your-secret&tag=v0.3.28"
```

## Directory Structure

After installation:

```
/opt/sidflow/
├── config/
│   ├── docker-compose.prd.yml
│   ├── docker-compose.stg.yml
│   ├── .env.prd
│   └── .env.stg
├── data/
│   ├── hvsc/           # SID collection
│   ├── wav-cache/      # Rendered audio
│   ├── tags/           # User ratings
│   └── sidflow/        # LanceDB, classifications
├── backups/            # Backup archives
└── scripts/            # Deployment scripts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SIDFLOW_ADMIN_PASSWORD` | Admin password | (required) |
| `SIDFLOW_ADMIN_USER` | Admin username | `admin` |
| `SIDFLOW_IMAGE` | Docker image | `ghcr.io/chrisgleissner/sidflow` |
| `WEBHOOK_SECRET` | Webhook auth token | (required for webhook) |

## Troubleshooting

### Container won't start

```bash
# Check logs
./logs.sh -n 200

# Verify ownership
ls -la /opt/sidflow/data/
# Should be 1001:1001

# Fix ownership
sudo chown -R 1001:1001 /opt/sidflow/data
```

### Health check failing

```bash
# Check health endpoint directly
curl http://localhost:3000/api/health | jq .

# Check container status
./status.sh --json
```

### Rollback to previous version

```bash
# Restore from latest backup
./restore.sh -i /opt/sidflow/backups/sidflow-prd-*.tar.gz

# Or manually update to specific version
./update.sh -t v0.3.27
```
