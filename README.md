![Logo](./doc/img/logo.png)

# SID Flow

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

### 2. `sidflow classify`

- **Status:** under active development.
- **Why:** converts your HVSC mirror into mood-aware insight—tempo, emotion, intensity—and assembles curated playlists.
- **What it will do:** render SIDs to WAV, extract audio features, score each track against trained mood models, and emit deterministic playlist manifests you can sync with players.
- **Key knobs (planned):**
  - `--force-rebuild` – discard cached features/models and recompute from scratch
  - `--sidplay <path>` – override the renderer binary for WAV outputs
- **Outputs (planned):** mood-segmented playlists and companion metadata alongside `wavCachePath` and `tagsPath`.

> Manual seed labels remain supported through the library APIs, but the mainline workflow focuses on automated classification for mood-first listening.

---

## Typical Flow

1. `bun run validate:config` – confirm your config.
2. `./scripts/sidflow-fetch` – sync or resync HVSC.
3. The classification CLI is landing next; planning helpers already live in `packages/sidflow-classify` for early adopters who want to experiment with feature extraction.

HVSC content lives under `hvscPath`; WAVs and generated tags mirror the same folder structure beneath `wavCachePath` and `tagsPath`.
The repository git-ignores the `workspace/` directory so your local HVSC mirror and derived assets stay out of version control.

---

## Troubleshooting Fetches

- SID Flow automatically retries manifest lookups and archive downloads three times. If you continue to see `Failed to fetch HVSC manifest`, verify your network/firewall and try `--remote` with a different mirror.
- On repeated download failures, delete the partially created archive in your temp directory (reported in the error) and rerun `sidflow fetch`.
- The file `hvsc-version.json` records the SHA-256 checksum for the base archive and every applied delta. If your local tree drifts (e.g., manual edits), remove that file to force a clean re-sync and compare the stored checksums afterward.
- Extract errors typically mean `7z` is missing—install it or ensure it is on your `PATH`.

---

## Need to Contribute?

Developer setup, project layout, and testing expectations now live in `doc/developer.md`.

---

## License

GPL v2 – see `LICENSE`.
