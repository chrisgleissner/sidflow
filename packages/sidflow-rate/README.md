# @sidflow/rate

Interactive manual rating interface for SID files.

## Overview

The `sidflow-rate` package provides an interactive terminal-based interface for manually rating SID files. It allows users to rate songs on energy, mood, complexity, and personal preference, creating explicit training data for the ML model.

## Features

- **Interactive TUI**: Terminal-based user interface for rating songs
- **Real-time Playback**: Listen to songs while rating using WASM-based SID emulation
- **Keyboard Controls**: Intuitive controls for rating and navigation
- **Progress Tracking**: Shows rated vs unrated songs
- **Deterministic Output**: Ratings saved as JSON for version control
- **Tag Management**: Creates `.sid.tags.json` files alongside SID files

## Installation

This is an internal workspace package:

```json
{
  "dependencies": {
    "@sidflow/rate": "workspace:*"
  }
}
```

## CLI Usage

The `sidflow-rate` CLI starts the interactive rating interface:

```bash
./scripts/sidflow-rate [options]
```

### Options

- `--config <path>` — Path to `.sidflow.json` (default: `./.sidflow.json`)
- `--hvsc-path <path>` — Override HVSC directory path
- `--tags-path <path>` — Override tags directory path
- `--filter <pattern>` — Filter songs by path pattern (glob)
- `--unrated-only` — Only show unrated songs
- `--resume` — Resume from last rated song
- `--help` — Display help message

### Examples

```bash
# Start rating all songs
./scripts/sidflow-rate

# Rate only unrated songs
./scripts/sidflow-rate --unrated-only

# Resume from last session
./scripts/sidflow-rate --resume

# Rate specific composer
./scripts/sidflow-rate --filter "MUSICIANS/H/Hubbard*"
```

## Keyboard Controls

During rating sessions:

### Playback Controls
- `Space` — Play/Pause current song
- `Enter` — Next song
- `Backspace` — Previous song
- `S` — Skip song (no rating)
- `Q` — Quit and save progress

### Rating Sliders
- `1-5` — Set energy rating (1=low, 5=high)
- `Shift+1-5` — Set mood rating (1=dark, 5=bright)
- `Ctrl+1-5` — Set complexity rating (1=simple, 5=complex)
- `Alt+1-5` — Set personal preference (1=dislike, 5=love)

### Navigation
- `←/→` — Adjust current slider
- `↑/↓` — Switch between rating categories
- `Tab` — Move to next slider
- `Shift+Tab` — Move to previous slider

## Rating Scales

### Energy (E)
- **1** - Very calm, slow
- **2** - Relaxed
- **3** - Moderate
- **4** - Energetic
- **5** - Very energetic, fast

### Mood (M)
- **1** - Very dark, somber
- **2** - Melancholic
- **3** - Neutral
- **4** - Upbeat
- **5** - Very bright, happy

### Complexity (C)
- **1** - Very simple
- **2** - Simple
- **3** - Moderate
- **4** - Complex
- **5** - Very complex

### Personal Preference (P)
- **1** - Strong dislike
- **2** - Dislike
- **3** - Neutral
- **4** - Like
- **5** - Love

## Output Format

Ratings are saved as `.sid.tags.json` files:

```json
{
  "path": "C64Music/MUSICIANS/H/Hubbard_Rob/Commando.sid",
  "e": 5,
  "m": 4,
  "c": 4,
  "p": 5,
  "ratedAt": "2025-11-15T12:00:00.000Z",
  "ratedBy": "user",
  "notes": "Classic high-energy tune"
}
```

## Programmatic Usage

```typescript
import { planTagSession, runTagSession, type TagSessionPlan } from "@sidflow/rate";

// Plan a rating session
const plan: TagSessionPlan = await planTagSession({
  hvscPath: "./workspace/hvsc",
  tagsPath: "./workspace/tags",
  filter: "MUSICIANS/H/*",
  unratedOnly: true
});

console.log(`${plan.unratedCount} songs to rate`);

// Run the session
await runTagSession(plan, {
  onProgress: (current: number, total: number) => {
    console.log(`Progress: ${current}/${total}`);
  },
  onRating: (sidPath: string, ratings: { e: number; m: number; c: number; p: number }) => {
    console.log(`Rated ${sidPath}:`, ratings);
  }
});
```

## Data Organization

```
workspace/
  ├── hvsc/                    # HVSC content
  │   └── C64Music/
  │       └── MUSICIANS/
  │           └── H/
  │               └── Hubbard_Rob/
  │                   ├── Commando.sid
  │                   └── Commando.sid.tags.json
  └── tags/                    # Alternative tags location
      └── manual/
          └── ...
```

## Training Integration

Manual ratings are used as high-quality training data:

```bash
# After rating songs
./scripts/sidflow-train
```

The training pipeline gives manual ratings full weight (1.0) compared to implicit feedback (0.3-0.7), making manual ratings the most impactful training signal.

## Session Management

The package maintains session state for resuming:

```json
{
  "lastRatedPath": "C64Music/MUSICIANS/H/Hubbard_Rob/Commando.sid",
  "totalRated": 42,
  "sessionStarted": "2025-11-15T10:00:00.000Z"
}
```

## API Reference

### `planTagSession(options)`

Create a rating session plan.

**Parameters:**
- `options.hvscPath` — HVSC directory path
- `options.tagsPath` — Tags directory path
- `options.filter` — Path filter pattern (optional)
- `options.unratedOnly` — Only include unrated songs (optional)

**Returns:** `Promise<TagSessionPlan>`

**TagSessionPlan type:**
```typescript
{
  sidPaths: string[];           // Array of SID file paths to rate
  unratedCount: number;         // Number of unrated songs
  totalCount: number;           // Total number of songs
  hvscPath: string;             // HVSC root path
  tagsPath: string;             // Tags directory path
}
```

### `runTagSession(plan, callbacks)`

Execute an interactive rating session.

**Parameters:**
- `plan` — Session plan from `planTagSession`
- `callbacks.onProgress` — Progress callback: `(current: number, total: number) => void` (optional)
- `callbacks.onRating` — Rating callback: `(sidPath: string, ratings: Tags) => void` (optional)

**Returns:** `Promise<void>`

### `loadTags(sidPath, tagsPath)`

Load existing tags for a SID file.

**Parameters:**
- `sidPath` — Path to SID file
- `tagsPath` — Tags directory path

**Returns:** `Promise<Tags | null>`

**Tags type:**
```typescript
{
  path: string;                 // SID file path
  e: number;                    // Energy rating (1-5)
  m: number;                    // Mood rating (1-5)
  c: number;                    // Complexity rating (1-5)
  p: number;                    // Personal preference (1-5)
  ratedAt: string;              // ISO timestamp
  ratedBy: string;              // User identifier
  notes?: string;               // Optional notes
}
```

### `saveTags(sidPath, tags, tagsPath)`

Save tags for a SID file.

**Parameters:**
- `sidPath` — Path to SID file
- `tags` — Tags object to save
- `tagsPath` — Tags directory path

**Returns:** `Promise<void>`

## Related Packages

- `@sidflow/common` — Shared utilities (SID parsing, file I/O)
- `@sidflow/libsidplayfp-wasm` — WASM-based SID playback
- `@sidflow/train` — Uses manual ratings for model training

## License

GPL-2.0-only
