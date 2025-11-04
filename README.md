![Logo](./doc/img/logo.png)

# SID Flow

Listen to C64 music based on your mood – automatically classified and ready to play.

[![CI](https://img.shields.io/github/actions/workflow/status/chrisgleissner/sidflow/ci.yaml?branch=main&logo=github&label=CI)](https://github.com/chrisgleissner/sidflow/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/github/chrisgleissner/sidflow/graph/badge.svg?token=ynAHHsMqMG)](https://codecov.io/github/chrisgleissner/sidflow)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-forestgreen)](doc/developer.md)

---

## What is SID Flow?

**SID Flow** helps you rediscover your C64 music collection by automatically organizing songs by energy, mood, and complexity. 

Whether you have thousands of SID files from the [High Voltage SID Collection](https://www.hvsc.c64.org/) or your own archive, SID Flow creates personalized playlists that match exactly how you feel.

No more random browsing – just tell it what kind of music you want, and it plays the perfect songs.

---

## Features

✨ **Smart Classification**
- Automatically rates every song for energy (1-5), mood (1-5), and complexity (1-5)
- Uses audio analysis to understand what makes each song unique
- Learns from your ratings and feedback to get better over time

🎵 **Mood-Based Playlists**
- Create playlists like "energetic," "quiet," "dark," or "complex"
- Filter songs by BPM, energy level, and other criteria
- Get personalized recommendations based on your listening history

🎮 **Easy to Use**
- Simple command-line tools that do one thing well
- Stream playlists directly through your speakers
- Export playlists for use in other players

📊 **Learning System**
- Rate songs manually to teach the system your preferences
- System automatically improves predictions based on your feedback
- Track what you play, like, and skip to refine recommendations

🔄 **Reproducible**
- All data stored in simple, human-readable formats (JSON/JSONL)
- Share your ratings and playlists with others
- Version control friendly – track changes over time

---

## Getting Started

### Prerequisites

Before you begin, install these tools on your computer:

1. **[Bun](https://bun.sh/install)** – A fast JavaScript runtime (like Node.js, but faster)
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **[sidplayfp](https://github.com/libsidplayfp/sidplayfp)** – The player that converts SID files to audio
   - **Linux (Ubuntu/Debian)**: `sudo apt install sidplayfp`
   - **macOS**: `brew install sidplayfp`
   - **Windows**: Download from the [releases page](https://github.com/libsidplayfp/sidplayfp/releases)

3. **[7-Zip](https://www.7-zip.org/download.html)** – For extracting downloaded archives
   - **Linux**: `sudo apt install p7zip-full`
   - **macOS**: `brew install p7zip`
   - **Windows**: Download installer from 7-zip.org

### Installation

1. **Clone this repository**
   ```bash
   git clone https://github.com/chrisgleissner/sidflow.git
   cd sidflow
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Build the project**
   ```bash
   bun run build
   ```

4. **Create configuration file**

   Create a file named `.sidflow.json` in the project root:
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

5. **Verify everything works**
   ```bash
   bun run validate:config
   ```

You're all set! 🎉

---

## Example: Your First Playlist

Let's walk through creating your first mood-based playlist from start to finish.

### Step 1: Download SID Files

First, download some SID music from the High Voltage SID Collection:

```bash
./scripts/sidflow-fetch
```

This downloads the latest HVSC archive and extracts it to `workspace/hvsc/`. It takes about 5-10 minutes on first run. The tool is smart – it only downloads what's new on subsequent runs.

### Step 2: Rate Some Songs (Optional but Recommended)

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

### Step 3: Classify Your Collection

Now, let the system analyze and classify all your SID files:

```bash
./scripts/sidflow-classify
```

This process:
1. Converts SID files to WAV format (cached for speed)
2. Extracts audio features (BPM, energy, spectral analysis, etc.)
3. Predicts ratings for songs you haven't rated manually
4. Creates organized classification files

**First run takes time** (maybe 30-60 minutes for full HVSC), but subsequent runs are much faster thanks to caching.

### Step 4: Train the Model (If You Rated Songs)

If you rated songs in Step 2, train the machine learning model on your ratings:

```bash
./scripts/sidflow-train
```

This teaches the system to predict ratings for unrated songs based on what you like. The more feedback you provide, the better it gets!

### Step 5: Build the Database

Create a searchable database from your classifications:

```bash
bun run build:db
```

This creates a vector database that enables fast similarity search and personalized recommendations.

### Step 6: Play Music!

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
- The playlist streams automatically through `sidplayfp`
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

# Classify your collection
./scripts/sidflow-classify

# Train the ML model
./scripts/sidflow-train

# Build recommendation database
bun run build:db

# Play mood-based playlists
./scripts/sidflow-play --mood energetic
./scripts/sidflow-play --filters "e>=4,m>=3"

# Export playlists
./scripts/sidflow-play --mood quiet --export playlist.json --export-only

# Verify configuration
bun run validate:config
```

---

## Web Control Panel

For users who prefer a graphical interface, SIDFlow includes a local web control panel built with Next.js and React.

### Quick Start

```bash
# Start the web server
cd packages/sidflow-web
bun run dev
```

Open your browser to **http://localhost:3000** to access the control panel.

### Features

- **Play Control** – Trigger playback with mood presets (quiet, energetic, dark, bright, complex)
- **Rating Interface** – Submit manual ratings using intuitive sliders for all dimensions
- **Status Display** – Real-time feedback on operations and errors
- **Queue View** – See recently played tracks
- **API Endpoints** – RESTful API for all CLI operations

### What You Can Do

The web interface provides a thin orchestration layer over the CLI tools:

1. **Play SID files** with mood presets
2. **Rate tracks** using visual sliders (energy, mood, complexity, preference)
3. **Trigger classification** on directories
4. **Sync HVSC** without command line
5. **Train models** on your feedback

All operations delegate to the proven CLI implementations, so behavior is identical to using command-line tools directly.

### Documentation

- **[Web Server README](packages/sidflow-web/README.md)** – Detailed setup, API documentation, troubleshooting
- **[OpenAPI Spec](packages/sidflow-web/openapi.yaml)** – Complete API reference

### Development & Testing

The web server includes comprehensive test coverage:
- **Unit tests** for validation and CLI execution (100% coverage)
- **E2E tests** with Playwright for all workflows
- **Stub tools** for CI/CD testing without dependencies

See [packages/sidflow-web/README.md](packages/sidflow-web/README.md) for developer documentation.

---

## Next Steps

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

## Technical Documentation

For developers and advanced users:

- **[Technical Reference](doc/technical-reference.md)** – Detailed component documentation, CLI flags, architecture diagrams
- **[Developer Guide](doc/developer.md)** – Development setup, testing, contribution guidelines
- **[Performance Metrics](doc/performance-metrics.md)** – Benchmarks and optimization details
- **[Artifact Governance](doc/artifact-governance.md)** – Data management policies

---

## License

GPL v2 – see [LICENSE](LICENSE).
