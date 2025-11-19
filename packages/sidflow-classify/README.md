# @sidflow/classify

Automatic classification of SID music files by **energy**, **mood**, and **complexity** through audio feature extraction and rating prediction.

---

## Overview

`@sidflow/classify` is the core classification engine for SIDFlow. It:

1. **Renders SID files to WAV** using libsidplayfp
2. **Extracts audio features** (tempo, spectral centroid, RMS energy, etc.)
3. **Predicts ratings** for energy (e), mood (m), and complexity (c)
4. **Generates JSONL metadata** for downstream training and playback

The package supports both **deterministic heuristic** ratings (default) and **ML-based** ratings via TensorFlow.js.

---

## Installation

```bash
cd packages/sidflow-classify
bun install
```

---

## CLI Usage

### Basic Classification

```bash
# Classify entire collection using default heuristic predictor
./scripts/sidflow-classify

# Use custom config file
./scripts/sidflow-classify --config ./my-config.json

# Force rebuild of WAV cache (re-render even if files are cached)
./scripts/sidflow-classify --force-rebuild
```

### Advanced: Custom Modules

You can override any component with your own implementation:

```bash
# Custom feature extractor
./scripts/sidflow-classify --feature-module ./my-features.js

# Custom rating predictor (e.g., trained TensorFlow.js model)
./scripts/sidflow-classify --predictor-module ./my-predictor.js

# Custom metadata extractor
./scripts/sidflow-classify --metadata-module ./my-metadata.js

# Custom WAV renderer
./scripts/sidflow-classify --render-module ./my-renderer.js
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Use an alternate `.sidflow.json` file |
| `--force-rebuild` | Re-render WAVs even if cache is fresh |
| `--feature-module <path>` | Module exporting a `featureExtractor` override |
| `--predictor-module <path>` | Module exporting a `predictRatings` override |
| `--metadata-module <path>` | Module exporting an `extractMetadata` override |
| `--render-module <path>` | Module exporting a `render` override for WAV cache |
| `--help` | Show help message |

---

## Architecture

### Pipeline Stages

```
┌─────────────────┐
│  SID Files      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ WAV Rendering   │  Convert SID → WAV (libsidplayfp)
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Feature Extract │  Extract tempo, energy, spectral features
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Rating Predict  │  Generate (e, m, c) ratings
└────────┬────────┘
         │
         v
┌─────────────────┐
│ JSONL Output    │  Write classified metadata
└─────────────────┘
```

### Default Implementations

**Heuristic Predictor (Default)**
- Deterministic, seed-based ratings
- Uses file path, metadata, and file sizes to compute stable seeds
- Fast, reproducible, requires no training
- Implementation: `heuristicPredictRatings`

**TensorFlow.js Predictor (Optional)**
- Neural network-based ratings
- Requires trained model or uses placeholder weights
- Supports feature normalization and model persistence
- Implementation: `tfjsPredictRatings`

For ML integration details, see [README-INTEGRATION.md](./README-INTEGRATION.md).

---

## Programmatic API

### Core Functions

#### `planClassification(options)`

Validates configuration and prepares paths for classification.

```typescript
import { planClassification } from "@sidflow/classify";

const plan = await planClassification({
  configPath: "./.sidflow.json"
});

console.log(plan.sidPath);      // Collection root
console.log(plan.wavCachePath); // WAV cache directory
console.log(plan.tagsPath);     // Output tags directory
```

#### `buildWavCache(options)`

Renders SID files to WAV format, using cached files when available.

```typescript
import { buildWavCache } from "@sidflow/classify";

const result = await buildWavCache({
  plan,
  threads: 4,
  forceRebuild: false,
  onProgress: (progress) => {
    console.log(`${progress.completed}/${progress.total} WAVs rendered`);
  }
});

console.log(`Rendered: ${result.rendered}, Cached: ${result.cached}`);
```

#### `generateAutoTags(options)`

Extracts features and generates ratings for all SID files.

```typescript
import { generateAutoTags, heuristicFeatureExtractor, heuristicPredictRatings } from "@sidflow/classify";

const result = await generateAutoTags({
  plan,
  featureExtractor: heuristicFeatureExtractor,
  predictRatings: heuristicPredictRatings,
  threads: 4,
  onProgress: (progress) => {
    console.log(`${progress.completed}/${progress.total} songs classified`);
  }
});

console.log(`Tags generated: ${result.total}`);
```

---

## Feature Extraction

### Heuristic Feature Extractor

Extracts basic file-based features without audio analysis:

```typescript
import { heuristicFeatureExtractor } from "@sidflow/classify";

const features = await heuristicFeatureExtractor({
  wavFile: "/path/to/song.wav",
  sidFile: "/path/to/song.sid"
});

console.log(features);
// { wavBytes: 123456, sidBytes: 4567, nameSeed: 42 }
```

### Essentia.js Feature Extractor (Advanced)

Extracts detailed audio features using Essentia.js WASM:

```typescript
import { essentiaFeatureExtractor } from "@sidflow/classify";

const features = await essentiaFeatureExtractor({
  wavFile: "/path/to/song.wav",
  sidFile: "/path/to/song.sid"
});

console.log(features);
// {
//   energy: 0.12,
//   rms: 0.11,
//   spectralCentroid: 2500,
//   spectralRolloff: 5000,
//   zeroCrossingRate: 0.15,
//   bpm: 140,
//   confidence: 0.8,
//   duration: 180,
//   sampleRate: 44100
// }
```

---

## Rating Prediction

### Heuristic Predictor (Default)

Generates deterministic ratings based on file paths and metadata:

```typescript
import { heuristicPredictRatings } from "@sidflow/classify";

const ratings = await heuristicPredictRatings({
  features: { wavBytes: 123456, sidBytes: 4567, nameSeed: 42 },
  relativePath: "MUSICIANS/Hubbard_Rob/Commando.sid",
  metadata: { title: "Commando", author: "Rob Hubbard" }
});

console.log(ratings);
// { e: 4, m: 3, c: 5 }
```

The heuristic predictor uses `computeSeed(relativePath + metadata.title)` to generate stable, reproducible ratings. Same file path + metadata always yields the same ratings.

### TensorFlow.js Predictor (Optional)

Predicts ratings using a trained neural network:

```typescript
import { tfjsPredictRatings } from "@sidflow/classify";

const ratings = await tfjsPredictRatings({
  features: {
    energy: 0.12,
    rms: 0.11,
    spectralCentroid: 2500,
    spectralRolloff: 5000,
    zeroCrossingRate: 0.15,
    bpm: 140,
    confidence: 0.8,
    duration: 180
  },
  relativePath: "MUSICIANS/Hubbard_Rob/Commando.sid",
  metadata: { title: "Commando", author: "Rob Hubbard" }
});

console.log(ratings);
// { e: 4, m: 3, c: 5 }
```

For training your own model, see [README-INTEGRATION.md](./README-INTEGRATION.md).

---

## Configuration

Classification reads settings from `.sidflow.json`:

```json
{
  "sidPath": "./workspace/hvsc",
  "wavCachePath": "./workspace/wav-cache",
  "tagsPath": "./workspace/tags",
  "threads": 0,
  "classificationDepth": 3
}
```

| Field | Description |
|-------|-------------|
| `sidPath` | Root directory of SID collection |
| `wavCachePath` | Directory for rendered WAV cache |
| `tagsPath` | Directory for classification output |
| `threads` | Number of worker threads (0 = CPU count) |
| `classificationDepth` | Directory depth to traverse |

---

## Output Format

Classification generates JSONL (JSON Lines) files in `tagsPath`:

```jsonl
{"sid":"MUSICIANS/Hubbard_Rob/Commando.sid","e":4,"m":3,"c":5,"title":"Commando","author":"Rob Hubbard","released":"1985"}
{"sid":"MUSICIANS/Galway_Martin/Times_of_Lore.sid","e":3,"m":4,"c":4,"title":"Times of Lore","author":"Martin Galway","released":"1988"}
```

Each line contains:
- `sid`: Relative path to SID file
- `e`: Energy rating (1-5)
- `m`: Mood rating (1-5)
- `c`: Complexity rating (1-5)
- `title`, `author`, `released`: Extracted metadata

---

## Performance

- **WAV Rendering**: ~100ms per SID file (cached after first render)
- **Feature Extraction** (heuristic): <1ms per file
- **Feature Extraction** (Essentia.js): ~50-100ms per WAV
- **Rating Prediction** (heuristic): <1ms per file
- **Rating Prediction** (TensorFlow.js): ~1-5ms per file

For large collections (10,000+ files), classification typically completes in 5-15 minutes with multi-threading.

---

## Testing

```bash
cd packages/sidflow-classify
bun test
```

Tests cover:
- CLI argument parsing
- WAV cache building and freshness detection
- Feature extraction (heuristic and Essentia.js)
- Rating prediction (heuristic and TensorFlow.js)
- JSONL generation
- Error handling and fallbacks

---

## Dependencies

- **libsidplayfp**: SID rendering engine (via `@sidflow/play`)
- **Essentia.js**: Audio feature extraction (optional)
- **TensorFlow.js**: Machine learning prediction (optional)

---

## References

- [Technical Reference](../../doc/technical-reference.md) - Architecture and data flow
- [README-INTEGRATION.md](./README-INTEGRATION.md) - ML integration details
- [User Guide](../../doc/user-guide.md) - End-to-end workflows
