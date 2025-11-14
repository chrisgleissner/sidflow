# SIDFlow Admin Operations Guide

**Audience:** System administrators and DevOps engineers managing SIDFlow deployments

This guide covers administrative operations for running, monitoring, and maintaining a SIDFlow production instance.

---

## Table of Contents

1. [Job Management](#job-management)
2. [Model Publishing](#model-publishing)
3. [Health Monitoring](#health-monitoring)
4. [Alert Configuration](#alert-configuration)
5. [Incident Response](#incident-response)
6. [Cache Management](#cache-management)
7. [Backup & Recovery](#backup--recovery)
8. [Performance Tuning](#performance-tuning)

---

## Job Management

### Job Types

SIDFlow uses a job queue system for long-running background operations:

- **fetch**: Download/update HVSC mirror
- **classify**: Process SID files, extract features, generate classifications
- **train**: Train ML model on feedback data
- **render**: Generate audio assets (WAV/M4A/FLAC) for streaming

### Job Orchestration

Jobs are managed by `JobOrchestrator` (`@sidflow/common`) and executed by `JobRunner`:

```bash
# Check job queue status
curl http://localhost:3000/api/admin/metrics | jq '.jobs'

# Response:
{
  "pending": 2,
  "running": 1,
  "completed": 142,
  "failed": 3,
  "totalDurationMs": 3600000,
  "avgDurationMs": 25352
}
```

### Starting Jobs

Jobs can be triggered via admin API endpoints:

```bash
# Trigger HVSC fetch
curl -X POST http://localhost:3000/api/fetch \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": false}'

# Trigger classification
curl -X POST http://localhost:3000/api/classify \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"threads": 4}'

# Trigger training
curl -X POST http://localhost:3000/api/train \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Monitoring Job Progress

Jobs persist state to `data/jobs/*.json` with resumable execution:

```json
{
  "id": "classify-20251114-123456",
  "type": "classify",
  "status": "running",
  "createdAt": 1700000000000,
  "startedAt": 1700000001000,
  "metadata": {
    "progress": {
      "processedFiles": 1250,
      "totalFiles": 5000,
      "percentComplete": 25.0
    }
  }
}
```

### Job Recovery

Jobs are idempotent and resumable:

1. **Crash Recovery**: Restart the server; pending jobs auto-resume
2. **Manual Restart**: Delete job file or set status to "pending"
3. **Failed Jobs**: Check `metadata.error` for diagnostics

### Job Queue Workers

The queue worker polls for pending jobs at configurable intervals:

```typescript
const worker = new JobQueueWorker({
  orchestrator,
  commandFactory,
  auditTrail,
  pollIntervalMs: 1000, // 1 second
});

worker.start();
```

Stop gracefully:

```typescript
await worker.stop(); // Waits for current job to complete
```

---

## Model Publishing

### Model Lifecycle

1. **Train**: Generate new model weights from feedback data
2. **Evaluate**: Validate against holdout set
3. **Approve**: Admin decision to publish
4. **Deploy**: Atomically update manifests and weights
5. **Rollback**: Revert to previous version if issues

### Training a New Model

```bash
# Via CLI
./scripts/sidflow-train --epochs 50 --batch-size 32

# Via API
curl -X POST http://localhost:3000/api/train \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "epochs": 50,
    "batchSize": 32,
    "learningRate": 0.001
  }'
```

### Model Artifacts

Training produces deterministic artifacts:

- `data/model/model.json`: TensorFlow.js model topology
- `data/model/model/weights.bin`: Model weights
- `data/model/feature-stats.json`: Feature normalization parameters
- `data/model/model-metadata.json`: Training metadata and metrics

### Publishing Workflow

1. **Review Metrics**:
   ```bash
   cat data/model/model-metadata.json | jq '.metrics'
   ```

2. **Test Predictions**:
   ```bash
   ./scripts/sidflow-classify --sample 100 --validate
   ```

3. **Atomic Deploy**:
   - Models are loaded via `/api/model/latest`
   - Cache headers: `max-age=60` for gradual rollout
   - Client polls for updates every minute

4. **Monitor Post-Deploy**:
   - Track prediction latency via `/api/admin/metrics`
   - Check telemetry for increased errors
   - Review feedback quality scores

### Rollback Procedure

```bash
# 1. Identify previous working version
ls -lt data/model/backups/

# 2. Restore previous model
cp data/model/backups/2025-11-13/* data/model/

# 3. Verify restoration
curl http://localhost:3000/api/model/latest | jq '.metadata'

# 4. Clear client caches
# Clients will fetch restored model within 60 seconds
```

---

## Health Monitoring

### Health Check Endpoint

**GET** `/api/health`

Monitor system component health:

```bash
curl http://localhost:3000/api/health | jq
```

Response:
```json
{
  "overall": "healthy",
  "timestamp": 1700000000000,
  "checks": {
    "wasm": {
      "status": "healthy",
      "details": { "sizeBytes": 1234567 }
    },
    "sidplayfpCli": {
      "status": "degraded",
      "message": "Not configured (optional)"
    },
    "streamingAssets": {
      "status": "healthy",
      "details": { "assetCount": 1250, "version": "1.0" }
    },
    "ultimate64": {
      "status": "healthy",
      "details": { "connected": true }
    }
  }
}
```

Status codes:
- **200**: Healthy or degraded (service operational)
- **503**: Unhealthy (service impaired)

### Metrics Endpoint

**GET** `/api/admin/metrics`

Aggregate operational KPIs:

```bash
curl http://localhost:3000/api/admin/metrics | jq
```

Response includes:
- **jobs**: Queue status, completion rates, average durations
- **cache**: WAV cache size, classified count, age statistics
- **sync**: HVSC version, SID count, last sync timestamp

### Integrating with Monitoring Systems

#### Prometheus

Expose metrics in Prometheus format:

```typescript
// Add to packages/sidflow-web/app/api/metrics/route.ts
export async function GET() {
  const metrics = await collectAdminMetrics();
  
  const prometheus = `
# HELP sidflow_jobs_pending Pending jobs in queue
# TYPE sidflow_jobs_pending gauge
sidflow_jobs_pending ${metrics.jobs.pending}

# HELP sidflow_cache_size_bytes WAV cache size in bytes
# TYPE sidflow_cache_size_bytes gauge
sidflow_cache_size_bytes ${metrics.cache.wavCacheSizeBytes}
`;

  return new Response(prometheus, {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

#### Datadog/New Relic

Use telemetry webhook:

```json
{
  "alerts": {
    "enabled": true,
    "webhookUrl": "https://api.datadoghq.com/api/v1/events",
    "thresholds": {
      "maxSessionFailureRate": 0.1,
      "maxCacheAgeMs": 604800000,
      "maxJobStallMs": 3600000
    }
  }
}
```

---

## Alert Configuration

### Configuration Schema

Edit `.sidflow.json`:

```json
{
  "alerts": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    "emailRecipients": ["ops@example.com", "devs@example.com"],
    "thresholds": {
      "maxSessionFailureRate": 0.1,
      "maxCacheAgeMs": 604800000,
      "maxJobStallMs": 3600000,
      "maxCpuPercent": 80,
      "maxMemoryPercent": 90
    }
  }
}
```

### Threshold Definitions

| Threshold | Default | Description |
|-----------|---------|-------------|
| `maxSessionFailureRate` | 0.1 (10%) | Playback failure rate |
| `maxCacheAgeMs` | 604800000 (7 days) | Maximum cache age |
| `maxJobStallMs` | 3600000 (1 hour) | Job stall duration |
| `maxCpuPercent` | 80% | CPU usage threshold |
| `maxMemoryPercent` | 90% | Memory usage threshold |

### Alert Delivery

Alerts fire when thresholds are exceeded:

1. **Webhook**: POST to configured URL with alert payload
2. **Email**: SMTP delivery to recipients (requires mail config)
3. **Audit Log**: All alerts logged to `data/audit/admin-actions.jsonl`

### Example Alert Payload

```json
{
  "timestamp": 1700000000000,
  "severity": "warning",
  "component": "cache",
  "message": "Cache age exceeds 7 days",
  "details": {
    "oldestCacheFileAge": 864000000,
    "threshold": 604800000
  }
}
```

---

## Incident Response

### Common Issues

#### High Job Failure Rate

**Symptoms**: Many jobs in "failed" status

**Diagnosis**:
```bash
# Check failed job errors
find data/jobs -name "*.json" -exec jq 'select(.status=="failed") | .metadata.error' {} \;

# Check audit logs
tail -100 data/audit/admin-actions.jsonl | grep '"success":false'
```

**Resolution**:
1. Identify error pattern (disk space, memory, network)
2. Fix underlying issue
3. Reset failed jobs: `rm data/jobs/failed-*.json`
4. Restart queue worker

#### Cache Staleness

**Symptoms**: `oldestCacheFileAge` exceeds threshold

**Diagnosis**:
```bash
curl http://localhost:3000/api/admin/metrics | jq '.cache'
```

**Resolution**:
1. Trigger HVSC sync: `./scripts/sidflow-fetch --force`
2. Trigger reclassification: `./scripts/sidflow-classify --all`
3. Monitor progress via `/api/classify/progress`

#### Model Degradation

**Symptoms**: Increased prediction errors, poor recommendations

**Diagnosis**:
```bash
# Check model metadata
cat data/model/model-metadata.json | jq '.metrics'

# Sample predictions
./scripts/sidflow-classify --sample 100 --verbose
```

**Resolution**:
1. Collect more feedback: Encourage rating activity
2. Retrain model: `./scripts/sidflow-train`
3. If still poor, rollback to previous version
4. Review training data quality

#### Health Check Failures

**Symptoms**: `/api/health` returns 503

**Diagnosis**: Check individual component status

**Resolution**:
- **WASM unhealthy**: Rebuild WASM: `bun run wasm:build`
- **sidplayfp degraded**: Install CLI or disable: set `sidplayPath: null`
- **Streaming assets missing**: Run render job
- **Ultimate 64 unreachable**: Check network/config

### Runbook Template

```markdown
## Incident: [Description]

**Severity**: Critical/High/Medium/Low
**Start Time**: YYYY-MM-DD HH:MM UTC
**Detected By**: Monitoring/User Report/Health Check

### Timeline
- HH:MM: Issue detected
- HH:MM: Investigation started
- HH:MM: Root cause identified
- HH:MM: Fix deployed
- HH:MM: Incident resolved

### Root Cause
[Technical explanation]

### Resolution
[Steps taken to resolve]

### Prevention
[Changes to prevent recurrence]
```

---

## Cache Management

### Cache Types

1. **WAV Cache** (`wavCachePath`): Rendered PCM audio
2. **Classified Data** (`classifiedPath`): Feature vectors and ratings
3. **Availability Manifests**: Streaming asset registry

### Cache Invalidation

Force regeneration:

```bash
# Clear WAV cache
rm -rf workspace/wav-cache/*

# Clear classifications
rm -rf data/classified/*

# Reclassify all
./scripts/sidflow-classify --all
```

### Cache Warmup

Pre-populate cache for popular tracks:

```bash
# Render top 1000 tracks
./scripts/sidflow-classify --top 1000 --formats wav,m4a,flac
```

### Cache Monitoring

```bash
# Check cache statistics
curl http://localhost:3000/api/admin/metrics | jq '.cache'

# Disk usage
du -sh workspace/wav-cache
du -sh data/classified
```

---

## Backup & Recovery

### Backup Strategy

**Critical Data** (must backup):
- `data/feedback/`: User ratings and implicit signals
- `data/model/`: Trained model artifacts
- `.sidflow.json`: Configuration
- `data/audit/`: Admin action logs

**Derived Data** (can regenerate):
- `workspace/wav-cache/`: Rendered audio
- `data/classified/`: Feature vectors
- `data/sidflow.lance/`: Vector database

### Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backups/sidflow/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup critical data
tar -czf "$BACKUP_DIR/feedback.tar.gz" data/feedback/
tar -czf "$BACKUP_DIR/model.tar.gz" data/model/
tar -czf "$BACKUP_DIR/audit.tar.gz" data/audit/
cp .sidflow.json "$BACKUP_DIR/"

# Backup database
tar -czf "$BACKUP_DIR/lancedb.tar.gz" data/sidflow.lance/

echo "Backup complete: $BACKUP_DIR"
```

### Recovery Procedure

```bash
#!/bin/bash
BACKUP_DIR="/backups/sidflow/20251114-120000"

# Stop services
systemctl stop sidflow

# Restore critical data
tar -xzf "$BACKUP_DIR/feedback.tar.gz" -C /
tar -xzf "$BACKUP_DIR/model.tar.gz" -C /
tar -xzf "$BACKUP_DIR/audit.tar.gz" -C /
cp "$BACKUP_DIR/.sidflow.json" .

# Rebuild derived data
./scripts/sidflow-classify --all
bun run build:db

# Restart services
systemctl start sidflow
```

---

## Performance Tuning

### Configuration Tuning

```json
{
  "threads": 8,
  "classificationDepth": 100,
  "render": {
    "preferredEngines": ["wasm", "sidplayfp-cli"],
    "defaultFormats": ["wav", "m4a"]
  }
}
```

**Recommendations**:
- `threads`: Set to CPU core count - 1
- `classificationDepth`: Increase for better accuracy, decrease for speed
- `preferredEngines`: Order by performance (WASM fastest)

### Database Optimization

LanceDB query performance:

```typescript
// Add index on frequently queried fields
await db.createIndex({
  column: 'ratings.e',
  indexType: 'IVF_PQ',
  numPartitions: 256,
});
```

### Render Performance

Batch rendering:

```bash
# Render in parallel
./scripts/sidflow-classify --threads 8 --batch-size 100
```

Pre-render popular content:

```bash
# Cache top tracks
./scripts/sidflow-classify --top 1000 --engine ultimate64
```

### Memory Management

Monitor memory usage:

```bash
# Check process memory
ps aux | grep sidflow

# Node.js heap stats
node --expose-gc --max-old-space-size=4096 server.js
```

### CDN Integration

Offload static assets:

```json
{
  "availability": {
    "publicBaseUrl": "https://cdn.example.com/sidflow-assets"
  }
}
```

---

## Security Checklist

- [ ] Admin authentication enabled and tested
- [ ] API rate limiting configured
- [ ] Audit logging enabled
- [ ] Telemetry anonymization active
- [ ] Security headers configured (CSP, HSTS, X-Frame-Options)
- [ ] HTTPS enforced in production
- [ ] Secrets stored in environment variables (not config files)
- [ ] Regular security updates applied
- [ ] Backup encryption enabled
- [ ] Access logs rotated and archived

---

## Additional Resources

- [Technical Reference](technical-reference.md) - Architecture and components
- [Developer Guide](developer.md) - Contributing and development
- [Telemetry Documentation](telemetry.md) - Metrics and instrumentation
- [Scale Planning](plans/scale/plan.md) - Scaling strategy and phases
