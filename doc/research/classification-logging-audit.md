# Classification Logging Audit — Per-Song Lifecycle System

*Created: 2026-03-25 · Branch: `copilot/implement-per-song-logging`*

---

## 1. Purpose

This document describes the per-song lifecycle logging subsystem introduced in Phase 12
and explains how to use its output to diagnose classification slowdowns and bottlenecks.

The earlier investigation ([`classification-slowdown-2026-03-25.md`](./classification-slowdown-2026-03-25.md))
identified the root cause of the apparent 70-75% stall as an insufficiently visible
post-extraction serialized phase. The per-song logger provides the observability layer
to detect and measure such issues in future runs.

---

## 2. Architecture Overview

### 2.1 Two telemetry streams

| Stream | File | Granularity | Purpose |
|---|---|---|---|
| `ClassificationTelemetryLogger` | `data/classified/classification_<ts>.events.jsonl` | Per-run events | Existing; pipeline-level milestones |
| `SongLifecycleLogger` | `logs/classification-detailed.jsonl` (default) | Per-song × per-stage events | New; fine-grained diagnostics |

The two streams are fully independent — the lifecycle logger can be disabled (by not calling
`lifecycle.flush()` or by pointing `lifecycleLogPath` to `/dev/null`) without affecting
the existing system.

### 2.2 Stage model

Each song passes through 11 named stages:

```
QUEUED → STARTED → RENDERING → RENDERED → EXTRACTING → EXTRACTED
        → ANALYZING → ANALYZED → TAGGING → TAGGED → COMPLETED
```

All stages exist in the lifecycle log even for cache hits (RENDERING/RENDERED are still
emitted but with `extra.cacheHit: true` and near-zero duration).

### 2.3 Stage semantics

| Stage | Phase | Description |
|---|---|---|
| `QUEUED` | Queue build | Job added to the work-stealing queue |
| `STARTED` | Concurrent | Worker picks up the job (spans the whole concurrent phase) |
| `RENDERING` | Concurrent | `sidplayfp` renders WAV (`render_start`→`render_complete`) |
| `RENDERED` | Concurrent | WAV confirmed ready (fresh or cache hit) |
| `EXTRACTING` | Concurrent | Essentia feature extraction |
| `EXTRACTED` | Concurrent | Features in memory |
| `ANALYZING` | Concurrent | Features flushed to intermediate `features_*.jsonl` |
| `ANALYZED` | Concurrent | Intermediate write complete; STARTED ends |
| `TAGGING` | Deferred | Per-song: rating model application + classification JSONL write |
| `TAGGED` | Deferred | Auto-tags committed |
| `COMPLETED` | Deferred | Song fully classified; `totalDurationMs` available |

---

## 3. Log Format

Each line is a valid JSON object:

```jsonc
{
  "ts": 1711372800123,        // Unix ms timestamp
  "event": "stage_start",     // "run_start" | "run_end" | "stage_start" | "stage_end" | "stage_error" | "stage_stall"
  "stage": "RENDERING",       // ClassificationStage (absent for run_start/run_end)
  "songIndex": 42,            // 0-based index into the full queue
  "totalSongs": 1000,         // total songs in this run
  "songPath": "HVSC/C64Music/MUSICIANS/Ab.sid",
  "songId": "HVSC/C64Music/MUSICIANS/Ab.sid:2",  // ":N" suffix for multi-song SIDs
  "workerId": 3,              // 1-based thread id (0 = deferred/main pass)
  "threadId": "3",            // string form of workerId for log correlation
  "durationMs": 284,          // present on stage_end; ms since matching stage_start
  "memoryMB": 512,            // heap used at event time (MB)
  "cpuPercent": 73,           // process-wide CPU % since last sample
  "pid": 12345,
  "gitCommit": "a1b2c3d",
  "extra": {                  // stage-specific metadata
    "cacheHit": true,
    "outcome": "render_failed",
    "source": "classification",
    "totalDurationMs": 1842
  }
}
```

### 3.1 Special events

**`run_start`** — emitted once before any songs are queued:
```jsonc
{
  "ts": ..., "event": "run_start",
  "command": "classify", "mode": "local", "fullRerun": false,
  "cwd": "/home/chris/dev/c64/sidflow",
  "gitCommit": "a1b2c3d", "pid": 12345,
  "totalSongs": 1000, "memoryMB": 312
}
```

**`run_end`** — emitted once in the `finally` block:
```jsonc
{ "ts": ..., "event": "run_end", "totalDurationMs": 9832145 }
```

**`stage_stall`** — emitted by the 30-second watchdog when a stage is active for:
- >10× the observed median duration for that stage, or
- >5 minutes (fallback for stages with no median established yet)
```jsonc
{
  "ts": ..., "event": "stage_stall",
  "stage": "ANALYZING", "songIndex": 713,
  "activeMs": 312000, "medianMs": 28
}
```

---

## 4. Stall Detection

`SongLifecycleLogger` runs a 30-second interval watchdog inspecting all `activeStages`
entries. For each stage, it maintains a rolling list of observed `durationMs` values and
computes the median.

A stall is declared when:
```
activeMs > max(10 × medianMs, 300_000)
```

Stall events appear inline in the JSONL stream alongside normal stage events. When
diagnosing a run that appeared to stall at 70-75%:

```bash
grep '"event":"stage_stall"' logs/classification-detailed.jsonl | jq .
```

If no stall events appear but the run was slow, the bottleneck is real work (not a
deadlock). Using `durationMs` histograms by stage is then more appropriate:

```bash
jq -r 'select(.event=="stage_end") | [.stage, .durationMs] | @tsv' \
  logs/classification-detailed.jsonl | \
  sort | awk '{sum[$1]+=$2; n[$1]++} END {for (s in sum) print s, sum[s]/n[s]}'
```

---

## 5. Diagnosing the 70-75% Slowdown

### 5.1 What to look for

The previously observed slowdown manifested as:
- Progress bar frozen near 70-75%
- CPU still active
- No error output

With per-song logging, the diagnosis procedure is:

1. **Check stage distribution:**
   ```bash
   jq 'select(.event=="stage_end") | .stage' logs/classification-detailed.jsonl | sort | uniq -c | sort -rn
   ```
   If `TAGGING` count << `ANALYZED` count, songs are stuck in the deferred pass.

2. **Check TAGGING durations:**
   ```bash
   jq -r 'select(.event=="stage_end" and .stage=="TAGGING") | .durationMs' \
     logs/classification-detailed.jsonl | sort -n | tail -20
   ```

3. **Look for stall events:**
   ```bash
   grep '"stage_stall"' logs/classification-detailed.jsonl
   ```

4. **Compare concurrent vs. deferred phase duration:**
   ```bash
   # Concurrent phase: sum of ANALYZED durationMs per worker
   jq -r 'select(.event=="stage_end" and .stage=="ANALYZED") | [.workerId, .durationMs] | @tsv' \
     logs/classification-detailed.jsonl | awk '{sum[$1]+=$2} END {for (w in sum) print "worker", w, sum[w]/1000, "s"}'

   # Deferred phase: COMPLETED totalDurationMs for last song vs. first song
   jq -r 'select(.event=="stage_end" and .stage=="COMPLETED") | .extra.totalDurationMs' \
     logs/classification-detailed.jsonl | sort -n | tail -5
   ```

### 5.2 Known root cause (confirmed Phase 11)

The apparent 70-75% stall is **not** a deadlock. It is serialized work in the deferred pass:
- Rating model is built once from all intermediate features
- Classification records are written one by one to `classification_*.jsonl`

This pass is O(n) but serialized on the main thread. On large collections (~50k songs)
it can take several minutes of CPU-bound time. The lifecycle logger now makes this
visible as TAGGING events with `workerId: 0`.

---

## 6. Performance Benchmarks (Reference Baseline)

These values are indicative from a bounded `test-data` run on a development machine.
For production benchmarks, see `doc/perf/`.

| Stage | Typical p50 (ms) | Notes |
|---|---|---|
| QUEUED | <1 | In-memory only |
| RENDERING | 1200–2500 | Depends on SID complexity |
| RENDERED (cached) | <1 | Hash check only |
| EXTRACTING | 200–800 | Essentia; scales with audio length |
| ANALYZED | 5–50 | `features_*.jsonl` I/O |
| TAGGING | 10–50 | Rating model inference + JSONL write |
| COMPLETED | 1300–3400 | Wall-clock from QUEUED to COMPLETED |

---

## 7. Configuration

```typescript
// Via GenerateAutoTagsOptions:
await generateAutoTags({
  ...,
  lifecycleLogPath: "/tmp/my-classify-run.jsonl"   // default: logs/classification-detailed.jsonl
});
```

The file is created (with parent directories) automatically. If the path is omitted,
it defaults to `<cwd>/logs/classification-detailed.jsonl`. The `logs/` directory is
excluded from git via `.gitignore`.

---

## 8. Implementation Reference

| Symbol | File |
|---|---|
| `SongLifecycleLogger` | `packages/sidflow-classify/src/classification-telemetry.ts` |
| `ClassificationStage` | `packages/sidflow-classify/src/classification-telemetry.ts` |
| `StageEventType` | `packages/sidflow-classify/src/classification-telemetry.ts` |
| `StageEventParams` | `packages/sidflow-classify/src/classification-telemetry.ts` |
| `lifecycleLogPath` option | `packages/sidflow-classify/src/index.ts` (`GenerateAutoTagsOptions`) |

All symbols are re-exported from the package root:
```typescript
import { SongLifecycleLogger, type ClassificationStage } from "@sidflow/classify";
```
