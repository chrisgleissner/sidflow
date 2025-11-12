<!-- markdownlint-disable-next-line MD041 -->
![Logo](./doc/img/logo.png)

# SID Flow

Listen to C64 music based on your mood – automatically classified (under development) and ready to play.

[![CI](https://img.shields.io/github/actions/workflow/status/chrisgleissner/sidflow/ci.yaml?branch=main&logo=github&label=CI)](https://github.com/chrisgleissner/sidflow/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/github/chrisgleissner/sidflow/graph/badge.svg?token=ynAHHsMqMG)](https://codecov.io/github/chrisgleissner/sidflow)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-forestgreen)](doc/developer.md)

---

## Overview

**SID Flow** helps you rediscover your C64 music collection by automatically organizing songs by *energy*, *mood*, and *complexity*.  Whether you have thousands of SID files from the [High Voltage SID Collection](https://www.hvsc.c64.org/) or your own archive, SID Flow creates personalized playlists that match exactly how you feel.  

No more random browsing – just tell it what kind of music you want, and it plays the perfect songs.

---

## Features

✨ **Smart Classification**

- Automatically rates songs for energy, mood, and complexity
- Uses audio analysis and learns from feedback

🎵 **Mood-Based Playlists**

- Create playlists like "energetic," "quiet," or "dark"
- Filter by BPM, energy, and other traits

🎮 **Easy to Use**

- Simple command-line tools and a web UI
- Stream directly or export playlists

📊 **Learning System**

- Improves over time based on your ratings

🔄 **Reproducible**

- All data stored in human-readable formats (JSON/JSONL)
- Version control friendly

---

## Installation

### Prerequisites

Install the following tools first:

1. **Node.js 18+** – required for the tooling helpers.
2. *(Optional for legacy playback CLIs)* **[sidplayfp](https://github.com/libsidplayfp/sidplayfp)** – native SID player

  The classification and training pipelines now render audio through the bundled WASM engine, so `sidplayfp` is only needed until the playback CLIs migrate in later rollout phases.

Install the native player if you still use those CLIs:

- Linux: `sudo apt install sidplayfp`
- macOS: `brew install sidplayfp`
- Windows: download from [releases](https://github.com/libsidplayfp/sidplayfp/releases)

1. **Archive extractor** – A cross-platform 7-Zip binary ships with SIDFlow, so no additional installation is required.

### Setup

```bash
git clone https://github.com/chrisgleissner/sidflow.git
cd sidflow
npm run build
```

To fetch a local Bun toolchain plus Playwright browsers for end-to-end tests, run:

```bash
npm run setup:tests
```

Then create `.sidflow.json` in the root directory:

```json
{
  "hvscPath": "./workspace/hvsc",
  "wavCachePath": "./workspace/wav-cache",
  "tagsPath": "./workspace/tags",
  "threads": 0,
  "classificationDepth": 3
}
```

Validate your setup:

```bash
npm run validate:config
```

---

## Web Control Panel

For those who prefer a graphical interface, SID Flow includes a **Next.js + React** control panel.

```bash
cd packages/sidflow-web
npm run dev
```

Open **<http://localhost:3000>** in your browser.

![r8ate panel](./doc/web-screenshots/04-rate.png)

### Control Panel Features

- Play and control SID playback by mood
- Rate songs visually using sliders
- Trigger classification, HVSC sync, and training jobs
- Real-time system feedback and status display
- RESTful API and [OpenAPI Spec](packages/sidflow-web/openapi.yaml)

Documentation: [packages/sidflow-web/README.md](packages/sidflow-web/README.md)

---

## Command-Line Tools

If you prefer automation or terminal workflows, use these CLI tools.

### Example: Your First Playlist

Let's walk through creating your first mood-based playlist from start to finish.

#### Step 1: Download SID Files

First, download some SID music from the High Voltage SID Collection:

```bash
./scripts/sidflow-fetch
```

This downloads the latest HVSC archive and extracts it to `workspace/hvsc/`. It takes about 5-10 minutes on first run. The tool is smart – it only downloads what's new on subsequent runs.

#### Step 2: Rate Some Songs (Optional but Recommended)

To help the system learn your taste, rate a few songs manually. This step is optional – you can skip directly to classification if you want.

```bash
./scripts/sidflow-rate
```

The tool will:
- Play each unrated song through your speakers
- Ask you to rate it on energy (e), mood (m), and complexity (c) from 1-5
- Save your ratings automatically

**Controls:**
- Type `e4` to rate energy as 4, `m3` for mood 3, etc.
- Press Enter to save and move to next song
- Press Q to quit (progress is saved automatically)

Rate at least 10-20 songs for best results. The more you rate, the better the system understands your preferences!

#### Step 3: Classify Your Collection

Now, let the system analyze and classify all your SID files:

```bash
./scripts/sidflow-classify
```

This process:
1. Converts SID files to WAV format using the bundled WASM renderer (cached for speed)
2. Extracts audio features (BPM, energy, spectral analysis, etc.)
3. Predicts ratings for songs you haven't rated manually
4. Creates organized classification files

**First run takes time** (maybe 30-60 minutes for full HVSC), but subsequent runs are much faster thanks to caching. The WASM renderer eliminates the need for a native `sidplayfp` binary.

#### Step 4: Train the Model (If You Rated Songs)

If you rated songs in Step 2, train the machine learning model on your ratings:

```bash
./scripts/sidflow-train
```

This teaches the system to predict ratings for unrated songs based on what you like. The more feedback you provide, the better it gets!

#### Step 5: Build the Database

Create a searchable database from your classifications:

```bash
npm run build:db
```

This creates a vector database that enables fast similarity search and personalized recommendations.

#### Step 6: Play Music!

Finally, generate and play a playlist based on your mood:

```bash
# Energetic playlist
./scripts/sidflow-play --mood energetic

# Quiet and relaxing
./scripts/sidflow-play --mood quiet

# Dark and atmospheric
./scripts/sidflow-play --mood dark

# Custom filters: high energy + specific BPM range
./scripts/sidflow-play --filters "e>=4,bpm=120-140"
```

**Playback controls:**
- The playlist streams automatically through `sidplayfp` (or use the web UI for WASM-based playback)
- Press Ctrl+C to stop

**Export without playing:**
```bash
# Export as JSON with metadata
./scripts/sidflow-play --mood energetic --export playlist.json --export-only

# Export as M3U for other players
./scripts/sidflow-play --mood quiet --export playlist.m3u --export-format m3u --export-only
```

That's it! You now have a smart music system that understands your taste. 🎶

---

## Available Mood Presets

Choose from these built-in mood presets when generating playlists:

| Preset | Energy | Mood | Complexity | Best For |
|--------|--------|------|------------|----------|
| **quiet** | Low (1) | Calm (2) | Simple (1) | Background music, focusing |
| **ambient** | Medium (2) | Neutral (3) | Medium (2) | Relaxing, thinking |
| **energetic** | High (5) | Upbeat (5) | High (4) | Gaming, exercise |
| **dark** | Medium (3) | Somber (1) | Medium (3) | Atmospheric, moody |
| **bright** | High (4) | Upbeat (5) | Medium (3) | Happy, positive vibes |
| **complex** | Medium (3) | Neutral (3) | High (5) | Deep listening, analysis |

Use them like this:
```bash
./scripts/sidflow-play --mood energetic
./scripts/sidflow-play --mood quiet
```

Or create your own combinations with custom filters:
```bash
# High energy, upbeat mood, any complexity
./scripts/sidflow-play --filters "e>=4,m>=4"

# Medium complexity, slow tempo
./scripts/sidflow-play --filters "c=3,bpm=80-110"
```

---

## Quick Command Reference

Here are the main commands you'll use:

```bash
# Download/update SID files
./scripts/sidflow-fetch

# Rate songs manually
./scripts/sidflow-rate

# Classify your collection (uses WASM renderer)
./scripts/sidflow-classify

# Train the ML model
./scripts/sidflow-train

# Build recommendation database
npm run build:db

# Play mood-based playlists
./scripts/sidflow-play --mood energetic
./scripts/sidflow-play --filters "e>=4,m>=3"

# Export playlists
./scripts/sidflow-play --mood quiet --export playlist.json --export-only

# Verify configuration
npm run validate:config
```

---

## Next Steps

- **Try the Web UI** – Run `cd packages/sidflow-web && npm run dev` for a graphical interface
- **Rate more songs** – Run `./scripts/sidflow-rate` regularly to improve recommendations
- **Explore filters** – Try different combinations with `--filters` to find exactly what you want
- **Share your data** – The `workspace/tags/` folder contains your ratings (can be committed to git)
- **Learn more** – Check out [Technical Reference](doc/technical-reference.md) for advanced usage

---

## Getting Help

- **Issues or bugs?** – [Open an issue on GitHub](https://github.com/chrisgleissner/sidflow/issues)
- **Questions?** – Check the [Technical Reference](doc/technical-reference.md) or [Developer Guide](doc/developer.md)
- **Want to contribute?** – See [doc/developer.md](doc/developer.md) for development setup

---

## Developer Documentation

- **[Technical Reference](doc/technical-reference.md)** – architecture, CLI flags, APIs  
- **[Developer Guide](doc/developer.md)** – setup, testing, contributions  
- **[Performance Metrics](doc/performance-metrics.md)** – benchmarks  
- **[Artifact Governance](doc/artifact-governance.md)** – data management

---

## Acknowledgements

SID Flow is [GPLv2](LICENSE)-licensed and builds upon outstanding open-source software and datasets:

| Component | License | Source | Credit |
|------------|----------|---------|-----|
| **Bun** | MIT | [github.com/oven-sh/bun](https://github.com/oven-sh/bun) | Fastest Typescript runtime |
| **libsidplayfp** | GPL v2+ | [github.com/libsidplayfp/libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) | Most accurate software SID emulator |
| **High Voltage SID Collection (HVSC)** | Free for personal use | [hvsc.c64.org](https://www.hvsc.c64.org/) | Largest SID collection |
