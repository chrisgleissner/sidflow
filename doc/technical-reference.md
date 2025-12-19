# SIDFlow Technical Reference

## Architecture overview

SIDFlow is a CLI-first pipeline with an optional web UI:

```mermaid
graph LR
    A[Fetch (HVSC)] --> B[Render + Classify]
    B --> C[Train (optional)]
    C --> D[Play / Recommend]
```

## Key packages

- **`@sidflow/fetch`**: downloads/syncs HVSC into `sidPath`.
- **`@sidflow/classify`**: renders SIDs to audio, extracts features, and writes JSONL classification output.
- **`@sidflow/train`**: trains/updates TensorFlow.js model artifacts (optional).
- **`@sidflow/play`**: playlist generation and similarity helpers (LanceDB-backed where configured).
- **`@sidflow/web`**: Next.js 16 / React 19 web UI and API routes.

## CLI entry points

This repo ships wrapper scripts under `scripts/`:

```bash
bun ./scripts/sidflow-fetch    --help
bun ./scripts/sidflow-classify --help
bun ./scripts/sidflow-train    --help
bun ./scripts/sidflow-rate     --help
bun ./scripts/sidflow-play     --help
```

Each CLI loads `.sidflow.json` by default (override via `--config` where supported or `SIDFLOW_CONFIG`).

## Classification (what it actually computes)

`@sidflow/classify` renders SIDs to WAV and extracts a compact set of objective features from a representative audio window.

Core features used by the deterministic rating/spec mapping include:

- `bpm` (plus `confidence` when available)
- `rms`, `energy`
- `spectralCentroid`, `spectralRolloff`, `spectralHfc`
- `spectralFlatnessDb`, `spectralEntropy`, `spectralCrest`
- `zeroCrossingRate`

When Essentia.js is unavailable or fails, SIDFlow falls back to a lightweight heuristic extractor (still producing a compatible feature shape).

### Ratings (`c/e/m`)

SIDFlow stores 3 ratings per song: `c` (complexity proxy), `e` (energy proxy), and `m` (mood proxy with restricted claims).

- Default auto-derivation is deterministic and dataset-normalized (features → perceptual tags → ratings). See `doc/feature-tag-rating-mapping.md`.
- A legacy seed-based “heuristic” predictor exists in code for testing/backwards-compatibility, but it is not a meaningful perceptual mapping (it does not use audio features) and should not be used as anything more than a placeholder.

Model-based prediction is available when a TFJS model is configured/available.

## Web UI and API

The web app runs at:

- **Public UI**: `/`
- **Admin UI** (auth required): `/admin`
- **API**: `/api/*`

The OpenAPI file documents a subset of endpoints:

- `packages/sidflow-web/openapi.yaml`

For the complete list, inspect `packages/sidflow-web/app/api/**/route.ts`.

Selected endpoints implemented in `packages/sidflow-web/app/api/**/route.ts`:

- **Health / metrics**: `GET /api/health`, `GET /api/admin/metrics`
- **Playback sessions**: `POST /api/play`, `POST /api/play/random`, `POST /api/play/manual`
- **Stations**: `POST /api/play/station-from-song`, plus additional station builders under `/api/play/*`
- **Ratings**: `POST /api/rate` (writes manual tag files), `GET /api/rate/aggregate`
- **Favorites**: `GET/POST/DELETE /api/favorites` (stored in `data/.sidflow-preferences.json`)
- **Classification**: `POST /api/classify`, progress/control under `/api/classify/*`
- **Fetch**: `POST /api/fetch`, progress under `/api/fetch/progress`

## Data layout (common defaults)

- **SID collection**: `sidPath` (e.g. `./workspace/hvsc`)
- **Audio cache**: `audioCachePath` (e.g. `./workspace/audio-cache`)
- **Manual tags/ratings**: `tagsPath` (e.g. `./workspace/tags`)
- **Web preferences**: `data/.sidflow-preferences.json`
- **HLS assets** (fallback playback): `workspace/hls/`

## Configuration

The repo’s default config file is `.sidflow.json` at the repository root. See that file for the current schema and defaults.

## Troubleshooting

- **Admin login fails**: confirm `SIDFLOW_ADMIN_USER` / `SIDFLOW_ADMIN_PASSWORD` match the values used by your deployment.
- **No audio in browser**: browsers require a user gesture before audio playback; click “Play” once to unlock audio.
- **HLS fallback missing**: HLS assets are generated on-demand into `workspace/hls/`; ensure the server can write to that directory.
