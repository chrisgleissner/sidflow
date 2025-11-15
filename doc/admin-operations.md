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

### Job Controls

#### Pause Running Job

```bash
# Gracefully pause job (saves checkpoint)
curl -X POST http://localhost:3000/api/admin/jobs/{jobId}/pause \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### Resume Paused Job

```bash
# Resume from last checkpoint
curl -X POST http://localhost:3000/api/admin/jobs/{jobId}/resume \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### Cancel Job

```bash
# Cancel and cleanup (removes temp files)
curl -X DELETE http://localhost:3000/api/admin/jobs/{jobId} \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### Retry Failed Job

```bash
# Retry with same config
curl -X POST http://localhost:3000/api/admin/jobs/{jobId}/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Retry with updated config
curl -X POST http://localhost:3000/api/admin/jobs/{jobId}/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config": {"threads": 8}}'
```

#### View Job Logs

```bash
# Stream job logs (SSE)
curl http://localhost:3000/api/admin/jobs/{jobId}/logs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --no-buffer

# Get full log history
curl http://localhost:3000/api/admin/jobs/{jobId}/logs?full=true \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Job Priority Management

```bash
# List jobs by priority
curl http://localhost:3000/api/admin/jobs?sort=priority \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Update job priority
curl -X PATCH http://localhost:3000/api/admin/jobs/{jobId} \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"priority": 10}'
```

**Priority Levels:**
- `10`: Critical (system maintenance, urgent fixes)
- `5`: High (user-requested operations)
- `1`: Normal (scheduled tasks)
- `0`: Low (background optimization)

### Concurrency Limits

Configure max concurrent jobs in `.sidflow.json`:

```json
{
  "jobs": {
    "maxConcurrent": 2,
    "maxConcurrentByType": {
      "fetch": 1,
      "classify": 2,
      "train": 1,
      "render": 4
    }
  }
}
```

### Job Scheduling

Schedule recurring jobs via cron:

```bash
# Daily HVSC sync at 2 AM
0 2 * * * curl -X POST http://localhost:3000/api/fetch \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Weekly training at Sunday 3 AM
0 3 * * 0 curl -X POST http://localhost:3000/api/train \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Or use built-in scheduler:

```json
{
  "jobs": {
    "schedule": {
      "fetch": "0 2 * * *",
      "train": "0 3 * * 0",
      "classify": "0 4 * * 1-5"
    }
  }
}
```

---

## Render Mode Selection

SIDFlow supports multiple rendering technologies with different trade-offs. The **Render Matrix** defines valid combinations.

### Render Matrix

| Location | Time | Technology | Target | Use Case |
|----------|------|------------|--------|----------|
| Client | Real-time | WASM | Live audio | Default playback |
| Client | Real-time | HLS | Streamed audio | Browser fallback |
| Server | Offline | CLI | WAV/M4A/FLAC | Batch rendering |
| Ultimate 64 | Real-time | Hardware | WAV/M4A/FLAC | Archival quality |

### Selecting Render Modes

**Admin UI**: Navigate to `/admin/render` and select:
1. **Source**: Single file, directory, or entire HVSC
2. **Mode**: Technology + format combination
3. **Options**: Subtune, duration, quality settings

**API Request**:

```bash
curl -X POST http://localhost:3000/api/admin/render \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sidPath": "MUSICIANS/Rob_Hubbard/Delta.sid",
    "mode": {
      "location": "server",
      "time": "offline",
      "technology": "cli",
      "target": "m4a"
    },
    "options": {
      "subtune": 1,
      "duration": 180,
      "quality": "high"
    }
  }'
```

### Mode Validation

Invalid combinations are rejected with suggestions:

**Example: Invalid client+offline+wasm**

```bash
curl -X POST http://localhost:3000/api/admin/render \
  -d '{"mode": {"location": "client", "time": "offline", "technology": "wasm"}}'

# Response: 400 Bad Request
{
  "error": "Invalid render mode combination",
  "details": "WASM only supports real-time rendering",
  "suggestions": [
    "Use server+offline+cli for offline WAV generation",
    "Use client+real-time+wasm for live playback"
  ]
}
```

### Technology-Specific Considerations

#### WASM Rendering
- **Best for**: Real-time client playback
- **Requires**: Browser with SharedArrayBuffer support
- **Latency**: 10-50ms
- **Quality**: Cycle-accurate emulation
- **Limitation**: Client-side only, no offline rendering

#### CLI (sidplayfp) Rendering
- **Best for**: Batch server-side rendering
- **Requires**: Native `sidplayfp` binary installed
- **Speed**: Fastest for bulk operations
- **Quality**: Identical to WASM
- **Formats**: WAV, can pipe to ffmpeg for M4A/FLAC

#### Ultimate 64 Hardware
- **Best for**: Archival-quality captures
- **Requires**: Ultimate 64 device on network
- **Quality**: Real SID chip (6581/8580), authentic analog filters
- **Speed**: Real-time only (no faster-than-realtime)
- **Formats**: WAV (via UDP capture) + M4A/FLAC (encoded)
- **Configuration**: See [Ultimate 64 Setup](#ultimate-64-setup)

### Batch Render Operations

Render entire collections:

```bash
# Render all Rob Hubbard tracks to M4A
curl -X POST http://localhost:3000/api/admin/render \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "sidPath": "MUSICIANS/Rob_Hubbard",
    "mode": {"location": "server", "technology": "cli", "target": "m4a"},
    "options": {"recursive": true, "formats": ["m4a", "flac"]}
  }'
```

Monitor batch progress:

```bash
# Check render job status
curl http://localhost:3000/api/admin/jobs/{jobId} \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.progress'

# Output:
{
  "current": 42,
  "total": 150,
  "percentComplete": 28.0,
  "message": "Rendering MUSICIANS/Rob_Hubbard/Commando.sid"
}
```

### Ultimate 64 Setup

Configure Ultimate 64 in `.sidflow.json`:

```json
{
  "render": {
    "ultimate64": {
      "host": "ultimate64.local",
      "port": 64,
      "username": "admin",
      "password": "${ULTIMATE64_PASSWORD}",
      "capturePort": 11000,
      "sidType": "6581",
      "clockSpeed": "PAL",
      "maxConcurrent": 1,
      "timeout": 300000
    }
  }
}
```

**Network Requirements:**
- Ultimate 64 and server on same network
- Port 64 (HTTP) open for REST API
- Port 11000 (UDP) open for audio streaming
- Stable low-latency connection (<10ms RTT preferred)

**Testing Connectivity:**

```bash
# Check Ultimate 64 REST API
curl http://ultimate64.local:64/api/status

# Test UDP port (on server)
nc -u -l 11000

# Trigger test stream (on Ultimate 64)
curl -X POST http://ultimate64.local:64/api/test-stream \
  -d '{"port": 11000, "duration": 5}'
```

**Audio Quality Settings:**

```json
{
  "render": {
    "ultimate64": {
      "sidType": "6581",           // or "8580"
      "clockSpeed": "PAL",         // or "NTSC"
      "filterCurve": "6581R3",     // Filter revision
      "bufferSize": 2048,          // UDP buffer (samples)
      "packetLossThreshold": 0.01  // Max 1% loss
    }
  }
}
```

### Render Asset Management

Generated assets are registered in availability manifests:

```bash
# View available formats for SID
curl http://localhost:3000/api/availability/check \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"sidPath": "MUSICIANS/Rob_Hubbard/Delta.sid"}'

# Response:
{
  "available": true,
  "formats": {
    "wav": {
      "size": 31752044,
      "duration": 180.0,
      "renderedAt": "2025-11-14T10:30:00Z",
      "renderer": "ultimate64"
    },
    "m4a": {
      "size": 5760000,
      "bitrate": 256000,
      "renderedAt": "2025-11-14T10:30:15Z"
    }
  }
}
```

Invalidate stale renders:

```bash
# Invalidate specific SID
curl -X DELETE http://localhost:3000/api/availability/invalidate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"sidPath": "MUSICIANS/Rob_Hubbard/Delta.sid"}'

# Invalidate by age
curl -X DELETE http://localhost:3000/api/availability/invalidate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"olderThanDays": 90}'
```
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

SIDFlow uses a managed workflow for publishing trained ML models to production. This ensures model quality, enables rollback, and maintains audit trails.

### Model Lifecycle

```
Train → Evaluate → Approve → Publish → Monitor
  ↓       ↓         ↓         ↓         ↓
Stage   Validate  Review    Deploy    Track
```

### Training Phase

Trigger model training:

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
    "learningRate": 0.001,
    "validationSplit": 0.2,
    "evaluate": true
  }'
```

Training produces:
- `data/model/model.json` - TensorFlow.js model architecture
- `data/model/model/*.bin` - Model weights (sharded)
- `data/model/model-metadata.json` - Training metadata and metrics
- `data/training/training-log.jsonl` - Append-only training history

**Training Metadata:**

```json
{
  "modelVersion": "1.2.0",
  "trainedAt": "2025-11-14T12:00:00Z",
  "trainingDuration": 3600000,
  "samples": {
    "total": 5000,
    "explicit": 3500,
    "implicit": 1500,
    "validation": 1000
  },
  "hyperparameters": {
    "epochs": 50,
    "batchSize": 32,
    "learningRate": 0.001
  },
  "metrics": {
    "mae": 0.38,
    "rmse": 0.52,
    "r2": 0.87,
    "validationMae": 0.42,
    "validationR2": 0.84
  },
  "featureSetVersion": "2.1.0",
  "status": "candidate"
}
```

### Evaluation Phase

Automated evaluation runs after training:

```bash
# View evaluation metrics
curl http://localhost:3000/api/admin/model/evaluate \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Response:
{
  "modelVersion": "1.2.0",
  "metrics": {
    "mae": 0.38,
    "rmse": 0.52,
    "r2": 0.87
  },
  "baseline": {
    "mae": 0.45,
    "improvement": "15.6%"
  },
  "recommendations": [
    "✓ R² score improved from 0.84 to 0.87",
    "✓ MAE below threshold (0.4)",
    "✓ Ready for approval"
  ]
}
```

**Quality Gates:**
- MAE < 0.4 (mean absolute error)
- R² > 0.8 (coefficient of determination)
- Validation metrics within 10% of training metrics
- Better than baseline model

### Approval Phase

Manual approval by admin:

```bash
# Review candidate model
curl http://localhost:3000/api/admin/model/candidate \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Approve for production
curl -X POST http://localhost:3000/api/admin/model/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "modelVersion": "1.2.0",
    "notes": "Improved R² from 0.84 to 0.87 with 5k samples"
  }'
```

Approval triggers:
1. Copy model to `data/model/production/`
2. Update `data/model/active-version.json`
3. Create backup of previous production model
4. Log approval to `data/audit/admin-actions.jsonl`

### Publishing Phase

Atomic model deployment:

```bash
# Publish approved model
curl -X POST http://localhost:3000/api/admin/model/publish \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"modelVersion": "1.2.0"}'
```

**Publishing Steps:**
1. Validate model artifacts (checksums)
2. Generate model manifest with metadata
3. Atomically update `data/model/manifest.json`
4. Trigger client refresh (via WebSocket or polling)
5. Monitor for errors (5-minute warmup period)

**Model Manifest:**

```json
{
  "activeVersion": "1.2.0",
  "publishedAt": "2025-11-14T14:00:00Z",
  "manifestChecksum": "sha256:abc123...",
  "artifacts": {
    "model.json": {
      "checksum": "sha256:def456...",
      "sizeBytes": 1234
    },
    "model/weights.bin": {
      "checksum": "sha256:ghi789...",
      "sizeBytes": 567890
    }
  },
  "metadata": {
    "trainedAt": "2025-11-14T12:00:00Z",
    "samples": 5000,
    "metrics": { "mae": 0.38, "r2": 0.87 }
  },
  "rollback": {
    "previousVersion": "1.1.0",
    "availableVersions": ["1.0.0", "1.1.0"]
  }
}
```

### Monitoring Phase

Track model performance in production:

```bash
# Live metrics
curl http://localhost:3000/api/admin/model/metrics \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Response:
{
  "activeVersion": "1.2.0",
  "uptime": 3600000,
  "predictions": {
    "total": 15000,
    "errors": 12,
    "errorRate": 0.0008,
    "avgLatency": 8.5,
    "p95Latency": 15.2
  },
  "accuracy": {
    "mae": 0.39,
    "drift": 0.01
  },
  "health": "healthy"
}
```

**Alert Conditions:**
- Error rate > 1%
- Average latency > 50ms
- MAE drift > 0.1 from training metrics
- Missing model artifacts

### Rollback Procedure

Revert to previous model version:

```bash
# Emergency rollback to last stable version
curl -X POST http://localhost:3000/api/admin/model/rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "reason": "High error rate in production",
    "immediate": true
  }'

# Rollback to specific version
curl -X POST http://localhost:3000/api/admin/model/rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "targetVersion": "1.1.0",
    "reason": "Manual rollback for testing"
  }'
```

**Rollback Steps:**
1. Verify target version exists in backups
2. Update active version pointer
3. Trigger client refresh
4. Monitor for 5 minutes
5. Log rollback to audit trail

**Recovery Time Objective:** < 2 minutes

### Versioning Strategy

**Semantic Versioning:**
- `MAJOR.MINOR.PATCH` (e.g., `1.2.0`)
- **MAJOR**: Breaking changes to feature set or model architecture
- **MINOR**: New features, improved accuracy
- **PATCH**: Bug fixes, performance improvements

**Version Retention:**
- Keep last 5 production versions
- Archive older versions to backup storage
- Minimum retention: 90 days

### Model Audit Trail

All model operations logged to `data/audit/admin-actions.jsonl`:

```json
{
  "timestamp": "2025-11-14T14:00:00Z",
  "action": "model.publish",
  "actor": "admin@example.com",
  "details": {
    "modelVersion": "1.2.0",
    "previousVersion": "1.1.0",
    "metrics": { "mae": 0.38, "r2": 0.87 },
    "notes": "Improved accuracy with expanded training set"
  }
}
```

Query audit trail:

```bash
# Recent model operations
grep "model\." data/audit/admin-actions.jsonl | tail -n 10

# Specific model history
grep "1.2.0" data/audit/admin-actions.jsonl | jq .
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
- `preferredEngines`: Order by performance and availability
  - WASM: fastest, always available, no dependencies
  - sidplayfp-cli: requires sidplayfp installed, good compatibility
  - ultimate64: real hardware, best accuracy, requires network access
  - Always include wasm as final fallback (auto-appended if missing)
- Can be overridden via Admin Prefs → Render Engine → Preferred order

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
