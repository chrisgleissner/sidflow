# 🧩 Prompt: Create the “SIDFlow” Project (Phase 1 – CLI Suite)

> **Goal:**  
> Generate a modern **TypeScript + Bun** monorepo named **SIDFlow**, licensed under **GPL v2**.  
> SIDFlow is a CLI-first toolkit for **classifying, tagging, and analyzing Commodore 64 SID music**, designed for future expansion into a live streaming web platform.  
> For now, everything is **CLI-based**.

---

## 1. 🏗️ Project Structure

```
sidflow/
 ├── packages/
 │    ├── sidflow-fetch/        # HVSC downloader & updater
 │    ├── sidflow-tag/          # manual classification & playback
 │    ├── sidflow-classify/     # automated classification
 │    └── sidflow-common/       # shared utilities, config, logging, types
 ├── workspace/
 │    ├── hvsc/                 # local HVSC tree
 │    ├── wav-cache/            # converted WAVs
 │    └── tags/                 # aggregated tag files
 ├── .github/workflows/ci.yml   # CI pipeline with Codecov upload
 ├── .github/copilot-instructions.md
 ├── .sidflow.json              # global configuration
 ├── README.md
 ├── LICENSE                    # GPL v2
 ├── package.json               # Bun workspace root
 └── tsconfig.json
```

All packages share code from `sidflow-common` for logging, filesystem operations, configuration, and typed data models. Each CLI executable is built with Bun and bundled for cross‑platform use.

---

## 2. ⚙️ Global Configuration

Create `.sidflow.json` at the repo root:

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

- `threads`: `0` = auto‑detect from CPU core count; otherwise use specified number.
- `sidplayPath`: defaults to `sidplayfp` in PATH, can be overridden via `--sidplay` on every CLI.
- `classificationDepth`: number of folder levels to aggregate classification JSON files beneath the base folder. Example: `3` → creates per‑letter aggregated JSONs under `C64Music/MUSICIANS/B`, `C`, etc.

---

## 3. 📦 Packages (Phase 1 CLI Tools)

### 3.1 `sidflow-fetch` — HVSC Downloader & Updater

**Purpose:** Smart, zero‑config downloader/updater for the High Voltage SID Collection (HVSC).

**Sources (current):**
- Base: `https://hvsc.brona.dk/HVSC/HVSC_83-all-of-them.7z`
- Deltas: `https://hvsc.brona.dk/HVSC/HVSC_Update_<n>.7z`

**Behavior:**
- If `hvscPath` is empty or missing → download and extract the latest base archive automatically.
- Scrape the HVSC directory listing to discover the highest available `HVSC_Update_<n>.7z` and compare to the locally recorded version. Download/apply any newer deltas in ascending order.
- Record and update state in `hvsc-version.json` (last base version, last applied delta, timestamps, checksums).
- Use 7‑Zip (system binary or library) to extract `.7z` archives.
- Idempotent and resilient: safe to run repeatedly; will do nothing if up to date.
- No need to specify what to download; `sidflow fetch` is fully automatic.

**CLI examples:**
- `sidflow fetch` — smart base/delta sync to `hvscPath`.
- Accepts `--sidplay` to override the player path for optional post‑fetch conversion tasks.

### 3.2 `sidflow-tag` — Manual Classification & Playback

**Purpose:** Interactive CLI for listening to and tagging unclassified `.sid` files.

**Playback & Controls:**
- Uses `sidplayfp` for playback found via `sidplayPath` (default PATH); can be overridden with `--sidplay`.
- Sequential or random mode over files without manual tag files.
- Key bindings:
  - `s1–5`: Speed (1 slow … 5 fast/intense)
  - `m1–5`: Mood (1 dark … 5 bright/uplifting)
  - `c1–5`: Complexity (1 minimal … 5 layered)
  - `Enter`: save tags and advance to next
  - `Q`: quit
- Default without numeric suffix is level `3`.

**Manual Tag Storage (colocated):**
For each `.sid`, write adjacent `*.sid.tags.json`:

```json
{
  "s": 2,
  "m": 4,
  "c": 3,
  "source": "manual",
  "timestamp": "2025-11-02T20:10:00Z"
}
```

Deterministic JSON: stable key order, two‑space indentation to keep Git diffs small.

### 3.3 `sidflow-classify` — Automatic Classification

**Purpose:** Automatically assign tags to unclassified songs using WAV features + learned model trained from manual tags.

**Metadata Extraction:**  
Run `sidplayfp <path>.sid -t1 --none` and parse lines such as:
```
| Title        : Atonal Music                          |
| Author       : Vic H. Berry                          |
| Released     : 1989 Vic H. Berry                     |
```
Persist `title`, `author`, `released` in per‑song metadata (either within tag JSON or sidecar `*.sid.meta.json`).

**WAV Conversion:**  
Use `sidplayfp <path>.sid -w` to emit `<basename>.wav` in the current directory; store in mirrored structure under `wavCachePath`. Use `threads` from config (or CPU cores if `0`) for parallel conversion; skip if WAV already cached and fresh.

**Feature Extraction & Model:**  
- Library: **Essentia.js** (open‑source MIR toolkit) for descriptors like RMS, tempo, spectral centroid, harmonic ratio, onset rate, etc.
- Learn a lightweight multi‑output regressor (e.g., TensorFlow.js MLP or regression trees) mapping features → `(s,m,c)` where:
  - `s` = Speed/Drive (1–5),
  - `m` = Mood/Tone (1–5),
  - `c` = Complexity/Texture (1–5).
- Manual tags are the ground truth; **auto never overwrites manual**. Only fill missing dimensions or untagged songs.

**Aggregated Auto‑Tag Files by Depth:**  
Create per‑folder **auto‑generated classification files** aggregated by `classificationDepth`.  
Example (`classificationDepth = 3`):
```
./C64Music/MUSICIANS/B/auto-tags.json
./C64Music/MUSICIANS/C/auto-tags.json
```
File structure:
```json
{
  "Berry_Vic/Atonal_Music.sid": {"s":3,"m":4,"c":2,"source":"auto"},
  "Ben_Daglish/Trap.sid": {"s":2,"m":5,"c":3,"source":"manual"}
}
```

**CLI:**
- `sidflow classify --dir ./workspace/hvsc`
- Implied flow: ensure WAVs → extract features → train from manual tags → predict missing `(s,m,c)` → write aggregated files.

---

## 4. 🧠 Tag & Classification Model

- **Tags:** `s` (Speed), `m` (Mood), `c` (Complexity), each in `1..5`, default `3` when not specified.
- **Manual precedence:** manual tags in `*.sid.tags.json` always win; auto fills gaps only.
- **Auto inference:** uses Essentia.js features + small TF.js model; internal floats mapped to 1–5 (round or quantize with calibrated thresholds).
- **Metadata:** extracted from `sidplayfp -t1 --none` and stored alongside tags for better UX and potential model features.

---

## 5. 📂 File System Conventions

| Type | Location | Notes |
|------|----------|-------|
| HVSC tree | `hvscPath` (e.g., `./workspace/hvsc`) | Mirrors original HVSC layout |
| Manual tags | Adjacent `*.sid.tags.json` | Git‑tracked, tiny diffs |
| Auto tags | `auto-tags.json` aggregated per folder at `classificationDepth` | Generated, re‑creatable |
| WAV cache | `wavCachePath` (e.g., `./workspace/wav-cache/…`) | Skipped if present & fresh |
| Version state | `hvsc-version.json` | base/delta versions, checksums, timestamps |

Example (depth=3):
```
workspace/
 ├── hvsc/C64Music/MUSICIANS/B/Berry_Vic/Atonal_Music.sid
 ├── hvsc/C64Music/MUSICIANS/B/Berry_Vic/Atonal_Music.sid.tags.json
 ├── hvsc/C64Music/MUSICIANS/B/auto-tags.json
 ├── wav-cache/C64Music/MUSICIANS/B/Berry_Vic/Atonal_Music.wav
 └── hvsc-version.json
```

---

## 6. 🧪 Testing, Coverage, CI

- **Testing:** Vitest (Bun‑native). Mock network, filesystem, and `sidplayfp` processes for deterministic tests.
- **Coverage:** Configure **Codecov** with a minimum **90%** coverage gate.
- **CI:** `.github/workflows/ci.yml`
  1. Checkout
  2. Setup Bun
  3. `bun install`
  4. `bun run build`
  5. `bun test --coverage`
  6. Upload coverage to Codecov
  7. Validate `.sidflow.json` with a small schema check

---

## 7. 🤖 Copilot Guidance

Place **`.github/copilot-instructions.md`** with high‑level guidance (do not include file contents here). Instruct Copilot to:
- Use strict TypeScript everywhere; no `any`.
- Prefer functional modules with small, composable functions.
- Use `fs/promises`, `child_process` with robust error handling.
- Always support `--sidplay` override and read `.sidflow.json` defaults.
- Parse `sidplayfp` metadata output using reliable regex and guardrails.
- Serialize JSON deterministically (sorted keys, 2‑space indent).
- Keep a single source of truth for types in `sidflow-common`.
- Write tests first; ensure Codecov ≥ 90% remains passing.

---

## 8. 📘 Documentation (README.md)

Provide a concise, task‑oriented README (do not spell out content here) covering:
- Project purpose and the three CLIs.
- Prereqs: Bun + `sidplayfp` on PATH (or `--sidplay`).
- First‑run flow: `sidflow fetch` → `sidflow tag` → `sidflow classify`.
- Tag semantics (`s/m/c`).
- Directory layout and `classificationDepth` concept.
- Notes on test‑driven development and coverage.
- GPLv2 license.

---

## 9. 🔮 Future‑Proofing

- The monorepo should be ready to add `sidflow-play` (query/play by filters) and a web layer (“SIDFlow Radio”) later without refactors: keep classification, metadata, and playback logic as reusable modules in `sidflow-common`.
- All storage conventions must remain stable such that auto‑generated artifacts can be reproduced and are safe to ignore in Git if desired.

---

## 10. 📜 License

License the entire repository under **GPL v2**.

---

## ✅ Deliverables Summary

- Monorepo workspace with four packages (`sidflow-fetch`, `sidflow-tag`, `sidflow-classify`, `sidflow-common`).
- Smart `sidflow fetch` (base + delta autodetect, re‑download if emptied).
- Manual tagger with colocated `*.sid.tags.json` and keyboard shortcuts.
- Auto classifier using Essentia.js + TF.js, WAV pipeline via `sidplayfp`.
- Aggregated `auto-tags.json` by `classificationDepth`.
- High‑coverage tests (≥90%) with Codecov CI.
- `.github/copilot-instructions.md`, `.github/workflows/ci.yml`, `README.md`, `LICENSE`, `.sidflow.json`.
```