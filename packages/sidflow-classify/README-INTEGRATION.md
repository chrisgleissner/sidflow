# Essentia.js and TensorFlow.js Integration

This directory contains modules for integrating Essentia.js and TensorFlow.js into the classification pipeline.

## Overview

The integration consists of two main modules:

1. **`essentia-features.ts`**: Feature extraction using Essentia.js
2. **`tfjs-predictor.ts`**: Rating prediction using TensorFlow.js

## Feature Extraction (`essentia-features.ts`)

The `essentiaFeatureExtractor` extracts audio features from WAV files using Essentia.js WASM.

### Features Extracted

- **Energy**: Total energy of the audio signal
- **RMS**: Root mean square amplitude
- **Spectral Centroid**: Center of mass of the spectrum
- **Spectral Rolloff**: Frequency below which 85% of the energy is contained
- **Zero Crossing Rate**: Rate at which the signal changes sign
- **BPM**: Estimated tempo (beats per minute)
- **Confidence**: Confidence score for BPM estimation
- **Duration**: Length of the audio in seconds
- **Sample Rate**: Audio sample rate

### Fallback Behavior

If Essentia.js is unavailable or fails to initialize, the feature extractor automatically falls back to basic feature extraction that computes:
- Energy and RMS from raw samples
- Zero crossing rate
- Estimated BPM from zero crossing rate
- Placeholder values for spectral features

### Usage

```typescript
import { essentiaFeatureExtractor } from "@sidflow/classify";

const features = await essentiaFeatureExtractor({
  wavFile: "/path/to/audio.wav",
  sidFile: "/path/to/song.sid"
});

console.log(features.bpm); // 140
console.log(features.energy); // 0.12
```

## Rating Prediction (`tfjs-predictor.ts`)

The `tfjsPredictRatings` function uses a lightweight TensorFlow.js neural network to predict (s,m,c) ratings from extracted features.

### Model Architecture

```
Input (8 features) 
  ↓
Dense Layer (32 units, ReLU)
  ↓
Dropout (20%)
  ↓
Dense Layer (16 units, ReLU)
  ↓
Dense Layer (3 units, Linear)
  ↓
Output: [s, m, c] ratings (1-5 scale)
```

### Features Used for Prediction

1. Energy
2. RMS
3. Spectral Centroid
4. Spectral Rolloff
5. Zero Crossing Rate
6. BPM
7. Confidence
8. Duration

### Normalization

Features are normalized using z-score normalization:

```
normalized = (value - mean) / std
```

The output is then scaled to the 1-5 rating range using sigmoid activation.

### Usage

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
  sidFile: "/path/to/song.sid",
  relativePath: "MUSICIANS/Artist/song.sid",
  metadata: { title: "Song Title", author: "Artist" }
});

console.log(ratings); // { s: 4, m: 3, c: 5 }
```

## CLI Integration

The new modules are automatically used by the `sidflow-classify` CLI when no custom modules are specified. You can also provide your own implementations:

```bash
# Use the built-in Essentia.js + TF.js implementation
./scripts/sidflow-classify

# Use custom feature extractor
./scripts/sidflow-classify --feature-module ./my-features.js

# Use custom predictor
./scripts/sidflow-classify --predictor-module ./my-predictor.js
```

## Training Your Own Model

The current TF.js model uses random weights for demonstration. To train a production model:

1. Collect labeled training data (manual tags)
2. Extract features using `essentiaFeatureExtractor`
3. Train a TensorFlow model on the feature-label pairs
4. Save the trained model
5. Load the model in `tfjs-predictor.ts` instead of creating a new one

Example training workflow:

```typescript
import * as tf from "@tensorflow/tfjs";

// Prepare training data
const features = [...]; // Array of feature vectors
const labels = [...];   // Array of [s, m, c] labels

const model = tf.sequential({
  layers: [
    tf.layers.dense({ inputShape: [8], units: 32, activation: "relu" }),
    tf.layers.dropout({ rate: 0.2 }),
    tf.layers.dense({ units: 16, activation: "relu" }),
    tf.layers.dense({ units: 3, activation: "linear" })
  ]
});

model.compile({
  optimizer: "adam",
  loss: "meanSquaredError",
  metrics: ["mae"]
});

// Train the model
await model.fit(featuresTensor, labelsTensor, {
  epochs: 100,
  validationSplit: 0.2
});

// Save the model
await model.save("file://./trained-model");
```

## Performance

- **Feature Extraction**: ~50-100ms per WAV file (depends on file size)
- **Prediction**: ~1-5ms per prediction
- **Memory**: Minimal overhead with lazy loading and proper disposal

## Dependencies

- `essentia.js@^0.1.3`: Music information retrieval and feature extraction
- `@tensorflow/tfjs@^4.22.0`: Machine learning prediction

## Notes

- Essentia.js requires WebAssembly support
- The fallback feature extractor ensures the pipeline works even without Essentia.js
- The TF.js model runs in CPU mode by default (use `@tensorflow/tfjs-node` for GPU acceleration)
- Model weights are currently random; train with your labeled data for accurate predictions
