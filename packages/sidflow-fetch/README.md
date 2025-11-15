# @sidflow/fetch

HVSC (High Voltage SID Collection) synchronization and download utilities.

## Overview

The `sidflow-fetch` package provides robust synchronization of the High Voltage SID Collection (HVSC) from official mirrors. It handles:

- **Delta Updates**: Efficiently downloads only changed files using HVSC update packages
- **Archive Extraction**: Automatic extraction of `.7z` archives using bundled `7zip-min`
- **Checksum Verification**: Validates downloaded files to ensure integrity
- **Version Tracking**: Maintains local version state for incremental updates
- **Resilient Downloads**: Automatic retry with exponential backoff for transient failures

## Installation

This is an internal workspace package:

```json
{
  "dependencies": {
    "@sidflow/fetch": "workspace:*"
  }
}
```

## CLI Usage

The `sidflow-fetch` CLI synchronizes your local HVSC mirror:

```bash
./scripts/sidflow-fetch [options]
```

### Options

- `--config <path>` — Path to `.sidflow.json` (default: `./.sidflow.json`)
- `--hvsc-path <path>` — Override HVSC destination directory
- `--force` — Force complete re-download (ignore existing version)
- `--dry-run` — Show what would be downloaded without making changes
- `--help` — Display help message

### Examples

```bash
# Sync with default configuration
./scripts/sidflow-fetch

# Use custom config file
./scripts/sidflow-fetch --config /path/to/.sidflow.json

# Override HVSC path
./scripts/sidflow-fetch --hvsc-path /mnt/storage/hvsc

# Preview changes without downloading
./scripts/sidflow-fetch --dry-run

# Force complete re-download
./scripts/sidflow-fetch --force
```

## Programmatic Usage

```typescript
import { syncHvsc } from "@sidflow/fetch";

const result = await syncHvsc({
  hvscPath: "./workspace/hvsc",
  mirrorUrl: "https://www.hvsc.de/downloads",
  force: false,
  onProgress: (status) => {
    console.log(`Progress: ${status.percent}% - ${status.message}`);
  }
});

console.log(`Synced to version ${result.version}`);
console.log(`Downloaded ${result.filesUpdated} files`);
```

## How It Works

1. **Version Check**: Queries the HVSC mirror for the latest version
2. **Manifest Download**: Retrieves the list of available update packages
3. **Delta Detection**: Compares local version with remote to determine needed updates
4. **Download**: Fetches required `.7z` archives with retry logic
5. **Checksum Verification**: Validates downloaded files match expected hashes
6. **Extraction**: Extracts archives to the target HVSC directory
7. **Version Persistence**: Updates local version tracking in `.sidflow-version.json`

## Configuration

The HVSC path is configured in `.sidflow.json`:

```json
{
  "hvscPath": "./workspace/hvsc"
}
```

This can be overridden via CLI options or programmatic configuration.

## Version Tracking

The package maintains a `.sidflow-version.json` file in the HVSC directory to track the current version:

```json
{
  "version": "83",
  "syncedAt": "2025-11-15T12:00:00.000Z",
  "baseArchive": "C64Music_Base_Update_83.7z",
  "updates": ["Update_83.7z"]
}
```

## Error Handling

The package provides detailed error messages for common issues:

- **Network Failures**: Automatic retry with exponential backoff
- **Checksum Mismatches**: Fails fast with detailed error
- **Disk Space Issues**: Checks available space before extraction
- **Archive Corruption**: Validates archives before extraction

## Data Organization

```
hvsc/
  ├── .sidflow-version.json    # Version tracking (generated)
  ├── C64Music/                # HVSC content
  │   ├── DEMOS/
  │   ├── GAMES/
  │   └── MUSICIANS/
  └── DOCUMENTS/               # HVSC documentation
```

## Related Commands

After fetching HVSC content, you can:

```bash
# Classify the downloaded SID files
./scripts/sidflow-classify

# Rate songs manually
./scripts/sidflow-rate

# Train the ML model
./scripts/sidflow-train
```

## API Reference

### `syncHvsc(options)`

Synchronize local HVSC mirror with remote.

**Parameters:**
- `options.hvscPath` — Local HVSC directory path
- `options.mirrorUrl` — HVSC mirror base URL (optional)
- `options.force` — Force complete re-download (optional)
- `options.onProgress` — Progress callback (optional)

**Returns:** `Promise<SyncResult>`

### `fetchHvscManifest(mirrorUrl)`

Fetch the list of available HVSC archives from the mirror.

**Returns:** `Promise<HvscManifest>`

### `loadHvscVersion(hvscPath)`

Load version information from local HVSC directory.

**Returns:** `Promise<HvscVersion | null>`

### `saveHvscVersion(hvscPath, version)`

Save version information to local HVSC directory.

**Returns:** `Promise<void>`

## Related Packages

- `@sidflow/common` — Shared utilities (archive extraction, retry logic)
- `@sidflow/classify` — Processes fetched SID files

## License

GPL-2.0-only
