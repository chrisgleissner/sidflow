# SID Flow

SID Flow keeps your High Voltage SID Collection (HVSC) current, helps you tag favourites, and can auto-classify the rest. Everything runs from simple CLIs powered by Bun and TypeScript.

---

## What You Need

- Bun ≥ 1.1.10
- `sidplayfp` on your `PATH` (or pass `--sidplay <path>` per command)
- A working 7-Zip (`7z`) binary for extracting HVSC archives

Drop a `.sidflow.json` next to this README before running any tool. The default shape is:

```json
{
  "hvscPath": "./data/hvsc",
  "wavCachePath": "./data/wav-cache",
  "tagsPath": "./data/tags",
  "sidplayPath": "sidplayfp",
  "threads": 0,
  "classificationDepth": 3
}
```

Run `bun run validate:config` anytime to confirm the file is well formed.

---

## The Three SID Flow Tools

Each tool exposes a simple CLI. Run them from the repository root with Bun, for example `bun packages/sidflow-fetch/src/cli.ts --help`.

### 1. `sidflow fetch`

- **Status:** available today.
- **Run when:** setting up a new machine or refreshing HVSC after releases.
- **What it does:** downloads the latest HVSC base archive, applies any missing deltas, and records progress in `hvsc-version.json`.
- **Key flags:**
  - `--remote <url>` – mirror root to scrape (defaults to `https://hvsc.brona.dk/HVSC/`)
  - `--version-file <path>` – custom location for `hvsc-version.json`
- **Shared flags:**
  - `--config <path>` – load an alternate `.sidflow.json`
  - `--help` – print usage
- **Outputs:** refreshed HVSC tree under `hvscPath`, updated version metadata beside it.

### 2. `sidflow tag`

- **Status:** CLI under construction (Phase 3). Library helpers already expose the planning API.
- **Run when:** you want to manually review and tag tracks, usually after a fetch.
- **What it does:** queues untagged `.sid` files for playback via `sidplayfp`, lets you assign the three `s/m/c` sliders (Speed, Mood, Complexity), and writes deterministic `*.sid.tags.json` files next to the music.
- **Key flags:**
  - `--random` – shuffle the queue instead of walking directories alphabetically
  - `--sidplay <path>` – override the player binary
- **Outputs:** human-authored tag files living right beside their matching `.sid` source files.

### 3. `sidflow classify`

- **Status:** CLI under construction (Phase 4). Planning API is ready for experimentation.
- **Run when:** you have a reasonably tagged seed library and want the rest auto-labelled.
- **What it does:** trains on manual tags, renders WAVs into the cache, extracts features, predicts missing `s/m/c` values, and writes aggregated `auto-tags.json` files using `classificationDepth`.
- **Key flags:**
  - `--force-rebuild` – discard cached models and recompute features from scratch
  - `--sidplay <path>` – override the player binary for WAV renders
- **Outputs:** updated WAV cache, regenerated `auto-tags.json`, and merged tag data within each HVSC folder depth.

---

## Typical Flow

1. `bun run validate:config` – confirm your config.
2. `bun packages/sidflow-fetch/src/cli.ts` – sync or resync HVSC.
3. Tag and classify CLIs will land next; until then the planning helpers live in `packages/sidflow-tag` and `packages/sidflow-classify` for early adopters.

HVSC content lives under `hvscPath`; WAVs and generated tags mirror the same folder structure beneath `wavCachePath` and `tagsPath`.

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
