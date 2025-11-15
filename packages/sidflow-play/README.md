# @sidflow/play

Mood-based playback and recommendation engine for SIDFlow.

## Overview

The `sidflow-play` package provides intelligent playlist generation and SID playback based on user preferences and mood filters. It integrates with the LanceDB vector store to find similar songs and create dynamic playlists.

## Features

- **Mood-Based Filtering**: Filter songs by energy, mood, complexity ranges
- **Similarity Search**: Find songs similar to a given track using LanceDB
- **Dynamic Playlists**: Generate playlists that match specific criteria
- **Playback Control**: Play, pause, skip, and queue management
- **Session Management**: Maintain playback state across sessions
- **Export Functionality**: Export playlists and recommendations

## Installation

This is an internal workspace package:

```json
{
  "dependencies": {
    "@sidflow/play": "workspace:*"
  }
}
```

## CLI Usage

The `sidflow-play` CLI provides mood-based playback:

```bash
./scripts/sidflow-play [options]
```

### Options

- `--config <path>` — Path to `.sidflow.json` (default: `./.sidflow.json`)
- `--mood <filter>` — Mood filter (e.g., "energetic", "calm", "dark")
- `--energy <range>` — Energy range (e.g., "3-5", "1-2")
- `--complexity <range>` — Complexity range (e.g., "2-4")
- `--similar <path>` — Find songs similar to the given SID file
- `--limit <n>` — Maximum number of songs in playlist (default: 20)
- `--shuffle` — Shuffle the playlist
- `--export <path>` — Export playlist to file instead of playing
- `--help` — Display help message

### Examples

```bash
# Play energetic music
./scripts/sidflow-play --energy 4-5

# Play calm, simple music
./scripts/sidflow-play --energy 1-2 --complexity 1-2

# Find similar songs
./scripts/sidflow-play --similar path/to/song.sid --limit 10

# Export playlist
./scripts/sidflow-play --mood energetic --export playlist.m3u
```

## Programmatic Usage

```typescript
import { createPlaybackSession, generatePlaylist } from "@sidflow/play";

// Create a playback session
const session = await createPlaybackSession({
  modelPath: "data/model",
  classifiedPath: "data/classified"
});

// Generate a mood-based playlist
const playlist = await generatePlaylist({
  session,
  filters: {
    energyMin: 3,
    energyMax: 5,
    moodMin: 3,
    complexityMin: 2
  },
  limit: 20,
  shuffle: true
});

// Play the playlist
for (const track of playlist.tracks) {
  console.log(`Playing: ${track.title} by ${track.author}`);
  await session.play(track);
}
```

## Mood Filters

The package supports various mood presets and custom filters:

### Presets

- **energetic**: High energy (4-5), positive mood (3-5)
- **calm**: Low energy (1-2), any mood
- **dark**: Any energy, dark mood (1-2)
- **complex**: Any energy/mood, high complexity (4-5)
- **simple**: Any energy/mood, low complexity (1-2)

### Custom Filters

```typescript
const playlist = await generatePlaylist({
  session,
  filters: {
    energyMin: 2,
    energyMax: 4,
    moodMin: 3,
    moodMax: 5,
    complexityMin: 2,
    complexityMax: 4
  }
});
```

## Similarity Search

Find songs similar to a reference track:

```typescript
import { findSimilarSongs } from "@sidflow/play";

const similar = await findSimilarSongs({
  session,
  referencePath: "path/to/song.sid",
  limit: 10,
  minSimilarity: 0.7
});

console.log(`Found ${similar.length} similar songs`);
```

## Playlist Export

Export playlists in various formats:

```typescript
import { exportPlaylist } from "@sidflow/play";

// Export as M3U
await exportPlaylist({
  playlist,
  format: "m3u",
  outputPath: "playlist.m3u"
});

// Export as JSON
await exportPlaylist({
  playlist,
  format: "json",
  outputPath: "playlist.json"
});
```

## Session Management

The playback session maintains state and can be persisted:

```typescript
import { createPlaybackSession, saveSession, loadSession } from "@sidflow/play";

// Create and configure session
const session = await createPlaybackSession(config);
session.setVolume(0.8);
session.setRepeat(true);

// Save session state
await saveSession(session, "session.json");

// Load session later
const restored = await loadSession("session.json");
```

## LanceDB Integration

The package uses LanceDB for efficient similarity search:

```typescript
import { buildPlaybackDatabase } from "@sidflow/play";

// Build LanceDB from classified data
await buildPlaybackDatabase({
  classifiedPath: "data/classified",
  modelPath: "data/model",
  databasePath: "data/lancedb"
});
```

## API Reference

### `createPlaybackSession(options)`

Create a new playback session.

**Parameters:**
- `options.modelPath` — Path to model directory (default: "data/model")
- `options.classifiedPath` — Path to classified directory (default: "data/classified")

**Returns:** `Promise<PlaybackSession>`

### `generatePlaylist(options)`

Generate a playlist based on filters.

**Parameters:**
- `options.session` — Playback session
- `options.filters` — Filter criteria (energyMin, energyMax, moodMin, moodMax, complexityMin, complexityMax)
- `options.limit` — Maximum number of songs (optional)
- `options.shuffle` — Shuffle the playlist (optional)

**Returns:** `Promise<Playlist>`

### `findSimilarSongs(options)`

Find songs similar to a reference track.

**Parameters:**
- `options.session` — Playback session
- `options.referencePath` — Path to reference SID file
- `options.limit` — Maximum number of similar songs (optional)
- `options.minSimilarity` — Minimum similarity threshold (optional)

**Returns:** `Promise<SongMatch[]>`

### `exportPlaylist(options)`

Export a playlist to a file.

**Parameters:**
- `options.playlist` — Playlist to export
- `options.format` — Export format ("m3u" or "json")
- `options.outputPath` — Output file path

**Returns:** `Promise<void>`

### `saveSession(session, path)`

Save playback session state to a file.

**Parameters:**
- `session` — Playback session to save
- `path` — File path to save to

**Returns:** `Promise<void>`

### `loadSession(path)`

Load a previously saved playback session.

**Parameters:**
- `path` — File path to load from

**Returns:** `Promise<PlaybackSession>`

### `buildPlaybackDatabase(options)`

Build LanceDB vector database from classified data.

**Parameters:**
- `options.classifiedPath` — Path to classified directory
- `options.modelPath` — Path to model directory
- `options.databasePath` — Output database path

**Returns:** `Promise<void>`

## Related Packages

- `@sidflow/common` — Shared utilities and types
- `@sidflow/classify` — Provides classified song data
- `@sidflow/train` — Trains the recommendation model
- `@sidflow/rate` — Manual rating interface

## License

GPL-2.0-only
