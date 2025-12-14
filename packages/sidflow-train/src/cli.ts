#!/usr/bin/env bun

import process from "node:process";
import {
  parseArgs,
  formatHelp,
  handleParseResult,
  type ArgDef
} from "@sidflow/common";
import { trainModel, type TrainModelOptions } from "./index.js";

let trainModelOverride: typeof trainModel | undefined;

export function __setTrainCliTestOverrides(overrides?: {
  trainModel?: typeof trainModel;
}): void {
  trainModelOverride = overrides?.trainModel;
}

interface CliOptions {
  config?: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  evaluate?: boolean;
  force?: boolean;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json"
  },
  {
    name: "--epochs",
    type: "integer",
    description: "Number of training epochs",
    defaultValue: 5,
    constraints: { positive: true }
  },
  {
    name: "--batch-size",
    type: "integer",
    description: "Training batch size",
    defaultValue: 8,
    constraints: { positive: true }
  },
  {
    name: "--learning-rate",
    type: "float",
    description: "Learning rate",
    defaultValue: 0.001,
    constraints: { positive: true }
  },
  {
    name: "--evaluate",
    type: "boolean",
    description: "Evaluate on test set",
    defaultValue: true,
    negation: "--no-evaluate"
  },
  {
    name: "--force",
    type: "boolean",
    description: "Force complete retraining from scratch"
  }
];

const HELP_TEXT = formatHelp(
  "sidflow-train [options]",
  "Train the ML model on explicit and implicit feedback data.",
  ARG_DEFS,
  [
    "sidflow-train                      # Train with default settings",
    "sidflow-train --epochs 10          # Train for 10 epochs",
    "sidflow-train --force              # Force complete retraining",
    "sidflow-train --no-evaluate        # Skip test set evaluation"
  ]
);

export async function runTrainCli(argv: string[]): Promise<number> {
  const result = parseArgs<CliOptions>(argv, ARG_DEFS);

  const exitCode = handleParseResult(result, HELP_TEXT);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;

  try {
    const trainOptions: TrainModelOptions = {
      trainOptions: {
        epochs: options.epochs,
        batchSize: options.batchSize,
        learningRate: options.learningRate
      },
      evaluate: options.evaluate
    };

    const train = trainModelOverride ?? trainModel;
    const trainResult = await train(trainOptions);

    // Print summary
    process.stdout.write("\n=== Training Summary ===\n");
    process.stdout.write(`Training samples: ${trainResult.trainSamples}\n`);
    process.stdout.write(`Test samples: ${trainResult.testSamples}\n`);
    process.stdout.write(`Training loss: ${trainResult.trainLoss.toFixed(4)}\n`);
    process.stdout.write(`Training MAE: ${trainResult.trainMAE.toFixed(4)}\n`);

    if (trainResult.testMAE !== undefined) {
      process.stdout.write(`Test MAE: ${trainResult.testMAE.toFixed(4)}\n`);
    }

    if (trainResult.testR2 !== undefined) {
      process.stdout.write(`Test R²: ${trainResult.testR2.toFixed(4)}\n`);
    }

    process.stdout.write("\nModel saved to data/model/\n");
    process.stdout.write("Training summary saved to data/training/training-log.jsonl\n");

    return 0;
  } catch (error) {
    process.stderr.write(`Training failed: ${(error as Error).message}\n`);
    if (process.env.DEBUG) {
      console.error(error);
    }
    return 1;
  }
}

if (import.meta.main) {
  runTrainCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
