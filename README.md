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
- Improves over time based on your ratings

🎵 **Mood-Based Playlists**

- Create playlists like "energetic," "quiet," or "dark"

🎮 **Easy to Use**

- Simple web UI
- Command-line tools for scripting

🔄 **Reproducible**

- All data stored in human-readable formats (JSON/JSONL)
- Version control friendly

---

## Getting Started

### Install Bun

First install Bun, the all-in-one toolkit for developing modern Typescript applications, as per https://bun.com/docs/installation:

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

---

## Web UI

For those who prefer a graphical interface, SID Flow includes a **Next.js + React** control panel.

```bash
cd packages/sidflow-web
bun run dev
```

Open **<http://localhost:3000>** in your browser.

![r8ate panel](./doc/web-screenshots/04-rate-playback.png)

### Features

- Play and control SID playback by mood
- Rate songs visually using sliders
- Trigger classification, HVSC sync, and training jobs
- Real-time system feedback and status display
- RESTful API and [OpenAPI Spec](packages/sidflow-web/openapi.yaml)

Documentation: [packages/sidflow-web/README.md](packages/sidflow-web/README.md)

---

## Command-Line Tools

If you prefer automation or terminal workflows, use the CLI tools documented in the [Technical Reference](./doc/technical-reference.md).


---

## Config


The `.sidflow.json` file contains details about the HVSC download folder and more:

```json
{
  "hvscPath": "./workspace/hvsc",
  "wavCachePath": "./workspace/wav-cache",
  "tagsPath": "./workspace/tags",
  "threads": 0,
  "classificationDepth": 3
}
```



## Developer Documentation

- **[Technical Reference](doc/technical-reference.md)** – architecture, CLI tools, APIs  
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
