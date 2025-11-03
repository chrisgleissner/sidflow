# @sidflow/train

Production-ready machine learning training system for SIDFlow.

## Overview

The `sidflow-train` package provides complete training infrastructure for the SIDFlow ML model:

- **Model Lifecycle**: Load, save, train, and evaluate TensorFlow.js models
- **Feedback Integration**: Merge explicit ratings (from `sidflow-rate`) and implicit feedback (from `sidflow-play`)
- **Sample Weighting**: Different weights for explicit (1.0), like (0.7), dislike (0.5), and skip (0.3) events
- **Git-Friendly Storage**: All training data and metadata stored as JSON/JSONL for version control
- **Incremental Training**: Support for periodic retraining with new feedback

## Installation

```bash
bun install @sidflow/train
```

## CLI Usage

Train the model on available feedback data:

```bash
sidflow train
```

### Options

- `--epochs <n>` — Number of training epochs (default: 5)
- `--batch-size <n>` — Training batch size (default: 8)
- `--learning-rate <n>` — Learning rate (default: 0.001)
- `--evaluate` — Evaluate on test set (default: true)
- `--no-evaluate` — Skip test set evaluation
- `--force` — Force complete retraining from scratch
- `--help` — Show help message

### Examples

```bash
# Train with default settings
sidflow train

# Train for 10 epochs with larger batch size
sidflow train --epochs 10 --batch-size 16

# Train with custom learning rate
sidflow train --learning-rate 0.01

# Skip evaluation for faster training
sidflow train --no-evaluate
```

## Programmatic Usage

```typescript
import { trainModel, type TrainModelOptions } from "@sidflow/train";

// Train with custom options
const result = await trainModel({
  classifiedPath: "data/classified",
  feedbackPath: "data/feedback",
  trainingPath: "data/training",
  modelPath: "data",
  trainOptions: {
    epochs: 10,
    batchSize: 16,
    learningRate: 0.001
  },
  evaluate: true
});

console.log(`Trained on ${result.trainSamples} samples`);
console.log(`Test MAE: ${result.testMAE?.toFixed(4)}`);
console.log(`Test R²: ${result.testR2?.toFixed(4)}`);
```

## Data Organization

```
data/
  ├── training/
  │   ├── training-log.jsonl          # Training history (in Git)
  │   └── training-samples.jsonl      # Aggregated samples (in Git)
  ├── model/
  │   ├── feature-stats.json          # Normalization stats (in Git)
  │   ├── model-metadata.json         # Model metadata (in Git)
  │   ├── model.json                  # TF.js topology (NOT in Git)
  │   └── weights.bin                 # TF.js weights (NOT in Git)
  ├── classified/*.jsonl              # Classification outputs (in Git)
  └── feedback/YYYY/MM/DD/*.jsonl     # User feedback (in Git)
```

## Training Process

1. **Load Data**: Read classification records and feedback events from JSONL files
2. **Merge Samples**: Combine explicit ratings and implicit feedback with weights
3. **Compute Stats**: Calculate feature normalization statistics (means/stds)
4. **Train Model**: Use TensorFlow.js to train neural network
5. **Evaluate**: Compute MAE and R² on held-out test set
6. **Persist**: Save model, metadata, and training summary

## Model Architecture

- **Input**: 8 features (energy, rms, spectralCentroid, spectralRolloff, zeroCrossingRate, bpm, confidence, duration)
- **Hidden Layers**: Dense(32, ReLU) → Dropout(0.2) → Dense(16, ReLU)
- **Output**: Dense(3, tanh) mapped to ratings [1-5] for energy, mood, complexity
- **Optimizer**: Adam with configurable learning rate
- **Loss**: Mean Squared Error

## Sample Weighting

Training samples are weighted based on their source:

| Source | Weight | Description |
|--------|--------|-------------|
| Explicit | 1.0 | Manual ratings from `sidflow-rate` |
| Like | 0.7 | User liked the song during playback |
| Dislike | 0.5 | User disliked the song |
| Skip | 0.3 | User skipped the song |

## Training Summary

Each training run produces a summary logged to `data/training/training-log.jsonl`:

```json
{
  "modelVersion": "0.2.0",
  "trainedAt": "2025-11-03T18:30:00Z",
  "samples": 842,
  "metrics": { "mae": 0.41, "r2": 0.86 },
  "featureSetVersion": "2025-11-03",
  "notes": "Trained on 750 samples (500 explicit, 250 implicit)"
}
```

## Periodic Retraining (Future)

The design supports optional periodic retraining during playback:

```json
{
  "retrain": {
    "enabled": true,
    "intervalHours": 24,
    "minNewFeedback": 50
  }
}
```

This will be integrated with the future `sidflow-play` package to automatically retrain the model as new feedback accumulates.

## API Reference

### `trainModel(options)`

Train the model on explicit and implicit feedback.

**Parameters:**
- `options.classifiedPath` — Path to classified directory (default: "data/classified")
- `options.feedbackPath` — Path to feedback directory (default: "data/feedback")
- `options.trainingPath` — Path to training directory (default: "data/training")
- `options.modelPath` — Path to model directory (default: "data/model")
- `options.trainOptions` — Training configuration (epochs, batchSize, learningRate)
- `options.evaluate` — Whether to evaluate on test set (default: true)
- `options.testSplit` — Test set fraction (default: 0.2)

**Returns:** `Promise<TrainModelResult>`

### `loadClassifications(classifiedPath)`

Load classification records from JSONL files.

**Returns:** `Promise<ClassificationRecord[]>`

### `loadFeedback(feedbackPath)`

Load feedback records from date-partitioned JSONL files.

**Returns:** `Promise<FeedbackRecord[]>`

### `mergeTrainingData(classifications, feedback)`

Merge explicit ratings and implicit feedback into training samples with weights.

**Returns:** `TrainingSample[]`

### `splitTrainTest(samples, testSplit)`

Split samples into training and test sets.

**Returns:** `{ train: TrainingSample[]; test: TrainingSample[] }`

## Related Packages

- `@sidflow/classify` — Feature extraction and classification
- `@sidflow/rate` — Manual rating interface
- `@sidflow/common` — Shared utilities and types

## License

GPL-2.0-only
