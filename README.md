<!-- markdownlint-disable-next-line MD041 -->
![Logo](./doc/img/logo.png)

# SIDFlow

A seamless stream of similar Commodore 64 SID songs.

[![CI](https://img.shields.io/github/actions/workflow/status/chrisgleissner/sidflow/ci.yaml?branch=main&logo=github&label=CI)](https://github.com/chrisgleissner/sidflow/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/github/chrisgleissner/sidflow/graph/badge.svg?token=ynAHHsMqMG)](https://codecov.io/github/chrisgleissner/sidflow)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-forestgreen)](doc/developer.md)


> [!NOTE]
> This project is under active development. Some documented features may not yet be fully functional.

---

## Features

- **Automatic SID analysis**  
  Structural and audio feature extraction used to compare tracks without manual metadata.

- **Similarity-based SID stations**  
  Automatically generate stations from a selected track based on analysed song structure.

- **Web-based player**  
  Browse, search, and play SID music, manage favourites, and build playlists.

- **CLI tools**  
  Command-line utilities for analysis, classification, and automation, including a CLI-based SID radio station.


---

## Getting Started

### Install Bun

First install Bun (see [bun.com/docs/installation](https://bun.com/docs/installation)):

macOS and Linux:

```sh
curl -fsSL https://bun.com/install | bash
```

Windows:

```sh
powershell -c "irm bun.sh/install.ps1|iex"
```

### Build Project

Then install and build this project:

```bash
git clone https://github.com/chrisgleissner/sidflow.git
cd sidflow
bun run build
```

## Deployment

See [Deployment Guide](doc/deployment.md) for Docker and Fly.io deployment options.

**Docker images:**  
- `ghcr.io/chrisgleissner/sidflow:<version>` (e.g., `v0.3.10`)  
- [ghcr.io/chrisgleissner/sidflow:latest](https://github.com/chrisgleissner/sidflow/pkgs/container/sidflow)

### Quick Deploy to Fly.io

Fly deployment is currently supported only as a single stateful machine. Multi-machine scaling and rolling deploys remain blocked on the Phase 2 shared-state work in [PLANS.md](PLANS.md).

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy to staging
./scripts/deploy/fly-deploy.sh -e stg

# Deploy to production
./scripts/deploy/fly-deploy.sh -e prd -t <tag>
```

See [Deployment Guide](doc/deployment.md) for details.

### Run with Docker

See **Deployment Guide** for full Docker instructions, CLI usage, health checks, and smoke-testing: [doc/deployment.md](doc/deployment.md).

Standard production scenario:

```bash
docker run -p 3000:3000 \
  -e SIDFLOW_ADMIN_USER=admin \
  -e SIDFLOW_ADMIN_PASSWORD='your-password' \
  -e SIDFLOW_ADMIN_SECRET='replace-with-a-32-character-secret-minimum' \
  -e JWT_SECRET='replace-with-a-32-character-secret-minimum' \
  -v /path/to/hvsc:/sidflow/workspace/hvsc \
  -v /path/to/audio-cache:/sidflow/workspace/audio-cache \
  -v /path/to/tags:/sidflow/workspace/tags \
  -v /path/to/data:/sidflow/data \
  ghcr.io/chrisgleissner/sidflow:latest
```
Web UI: <http://localhost:3000> (admin at `/admin` with the credentials you configured above).

### Run Locally

Development mode with hot reload:

```bash
cd packages/sidflow-web
bun run dev
```

Production mode (after `bun run build`):

```bash
cd packages/sidflow-web
bun run start
```

Web UI: <http://localhost:3000>.

### Performance Tests

Run the unified performance suite (journey-driven; k6 and optional Playwright) with the shared runner:

```bash
# Point at an already-running server
bun run perf:run -- --env local --base-url http://localhost:3000 --results performance/results --tmp performance/tmp --execute
```

- **Profiles**: `--profile smoke|reduced|standard|scale` (defaults: local→smoke, CI→reduced, remote→reduced).
- **GitHub runner (CI)**: runs **reduced** load and **k6-only** for stability (see `.github/workflows/performance.yml`).
- **CI data**: uses a tiny, deterministic SID fixture (no HVSC download) via `scripts/perf/prepare-perf-fixtures.sh`.
- **Fly.io / Raspberry Pi (remote targets)**: supported via `--env remote --enable-remote --base-url <url>` (typically with `--executor k6`).
- **Hundreds of users**: opt-in only via `--profile scale` (remote-only guard to avoid accidental load).
- **Journeys** live in `performance/journeys/` (e.g. `play-start-stream.json`).
- **Outputs**: `performance/results/<timestamp>/` (report + summaries) and `performance/tmp/<timestamp>/` (generated scripts).

## Portable Similarity Export

After classification, SIDFlow can export a portable offline similarity bundle for downstream consumers.

```bash
bun run export:similarity -- --profile full
```

By default this writes:

- `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- `data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`

The SQLite bundle stores per-track ratings, feedback aggregates, optional vectors, and optional precomputed neighbors. See [doc/similarity-export.md](doc/similarity-export.md) for the schema, consumer workflow, and the full local classify-then-export sequence.

If you already have classified feature output in `data/classified` and only need the SQLite bundle, you do not need to re-run classification. The exporter will read the existing `features_*.jsonl` and `classification_*.jsonl` files from the configured `classifiedPath` and build the SQLite bundle directly:

```bash
bun run export:similarity -- --profile full --output data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite
```

For example, if `data/classified/features_2026-03-14_13-03-41-920.jsonl` already exists, the command above converts that classified corpus into the portable SQLite export.

If your classified JSONL files live in another directory, point SIDFlow at that directory via an alternate config and export from there:

```bash
cp .sidflow.json /tmp/sidflow-export.json
# edit /tmp/sidflow-export.json so classifiedPath points at the directory containing your features_*.jsonl files
bun run export:similarity -- --config /tmp/sidflow-export.json --profile full --output /path/to/sidcorr.sqlite
```

The exporter also recovers rows from existing `features_*.jsonl` files when a previous classify run was interrupted before all `classification_*.jsonl` rows were written, so an existing large features file is still enough to produce a complete SQLite bundle.

### SID Flow CLI Station

To prove the standalone SQLite export is usable on its own, run the SID Flow CLI Station for local playback: 

```bash
./scripts/sid-station.sh
```

For remote playback on a Commodore 64 Ultimate in your LAN, try this:

```bash
./scripts/sid-station.sh --c64u-host c64u
```

If `workspace/hvsc` is missing or empty, the wrapper  bootstraps HVSC automatically with the existing fetch CLI before starting the demo.

If the export already exists and you only want to publish the bundle to the separate `sidflow-data` release repository, you can skip classification and export generation entirely:

```bash
bash scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true
```

Screenshot:

![SID Flow CLI Station](./doc/cli-screenshots/sidflow-station.png)  

## Web UI

For those who prefer a graphical interface, SID Flow includes a **Next.js + React** control panel with two interfaces:

### Two Access Points

- **Public Player** at **<http://localhost:3000>** - Simple playback interface for casual listening
- **Admin Console** at **<http://localhost:3000/admin>** - Full pipeline control and operations

```bash
cd packages/sidflow-web
bun run dev
```

### Admin Authentication

The admin console requires authentication for security:

- **Username:** `SIDFLOW_ADMIN_USER` (defaults to `admin` outside production)
- **Password:** `SIDFLOW_ADMIN_PASSWORD`
- **Session signing secret:** `SIDFLOW_ADMIN_SECRET`

Local development falls back to `admin/password` only when you have not configured credentials. Production startup now refuses default credentials, derived admin secrets, missing `SIDFLOW_ADMIN_SECRET`, or a missing `JWT_SECRET`.

For web UI route details, see [packages/sidflow-web/README.md](packages/sidflow-web/README.md).

### Public Player Features

The public interface at **<http://localhost:3000>** provides:

- **Play Tab** - Mood-based playback with presets (Quiet, Ambient, Energetic, Dark, Bright, Complex)
- **Preferences** - Local theme and font settings

### Admin Console Features

The admin interface at **<http://localhost:3000/admin>** provides full system control:

#### Wizard

First-time setup walks you through selecting your HVSC root and confirming cache locations.

![wizard panel](./doc/web-screenshots/01-wizard.png)

#### Preferences

Tweak themes, fonts, render engines, ROM paths, and collection settings.

![preferences panel](./doc/web-screenshots/02-prefs.png)

#### Fetch HVSC

Download and synchronize the High Voltage SID Collection.

![fetch panel](./doc/web-screenshots/03-fetch.png)

#### Rate

Manually rate songs on energy, complexity, mood, and preference. Ratings are stored as tag files under `tagsPath` and can be used by training/classification workflows.

![rate panel](./doc/web-screenshots/04-rate-playback.png)

#### Classify

Automatically analyze your entire collection using audio features.

![classify panel](./doc/web-screenshots/05-classify-progress.png)

#### Play

Create mood-based queues with full playback controls and history.

![play panel](./doc/web-screenshots/07-play.png)

### Player notes

- **Search**: available in the Play tab; press `S` to focus the search input.
- **Keyboard shortcuts (Play tab)**: Space (play/pause), ←/→ (prev/next), ↑/↓ (volume), `M` (mute), `?` (help). Shortcuts are disabled while typing in inputs.
- **Favorites**: stored server-side (in `data/.sidflow-preferences.json`) and shared across browsers pointing at the same server. “Play All” / “Shuffle” currently start playback from the first selected entry (queueing the rest is not implemented yet).
- **Recently played**: stored in the browser (localStorage), up to 100 entries, with a “Clear History” action.

### Additional Features

- Play and control SID playback by mood
- Trigger HVSC fetch and training jobs
- Real-time system feedback and status display
- RESTful API and [OpenAPI Spec](packages/sidflow-web/openapi.yaml)

Documentation: [packages/sidflow-web/README.md](packages/sidflow-web/README.md)

---

## Command-Line Tools

If you prefer automation or terminal workflows, use the CLI tools documented in the [Technical Reference](./doc/technical-reference.md).

### Available CLIs

- **[sidflow-fetch](packages/sidflow-fetch/README.md)** - Sync HVSC collection from official mirrors
- **[sidflow-classify](packages/sidflow-classify/README.md)** - Render + extract features; write classification JSONL
- **[sidflow-train](packages/sidflow-train/README.md)** - Train/update the TensorFlow.js model artifacts
- **[sidflow-rate](packages/sidflow-rate/README.md)** - Write manual rating/tag files
- **[sidflow-play](packages/sidflow-play/README.md)** - Generate playlists / exports using similarity search

Start your own local SID CLI station on the command line with:

```bash
./scripts/sid-station.sh
```

---

## Config

The `.sidflow.json` file defines where SIDFlow should read your SID collection along with other runtime paths:

```json
{
  "sidPath": "./workspace/hvsc",
  "audioCachePath": "./workspace/audio-cache",
  "tagsPath": "./workspace/tags",
  "threads": 0,
  "classificationDepth": 3
}
```



## Developer Documentation

- **[Technical Reference](doc/technical-reference.md)** – architecture, CLI tools, APIs  
- **[Developer Guide](doc/developer.md)** – setup, testing, contributions

---

## Acknowledgements

SIDFlow is [GPLv2](LICENSE)-licensed and builds upon open-source software and datasets:

| Component | License | Source | Credit |
|------------|----------|---------|-----|
| **Bun** | MIT | [github.com/oven-sh/bun](https://github.com/oven-sh/bun) | JS runtime and tooling |
| **libsidplayfp** | GPL v2+ | [github.com/libsidplayfp/libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) | Software SID emulator (compiled to WASM for browser playback) |
| **High Voltage SID Collection (HVSC)** | Free for personal use | [hvsc.c64.org](https://www.hvsc.c64.org/) | Largest SID collection |
