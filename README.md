![Logo](./doc/img/logo.png)

# SID Flow

[![Build](https://img.shields.io/github/actions/workflow/status/chrisgleissner/sidflow/ci.yaml)](https://github.com/chrisgleissner/sidflow/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/github/chrisgleissner/sidflow/graph/badge.svg?token=ynAHHsMqMG)](https://codecov.io/github/chrisgleissner/sidflow)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-forestgreen)](doc/developer.md)


SID Flow mirrors the High Voltage SID Collection (HVSC), analyses every tune, and builds mood-driven playlists you can drop straight into your listening pipeline.

Everything runs from simple CLIs powered by Bun and TypeScript.

---

## What You Need

- Bun ≥ 1.1.10
- `sidplayfp` on your `PATH` (or pass `--sidplay <path>` per command)
- A working 7-Zip (`7z`) binary for extracting HVSC archives

Drop a `.sidflow.json` next to this README before running any tool. The default shape is:

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

Run `bun run validate:config` anytime to confirm the file is well formed.

---

## SID Flow Tools

Each tool exposes a simple CLI. Run them from the repository root, for example `./scripts/sidflow-fetch --help`.

### 1. `sidflow fetch`

- **Status:** production ready.
- **Why:** keeps a reproducible HVSC mirror for downstream analysis.
- **What it does:** downloads the latest HVSC base archive, applies any missing deltas, and records progress in `hvsc-version.json`.
- **Key flags:**
  - `--remote <url>` – mirror root to scrape (defaults to `https://hvsc.brona.dk/HVSC/`)
  - `--version-file <path>` – custom location for `hvsc-version.json`
- **Shared flags:**
  - `--config <path>` – load an alternate `.sidflow.json`
  - `--help` – print usage
- **Outputs:** refreshed HVSC tree under `hvscPath`, updated version metadata beside it.

### 2. `sidflow tag`

- **Status:** in development.
- **Why:** supplies the human mood labels the classifier learns from.
- **What it will do:** queue untagged `.sid` files for playback through `sidplayfp`, capture your `s/m/c` ratings (Speed, Mood, Complexity), and write deterministic `*.sid.tags.json` right beside the source tune.
- **Key controls (planned):**
  - `s1-5`, `m1-5`, `c1-5` – set sliders; default to level 3 when omitted
  - `Enter` – save ratings and advance
  - `Q` – exit gracefully while persisting progress
- **Outputs (planned):** clearly versioned manual tag files with timestamps and source markers.

### 3. `sidflow classify`

- **Status:** under active development.
- **Why:** converts your HVSC mirror into mood-aware insight—tempo, emotion, intensity—and assembles curated playlists.
- **What it will do:** render SIDs to WAV, extract audio features, score each track against trained mood models, and emit deterministic playlist manifests you can sync with players.
- **Key knobs (planned):**
  - `--force-rebuild` – discard cached features/models and recompute from scratch
  - `--sidplay <path>` – override the renderer binary for WAV outputs
- **Outputs (planned):** mood-segmented playlists and companion metadata alongside `wavCachePath` and `tagsPath`.

### 4. `sidflow play`

- **Status:** planned.
- **Why:** turns your classified library into a personal SID radio tailored to moment-by-moment preferences.
- **What it will do:** blend manual and automatic tags to build adaptive queues (e.g., "bright + energetic"), stream them through `sidplayfp`, and export queue manifests for later reuse.
- **Key knobs (planned):**
  - `--mood <profile>` – shorthand for saved blends (e.g., `focus`, `sunrise`)
  - `--filters <expr>` – ad-hoc ranges like `s>=4,m>=3`
  - `--export <path>` – write deterministic playlist JSON/M3U for external players
- **Outputs (planned):** live playback session management plus portable playlist files under `tagsPath`.

> Manual seed labels remain supported through the library APIs, but the mainline workflow focuses on automated classification for mood-first listening.

---

## Typical Flow

1. `bun run validate:config` – confirm your config.
2. `./scripts/sidflow-fetch` – sync or resync HVSC.
3. `sidflow tag` (coming soon) – capture seed labels for the moods you care about.
4. `sidflow classify` (coming soon) – generate features, train models, and broaden coverage.
5. `sidflow play` (planned) – stream mood-matched sets or export playlists on demand.

HVSC content lives under `hvscPath`; WAVs and generated tags mirror the same folder structure beneath `wavCachePath` and `tagsPath`.
The repository git-ignores the `workspace/` directory so your local HVSC mirror and derived assets stay out of version control.

---

## Troubleshooting

### Fetching HVSC

- SID Flow automatically retries manifest lookups and archive downloads three times. If you continue to see `Failed to fetch HVSC manifest`, verify your network/firewall and try `--remote` with a different mirror.
- On repeated download failures, delete the partially created archive in your temp directory (reported in the error) and rerun `sidflow fetch`.
- The file `hvsc-version.json` records the SHA-256 checksum for the base archive and every applied delta. If your local tree drifts (e.g., manual edits), remove that file to force a clean re-sync and compare the stored checksums afterward.
- Extract errors typically mean `7z` is missing—install it or ensure it is on your `PATH`.

---

## Development

Developer setup, project layout, and testing expectations now live in `doc/developer.md`.

---

## License

GPL v2 – see `LICENSE`.
