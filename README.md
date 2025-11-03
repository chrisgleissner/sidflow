![Logo](./doc/img/logo.png)

# SID Flow

Classify any C64 song collection: from raw SID tunes to mood-driven playlists.

[![CI](https://img.shields.io/github/actions/workflow/status/chrisgleissner/sidflow/ci.yml?branch=main&logo=github&label=CI)](https://github.com/chrisgleissner/sidflow/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/chrisgleissner/sidflow/graph/badge.svg?token=ynAHHsMqMG)](https://codecov.io/github/chrisgleissner/sidflow)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-forestgreen)](doc/developer.md)

**SID Flow** contains various CLI scripts to process any SID library - such as the High Voltage SID Collection ([HVSC](https://www.hvsc.c64.org/)) or your own archive - to extract structure, mood, and complexity. It builds deterministic playlists that you can play directly or integrate into existing workflows.

> [!NOTE]
> This project is in active development. Several features mentioned below are planned but not yet implemented.

---

## Requirements

- [Bun](https://bun.com/docs/installation) ≥ 1.1.10 - for executing Typescript
- [sidplayfp](https://github.com/libsidplayfp/sidplayfp) in your `PATH` (or specify with `--sidplay <path>`) - for SID playback and WAV rendering
- [7-Zip](https://www.7-zip.org/download.html) - for archive extraction  

Place a `.sidflow.json` configuration file beside this README before running any tool.  
Default structure:

```json
{
  "hvscPath": "./workspace/hvsc",
  "wavCachePath": "./workspace/wav-cache",
  "tagsPath": "./workspace/tags",
  "sidplayPath": "sidplayfp",
  "threads": 0,
  "classificationDepth": 3
}
```

Validate configuration anytime:

```bash
bun run validate:config
```

---

## CLI Tools

Each command can be run via the command line interface from the repository root.

### 1. `sidflow-fetch`

```sh
./scripts/sidflow-fetch [--remote <url>] [--version-file <path>] [--config <path>] [--help]
```

**Status:** Done  
**Purpose:** Keep a reproducible HVSC or custom SID mirror for downstream processing.  
**Operation:** Downloads the latest base archive, applies missing deltas, and records version metadata in `hvsc-version.json`.

**Key flags**

- `--remote <url>` — mirror root (default: `https://hvsc.brona.dk/HVSC/`)  
- `--version-file <path>` — custom location for version metadata  
- `--config <path>` — alternate configuration file  
- `--help` — show usage  

**Outputs**

- Updated SID tree under `hvscPath`  
- Refreshed `hvsc-version.json` containing version and checksum data  

---

### 2. `sidflow-tag` (planned)

```sh
./scripts/sidflow-tag [--sidplay <path>] [--config <path>]
```

**Status:** In development  
**Purpose:** Provide human-readable mood labels for supervised classification.  
**Operation:** Plays untagged `.sid` files via `sidplayfp`, records speed/mood/complexity (`s/m/c`) ratings, and stores results beside each track.

**Controls**

- `s1-5`, `m1-5`, `c1-5` — set values (default 3)  
- `Enter` — save and advance  
- `Q` — quit safely while saving progress  

**Outputs**

- Deterministic `*.sid.tags.json` files with timestamps and version markers  

---

### 3. `sidflow-classify`

```sh
./scripts/sidflow-classify [--config <path>] [--sidplay <path>] [--force-rebuild]
                            [--feature-module <path>] [--predictor-module <path>]
                            [--metadata-module <path>] [--render-module <path>]
```

**Status:** In development with Essentia.js + TensorFlow.js integration available  
**Purpose:** Convert SIDs to WAV, extract features, merge manual tags, and publish deterministic `auto-tags.json` summaries.  
**Operation:** Rebuilds the WAV cache, captures metadata (falling back to path heuristics when `sidplayfp` is missing), derives feature vectors using Essentia.js, and predicts `(s/m/c)` ratings using TensorFlow.js for untagged dimensions without overwriting manual values.

#### Flags (classification)

- `--config <path>` — alternate `.sidflow.json`
- `--sidplay <path>` — override `sidplayfp` binary for WAV + metadata extraction
- `--force-rebuild` — re-render WAV cache even if fresh
- `--feature-module <path>` — custom Bun/ESM module exporting `featureExtractor`
- `--predictor-module <path>` — custom module exporting `predictRatings`
- `--metadata-module <path>` — custom module exporting `extractMetadata`
- `--render-module <path>` — custom module exporting `render` hook (handy for tests)

#### Outputs (classification)

- Deterministic WAV cache under `wavCachePath`
- Per-SID metadata files (`*.sid.meta.json`)
- Aggregated `auto-tags.json` files respecting `classificationDepth`
- Summary of auto/manual/mixed tag coverage on stdout
- **Performance metrics** (runtime, cache hit rate, predictions generated) — see [`doc/performance-metrics.md`](doc/performance-metrics.md)

> [!TIP]
> The CLI now includes Essentia.js for feature extraction and TensorFlow.js for rating prediction. Features extracted include energy, RMS, spectral centroid, spectral rolloff, zero crossing rate, and BPM. The TF.js model uses a lightweight neural network architecture. For production use, train the model with your labeled data. See [`packages/sidflow-classify/README-INTEGRATION.md`](packages/sidflow-classify/README-INTEGRATION.md) for details on customization and training.

---

### 4. `sidflow-play` (planned)

```sh
./scripts/sidflow-play [--mood <profile>] [--filters <expr>] [--export <path>]
```

**Status:** Planned  
**Purpose:** Turn your classified collection into a dynamic SID playlist experience.  
**Operation:** Combines manual and automatic tags to build thematic queues (e.g., “bright + energetic”), streams through `sidplayfp`, and exports deterministic manifests.

#### Flags (play)

- `--mood <profile>` — predefined blend (e.g., `focus`, `sunrise`)  
- `--filters <expr>` — range expressions like `s>=4,m>=3`  
- `--export <path>` — write playlists (JSON/M3U)  

#### Outputs (play)

- Portable playlist files and live playback session state  

---

## Typical Workflow

1. `bun run validate:config` — verify configuration  
2. `./scripts/sidflow-fetch` — download or refresh your SID mirror  
3. `./scripts/sidflow-tag` — manually tag songs to provide seeds for classification
4. `./scripts/sidflow-classify` — automatically classify all songs based on tags
5. `./scripts/sidflow-play` — filter and play curated sets  

All generated data (HVSC mirror, WAVs, tags) stays under `workspace/` and is git-ignored by default.

---

## Troubleshooting

### Fetching HVSC

- Retries manifest and archive downloads up to three times.  
- On persistent errors, use `--remote` with an alternate mirror.  
- Delete partial archives if extraction fails and rerun.  
- Ensure `7z` is installed and accessible on your `PATH`.  
- If `hvsc-version.json` drifts from actual content, remove it to trigger a clean re-sync.

---

## Development

Setup details, structure, and testing are described in [`doc/developer.md`](doc/developer.md).

---

## License

GPL v2 — see `LICENSE`.
