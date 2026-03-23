#!/usr/bin/env bun

import process from "node:process";
import path from "node:path";
import { readFile, copyFile } from "node:fs/promises";
import {
  parseArgs,
  formatHelp,
  handleParseResult,
  pathExists,
  ensureDir,
  type ArgDef
} from "@sidflow/common";
import { trainModel, type TrainModelOptions } from "./index.js";
import { runScheduler } from "./scheduler.js";

const METRIC_MODEL_FILENAME = "metric-model.json";
const MAX_VERSIONS = 5;

let trainModelOverride: typeof trainModel | undefined;
let runSchedulerOverride: typeof runScheduler | undefined;

export function __setTrainCliTestOverrides(overrides?: {
  trainModel?: typeof trainModel;
  runScheduler?: typeof runScheduler;
}): void {
  trainModelOverride = overrides?.trainModel;
  runSchedulerOverride = overrides?.runScheduler;
}

interface CliOptions {
  config?: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  evaluate?: boolean;
  force?: boolean;
  rollback?: number;
  listModels?: boolean;
  auto?: boolean;
  modelPath?: string;
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
  },
  {
    name: "--rollback",
    type: "integer",
    description: "Roll back to model version N (1–5)",
    constraints: { min: 1, max: MAX_VERSIONS }
  },
  {
    name: "--list-models",
    type: "boolean",
    description: "List available model versions and exit"
  },
  {
    name: "--auto",
    type: "boolean",
    description: "Run the automatic retraining scheduler (D4)"
  },
  {
    name: "--model-path",
    type: "string",
    description: "Path to the model directory (default: data/model)"
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
    "sidflow-train --no-evaluate        # Skip test set evaluation",
    "sidflow-train --auto               # Run scheduler (auto retraining)",
    "sidflow-train --list-models        # List saved model versions",
    "sidflow-train --rollback 1         # Roll back to model v1"
  ]
);

// ---------------------------------------------------------------------------
// Model version helpers
// ---------------------------------------------------------------------------

async function listModels(modelPath: string): Promise<void> {
  process.stdout.write("=== Model Versions ===\n");

  const currentFile = path.join(modelPath, "current", METRIC_MODEL_FILENAME);
  if (await pathExists(currentFile)) {
    const raw = await readFile(currentFile, "utf8");
    const m = JSON.parse(raw) as { version?: number; trainedAt?: string };
    process.stdout.write(
      `  current  v${m.version ?? "?"}  trained ${m.trainedAt ?? "unknown"}\n`
    );
  } else {
    process.stdout.write("  current  (none)\n");
  }

  for (let v = 1; v <= MAX_VERSIONS; v++) {
    const vFile = path.join(modelPath, `v${v}`, METRIC_MODEL_FILENAME);
    if (await pathExists(vFile)) {
      const raw = await readFile(vFile, "utf8");
      const m = JSON.parse(raw) as { version?: number; trainedAt?: string };
      process.stdout.write(
        `  v${v}       v${m.version ?? "?"}  trained ${m.trainedAt ?? "unknown"}\n`
      );
    }
  }
}

async function rollbackModel(modelPath: string, version: number): Promise<boolean> {
  const srcFile = path.join(modelPath, `v${version}`, METRIC_MODEL_FILENAME);
  if (!(await pathExists(srcFile))) {
    process.stderr.write(`No model found at v${version}\n`);
    return false;
  }

  const currentPath = path.join(modelPath, "current");
  await ensureDir(currentPath);
  await copyFile(srcFile, path.join(currentPath, METRIC_MODEL_FILENAME));
  process.stdout.write(`Rolled back to v${version}\n`);
  return true;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function runTrainCli(argv: string[]): Promise<number> {
  const result = parseArgs<CliOptions>(argv, ARG_DEFS);

  const exitCode = handleParseResult(result, HELP_TEXT);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;
  const modelPath = options.modelPath ?? "data/model";

  try {
    // === --list-models ===
    if (options.listModels) {
      await listModels(modelPath);
      return 0;
    }

    // === --rollback <version> ===
    if (options.rollback !== undefined) {
      const ok = await rollbackModel(modelPath, options.rollback);
      return ok ? 0 : 1;
    }

    // === --auto (scheduler) ===
    if (options.auto) {
      const scheduler = runSchedulerOverride ?? runScheduler;
      const schedulerResult = await scheduler({
        modelPath,
        force: options.force,
        trainOptions: {
          epochs: options.epochs,
          batchSize: options.batchSize,
          learningRate: options.learningRate,
        },
      });

      if (!schedulerResult.triggered) {
        process.stdout.write(
          `No trigger: ${schedulerResult.newEventCount} total events` +
            ` (need ${50} new events or time interval elapsed)\n`
        );
        return 0;
      }

      process.stdout.write(`Scheduler triggered (${schedulerResult.reason})\n`);
      if (schedulerResult.evaluation) {
        const e = schedulerResult.evaluation;
        process.stdout.write(`Evaluation: ${e.summary}\n`);
        process.stdout.write(
          `Metrics passed: ${e.passed}/${e.required} → ${e.promote ? "PROMOTED" : "REJECTED"}\n`
        );
      }
      process.stdout.write(
        schedulerResult.promoted ? "New model promoted to current\n" : "Challenger rejected\n"
      );
      return 0;
    }

    // === Default: standard train ===
    const trainOptions: TrainModelOptions = {
      modelPath,
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

    process.stdout.write(`\nModel saved to ${modelPath}/\n`);
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
