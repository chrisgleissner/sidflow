# SIDFlow Technical Reference

## Architecture Overview

SIDFlow is a C64 SID music discovery platform built as a CLI-first pipeline with an optional web interface.

```mermaid
graph LR
    A[Fetch HVSC] --> B[Classify Audio]
    B --> C[Train Model]
    C --> D[Play/Recommend]
    D -->|Feedback| C
```

### Core Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Audio Features | Essentia.js WASM | Extract MFCC, spectral, rhythm features |
| Classification | TensorFlow.js | Neural network for mood/style prediction |
| Vector DB | LanceDB | Similarity search, nearest-neighbor recommendations |
| Playback | libsidplayfp WASM | Browser-based SID emulation |
| Web UI | Next.js 15 + React 19 | Progressive enhancement, RSC |
| Runtime | Bun 1.3.1 | CLI execution, testing, builds |

## CLI Tools

### sidflow-fetch

Downloads and manages SID collections (currently HVSC).

```bash
sidflow-fetch [--config <path>] [--force] [--version <ver>]
```

| Flag | Description |
|------|-------------|
| `--config` | Config file path (default: `.sidflow.json`) |
| `--force` | Re-download even if exists |
| `--version` | HVSC version (default: latest) |

**Output:** Extracts to `sidPath` from config, creates `data/availability/hvsc-availability.jsonl`.

### sidflow-classify

Renders SIDs to WAV, extracts audio features, generates auto-tags.

```bash
sidflow-classify [--config <path>] [--concurrency <n>] [--max-files <n>]
```

| Flag | Description |
|------|-------------|
| `--concurrency` | Parallel workers (default: CPU count) |
| `--max-files` | Limit files to process |
| `--skip-render` | Use existing WAVs only |
| `--skip-extract` | Use existing features only |

**Pipeline Phases:**
1. **Render** - SID → WAV via sidplayfp (30s clips)
2. **Extract** - WAV → features via Essentia.js
3. **Tag** - Features → mood/style labels via heuristics + ML

**Output:** `data/classified/*.jsonl` with features, tags, and metadata.

### sidflow-train

Trains recommendation model from classification + feedback data.

```bash
sidflow-train [--config <path>] [--epochs <n>]
```

**Input:** `data/classified/*.jsonl` + `data/feedback/**/*.jsonl`
**Output:** `data/model/` artifacts + LanceDB vectors

### sidflow-play

Interactive CLI player with recommendations.

```bash
sidflow-play [--config <path>] [<sid-path>]
```

**Controls:** `space` pause, `n` next, `r` random, `1-5` rate, `q` quit

### sidflow-rate

Record feedback for a SID file.

```bash
sidflow-rate <sid-path> --rating <1-5> [--tags <tag1,tag2>]
```

## Classification Pipeline

### Thread State Machine

```
IDLE → STARTING → READY ⇄ PROCESSING → (READY | ERROR | TERMINATED)
```

- Workers managed by `ClassificationWorkerPool`
- Graceful shutdown on SIGINT/SIGTERM
- Progress callbacks with throttling for TTY

### Feature Extraction

The `heuristicFeatureExtractor` computes:
- **MFCC** (13 coefficients) - Timbral texture
- **Spectral** - Centroid, rolloff, flux
- **Rhythm** - BPM, onset strength
- **Energy** - RMS, dynamic range

Features normalized to `[-1, 1]` before storage.

### Auto-Tagging

Tags derived from feature thresholds + ML predictions:
- **Mood:** energetic, melancholic, upbeat, dark, calm
- **Style:** chiptune, orchestral, bass-heavy, melodic
- **Tempo:** slow (<90 BPM), medium, fast (>140 BPM)

## Web Interface

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/songs` | GET | List songs with pagination, filters |
| `/api/songs/[id]` | GET | Song details + features |
| `/api/songs/[id]/stream` | GET | HLS stream or direct WAV |
| `/api/songs/[id]/similar` | GET | Similar songs via LanceDB |
| `/api/feedback` | POST | Submit rating/tag feedback |
| `/api/health` | GET | Health check for load balancers |
| `/api/admin/metrics` | GET | Prometheus metrics |

### Query Parameters (songs list)

```
?q=<search>&mood=<mood>&style=<style>&sort=<field>&order=asc|desc&page=<n>&limit=<n>
```

### Client-Side Playback

Four playback adapters with automatic fallback:

1. **WASM** (default) - libsidplayfp in browser via AudioWorklet
2. **HLS** - Server-rendered adaptive streaming
3. **CLI** - Node.js sidplayfp for headless
4. **Ultimate64** - Network streaming to real hardware

```typescript
// Adapter selection
const player = createPlayer({
  adapter: 'auto', // auto | wasm | hls | cli | ultimate64
  sampleRate: 48000,
  bufferSize: 4096
});
```

## LanceDB Vector Database

### Schema

```typescript
interface SongVector {
  id: string;           // Unique song identifier
  path: string;         // Relative SID path
  embedding: number[];  // 128-dim feature vector
  tags: string[];       // Auto + user tags
  rating: number;       // Aggregated rating
}
```

### Building

```bash
bun run build:db  # Builds data/sidflow.lance/ from classified data
```

### Querying

```typescript
import { connect } from 'vectordb';

const db = await connect('data/sidflow.lance');
const table = await db.openTable('songs');
const similar = await table.search(embedding).limit(10).execute();
```

## Configuration

### .sidflow.json

```json
{
  "sidPath": "./data/hvsc/C64Music",
  "wavCachePath": "./data/wav-cache",
  "classifiedPath": "./data/classified",
  "feedbackPath": "./data/feedback",
  "modelPath": "./data/model",
  "lancePath": "./data/sidflow.lance",
  "concurrency": 8,
  "logLevel": "info"
}
```

All paths relative to config file location. Override with `--config` flag.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SIDFLOW_CONFIG` | Config file path |
| `SIDFLOW_LOG_LEVEL` | debug, info, warn, error |
| `PORT` | Web server port (default: 3000) |
| `NODE_ENV` | development, production |

## Troubleshooting

### Common Issues

**"Cannot find SID files"**
- Check `sidPath` in `.sidflow.json` points to HVSC root
- Run `sidflow-fetch` to download collection

**"Render failed: sidplayfp error"**
- Ensure sidplayfp is installed: `apt install sidplayfp`
- Check SID file isn't corrupted

**"LanceDB query timeout"**
- Rebuild database: `bun run build:db`
- Check disk space for vector storage

**"WASM playback silent"**
- Browser requires user gesture for audio
- Check AudioContext state: `player.context.state`

### Debug Logging

```bash
SIDFLOW_LOG_LEVEL=debug sidflow-classify --max-files 10
```

## Observability

### Prometheus Metrics

Available at `/api/admin/metrics`:

- `sidflow_songs_total` - Total songs in database
- `sidflow_playback_duration_seconds` - Playback histogram
- `sidflow_feedback_total` - Feedback submissions by type
- `sidflow_classification_duration_seconds` - Processing time

### Health Checks

```bash
curl http://localhost:3000/api/health
# {"status":"ok","version":"1.0.0","uptime":3600}
```

## Data Flow

### Feedback Loop

```
User Rating → data/feedback/YYYY/MM/events.jsonl
           → Training merge with classification
           → Updated model weights
           → Better recommendations
```

Feedback weights:
- Explicit rating: 1.0
- Skip (<10s): -0.3
- Full listen: +0.2
- Replay: +0.5

### JSONL Formats

**Classified song:**
```json
{"path":"MUSICIANS/H/Hubbard_Rob/Commando.sid","subsong":0,"features":[...],"tags":["energetic","chiptune"],"duration":180}
```

**Feedback event:**
```json
{"timestamp":"2024-01-15T10:30:00Z","path":"...","type":"rating","value":4,"tags":["favorite"]}
```
