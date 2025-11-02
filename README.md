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

### 3. `sidflow-classify` (planned)

```sh
./scripts/sidflow-classify [--force-rebuild] [--sidplay <path>] [--config <path>]
```

**Status:** Planned  
**Purpose:** Analyse audio, extract features, and generate mood-aware playlists.  
**Operation:** Converts `.sid` to WAV, computes feature vectors, compares against learned patterns, and emits playlists grouped by tempo, mood, and complexity.

**Flags**

- `--force-rebuild` — ignore cache and recompute  
- `--sidplay <path>` — override player binary  

**Outputs**

- Playlists and metadata under `wavCachePath` and `tagsPath`  

---

### 4. `sidflow-play` (planned)

```sh
./scripts/sidflow-play [--mood <profile>] [--filters <expr>] [--export <path>]
```

**Status:** Planned  
**Purpose:** Turn your classified collection into a dynamic SID playlist experience.  
**Operation:** Combines manual and automatic tags to build thematic queues (e.g., “bright + energetic”), streams through `sidplayfp`, and exports deterministic manifests.

**Flags**

- `--mood <profile>` — predefined blend (e.g., `focus`, `sunrise`)  
- `--filters <expr>` — range expressions like `s>=4,m>=3`  
- `--export <path>` — write playlists (JSON/M3U)  

**Outputs**

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
