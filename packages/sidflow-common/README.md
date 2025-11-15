# @sidflow/common

Shared utilities and type definitions for all SIDFlow packages.

## Overview

This package provides core functionality used across the SIDFlow monorepo:

- **Configuration**: Load and validate `.sidflow.json` settings
- **JSON Utilities**: Deterministic JSON serialization for version control
- **File System**: Promise-based filesystem helpers (`ensureDir`, `pathExists`)
- **Logging**: Structured logging with configurable verbosity
- **Archive Extraction**: 7-Zip extraction utilities (bundled `7zip-min`)
- **Retry Logic**: Resilient network and I/O operations
- **LanceDB Builder**: Vector database construction for similarity search
- **SID Parsing**: SID file format parsing and metadata extraction
- **Type Definitions**: Shared TypeScript interfaces and types

## Installation

This is an internal workspace package. It's automatically available to other packages via workspace dependencies:

```json
{
  "dependencies": {
    "@sidflow/common": "workspace:*"
  }
}
```

## Usage

### Configuration

```typescript
import { loadConfig } from "@sidflow/common";

const config = await loadConfig(); // Loads .sidflow.json
console.log(config.hvscPath);
```

### Deterministic JSON

```typescript
import { stringifyDeterministic } from "@sidflow/common";

const obj = { b: 2, a: 1 };
const json = stringifyDeterministic(obj, 2);
// Always outputs: {"a":1,"b":2} (sorted keys)
```

### File System Helpers

```typescript
import { ensureDir, pathExists } from "@sidflow/common";

await ensureDir("/path/to/directory");
if (await pathExists("/path/to/file.txt")) {
  // File exists
}
```

### Logging

```typescript
import { createLogger } from "@sidflow/common";

const logger = createLogger("my-component");
logger.info("Processing started");
logger.warn("Potential issue detected");
logger.error("Operation failed", error);
```

### Retry Logic

```typescript
import { retry } from "@sidflow/common";

const result = await retry(
  async () => {
    return await fetchDataFromAPI();
  },
  {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2
  }
);
```

## Key Modules

- `config.ts` - Configuration loading and validation
- `json.ts` - Deterministic JSON serialization
- `fs.ts` - Promise-based filesystem utilities
- `logger.ts` - Structured logging
- `archive.ts` - 7-Zip extraction helpers
- `retry.ts` - Retry logic with exponential backoff
- `lancedb-builder.ts` - LanceDB vector database construction
- `sid-parser.ts` - SID file format parsing
- `audio-types.ts` - Audio format type definitions
- `ratings.ts` - Rating and classification types

## Design Principles

- **Dependency-free core**: Minimal external dependencies for core utilities
- **Type-safe**: Full TypeScript support with strict type checking
- **Deterministic**: Stable output for version control (JSON, hashes)
- **Async-first**: Promise-based APIs throughout
- **Error transparency**: Detailed error messages with context

## Related Packages

All SIDFlow packages depend on `@sidflow/common`:
- `@sidflow/fetch` - HVSC synchronization
- `@sidflow/classify` - Audio classification
- `@sidflow/train` - ML model training
- `@sidflow/play` - Playback and recommendations
- `@sidflow/rate` - Manual rating interface
- `@sidflow/web` - Web UI and API

## License

GPL-2.0-only
